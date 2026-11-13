import { Router } from "express";
import { z } from "zod";
import { handleAlexa } from "../alexa/handler.js";
import { freshTimestamp, verifyAlexaRequest } from "../alexa/verify.js";
import { resolveBiz } from "../bot/engine.js";
import { markPaid } from "../bot/customer/payment.js";
import { httpGateway } from "../convexa/client.js";
import { env } from "../env.js";
import { errorInfo, log } from "../lib/log.js";
import { systemCtx } from "../jobs/tick.js";
import { getPayment, verifyWebhook } from "../payments/mercadopago.js";
import { payments } from "../payments/repo.js";
import { links } from "../settings/links.js";
import { finishOAuth } from "../google/oauth.js";
import { settingsRepo } from "../settings/settings.js";
import { HttpError, requireAutomacaoKey, toGraph, wrap } from "./util.js";

export const integrationRoutes = Router();

// ------------------------------------------------------------------ Alexa (via n8n)
integrationRoutes.post(
  "/v1/alexa",
  requireAutomacaoKey,
  wrap(async (req, res) => {
    const body = z.object({ rawBody: z.string(), signature: z.string().nullable().optional(), certUrl: z.string().nullable().optional() }).parse(req.body);
    const alexaReq = JSON.parse(body.rawBody);
    if (env().ALEXA_VERIFY_SIGNATURE) {
      const ok = await verifyAlexaRequest(body).catch(() => false);
      if (!ok) throw new HttpError(400, "Assinatura da Alexa inválida");
    }
    if (!freshTimestamp(alexaReq?.request?.timestamp)) throw new HttpError(400, "Requisição da Alexa fora do prazo");
    const appId = alexaReq?.context?.System?.application?.applicationId ?? alexaReq?.session?.application?.applicationId;
    if (env().ALEXA_SKILL_ID && appId !== env().ALEXA_SKILL_ID) throw new HttpError(400, "Skill não reconhecida");
    const result = await handleAlexa(httpGateway, alexaReq);
    res.json({ alexa: result.alexa, batches: result.phoneNumberId && result.outbound.length ? [toGraph(result.phoneNumberId, result.outbound)] : [] });
  }),
);

// ------------------------------------------------------------------ Mercado Pago (via n8n)
integrationRoutes.post(
  "/v1/webhooks/mercadopago",
  requireAutomacaoKey,
  wrap(async (req, res) => {
    const input = z
      .object({ businessId: z.string().uuid(), query: z.record(z.string(), z.any()).optional(), body: z.any(), signature: z.string().nullable().optional(), requestId: z.string().nullable().optional() })
      .parse(req.body);
    const dataId = String(input.body?.data?.id ?? input.query?.["data.id"] ?? input.query?.id ?? "");
    const type = String(input.body?.type ?? input.query?.type ?? input.query?.topic ?? "");
    if (!dataId || (type && type !== "payment")) return res.json({ batches: [] });

    const secrets = await settingsRepo.secrets(input.businessId);
    if (!secrets.mercadoPagoAccessToken) throw new HttpError(404, "Empresa sem Mercado Pago configurado");
    if (secrets.mercadoPagoWebhookSecret && !verifyWebhook(secrets.mercadoPagoWebhookSecret, { signature: input.signature ?? undefined, requestId: input.requestId ?? undefined }, dataId)) {
      throw new HttpError(401, "Assinatura do Mercado Pago não confere");
    }
    // Nunca confia no corpo do aviso: consulta o pagamento na API do Mercado Pago
    const mp = await getPayment(secrets.mercadoPagoAccessToken, dataId);
    const p = await payments.byProviderRef("mercadopago", mp.id);
    if (!p || p.businessId !== input.businessId || mp.status !== "approved") return res.json({ batches: [] });

    const link = await links.get(p.businessId);
    if (!link?.metaPhoneNumberId) return res.json({ batches: [] });
    const biz = await resolveBiz(httpGateway, link.metaPhoneNumberId);
    const ctx = systemCtx(biz, httpGateway);
    try {
      if (await markPaid(ctx, p, "mercadopago")) {
        await ctx.notifyOwner(`💰 Pix recebido pelo Mercado Pago: ${p.customerName ?? "cliente"}, ${p.summary.service} ${p.summary.time}.`);
      }
    } catch (error) {
      log.error("falha ao confirmar pagamento do Mercado Pago", errorInfo(error));
    }
    res.json({ batches: ctx.out.length ? [toGraph(biz.phoneNumberId, ctx.out)] : [] });
  }),
);

// ------------------------------------------------------------------ Google: volta do consentimento
integrationRoutes.get(
  "/v1/google/callback",
  wrap(async (req, res) => {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    const back = env().PANEL_URL;
    if (req.query.error || !code || !state) return res.redirect(`${back}/#/automacao?google=cancelado`);
    try {
      const businessId = await finishOAuth(code, state);
      await settingsRepo.update(businessId, { google: { enabled: true } });
      res.redirect(`${back}/#/automacao?google=ok`);
    } catch (error) {
      log.warn("conexão com Google falhou", errorInfo(error));
      res.redirect(`${back}/#/automacao?google=erro`);
    }
  }),
);
