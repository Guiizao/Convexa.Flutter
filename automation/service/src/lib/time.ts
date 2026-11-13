import { DateTime } from "luxon";

export const WEEKDAYS_FULL = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "agora" no fuso da empresa. Injetável para testes. */
let clock: () => Date = () => new Date();
export function setClock(fn: () => Date) {
  clock = fn;
}
export function nowIn(zone: string): DateTime {
  return DateTime.fromJSDate(clock(), { zone });
}

export function dayOf(dt: DateTime): string {
  return dt.toISODate()!;
}

export function weekdayIndex(dt: DateTime): number {
  return dt.weekday % 7; // luxon: 1=seg..7=dom -> 0=dom..6=sáb
}

/** "sex, 14/11" */
export function shortDay(isoDate: string, zone: string): string {
  const d = DateTime.fromISO(isoDate, { zone });
  return `${WEEKDAYS_SHORT[weekdayIndex(d)]}, ${d.toFormat("dd/MM")}`;
}

/** "hoje", "amanhã" ou "sexta-feira, 14/11" */
export function friendlyDay(isoDate: string, zone: string): string {
  const today = nowIn(zone).startOf("day");
  const d = DateTime.fromISO(isoDate, { zone }).startOf("day");
  const diff = Math.round(d.diff(today, "days").days);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  return `${WEEKDAYS_FULL[weekdayIndex(d)]}, ${d.toFormat("dd/MM")}`;
}

export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function minutesOfDay(dt: DateTime): number {
  return dt.hour * 60 + dt.minute;
}

/** Instante ISO (UTC) -> horário de parede no fuso */
export function wall(instant: string | Date, zone: string): { date: string; time: string; minutes: number; dt: DateTime } {
  const dt = (typeof instant === "string" ? DateTime.fromISO(instant) : DateTime.fromJSDate(instant)).setZone(zone);
  return { date: dayOf(dt), time: dt.toFormat("HH:mm"), minutes: minutesOfDay(dt), dt };
}

/** Dia + minutos no fuso -> instante ISO com offset */
export function instantAt(isoDate: string, minutes: number, zone: string): string {
  const dt = DateTime.fromISO(isoDate, { zone }).startOf("day").plus({ minutes });
  return dt.toISO({ suppressMilliseconds: true })!;
}

export function periodOf(minutes: number): "manha" | "tarde" | "noite" {
  if (minutes < 12 * 60) return "manha";
  if (minutes < 18 * 60) return "tarde";
  return "noite";
}

export const PERIOD_LABEL = { manha: "Manhã", tarde: "Tarde", noite: "Noite" } as const;
