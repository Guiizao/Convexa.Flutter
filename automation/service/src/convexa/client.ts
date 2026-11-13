import { env } from "../env.js";
import { errorInfo, log } from "../lib/log.js";
import { links } from "../settings/links.js";
import type { CustomerApi, Gateway, OwnerApi } from "./gateway.js";
import { http, type HttpOptions } from "./http.js";
import {
  ConvexaError,
  type Availability,
  type BusinessInfo,
  type ConvAppointment,
  type Employee,
  type OwnerAppointment,
  type Service,
  type Session,
  type TimeBlock,
} from "./types.js";

const internalHeaders = () => ({ "x-internal-key": env().INTERNAL_API_KEY });

function internal<T>(method: string, path: string, opts: HttpOptions = {}) {
  return http<T>(env().CONVEXA_API_URL, method, path, { ...opts, headers: { ...internalHeaders(), ...opts.headers } });
}

// ---------------------------------------------------------------- cliente
class HttpCustomerApi implements CustomerApi {
  constructor(readonly session: Session) {}

  private call<T>(method: string, path: string, opts: HttpOptions = {}) {
    return internal<T>(method, `/internal/conversation${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${this.session.token}` },
    });
  }

  services() {
    return this.call<Service[]>("GET", "/services");
  }
  availability(q: { serviceId: string; date: string; employeeId?: string; limit?: number }) {
    return this.call<Availability>("GET", "/availability", { query: { ...q, limit: Math.min(q.limit ?? 10, 10) } });
  }
  appointments() {
    return this.call<ConvAppointment[]>("GET", "/appointments");
  }
  book(input: { serviceId: string; employeeId: string; startAt: string; notes?: string }) {
    return this.call<ConvAppointment>("POST", "/appointments", { body: input });
  }
  cancel(id: string) {
    return this.call<ConvAppointment>("POST", `/appointments/${id}/cancel`);
  }
  reschedule(id: string, input: { startAt: string; employeeId?: string }) {
    return this.call<ConvAppointment>("POST", `/appointments/${id}/reschedule`, { body: input });
  }
}

// ---------------------------------------------------------------- dono
type CachedToken = { token: string; expiresAt: number };
const ownerTokens = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();

/**
 * Login do dono com a credencial guardada. Não usa refresh token de propósito:
 * a ConvexaAPI derruba TODAS as sessões do usuário se um refresh token já
 * trocado for reapresentado (por exemplo depois de um timeout). Login direto
 * não tem esse risco. O refresh token que vem no login é revogado na hora.
 */
async function ownerToken(businessId: string, force = false): Promise<string | undefined> {
  const cached = ownerTokens.get(businessId);
  if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached.token;

  const running = inflight.get(businessId);
  if (running) return running;

  const job = (async () => {
    const creds = await links.credentials(businessId);
    if (!creds) throw new ConvexaError("Automação não conectada pelo dono", 412, "NOT_LINKED");
    try {
      const session = await http<{ accessToken: string; refreshToken: string; expiresIn: number }>(
        env().CONVEXA_API_URL,
        "POST",
        "/api/auth/login",
        { body: { email: creds.email, password: creds.password } },
      );
      ownerTokens.set(businessId, { token: session.accessToken, expiresAt: Date.now() + session.expiresIn * 1000 });
      // revoga o refresh token que não vamos usar (não bloqueia)
      void http(env().CONVEXA_API_URL, "POST", "/api/auth/logout", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        body: { refreshToken: session.refreshToken },
      }).catch(() => {});
      return session.accessToken;
    } catch (error) {
      if (error instanceof ConvexaError && error.status === 401) {
        await links.markBroken(businessId, "Senha do dono mudou ou usuário desativado. Conecte de novo no painel.");
      }
      throw error;
    }
  })();
  inflight.set(businessId, job);
  try {
    return await job;
  } finally {
    inflight.delete(businessId);
  }
}

export function forgetOwnerToken(businessId: string) {
  ownerTokens.delete(businessId);
}

