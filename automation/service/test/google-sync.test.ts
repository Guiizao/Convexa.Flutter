import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OwnerApi } from "../src/convexa/gateway.js";
import type { OwnerAppointment } from "../src/convexa/types.js";

// Teste de integração: precisa do Postgres da automação (DATABASE_URL) e ENCRYPTION_KEY.
const run = process.env.DATABASE_URL && process.env.ENCRYPTION_KEY ? describe : describe.skip;

run("sincronização com o Google Agenda", () => {
  const businessId = "00000000-0000-4000-8000-0000000000aa";
  const calls: Array<{ method: string; url: string; body?: any }> = [];
  let nextId = 0;
  const personal = [{ id: "pessoal-1", summary: "Dentista", status: "confirmed", start: { dateTime: "2030-01-10T14:00:00-03:00" }, end: { dateTime: "2030-01-10T15:00:00-03:00" } }];

  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url: String(url), body: init?.body ? String(init.body) : undefined });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (String(url).includes("oauth2.googleapis.com/token")) return json({ access_token: "tok", expires_in: 3600 });
    if (method === "POST") return json({ id: `ev-${++nextId}` });
    if (method === "PATCH") return json({ id: "ok" });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return json({ items: personal });
  }) as typeof fetch;

  const appts: OwnerAppointment[] = [
    { id: "00000000-0000-4000-8000-0000000000a1", status: "SCHEDULED", startAt: "2030-01-10T12:00:00.000Z", endAt: "2030-01-10T12:40:00.000Z", priceCents: 4500, durationMinutes: 40, customer: { id: "c1", name: "João", phone: "+5514988887777" }, service: { id: "s1", name: "Corte" }, employee: { id: "e1", name: "Pedro" } },
    { id: "00000000-0000-4000-8000-0000000000a2", status: "SCHEDULED", startAt: "2030-01-10T13:00:00.000Z", endAt: "2030-01-10T13:30:00.000Z", priceCents: 3500, durationMinutes: 30, customer: { id: "c2", name: "Ana", phone: "+5514977776666" }, service: { id: "s2", name: "Barba" }, employee: { id: "e1", name: "Pedro" } },
  ];
  const blocks: Array<{ startAt: string; endAt: string; reason?: string }> = [];
  const owner = {
    appointments: async () => appts,
    createTimeBlock: async (b: any) => (blocks.push(b), { id: `00000000-0000-4000-8000-${String(blocks.length).padStart(12, "0")}`, ...b }),
    updateTimeBlock: async () => ({}),
    deleteTimeBlock: async () => undefined,
  } as unknown as OwnerApi;

  let sync: typeof import("../src/google/sync.js");
  let pool: typeof import("../src/db/pool.js");
  beforeAll(async () => {
    pool = await import("../src/db/pool.js");
    const { encrypt } = await import("../src/lib/crypto.js");
    await (await import("../src/db/migrate.js")).migrate();
    await pool.db().query("DELETE FROM google_link WHERE business_id = $1", [businessId]);
    await pool.db().query("DELETE FROM calendar_event WHERE business_id = $1", [businessId]);
    await pool.db().query("DELETE FROM google_block WHERE business_id = $1", [businessId]);
    await pool.db().query("INSERT INTO google_link (business_id, email, refresh_token_enc) VALUES ($1, 'dono@x.com', $2)", [businessId, encrypt("refresh")]);
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    sync = await import("../src/google/sync.js");
  });
  afterAll(async () => {
    await pool.db().query("DELETE FROM google_link WHERE business_id = $1", [businessId]);
    await pool.db().query("DELETE FROM calendar_event WHERE business_id = $1", [businessId]);
    await pool.db().query("DELETE FROM google_block WHERE business_id = $1", [businessId]);
    await pool.closeDb();
  });

  const input = { businessId, businessName: "Teste", timezone: "America/Sao_Paulo", importBusy: true, ownerEmployeeId: null };

  it("cria um evento por agendamento e importa o compromisso pessoal", async () => {
    const s = await sync.syncBusiness(input, owner, fakeFetch);
    expect(s).toEqual({ created: 2, updated: 0, deleted: 0, blocks: 1 });
    const ev = JSON.parse(calls.find((c) => c.method === "POST" && c.url.includes("/events"))!.body!);
    expect(ev.summary).toBe("Corte — João");
    expect(ev.extendedProperties.private.convexaAppointmentId).toBe("00000000-0000-4000-8000-0000000000a1");
    expect(blocks[0]!.reason).toBe("Google Agenda: Dentista");
  });

  it("não refaz nada quando nada mudou", async () => {
    expect(await sync.syncBusiness(input, owner, fakeFetch)).toEqual({ created: 0, updated: 0, deleted: 0, blocks: 0 });
  });

  it("atualiza quando o status muda e apaga quando cancela", async () => {
    appts[0]!.status = "CONFIRMED";
    appts[1]!.status = "CANCELLED";
    expect(await sync.syncBusiness(input, owner, fakeFetch)).toEqual({ created: 0, updated: 1, deleted: 1, blocks: 0 });
  });
});
