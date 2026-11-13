import { DateTime } from "luxon";
import type { Ctx } from "../bot/context.js";
import type { OwnerApi } from "../convexa/gateway.js";
import type { OwnerAppointment } from "../convexa/types.js";
import { db } from "../db/pool.js";
import { sha256 } from "../lib/crypto.js";
import { log } from "../lib/log.js";
import { brl } from "../lib/money.js";
import { formatPhoneBR } from "../lib/phone.js";
import { accessToken } from "./oauth.js";

const API = "https://www.googleapis.com/calendar/v3";
const STATUS = { SCHEDULED: "Agendado", CONFIRMED: "Confirmado", COMPLETED: "Atendido", CANCELLED: "Cancelado" } as const;

export function eventFor(a: OwnerAppointment, tz: string, businessName: string) {
  return {
    summary: `${a.service.name} — ${a.customer.name}`,
    description:
      `Cliente: ${a.customer.name}\nTelefone: ${formatPhoneBR(a.customer.phone)}\nProfissional: ${a.employee.name}\n` +
      `Valor: ${brl(a.priceCents)}\nStatus: ${STATUS[a.status]}\n\nCriado pelo Convexa (${businessName}).`,
    start: { dateTime: DateTime.fromISO(a.startAt).setZone(tz).toISO(), timeZone: tz },
    end: { dateTime: DateTime.fromISO(a.endAt).setZone(tz).toISO(), timeZone: tz },
    colorId: a.status === "CONFIRMED" ? "10" : a.status === "COMPLETED" ? "8" : "9",
    extendedProperties: { private: { convexaAppointmentId: a.id } },
    reminders: { useDefault: true },
  };
}

type Fetch = typeof fetch;

