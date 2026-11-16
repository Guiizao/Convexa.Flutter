import type { Out } from "../whatsapp/messages.js";
import { optionIds } from "../whatsapp/messages.js";
import { conversations } from "./conversations.js";
import { menuNumber } from "./nlu.js";

/**
 * Depois de cada rodada: guarda, para cada contato que recebeu algo, as opções da
 * última mensagem enviada. Se a última mensagem não tem opções, apaga as antigas
 * (um "2" depois de uma pergunta aberta não deve escolher um botão velho).
 */
export async function rememberOptions(businessId: string, outs: Out[]): Promise<void> {
  const last = new Map<string, string[]>();
  for (const o of outs) last.set(o.to, optionIds(o));
  for (const [phone, ids] of last) await conversations.setOptions(businessId, phone, ids.length ? ids : null);
}

/**
 * "1", "opção 2", "3." -> id da opção correspondente da última lista ou dos últimos botões.
 * Horários ficam de fora quando o número parece uma hora ("10" numa lista de horários é 10h, não a 10ª linha).
 */
export function optionFromNumber(text: string, options: string[] | null): string | undefined {
  if (!options?.length) return undefined;
  const n = menuNumber(text);
  if (n === undefined || n < 1 || n > options.length) return undefined;
  const timeSlots = options.filter((id) => /^t:\d{2}:\d{2}/.test(id));
  if (timeSlots.length && n >= 6 && timeSlots.some((id) => Number(id.slice(2, 4)) === n)) return undefined;
  return options[n - 1];
}
