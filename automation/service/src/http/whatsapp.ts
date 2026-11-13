import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { handleInbound } from "../bot/engine.js";
import { httpGateway, metaCredentials } from "../convexa/client.js";
import { env } from "../env.js";
import { errorInfo, log } from "../lib/log.js";
import { checkSignature } from "../lib/signed.js";
import { tick } from "../jobs/tick.js";
import { payments } from "../payments/repo.js";
import { parseWebhook, verifySignature } from "../whatsapp/inbound.js";
import { HttpError, requireAutomacaoKey, toGraph, wrap } from "./util.js";

export const whatsappRoutes = Router();

const inboundSchema = z.object({
  payload: z.unknown(),
  rawBody: z.string().optional(),
  signature: z.string().optional(),
  media: z.record(z.string(), z.object({ mimeType: z.string(), base64: z.string() })).optional(),
});

/**
 * O n8n repassa o webhook da Meta. Responde com as mensagens a enviar,
 * já no formato da Graph API, agrupadas pelo número que envia.
 */
whatsappRoutes.post(
  "/v1/whatsapp/inbound",
  requireAutomacaoKey,
  wrap(async (req, res) => {
    const body = inboundSchema.parse(req.body);
    const payload = body.rawBody ? JSON.parse(body.rawBody) : body.payload;
    const { messages, statuses } = parseWebhook(payload);

    // Assinatura da Meta: confere com o app secret da empresa dona do número
    const phoneNumberIds = [...new Set([...messages, ...statuses].map((m) => m.phoneNumberId))];
    if (env().WHATSAPP_REQUIRE_SIGNATURE) {
      if (!body.rawBody || !body.signature) throw new HttpError(401, "Webhook sem assinatura");
      for (const id of phoneNumberIds) {
        const creds = await metaCredentials(id);
        if (!creds?.metaAppSecret || !verifySignature(body.rawBody, body.signature, creds.metaAppSecret)) {
          throw new HttpError(401, "Assinatura da Meta não confere");
        }
      }
    }

    for (const s of statuses) {
      if (s.status === "failed") log.warn("Meta não entregou mensagem", { wamid: s.wamid, errors: s.errors as never });
    }

    const batches = new Map<string, ReturnType<typeof toGraph>>();
    for (const m of messages) {
      const media = m.media?.id ? body.media?.[m.media.id] : undefined;
      try {
        const outs = await handleInbound(httpGateway, m, media ? { mimeType: media.mimeType, data: Buffer.from(media.base64, "base64") } : undefined);
        const batch = batches.get(m.phoneNumberId) ?? toGraph(m.phoneNumberId, []);
        batch.messages.push(...toGraph(m.phoneNumberId, outs).messages);
        batches.set(m.phoneNumberId, batch);
      } catch (error) {
        log.error("mensagem não processada", { phoneNumberId: m.phoneNumberId, ...errorInfo(error) });
      }
    }
    res.json({ batches: [...batches.values()] });
  }),
);

/** Disparado pelo cron do n8n a cada 5 minutos. */
whatsappRoutes.post(
  "/v1/jobs/tick",
  requireAutomacaoKey,
  wrap(async (_req, res) => {
    const batches = await tick(httpGateway);
    res.json({ batches: batches.map((b) => toGraph(b.phoneNumberId, b.messages)) });
  }),
);

/** QR Code do Pix (URL assinada, a Meta baixa a imagem). */
whatsappRoutes.get(
  "/v1/pix/:id.png",
  wrap(async (req, res) => {
    const path = `/v1/pix/${req.params.id}.png`;
    if (!checkSignature(path, req.query.e, req.query.s)) throw new HttpError(403, "Link expirado");
    const p = await payments.get(String(req.params.id));
    if (!p) throw new HttpError(404, "Pagamento não encontrado");
    const png = await QRCode.toBuffer(p.pixCode, { type: "png", width: 512, margin: 2, errorCorrectionLevel: "M" });
    res.type("png").set("Cache-Control", "private, max-age=3600").send(png);
  }),
);

/** Comprovante enviado pelo cliente (o dono vê no WhatsApp e no painel). */
whatsappRoutes.get(
  "/v1/receipts/:id",
  wrap(async (req, res) => {
    const path = `/v1/receipts/${req.params.id}`;
    if (!checkSignature(path, req.query.e, req.query.s)) throw new HttpError(403, "Link expirado");
    const r = await payments.receipt(String(req.params.id));
    if (!r) throw new HttpError(404, "Comprovante não encontrado");
    res.type(r.mime_type).set("Cache-Control", "private, max-age=3600").send(r.data);
  }),
);
