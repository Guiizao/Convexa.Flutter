import { db } from "../db/pool.js";

export type ConvState = {
  flow?: string;
  step?: string;
  data?: Record<string, any>;
  at?: string; // ISO, última mudança de estado
  /** Dono testando o bot como se fosse cliente */
  actAsCustomerUntil?: string;
};

export type Conversation = {
  businessId: string;
  phone: string;
  waId: string | null;
  name: string | null;
  role: "customer" | "owner";
  state: ConvState;
  pausedUntil: Date | null;
  lastInboundAt: Date | null;
};

type Row = {
  business_id: string;
  phone: string;
  wa_id: string | null;
  name: string | null;
  role: "customer" | "owner";
  state: ConvState;
  paused_until: Date | null;
  last_inbound_at: Date | null;
};

const map = (r: Row): Conversation => ({
  businessId: r.business_id,
  phone: r.phone,
  waId: r.wa_id,
  name: r.name,
  role: r.role,
  state: r.state ?? {},
  pausedUntil: r.paused_until,
  lastInboundAt: r.last_inbound_at,
});

const STATE_TTL_MS = 2 * 60 * 60 * 1000;

export const conversations = {
  async get(businessId: string, phone: string): Promise<Conversation | undefined> {
    const r = await db().query<Row>("SELECT * FROM conversation WHERE business_id = $1 AND phone = $2", [businessId, phone]);
    return r.rows[0] ? map(r.rows[0]) : undefined;
  },

  /** Carrega ou cria. Estado parado há mais de 2h volta ao início. */
  async touchInbound(input: { businessId: string; phone: string; waId: string; name?: string; role: Conversation["role"] }) {
    const r = await db().query<Row>(
      `INSERT INTO conversation (business_id, phone, wa_id, name, role, last_inbound_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (business_id, phone) DO UPDATE
         SET wa_id = EXCLUDED.wa_id,
             name = COALESCE(EXCLUDED.name, conversation.name),
             role = EXCLUDED.role,
             last_inbound_at = now(),
             updated_at = now()
       RETURNING *`,
      [input.businessId, input.phone, input.waId, input.name ?? null, input.role],
    );
    const conv = map(r.rows[0]!);
    if (conv.state.at && Date.now() - Date.parse(conv.state.at) > STATE_TTL_MS) {
      const keep = conv.state.actAsCustomerUntil;
      conv.state = keep ? { actAsCustomerUntil: keep } : {};
    }
    return conv;
  },

  async ensure(businessId: string, phone: string, name?: string) {
    await db().query(
      `INSERT INTO conversation (business_id, phone, name) VALUES ($1, $2, $3)
       ON CONFLICT (business_id, phone) DO UPDATE SET name = COALESCE(conversation.name, EXCLUDED.name)`,
      [businessId, phone, name ?? null],
    );
    return (await this.get(businessId, phone))!;
  },

  async saveState(businessId: string, phone: string, state: ConvState) {
    await db().query("UPDATE conversation SET state = $3, updated_at = now() WHERE business_id = $1 AND phone = $2", [
      businessId,
      phone,
      JSON.stringify({ ...state, at: new Date().toISOString() }),
    ]);
  },

  async pause(businessId: string, phone: string, until: Date | null) {
    await db().query("UPDATE conversation SET paused_until = $3, updated_at = now() WHERE business_id = $1 AND phone = $2", [
      businessId,
      phone,
      until,
    ]);
  },

  async markOutbound(businessId: string, phone: string) {
    await db().query("UPDATE conversation SET last_outbound_at = now() WHERE business_id = $1 AND phone = $2", [businessId, phone]);
  },

  /** Regra das 24h: só dá para mandar mensagem livre se o contato escreveu nas últimas 24h. */
  async windowOpen(businessId: string, phone: string): Promise<boolean> {
    const r = await db().query<{ open: boolean }>(
      `SELECT last_inbound_at > now() - interval '23 hours 50 minutes' AS open
       FROM conversation WHERE business_id = $1 AND phone = $2`,
      [businessId, phone],
    );
    return r.rows[0]?.open ?? false;
  },

  async recent(businessId: string, limit = 50) {
    const r = await db().query<Row & { last_body: string | null; last_at: Date | null }>(
      `SELECT c.*, m.body AS last_body, m.created_at AS last_at
       FROM conversation c
       LEFT JOIN LATERAL (
         SELECT body, created_at FROM message_log
         WHERE business_id = c.business_id AND phone = c.phone
         ORDER BY created_at DESC LIMIT 1
       ) m ON true
       WHERE c.business_id = $1
       ORDER BY m.created_at DESC NULLS LAST
       LIMIT $2`,
      [businessId, limit],
    );
    return r.rows.map((row) => ({ ...map(row), lastBody: row.last_body, lastAt: row.last_at }));
  },
};

export const messageLog = {
  /** false se a mensagem já tinha sido processada (a Meta reenvia webhooks) */
  async inbound(input: { businessId: string; phone: string; kind: string; body?: string; payload?: unknown; wamid: string }) {
    const r = await db().query(
      `INSERT INTO message_log (business_id, phone, direction, kind, body, payload, wamid)
       VALUES ($1, $2, 'in', $3, $4, $5, $6)
       ON CONFLICT DO NOTHING RETURNING id`,
      [input.businessId, input.phone, input.kind, input.body ?? null, input.payload ? JSON.stringify(input.payload) : null, input.wamid],
    );
    return (r.rowCount ?? 0) > 0;
  },

  async outbound(input: { businessId: string; phone: string; kind: string; body: string; payload?: unknown }) {
    await db().query(
      `INSERT INTO message_log (business_id, phone, direction, kind, body, payload) VALUES ($1, $2, 'out', $3, $4, $5)`,
      [input.businessId, input.phone, input.kind, input.body, input.payload ? JSON.stringify(input.payload) : null],
    );
  },

  async history(businessId: string, phone: string, limit = 100) {
    const r = await db().query<{ direction: string; kind: string; body: string | null; created_at: Date }>(
      `SELECT direction, kind, body, created_at FROM message_log
       WHERE business_id = $1 AND phone = $2 ORDER BY created_at DESC LIMIT $3`,
      [businessId, phone, limit],
    );
    return r.rows.reverse();
  },
};