async function gcal(fetcher: Fetch, token: string, method: string, path: string, body?: unknown) {
  const res = await fetcher(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404 || res.status === 410) return undefined;
  if (!res.ok) throw new Error(`Google Agenda respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? {} : res.json();
}

/**
 * Convexa -> Google: um evento por agendamento ativo (cria, atualiza, apaga).
 * Google -> Convexa (opcional): compromisso pessoal vira bloqueio de agenda.
 */
export async function syncBusiness(
  input: { businessId: string; businessName: string; timezone: string; importBusy: boolean; ownerEmployeeId: string | null },
  owner: OwnerApi,
  fetcher: Fetch = fetch,
): Promise<{ created: number; updated: number; deleted: number; blocks: number }> {
  const auth = await accessToken(input.businessId, fetcher);
  if (!auth) return { created: 0, updated: 0, deleted: 0, blocks: 0 };
  const cal = encodeURIComponent(auth.calendarId);
  const now = DateTime.now();
  const appts = await owner.appointments({ from: now.minus({ days: 1 }).toUTC().toISO()!, to: now.plus({ days: 60 }).toUTC().toISO()! });
  const known = new Map(
    (await db().query<{ appointment_id: string; event_id: string; content_hash: string }>("SELECT appointment_id, event_id, content_hash FROM calendar_event WHERE business_id = $1", [input.businessId])).rows.map(
      (r) => [r.appointment_id, r],
    ),
  );
  const stats = { created: 0, updated: 0, deleted: 0, blocks: 0 };
  const seen = new Set<string>();
  for (const a of appts) {
    if (a.status === "CANCELLED") continue;
    seen.add(a.id);
    const ev = eventFor(a, input.timezone, input.businessName);
    const hash = sha256(JSON.stringify(ev));
    const k = known.get(a.id);
    if (k && k.content_hash === hash) continue;
    if (k) {
      const r = await gcal(fetcher, auth.token, "PATCH", `/calendars/${cal}/events/${encodeURIComponent(k.event_id)}`, ev);
      if (r) {
        stats.updated++;
        await db().query("UPDATE calendar_event SET content_hash = $3, updated_at = now() WHERE business_id = $1 AND appointment_id = $2", [input.businessId, a.id, hash]);
        continue;
      }
    }
    const created = (await gcal(fetcher, auth.token, "POST", `/calendars/${cal}/events`, ev)) as { id: string };
    stats.created++;
    await db().query(
      `INSERT INTO calendar_event (business_id, appointment_id, event_id, content_hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT (business_id, appointment_id) DO UPDATE SET event_id = EXCLUDED.event_id, content_hash = EXCLUDED.content_hash, updated_at = now()`,
      [input.businessId, a.id, created.id, hash],
    );
  }
  // agendamentos cancelados (ou que saíram da janela por cancelamento) somem do Google
  const cancelled = new Set(appts.filter((a) => a.status === "CANCELLED").map((a) => a.id));
  for (const [apptId, row] of known) {
    if (seen.has(apptId)) continue;
    if (!cancelled.has(apptId)) continue;
    await gcal(fetcher, auth.token, "DELETE", `/calendars/${cal}/events/${encodeURIComponent(row.event_id)}`);
    await db().query("DELETE FROM calendar_event WHERE business_id = $1 AND appointment_id = $2", [input.businessId, apptId]);
    stats.deleted++;
  }

  if (input.importBusy) stats.blocks = await importBusy(input, owner, auth, fetcher);
  await db().query("UPDATE google_link SET last_sync_at = now(), last_error = NULL WHERE business_id = $1", [input.businessId]);
  return stats;
}

async function importBusy(
  input: { businessId: string; timezone: string; ownerEmployeeId: string | null },
  owner: OwnerApi,
  auth: { token: string; calendarId: string },
  fetcher: Fetch,
): Promise<number> {
  const now = DateTime.now();
  const q = new URLSearchParams({ timeMin: now.toUTC().toISO()!, timeMax: now.plus({ days: 30 }).toUTC().toISO()!, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const list = (await gcal(fetcher, auth.token, "GET", `/calendars/${encodeURIComponent(auth.calendarId)}/events?${q}`)) as { items?: any[] } | undefined;
  const items = (list?.items ?? []).filter(
    (e) => !e.extendedProperties?.private?.convexaAppointmentId && e.status !== "cancelled" && e.transparency !== "transparent" && e.start?.dateTime && e.end?.dateTime,
  );
  const existing = new Map(
    (await db().query<{ event_id: string; time_block_id: string; content_hash: string }>("SELECT event_id, time_block_id, content_hash FROM google_block WHERE business_id = $1", [input.businessId])).rows.map(
      (r) => [r.event_id, r],
    ),
  );
  let changed = 0;
  const current = new Set<string>();
  for (const e of items) {
    current.add(e.id);
    const startAt = DateTime.fromISO(e.start.dateTime).toUTC().toISO()!;
    const endAt = DateTime.fromISO(e.end.dateTime).toUTC().toISO()!;
    const reason = `Google Agenda: ${(e.summary ?? "compromisso").slice(0, 80)}`;
    const hash = sha256(`${startAt}|${endAt}|${reason}`);
    const prev = existing.get(e.id);
    if (prev?.content_hash === hash) continue;
    if (prev) {
      await owner.updateTimeBlock(prev.time_block_id, { startAt, endAt, reason }).catch(() => undefined);
      await db().query("UPDATE google_block SET content_hash = $3 WHERE business_id = $1 AND event_id = $2", [input.businessId, e.id, hash]);
    } else {
      const block = await owner.createTimeBlock({ startAt, endAt, reason, employeeId: input.ownerEmployeeId ?? undefined });
      await db().query("INSERT INTO google_block (business_id, event_id, time_block_id, content_hash) VALUES ($1,$2,$3,$4)", [input.businessId, e.id, block.id, hash]);
    }
    changed++;
  }
  for (const [eventId, row] of existing) {
    if (current.has(eventId)) continue;
    await owner.deleteTimeBlock(row.time_block_id).catch(() => undefined);
    await db().query("DELETE FROM google_block WHERE business_id = $1 AND event_id = $2", [input.businessId, eventId]);
    changed++;
  }
  return changed;
}

export async function syncGoogle(ctx: Ctx): Promise<void> {
  const owner = await ctx.owner();
  if (!owner) return;
  const stats = await syncBusiness(
    {
      businessId: ctx.biz.businessId,
      businessName: ctx.biz.businessName,
      timezone: ctx.tz,
      importBusy: ctx.settings.google.importBusy,
      ownerEmployeeId: ctx.settings.ownerEmployeeId,
    },
    owner,
  );
  if (stats.created + stats.updated + stats.deleted + stats.blocks > 0) log.info("Google Agenda sincronizado", { businessId: ctx.biz.businessId, ...stats });
}
