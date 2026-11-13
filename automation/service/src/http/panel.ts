import { randomInt } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { Ctx } from "../bot/context.js";
import { conversations, messageLog } from "../bot/conversations.js";
import { markPaid, reject } from "../bot/customer/payment.js";
import { campaigns } from "../bot/owner/campaigns.js";
import { resolveBiz } from "../bot/engine.js";
import { forgetOwnerToken, httpGateway, tryOwnerLogin } from "../convexa/client.js";
import { ConvexaError } from "../convexa/types.js";
import { db } from "../db/pool.js";
import { env } from "../env.js";
import { canonicalPhone } from "../lib/phone.js";
import { signedUrl } from "../lib/signed.js";
import { llmEnabled } from "../nlu/llm.js";
import * as ops from "../owner/ops.js";
import { payments } from "../payments/repo.js";
import { links } from "../settings/links.js";
import { SEGMENTS, secretsSchema, settingsRepo } from "../settings/settings.js";
import * as wa from "../whatsapp/messages.js";
import { authUrl, disconnect, googleConfigured, googleStatus } from "../google/oauth.js";
import { syncGoogle } from "../google/sync.js";
import { deliver } from "./outbox.js";
import { ownerOnly, panelAuth } from "./panel-auth.js";
import { HttpError, wrap } from "./util.js";

export const panelRoutes = Router();
panelRoutes.use("/v1/panel", panelAuth);

async function bizFor(req: Parameters<typeof panelAuth>[0]) {
  const b = req.panel!.business;
  if (!b.metaPhoneNumberId) throw new HttpError(409, "Cadastre o número do WhatsApp (Meta) da empresa antes de usar a automação");
  return resolveBiz(httpGateway, b.metaPhoneNumberId);
}

function panelCtx(biz: Awaited<ReturnType<typeof resolveBiz>>) {
  return new Ctx(biz, httpGateway, "panel", { businessId: biz.businessId, phone: "panel", waId: null, name: null, role: "owner", state: {}, pausedUntil: null, lastInboundAt: null }, {});
}

// ------------------------------------------------------------------ status geral
panelRoutes.get(
  "/v1/panel/status",
  wrap(async (req, res) => {
    const p = req.panel!;
    await links.ensure({ businessId: p.businessId, name: p.business.name, timezone: p.business.timezone, metaPhoneNumberId: p.business.metaPhoneNumberId });
    const [link, settings, secrets, pending, google, alexa] = await Promise.all([
      links.get(p.businessId),
      settingsRepo.get(p.businessId),
      settingsRepo.secrets(p.businessId),
      payments.list(p.businessId, ["under_review"], 50),
      googleStatus(p.businessId),
      db().query<{ n: string }>("SELECT count(*) AS n FROM alexa_link WHERE business_id = $1", [p.businessId]),
    ]);
    res.json({
      business: { id: p.business.id, name: p.business.name, timezone: p.business.timezone, phone: p.business.phone },
      whatsapp: { phoneNumberId: p.business.metaPhoneNumberId, configured: !!p.business.metaPhoneNumberId },
      link: { status: link?.status ?? "pending", ownerEmail: link?.ownerEmail ?? null, lastError: link?.lastError ?? null, linkedAt: link?.linkedAt ?? null },
      settings,
      secrets: { mercadoPagoAccessToken: !!secrets.mercadoPagoAccessToken, mercadoPagoWebhookSecret: !!secrets.mercadoPagoWebhookSecret },
      segments: Object.entries(SEGMENTS).map(([id, s]) => ({ id, label: s.label })),
      pendingPayments: pending.length,
      google,
      alexa: { linkedDevices: Number(alexa.rows[0]?.n ?? 0) },
      ai: { enabled: llmEnabled(), model: llmEnabled() ? env().ANTHROPIC_MODEL : null },
      delivery: { configured: !!env().N8N_SEND_WEBHOOK_URL },
    });
  }),
);

