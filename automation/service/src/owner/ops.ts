import { DateTime } from "luxon";
import type { OwnerApi } from "../convexa/gateway.js";
import type { OwnerAppointment, Slot } from "../convexa/types.js";
import { payments } from "../payments/repo.js";
import { dayOf, instantAt, nowIn, wall } from "../lib/time.js";

/**
 * Operações do dono, sem formatação. WhatsApp, Alexa e painel montam a
 * resposta cada um no seu formato a partir daqui.
 */

const ACTIVE = new Set(["SCHEDULED", "CONFIRMED"]);

export type AgendaItem = {
  id: string;
  start: string; // HH:mm
  end: string;
  date: string;
  status: OwnerAppointment["status"];
  customer: { name: string; phone: string };
  service: string;
  employee: string;
  employeeId: string;
  priceCents: number;
  startAt: string;
};

function item(a: OwnerAppointment, tz: string): AgendaItem {
  const s = wall(a.startAt, tz);
  return {
    id: a.id,
    start: s.time,
    end: wall(a.endAt, tz).time,
    date: s.date,
    status: a.status,
    customer: { name: a.customer.name, phone: a.customer.phone },
    service: a.service.name,
    employee: a.employee.name,
    employeeId: a.employee.id,
    priceCents: a.priceCents,
    startAt: a.startAt,
  };
}

function dayRange(date: string, tz: string) {
  const start = DateTime.fromISO(date, { zone: tz }).startOf("day");
  return { from: start.toUTC().toISO()!, to: start.plus({ days: 1 }).toUTC().toISO()! };
}

