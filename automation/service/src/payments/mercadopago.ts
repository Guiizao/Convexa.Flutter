import { createHmac, randomUUID } from "node:crypto";
import { safeEqual } from "../lib/crypto.js";

/**
 * Pix pelo Mercado Pago: cria a cobrança e recebe a confirmação por webhook.
 * Docs: https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post
 */
const API = "https://api.mercadopago.com";

export type MpPix = { id: string; status: string; qrCode: string; qrCodeBase64?: string; ticketUrl?: string };

export async function createPixCharge(input: {
  accessToken: string;
  amountCents: number;
  description: string;
  externalReference: string;
  payerEmail: string;
  notificationUrl: string;
  expiresAt: Date;
}): Promise<MpPix> {
  const res = await fetch(`${API}/v1/payments`, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": input.externalReference,
    },
    body: JSON.stringify({
      transaction_amount: Number((input.amountCents / 100).toFixed(2)),
      description: input.description.slice(0, 200),
      payment_method_id: "pix",
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      date_of_expiration: input.expiresAt.toISOString().replace("Z", "-00:00"),
      payer: { email: input.payerEmail },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(`Mercado Pago recusou a cobrança: ${body?.message ?? res.status}`);
  const tx = body.point_of_interaction?.transaction_data ?? {};
  if (!tx.qr_code) throw new Error("Mercado Pago não devolveu o código Pix");
  return { id: String(body.id), status: body.status, qrCode: tx.qr_code, qrCodeBase64: tx.qr_code_base64, ticketUrl: tx.ticket_url };
}

export async function getPayment(accessToken: string, id: string): Promise<{ id: string; status: string; externalReference?: string }> {
  const res = await fetch(`${API}/v1/payments/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(`Mercado Pago: ${body?.message ?? res.status}`);
  return { id: String(body.id), status: body.status, externalReference: body.external_reference };
}

/**
 * x-signature: "ts=...,v1=..." ; manifesto "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 * https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 */
export function verifyWebhook(secret: string, headers: { signature?: string; requestId?: string }, dataId: string): boolean {
  if (!headers.signature) return false;
  const parts = Object.fromEntries(headers.signature.split(",").map((p) => p.trim().split("=") as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${headers.requestId ?? ""};ts:${parts.ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  return safeEqual(expected, parts.v1);
}

export const newIdempotencyKey = () => randomUUID();
