import { env } from "../env.js";
import { errorInfo, log } from "../lib/log.js";
import type { Out } from "../whatsapp/messages.js";
import { toGraph } from "./util.js";

/**
 * Mensagens que nascem fora de um webhook do WhatsApp (painel, Alexa):
 * empurra o lote para o n8n, que consome a cota e envia pela Meta.
 */
export async function deliver(phoneNumberId: string, outs: Out[]): Promise<{ delivered: boolean; count: number }> {
  if (outs.length === 0) return { delivered: true, count: 0 };
  const url = env().N8N_SEND_WEBHOOK_URL;
  if (!url) {
    log.warn("N8N_SEND_WEBHOOK_URL não configurada: mensagens não enviadas", { count: outs.length });
    return { delivered: false, count: outs.length };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "x-automacao-key": env().AUTOMACAO_KEY },
      body: JSON.stringify({ batches: [toGraph(phoneNumberId, outs)] }),
    });
    if (!res.ok) throw new Error(`n8n respondeu ${res.status}`);
    return { delivered: true, count: outs.length };
  } catch (error) {
    log.error("falha ao entregar lote ao n8n", errorInfo(error));
    return { delivered: false, count: outs.length };
  }
}