// ------------------------------------------------------------------ configurações
panelRoutes.put(
  "/v1/panel/settings",
  ownerOnly,
  wrap(async (req, res) => {
    const patch = z.record(z.string(), z.unknown()).parse(req.body);
    if (Array.isArray(patch.ownerPhones)) patch.ownerPhones = (patch.ownerPhones as string[]).map(canonicalPhone).filter(Boolean);
    const settings = await settingsRepo.update(req.panel!.businessId, patch);
    res.json({ settings });
  }),
);

panelRoutes.put(
  "/v1/panel/secrets",
  ownerOnly,
  wrap(async (req, res) => {
    await settingsRepo.updateSecrets(req.panel!.businessId, secretsSchema.parse(req.body));
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ conectar a automação ao dono
panelRoutes.post(
  "/v1/panel/link",
  ownerOnly,
  wrap(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const p = req.panel!;
    let session;
    try {
      session = await tryOwnerLogin(email, password);
    } catch (error) {
      if (error instanceof ConvexaError && error.status === 401) throw new HttpError(400, "E-mail ou senha não conferem");
      throw error;
    }
    if (session.business.id !== p.businessId) throw new HttpError(403, "Essa conta é de outra empresa");
    await links.ensure({ businessId: p.businessId, name: p.business.name, timezone: p.business.timezone, metaPhoneNumberId: p.business.metaPhoneNumberId });
    await links.saveCredentials(p.businessId, email, password);
    forgetOwnerToken(p.businessId);
    const settings = await settingsRepo.get(p.businessId);
    if (settings.ownerPhones.length === 0 && p.business.phone) {
      await settingsRepo.update(p.businessId, { ownerPhones: [canonicalPhone(p.business.phone)] });
    }
    res.json({ ok: true });
  }),
);

panelRoutes.delete(
  "/v1/panel/link",
  ownerOnly,
  wrap(async (req, res) => {
    await links.unlink(req.panel!.businessId);
    forgetOwnerToken(req.panel!.businessId);
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ pagamentos
panelRoutes.get(
  "/v1/panel/payments",
  wrap(async (req, res) => {
    const status = typeof req.query.status === "string" ? (req.query.status.split(",") as never) : undefined;
    const list = await payments.list(req.panel!.businessId, status, 100);
    res.json({
      data: list.map((p) => ({
        ...p,
        pixCode: undefined,
        receiptUrl: p.hasReceipt ? signedUrl(`/v1/receipts/${p.id}`, 3600) : null,
      })),
    });
  }),
);

panelRoutes.post(
  "/v1/panel/payments/:id/:action",
  ownerOnly,
  wrap(async (req, res) => {
    const action = z.enum(["approve", "reject"]).parse(req.params.action);
    const p = await payments.get(String(req.params.id));
    if (!p || p.businessId !== req.panel!.businessId) throw new HttpError(404, "Pagamento não encontrado");
    const biz = await bizFor(req);
    const ctx = panelCtx(biz);
    const ok = action === "approve" ? await markPaid(ctx, p, `painel:${req.panel!.userId}`) : await reject(ctx, p, `painel:${req.panel!.userId}`);
    if (!ok) throw new HttpError(409, "Esse pagamento já foi resolvido");
    const sent = await deliver(biz.phoneNumberId, ctx.out);
    res.json({ ok: true, notified: sent.delivered });
  }),
);

// ------------------------------------------------------------------ conversas e atendimento humano
panelRoutes.get(
  "/v1/panel/conversations",
  wrap(async (req, res) => {
    const list = await conversations.recent(req.panel!.businessId, 60);
    res.json({
      data: list.map((c) => ({
        phone: c.phone,
        name: c.name,
        role: c.role,
        pausedUntil: c.pausedUntil,
        lastInboundAt: c.lastInboundAt,
        lastBody: c.lastBody,
        lastAt: c.lastAt,
        windowOpen: !!c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < 24 * 3600_000,
      })),
    });
  }),
);

panelRoutes.get(
  "/v1/panel/conversations/:phone",
  wrap(async (req, res) => {
    const phone = canonicalPhone(String(req.params.phone));
    res.json({ data: await messageLog.history(req.panel!.businessId, phone, 200) });
  }),
);

panelRoutes.post(
  "/v1/panel/conversations/:phone/reply",
  ownerOnly,
  wrap(async (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
    const phone = canonicalPhone(String(req.params.phone));
    const biz = await bizFor(req);
    if (!(await conversations.windowOpen(biz.businessId, phone))) {
      throw new HttpError(409, "Passaram 24h desde a última mensagem do cliente. A Meta só deixa responder com template.");
    }
    // quem responde pelo painel assume a conversa: o bot fica quieto
    await conversations.pause(biz.businessId, phone, new Date(Date.now() + biz.settings.handoffHours * 3600_000));
    const out = wa.text(phone, text);
    await messageLog.outbound({ businessId: biz.businessId, phone, kind: "text", body: `[painel] ${text}`, payload: out.body });
    const sent = await deliver(biz.phoneNumberId, [out]);
    res.json({ ok: sent.delivered });
  }),
);

panelRoutes.post(
  "/v1/panel/conversations/:phone/resume",
  wrap(async (req, res) => {
    await conversations.pause(req.panel!.businessId, canonicalPhone(String(req.params.phone)), null);
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ aviso aos clientes do dia
panelRoutes.post(
  "/v1/panel/notice",
  ownerOnly,
  wrap(async (req, res) => {
    const { date, message } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), message: z.string().trim().min(3).max(500) }).parse(req.body);
    const biz = await bizFor(req);
    const owner = await httpGateway.owner(biz.businessId);
    if (!owner) throw new HttpError(412, "Conecte a automação primeiro");
    const targets = await ops.remainingToday(owner, biz.timezone, date);
    if (targets.length === 0) return res.json({ sent: 0 });
    const ctx = panelCtx(biz);
    await campaigns.create(ctx, "notice", targets, { message, createdBy: "panel" });
    const sent = await deliver(biz.phoneNumberId, ctx.out);
    res.json({ sent: targets.length, delivered: sent.delivered });
  }),
);

// ------------------------------------------------------------------ relatório
panelRoutes.get(
  "/v1/panel/reports/revenue",
  wrap(async (req, res) => {
    const period = z.enum(["today", "week", "month", "last_month"]).default("month").parse(req.query.period ?? undefined);
    const owner = await httpGateway.owner(req.panel!.businessId);
    if (!owner) throw new HttpError(412, "Conecte a automação primeiro");
    const settings = await settingsRepo.get(req.panel!.businessId);
    res.json(await ops.revenue(owner, req.panel!.business.timezone, req.panel!.businessId, period, settings.costPercent));
  }),
);

// ------------------------------------------------------------------ Alexa: código de vínculo
panelRoutes.post(
  "/v1/panel/alexa/code",
  ownerOnly,
  wrap(async (req, res) => {
    const code = String(randomInt(100000, 999999));
    await db().query("DELETE FROM link_code WHERE business_id = $1 AND purpose = 'alexa'", [req.panel!.businessId]);
    await db().query("INSERT INTO link_code (code, business_id, purpose, expires_at) VALUES ($1, $2, 'alexa', now() + interval '15 minutes')", [
      code,
      req.panel!.businessId,
    ]);
    res.json({ code, expiresInMinutes: 15 });
  }),
);

panelRoutes.delete(
  "/v1/panel/alexa",
  ownerOnly,
  wrap(async (req, res) => {
    await db().query("DELETE FROM alexa_link WHERE business_id = $1", [req.panel!.businessId]);
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ Google Agenda
panelRoutes.get(
  "/v1/panel/google/connect",
  ownerOnly,
  wrap(async (req, res) => {
    if (!googleConfigured()) throw new HttpError(501, "Google Agenda não configurado no servidor (GOOGLE_CLIENT_ID/SECRET)");
    res.json({ url: await authUrl(req.panel!.businessId) });
  }),
);

panelRoutes.post(
  "/v1/panel/google/sync",
  wrap(async (req, res) => {
    const biz = await bizFor(req);
    await syncGoogle(panelCtx(biz));
    res.json(await googleStatus(biz.businessId));
  }),
);

panelRoutes.delete(
  "/v1/panel/google",
  ownerOnly,
  wrap(async (req, res) => {
    await disconnect(req.panel!.businessId);
    await settingsRepo.update(req.panel!.businessId, { google: { enabled: false } });
    res.json({ ok: true });
  }),
);