/** Valida as credenciais sem guardar nada (usado na tela de conexão). */
export async function tryOwnerLogin(email: string, password: string) {
  const session = await http<{ accessToken: string; refreshToken: string; business: { id: string; name: string; timezone: string } }>(
    env().CONVEXA_API_URL,
    "POST",
    "/api/auth/login",
    { body: { email, password } },
  );
  void http(env().CONVEXA_API_URL, "POST", "/api/auth/logout", {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: { refreshToken: session.refreshToken },
  }).catch(() => {});
  return session;
}

class HttpOwnerApi implements OwnerApi {
  constructor(private readonly businessId: string) {}

  private async call<T>(method: string, path: string, opts: HttpOptions = {}, retried = false): Promise<T> {
    const token = await ownerToken(this.businessId, retried);
    try {
      return await http<T>(env().CONVEXA_API_URL, method, path, {
        ...opts,
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (!retried && error instanceof ConvexaError && error.status === 401) {
        forgetOwnerToken(this.businessId);
        return this.call<T>(method, path, opts, true);
      }
      throw error;
    }
  }

  business() {
    return this.call<BusinessInfo>("GET", "/api/business");
  }
  async services() {
    const r = await this.call<{ data: Service[] }>("GET", "/api/services", { query: { perPage: 100 } });
    return r.data;
  }
  async employees() {
    const r = await this.call<{ data: Employee[] }>("GET", "/api/employees", { query: { perPage: 100 } });
    return r.data;
  }
  appointments(q: { from?: string; to?: string; status?: OwnerAppointment["status"]; customerId?: string }) {
    return this.call<OwnerAppointment[]>("GET", "/api/appointments", { query: q });
  }
  appointment(id: string) {
    return this.call<OwnerAppointment>("GET", `/api/appointments/${id}`);
  }
  confirm(id: string) {
    return this.call<OwnerAppointment>("POST", `/api/appointments/${id}/confirm`);
  }
  cancel(id: string) {
    return this.call<OwnerAppointment>("POST", `/api/appointments/${id}/cancel`);
  }
  availability(q: { serviceId: string; date: string; employeeId?: string; limit?: number; slotIntervalMinutes?: number }) {
    return this.call<Availability>("GET", "/api/availability", { query: { ...q, limit: q.limit ?? 100 } });
  }
  createTimeBlock(input: { startAt: string; endAt: string; employeeId?: string; reason?: string }) {
    return this.call<TimeBlock>("POST", "/api/time-blocks", { body: input });
  }
  updateTimeBlock(id: string, input: { startAt?: string; endAt?: string; reason?: string }) {
    return this.call<TimeBlock>("PATCH", `/api/time-blocks/${id}`, { body: input });
  }
  async deleteTimeBlock(id: string) {
    await this.call<unknown>("DELETE", `/api/time-blocks/${id}`);
  }
  timeBlocks(q: { from?: string; to?: string }) {
    return this.call<TimeBlock[]>("GET", "/api/time-blocks", { query: q });
  }
  addClosedDay(input: { date: string; reason?: string }) {
    return this.call<unknown>("POST", "/api/business/closed-days", { body: input });
  }
}

// ---------------------------------------------------------------- gateway
export const httpGateway: Gateway = {
  tenant(phoneNumberId) {
    return internal("GET", `/internal/tenants/by-phone-number-id/${encodeURIComponent(phoneNumberId)}`);
  },
  async customer(phoneNumberId, phone, name) {
    const session = await internal<Session>("POST", "/internal/conversation/session", {
      body: { phoneNumberId, phone, ...(name ? { name } : {}) },
    });
    return new HttpCustomerApi(session);
  },
  async owner(businessId) {
    const link = await links.get(businessId);
    if (!link || link.status !== "active") return undefined;
    return new HttpOwnerApi(businessId);
  },
};

export async function metaCredentials(phoneNumberId: string) {
  try {
    return await internal<{ metaAccessToken: string | null; metaAppSecret: string | null }>(
      "GET",
      `/internal/integrations/by-phone-number-id/${encodeURIComponent(phoneNumberId)}`,
    );
  } catch (error) {
    log.warn("credenciais da Meta indisponíveis", { phoneNumberId, ...errorInfo(error) });
    return undefined;
  }
}
