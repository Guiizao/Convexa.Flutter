/** Fala natural em pt-BR para a Alexa. */
export function reais(cents: number): string {
  const r = Math.floor(cents / 100);
  const c = cents % 100;
  const rs = r === 1 ? "1 real" : `${r.toLocaleString("pt-BR")} reais`;
  if (c === 0) return rs;
  return r === 0 ? `${c} centavos` : `${rs} e ${c} centavos`;
}

export function hora(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  if (h === 12 && m === 0) return "meio-dia";
  if (h === 0 && m === 0) return "meia-noite";
  const base = h === 1 ? "1 hora" : `${h} horas`;
  if (m === 0) return base;
  return m === 30 ? `${h} e meia` : `${h} e ${m}`;
}

// Preposição certa para a hora falada: "das 14 horas", "do meio-dia", "da 1 hora".
const isNoun = (h: string) => h === "meio-dia" || h === "meia-noite";
const isOne = (h: string) => /^1 (hora|e )/.test(h);
/** "às 14 horas", "ao meio-dia", "à 1 hora" */
export function as(hhmm: string): string {
  const h = hora(hhmm);
  return isNoun(h) ? `ao ${h}` : isOne(h) ? `à ${h}` : `às ${h}`;
}
/** "das 14 horas", "do meio-dia", "da 1 hora" */
export function das(hhmm: string): string {
  const h = hora(hhmm);
  return isNoun(h) ? `do ${h}` : isOne(h) ? `da ${h}` : `das ${h}`;
}
/** "das 14 horas às 16 horas", "do meio-dia à 1 hora" */
export function faixa(start: string, end: string): string {
  return `${das(start)} ${as(end)}`;
}
/** "até as 10 horas", "até o meio-dia", "até a 1 hora" */
export function ate(hhmm: string): string {
  const h = hora(hhmm);
  return isNoun(h) ? `até o ${h}` : isOne(h) ? `até a ${h}` : `até as ${h}`;
}
/** "a partir das 17 horas", "a partir do meio-dia" */
export function aPartir(hhmm: string): string {
  return `a partir ${das(hhmm)}`;
}

export function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

export function escapeSsml(s: string): string {
  return s.replace(/&/g, " e ").replace(/[<>]/g, " ");
}

export function firstName(n: string) {
  return n.split(" ")[0] ?? n;
}

import { DateTime } from "luxon";
import { WEEKDAYS_FULL, nowIn, weekdayIndex } from "../lib/time.js";

/** "hoje", "amanhã", "sábado, dia 14" — data por extenso para voz */
export function dia(isoDate: string, zone: string): string {
  const today = nowIn(zone).startOf("day");
  const d = DateTime.fromISO(isoDate, { zone }).startOf("day");
  const diff = Math.round(d.diff(today, "days").days);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  return `${WEEKDAYS_FULL[weekdayIndex(d)]!.replace("-feira", "")}, dia ${d.day}`;
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
