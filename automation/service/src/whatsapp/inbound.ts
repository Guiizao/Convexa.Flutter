import { createHmac } from "node:crypto";
import { safeEqual } from "../lib/crypto.js";

export type InboundMessage = {
  phoneNumberId: string;
  waId: string;
  name?: string;
  wamid: string;
  timestamp: number; // epoch segundos
  type: "text" | "reply" | "image" | "document" | "audio" | "location" | "unsupported";
  text?: string; // texto digitado, ou o título do botão/linha escolhido
  replyId?: string; // id do botão/linha, ou payload do botão de template
  media?: { id: string; mimeType?: string; sha256?: string; caption?: string };
};

export type StatusUpdate = { phoneNumberId: string; wamid: string; status: string; recipient: string; errors?: unknown };

type Raw = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<Record<string, any>>;
        statuses?: Array<Record<string, any>>;
      };
    }>;
  }>;
};

/** Achata o webhook da Meta em mensagens e status. Ignora o que não entende. */
export function parseWebhook(payload: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const raw = payload as Raw;
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  for (const entry of raw?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!value || !phoneNumberId) continue;
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        const base = {
          phoneNumberId,
          waId: String(m.from ?? ""),
          name: names.get(m.from) ?? undefined,
          wamid: String(m.id ?? ""),
          timestamp: Number(m.timestamp ?? Math.floor(Date.now() / 1000)),
        };
        if (!base.waId || !base.wamid) continue;
        switch (m.type) {
          case "text":
            messages.push({ ...base, type: "text", text: String(m.text?.body ?? "") });
            break;
          case "interactive": {
            const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
            messages.push({ ...base, type: "reply", replyId: r?.id, text: r?.title });
            break;
          }
          case "button": // botão de resposta rápida de template
            messages.push({ ...base, type: "reply", replyId: m.button?.payload, text: m.button?.text });
            break;
          case "image":
          case "document":
            messages.push({
              ...base,
              type: m.type,
              text: m[m.type]?.caption,
              media: { id: m[m.type]?.id, mimeType: m[m.type]?.mime_type, sha256: m[m.type]?.sha256, caption: m[m.type]?.caption },
            });
            break;
          case "audio":
            messages.push({ ...base, type: "audio", media: { id: m.audio?.id, mimeType: m.audio?.mime_type } });
            break;
          case "location":
            messages.push({ ...base, type: "location" });
            break;
          default:
            messages.push({ ...base, type: "unsupported" });
        }
      }
      for (const s of value.statuses ?? []) {
        statuses.push({ phoneNumberId, wamid: s.id, status: s.status, recipient: s.recipient_id, errors: s.errors });
      }
    }
  }
  return { messages, statuses };
}

/** X-Hub-Signature-256: sha256=<hmac do corpo cru com o app secret> */
export function verifySignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqual(header.slice(7), expected);
}
