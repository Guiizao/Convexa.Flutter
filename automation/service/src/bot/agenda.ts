import { DateTime } from "luxon";
import type { Slot } from "../convexa/types.js";
import { dayOf, friendlyDay, hhmm, periodOf, shortDay } from "../lib/time.js";
import type { Ctx } from "./context.js";

/**
 * Horários do dia inteiro. Com a automação conectada usa a rota do painel
 * (até 100 horários); sem ela, a rota da conversa devolve só os 10 primeiros.
 */
export async function daySlots(ctx: Ctx, serviceId: string, date: string, employeeId?: string): Promise<Slot[]> {
  const owner = await ctx.owner();
  if (owner) {
    try {
      const r = await owner.availability({ serviceId, date, employeeId, limit: 100 });
      const names = new Map<string, string>();
      if (r.slots.some((s) => !s.employeeName)) {
        for (const e of await owner.employees()) names.set(e.id, e.name);
      }
      return r.slots.map((s) => ({
        ...s,
        employeeName: s.employeeName ?? names.get(s.employeeId) ?? null,
        time: s.time ?? DateTime.fromISO(s.startAt).setZone(ctx.tz).toFormat("HH:mm"),
      }));
    } catch {
      // cai para a rota da conversa
    }
  }
  const api = await ctx.customer();
  const r = await api.availability({ serviceId, date, employeeId, limit: 10 });
  return r.slots;
}

export async function dayCount(ctx: Ctx, serviceId: string, date: string, employeeId?: string): Promise<number> {
  const api = await ctx.customer();
  const r = await api.availability({ serviceId, date, employeeId, limit: 1 });
  return r.totalSlots;
}

/** Próximos dias (a partir de hoje) com pelo menos um horário. */
export async function nextOpenDays(
  ctx: Ctx,
  serviceId: string,
  opts: { from?: string; count?: number; horizon?: number; employeeId?: string } = {},
): Promise<Array<{ date: string; total: number }>> {
  const count = opts.count ?? 6;
  const horizon = opts.horizon ?? 21;
  const start = opts.from ? DateTime.fromISO(opts.from, { zone: ctx.tz }) : ctx.now().startOf("day");
  const days: string[] = [];
  for (let i = 0; i < horizon; i++) days.push(dayOf(start.plus({ days: i })));
  const found: Array<{ date: string; total: number }> = [];
  // em blocos de 7 para não disparar 21 requisições de uma vez
  for (let i = 0; i < days.length && found.length < count; i += 7) {
    const chunk = days.slice(i, i + 7);
    const totals = await Promise.all(chunk.map((d) => dayCount(ctx, serviceId, d, opts.employeeId).catch(() => 0)));
    chunk.forEach((d, j) => {
      if (totals[j]! > 0 && found.length < count) found.push({ date: d, total: totals[j]! });
    });
  }
  return found;
}

/** Um horário por hora de relógio quando o cliente não escolheu profissional. */
export function uniqueTimes(slots: Slot[]): Slot[] {
  const seen = new Map<string, Slot>();
  for (const s of slots) if (!seen.has(s.time)) seen.set(s.time, s);
  return [...seen.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function nearest(slots: Slot[], minutes: number, n = 3): Slot[] {
  return [...slots].sort((a, b) => Math.abs(toMinutes(a.time) - minutes) - Math.abs(toMinutes(b.time) - minutes)).slice(0, n)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function byPeriod(slots: Slot[]) {
  const groups = { manha: [] as Slot[], tarde: [] as Slot[], noite: [] as Slot[] };
  for (const s of slots) groups[periodOf(toMinutes(s.time))].push(s);
  return groups;
}

/** Até `max` horários espalhados ao longo do período, em vez dos `max` primeiros. */
export function spread(slots: Slot[], max: number): Slot[] {
  if (slots.length <= max) return slots;
  const step = (slots.length - 1) / (max - 1);
  const picked = new Set<number>();
  for (let i = 0; i < max; i++) picked.add(Math.round(i * step));
  return [...picked].sort((a, b) => a - b).map((i) => slots[i]!);
}

export function dayLabel(ctx: Ctx, date: string) {
  return friendlyDay(date, ctx.tz);
}
export function dayShort(ctx: Ctx, date: string) {
  return shortDay(date, ctx.tz);
}
export { hhmm };
