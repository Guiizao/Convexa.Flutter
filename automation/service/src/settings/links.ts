import { db } from "../db/pool.js";
import { decrypt, encrypt } from "../lib/crypto.js";

export type BusinessLink = {
  businessId: string;
  metaPhoneNumberId: string | null;
  businessName: string;
  timezone: string;
  ownerEmail: string | null;
  status: "pending" | "active" | "broken";
  lastError: string | null;
  linkedAt: Date | null;
};

type Row = {
  business_id: string;
  meta_phone_number_id: string | null;
  business_name: string;
  timezone: string;
  owner_email: string | null;
  owner_password_enc: string | null;
  status: BusinessLink["status"];
  last_error: string | null;
  linked_at: Date | null;
};

const toLink = (r: Row): BusinessLink => ({
  businessId: r.business_id,
  metaPhoneNumberId: r.meta_phone_number_id,
  businessName: r.business_name,
  timezone: r.timezone,
  ownerEmail: r.owner_email,
  status: r.status,
  lastError: r.last_error,
  linkedAt: r.linked_at,
});

export const links = {
  async get(businessId: string): Promise<BusinessLink | undefined> {
    const r = await db().query<Row>("SELECT * FROM business_link WHERE business_id = $1", [businessId]);
    return r.rows[0] ? toLink(r.rows[0]) : undefined;
  },

  async credentials(businessId: string): Promise<{ email: string; password: string } | undefined> {
    const r = await db().query<Row>("SELECT * FROM business_link WHERE business_id = $1", [businessId]);
    const row = r.rows[0];
    if (!row?.owner_email || !row.owner_password_enc) return undefined;
    return { email: row.owner_email, password: decrypt(row.owner_password_enc) };
  },

  /** Registra a empresa (sem credencial ainda) quando a primeira mensagem chega. */
  async ensure(input: { businessId: string; name: string; timezone: string; metaPhoneNumberId?: string | null }) {
    await db().query(
      `INSERT INTO business_link (business_id, business_name, timezone, meta_phone_number_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (business_id) DO UPDATE
         SET business_name = EXCLUDED.business_name,
             timezone = EXCLUDED.timezone,
             meta_phone_number_id = COALESCE(EXCLUDED.meta_phone_number_id, business_link.meta_phone_number_id),
             updated_at = now()`,
      [input.businessId, input.name, input.timezone, input.metaPhoneNumberId ?? null],
    );
  },

  async saveCredentials(businessId: string, email: string, password: string) {
    await db().query(
      `UPDATE business_link SET owner_email = $2, owner_password_enc = $3, status = 'active',
              last_error = NULL, linked_at = now(), updated_at = now()
       WHERE business_id = $1`,
      [businessId, email, encrypt(password)],
    );
  },

  async markBroken(businessId: string, error: string) {
    await db().query(
      "UPDATE business_link SET status = 'broken', last_error = $2, updated_at = now() WHERE business_id = $1",
      [businessId, error],
    );
  },

  async unlink(businessId: string) {
    await db().query(
      `UPDATE business_link SET owner_email = NULL, owner_password_enc = NULL, status = 'pending',
              updated_at = now() WHERE business_id = $1`,
      [businessId],
    );
  },

  async active(): Promise<BusinessLink[]> {
    const r = await db().query<Row>("SELECT * FROM business_link WHERE status = 'active'");
    return r.rows.map(toLink);
  },
};
