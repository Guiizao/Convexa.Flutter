import { db } from "../db/pool.js";

export type PaymentStatus = "pending" | "under_review" | "paid" | "rejected" | "expired" | "cancelled";

export type Payment = {
  id: string;
  businessId: string;
  appointmentId: string;
  customerPhone: string;
  customerName: string | null;
  kind: "deposit" | "full";
  amountCents: number;
  discountCents: number;
  status: PaymentStatus;
  provider: "static_pix" | "mercadopago";
  providerRef: string | null;
  txid: string;
  pixCode: string;
  receiptAnalysis: any;
  hasReceipt: boolean;
  summary: { service: string; date: string; time: string; employee?: string; priceCents: number };
  expiresAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
};

const map = (r: any): Payment => ({
  id: r.id,
  businessId: r.business_id,
  appointmentId: r.appointment_id,
  customerPhone: r.customer_phone,
  customerName: r.customer_name,
  kind: r.kind,
  amountCents: r.amount_cents,
  discountCents: r.discount_cents,
  status: r.status,
  provider: r.provider,
  providerRef: r.provider_ref,
  txid: r.txid,
  pixCode: r.pix_code,
  receiptAnalysis: r.receipt_analysis,
  hasReceipt: r.receipt_media != null,
  summary: r.appointment_summary,
  expiresAt: r.expires_at,
  paidAt: r.paid_at,
  createdAt: r.created_at,
});

export const payments = {
  async create(p: Omit<Payment, "id" | "status" | "receiptAnalysis" | "hasReceipt" | "paidAt" | "createdAt" | "providerRef"> & { providerRef?: string }) {
    const r = await db().query(
      `INSERT INTO payment (business_id, appointment_id, customer_phone, customer_name, kind, amount_cents, discount_cents,
         provider, provider_ref, txid, pix_code, appointment_summary, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        p.businessId, p.appointmentId, p.customerPhone, p.customerName, p.kind, p.amountCents, p.discountCents,
        p.provider, p.providerRef ?? null, p.txid, p.pixCode, JSON.stringify(p.summary), p.expiresAt,
      ],
    );
    return map(r.rows[0]);
  },

  async get(id: string): Promise<Payment | undefined> {
    const r = await db().query("SELECT * FROM payment WHERE id = $1", [id]);
    return r.rows[0] ? map(r.rows[0]) : undefined;
  },

  async byProviderRef(provider: string, ref: string) {
    const r = await db().query("SELECT * FROM payment WHERE provider = $1 AND provider_ref = $2", [provider, ref]);
    return r.rows[0] ? map(r.rows[0]) : undefined;
  },

  /** Pagamento em aberto deste cliente (o mais recente). */
  async openFor(businessId: string, phone: string) {
    const r = await db().query(
      `SELECT * FROM payment WHERE business_id = $1 AND customer_phone = $2
         AND status IN ('pending','under_review','rejected')
       ORDER BY created_at DESC LIMIT 1`,
      [businessId, phone],
    );
    return r.rows[0] ? map(r.rows[0]) : undefined;
  },

  async forAppointment(appointmentId: string) {
    const r = await db().query("SELECT * FROM payment WHERE appointment_id = $1 ORDER BY created_at DESC", [appointmentId]);
    return r.rows.map(map);
  },

  async list(businessId: string, status?: PaymentStatus[], limit = 100) {
    const r = await db().query(
      `SELECT * FROM payment WHERE business_id = $1 ${status ? "AND status = ANY($3)" : ""}
       ORDER BY created_at DESC LIMIT $2`,
      status ? [businessId, limit, status] : [businessId, limit],
    );
    return r.rows.map(map);
  },

  /** Troca de status só se ainda estiver num dos estados esperados (evita corrida). */
  async transition(id: string, from: PaymentStatus[], to: PaymentStatus, extra: { decidedBy?: string } = {}) {
    const r = await db().query(
      `UPDATE payment SET status = $3, updated_at = now(),
         paid_at = CASE WHEN $3 = 'paid' THEN now() ELSE paid_at END,
         decided_by = COALESCE($4, decided_by)
       WHERE id = $1 AND status = ANY($2) RETURNING *`,
      [id, from, to, extra.decidedBy ?? null],
    );
    return r.rows[0] ? map(r.rows[0]) : undefined;
  },

  async saveReceipt(id: string, receipt: { mimeType: string; data: Buffer }, analysis?: unknown) {
    await db().query(
      `INSERT INTO payment_receipt (payment_id, mime_type, data) VALUES ($1, $2, $3)
       ON CONFLICT (payment_id) DO UPDATE SET mime_type = EXCLUDED.mime_type, data = EXCLUDED.data, created_at = now()`,
      [id, receipt.mimeType, receipt.data],
    );
    await db().query(
      "UPDATE payment SET receipt_media = $2, receipt_analysis = $3, updated_at = now() WHERE id = $1",
      [id, JSON.stringify({ mimeType: receipt.mimeType, size: receipt.data.length }), analysis ? JSON.stringify(analysis) : null],
    );
  },

  async receipt(id: string) {
    const r = await db().query<{ mime_type: string; data: Buffer }>("SELECT mime_type, data FROM payment_receipt WHERE payment_id = $1", [id]);
    return r.rows[0];
  },

  async expired(limit = 50) {
    const r = await db().query(
      `SELECT * FROM payment WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()
       ORDER BY expires_at LIMIT $1`,
      [limit],
    );
    return r.rows.map(map);
  },

  async discountsBetween(businessId: string, from: Date, to: Date) {
    const r = await db().query<{ total: string | null; received: string | null }>(
      `SELECT SUM(discount_cents) AS total, SUM(amount_cents) AS received FROM payment
       WHERE business_id = $1 AND status = 'paid' AND paid_at >= $2 AND paid_at < $3`,
      [businessId, from, to],
    );
    return { discounts: Number(r.rows[0]?.total ?? 0), received: Number(r.rows[0]?.received ?? 0) };
  },
};
