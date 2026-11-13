import { randomBytes } from "node:crypto";
import { db } from "../db/pool.js";
import { env } from "../env.js";
import { decrypt, encrypt } from "../lib/crypto.js";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];

export const googleConfigured = () => !!(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
const redirectUri = () => `${env().PUBLIC_URL}/v1/google/callback`;

export async function googleStatus(businessId: string) {
  const r = await db().query<{ email: string | null; calendar_id: string; status: string; last_error: string | null; last_sync_at: Date | null }>(
    "SELECT email, calendar_id, status, last_error, last_sync_at FROM google_link WHERE business_id = $1",
    [businessId],
  );
  const row = r.rows[0];
  return {
    available: googleConfigured(),
    connected: row?.status === "active",
    email: row?.email ?? null,
    calendarId: row?.calendar_id ?? null,
    lastError: row?.last_error ?? null,
    lastSyncAt: row?.last_sync_at ?? null,
  };
}

export async function authUrl(businessId: string): Promise<string> {
  const state = randomBytes(18).toString("base64url");
  await db().query("INSERT INTO link_code (code, business_id, purpose, expires_at) VALUES ($1, $2, 'google_state', now() + interval '15 minutes')", [
    state,
    businessId,
  ]);
  const q = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH}?${q}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>, fetcher: typeof fetch = fetch): Promise<TokenResponse> {
  const res = await fetcher(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env().GOOGLE_CLIENT_ID!, client_secret: env().GOOGLE_CLIENT_SECRET!, ...params }),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json()) as TokenResponse;
  if (!res.ok || body.error) throw new Error(`Google recusou: ${body.error_description ?? body.error ?? res.status}`);
  return body;
}

/** Callback do OAuth: troca o código pelo refresh token e guarda cifrado. */
export async function finishOAuth(code: string, state: string): Promise<string> {
  const r = await db().query<{ business_id: string }>(
    "DELETE FROM link_code WHERE code = $1 AND purpose = 'google_state' AND expires_at > now() RETURNING business_id",
    [state],
  );
  const businessId = r.rows[0]?.business_id;
  if (!businessId) throw new Error("Link de conexão expirado. Tente de novo pelo painel.");
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error("O Google não devolveu acesso permanente. Remova o acesso do Convexa na sua conta Google e conecte de novo.");
  let email: string | null = null;
  try {
    email = JSON.parse(Buffer.from(t.id_token!.split(".")[1]!, "base64url").toString()).email ?? null;
  } catch {
    // sem e-mail
  }
  await db().query(
    `INSERT INTO google_link (business_id, email, refresh_token_enc, status) VALUES ($1, $2, $3, 'active')
     ON CONFLICT (business_id) DO UPDATE SET email = EXCLUDED.email, refresh_token_enc = EXCLUDED.refresh_token_enc,
       status = 'active', last_error = NULL`,
    [businessId, email, encrypt(t.refresh_token)],
  );
  tokens.delete(businessId);
  return businessId;
}

const tokens = new Map<string, { token: string; until: number }>();

export async function accessToken(businessId: string, fetcher: typeof fetch = fetch): Promise<{ token: string; calendarId: string } | undefined> {
  const r = await db().query<{ refresh_token_enc: string; calendar_id: string; status: string }>(
    "SELECT refresh_token_enc, calendar_id, status FROM google_link WHERE business_id = $1",
    [businessId],
  );
  const row = r.rows[0];
  if (!row || row.status !== "active") return undefined;
  const hit = tokens.get(businessId);
  if (hit && hit.until > Date.now() + 60_000) return { token: hit.token, calendarId: row.calendar_id };
  try {
    const t = await tokenRequest({ refresh_token: decrypt(row.refresh_token_enc), grant_type: "refresh_token" }, fetcher);
    tokens.set(businessId, { token: t.access_token, until: Date.now() + t.expires_in * 1000 });
    return { token: t.access_token, calendarId: row.calendar_id };
  } catch (error) {
    await db().query("UPDATE google_link SET status = 'broken', last_error = $2 WHERE business_id = $1", [businessId, (error as Error).message]);
    throw error;
  }
}

export async function disconnect(businessId: string) {
  const r = await db().query<{ refresh_token_enc: string }>("DELETE FROM google_link WHERE business_id = $1 RETURNING refresh_token_enc", [businessId]);
  await db().query("DELETE FROM calendar_event WHERE business_id = $1", [businessId]);
  tokens.delete(businessId);
  const enc = r.rows[0]?.refresh_token_enc;
  if (enc) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(enc))}`, { method: "POST" }).catch(() => undefined);
  }
}