export async function dayAgenda(owner: OwnerApi, tz: string, date: string): Promise<AgendaItem[]> {
  const list = await owner.appointments(dayRange(date, tz));
  return list
    .filter((a) => a.status !== "CANCELLED")
    .map((a) => item(a, tz))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export async function nextAppointment(owner: OwnerApi, tz: string): Promise<AgendaItem | undefined> {
  const now = nowIn(tz);
  const list = await owner.appointments({ from: now.minus({ minutes: 10 }).toUTC().toISO()!, to: now.plus({ days: 7 }).toUTC().toISO()! });
  return list
    .filter((a) => ACTIVE.has(a.status))
    .map((a) => item(a, tz))
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
}

/** Janelas livres por profissional, usando o motor de disponibilidade da API com o serviço mais curto. */
export async function freeWindows(
  owner: OwnerApi,
  tz: string,
  date: string,
): Promise<Array<{ employeeId: string; employee: string; windows: Array<{ start: string; end: string }> }>> {
  const services = (await owner.services()).filter((s) => s.active !== false);
  if (services.length === 0) return [];
  const employees = (await owner.employees()).filter((e) => e.active);
  const out = [];
  for (const e of employees) {
    // o serviço mais curto que ESTE profissional faz; passo de 15 min cabe no limite de 100 horários da API
    const svcIds = new Set((e.services ?? []).map((s) => ("serviceId" in s ? s.serviceId : s.id)));
    const own = services.filter((s) => svcIds.size === 0 || svcIds.has(s.id));
    if (own.length === 0) {
      out.push({ employeeId: e.id, employee: e.name, windows: [] });
      continue;
    }
    const shortestOwn = own.reduce((a, b) => (a.durationMinutes <= b.durationMinutes ? a : b));
    const slots: Slot[] = (
      await owner.availability({ serviceId: shortestOwn.id, date, employeeId: e.id, limit: 100, slotIntervalMinutes: 15 }).catch(() => ({ slots: [] as Slot[] }))
    ).slots;
    const windows: Array<{ start: string; end: string }> = [];
    let cur: { startMs: number; endMs: number } | undefined;
    for (const s of slots.sort((a, b) => a.startAt.localeCompare(b.startAt))) {
      const st = Date.parse(s.startAt);
      const en = Date.parse(s.endAt);
      if (cur && st <= cur.endMs) cur.endMs = Math.max(cur.endMs, en);
      else {
        if (cur) windows.push({ start: wall(new Date(cur.startMs), tz).time, end: wall(new Date(cur.endMs), tz).time });
        cur = { startMs: st, endMs: en };
      }
    }
    if (cur) windows.push({ start: wall(new Date(cur.startMs), tz).time, end: wall(new Date(cur.endMs), tz).time });
    out.push({ employeeId: e.id, employee: e.name, windows });
  }
  return out;
}

export type RevenuePeriod = "today" | "week" | "month" | "last_month";

export function periodRange(period: RevenuePeriod, tz: string) {
  const now = nowIn(tz);
  switch (period) {
    case "today":
      return { start: now.startOf("day"), end: now.startOf("day").plus({ days: 1 }), label: "hoje" };
    case "week":
      return { start: now.startOf("week"), end: now.startOf("week").plus({ weeks: 1 }), label: "nesta semana" };
    case "last_month": {
      const s = now.startOf("month").minus({ months: 1 });
      return { start: s, end: s.plus({ months: 1 }), label: `em ${s.setLocale("pt-BR").toFormat("LLLL")}` };
    }
    default:
      return { start: now.startOf("month"), end: now.startOf("month").plus({ months: 1 }), label: `em ${now.setLocale("pt-BR").toFormat("LLLL")}` };
  }
}

export type Revenue = {
  label: string;
  done: { count: number; cents: number }; // COMPLETED
  unclosed: { count: number; cents: number }; // já passou, mas não deu baixa
  upcoming: { count: number; cents: number }; // ainda vai acontecer
  cancelled: number;
  discountsCents: number;
  prepaidCents: number;
  costPercent: number | null;
  estimatedProfitCents: number | null;
  topService?: { name: string; count: number };
};

export async function revenue(owner: OwnerApi, tz: string, businessId: string, period: RevenuePeriod, costPercent: number | null): Promise<Revenue> {
  const r = periodRange(period, tz);
  const list = await owner.appointments({ from: r.start.toUTC().toISO()!, to: r.end.toUTC().toISO()! });
  const now = Date.now();
  const acc = { done: { count: 0, cents: 0 }, unclosed: { count: 0, cents: 0 }, upcoming: { count: 0, cents: 0 }, cancelled: 0 };
  const bySvc = new Map<string, number>();
  for (const a of list) {
    if (a.status === "CANCELLED") {
      acc.cancelled++;
      continue;
    }
    bySvc.set(a.service.name, (bySvc.get(a.service.name) ?? 0) + 1);
    const bucket = a.status === "COMPLETED" ? acc.done : Date.parse(a.endAt) <= now ? acc.unclosed : acc.upcoming;
    bucket.count++;
    bucket.cents += a.priceCents;
  }
  const pay = await payments.discountsBetween(businessId, r.start.toJSDate(), r.end.toJSDate());
  const expected = acc.done.cents + acc.unclosed.cents + acc.upcoming.cents - pay.discounts;
  const top = [...bySvc.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    label: r.label,
    ...acc,
    discountsCents: pay.discounts,
    prepaidCents: pay.received,
    costPercent,
    estimatedProfitCents: costPercent === null ? null : Math.max(0, Math.round(expected * (1 - costPercent / 100))),
    topService: top ? { name: top[0], count: top[1] } : undefined,
  };
}

/** Cria o bloqueio e devolve os agendamentos que ficaram dentro dele. */
export async function blockTime(
  owner: OwnerApi,
  tz: string,
  input: { date: string; startMin: number; endMin: number; employeeId?: string; reason?: string },
): Promise<{ blockId: string; startAt: string; endAt: string; conflicts: AgendaItem[] }> {
  const startAt = instantAt(input.date, input.startMin, tz);
  const endAt = instantAt(input.date, Math.min(input.endMin, 24 * 60 - 1), tz);
  const block = await owner.createTimeBlock({ startAt, endAt, employeeId: input.employeeId, reason: input.reason ?? "Bloqueado pelo dono" });
  const day = await dayAgenda(owner, tz, input.date);
  const s = Date.parse(startAt);
  const e = Date.parse(endAt);
  const conflicts = day.filter(
    (a) => ACTIVE.has(a.status) && (!input.employeeId || a.employeeId === input.employeeId) && overlaps(a, tz, s, e),
  );
  return { blockId: block.id, startAt, endAt, conflicts };
}

function overlaps(a: AgendaItem, tz: string, s: number, e: number) {
  const as = Date.parse(a.startAt);
  const ae = DateTime.fromISO(`${a.date}T${a.end}`, { zone: tz }).toMillis();
  return as < e && ae > s;
}

/** Clientes ainda por vir num dia (para avisos e atraso). */
export async function remainingToday(owner: OwnerApi, tz: string, date?: string): Promise<AgendaItem[]> {
  const d = date ?? dayOf(nowIn(tz));
  const now = Date.now();
  return (await dayAgenda(owner, tz, d)).filter((a) => ACTIVE.has(a.status) && Date.parse(a.startAt) > now - 15 * 60_000);
}
