import { db } from "../db/pool.js";

export async function googleStatus(businessId: string) {
  const r = await db().query<{ email: string | null; calendar_id: string; status: string; last_error: string | null; last_sync_at: Date | null }>(
    "SELECT email, calendar_id, status, last_error, last_sync_at FROM google_link WHERE business_id = $1",
    [businessId],
  );
  const row = r.rows[0];
  return row
    ? { connected: row.status === "active", email: row.email, calendarId: row.calendar_id, lastError: row.last_error, lastSyncAt: row.last_sync_at }
    : { connected: false, email: null, calendarId: null, lastError: null, lastSyncAt: null };
}
