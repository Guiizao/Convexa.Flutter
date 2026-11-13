import { z } from "zod";
import { db } from "../db/pool.js";
import { decrypt, encrypt } from "../lib/crypto.js";

export const SEGMENTS = {
  barbearia: { label: "Barbearia", service: "serviço", professional: "barbeiro", professionals: "barbeiros" },
  salao: { label: "Salão de beleza", service: "serviço", professional: "profissional", professionals: "profissionais" },
  estetica: { label: "Estética", service: "procedimento", professional: "profissional", professionals: "profissionais" },
  clinica: { label: "Clínica / consultório", service: "atendimento", professional: "profissional", professionals: "profissionais" },
  manicure: { label: "Manicure e pedicure", service: "serviço", professional: "manicure", professionals: "manicures" },
  pet: { label: "Pet shop", service: "serviço", professional: "profissional", professionals: "profissionais" },
  estudio: { label: "Estúdio (tatuagem, cílios, sobrancelha)", service: "sessão", professional: "artista", professionals: "artistas" },
  academia: { label: "Personal / aulas", service: "aula", professional: "instrutor", professionals: "instrutores" },
  outro: { label: "Outro", service: "serviço", professional: "profissional", professionals: "profissionais" },
} as const;

export type Segment = keyof typeof SEGMENTS;

const phoneList = z.array(z.string().trim().min(8)).max(5);

export const settingsSchema = z.object({
  agentEnabled: z.boolean().default(true),
  ownerPhones: phoneList.default([]),
  segment: z.enum(Object.keys(SEGMENTS) as [Segment, ...Segment[]]).default("outro"),
  greeting: z.string().trim().max(300).default(""),
  address: z.string().trim().max(300).default(""),
  mapsUrl: z.string().trim().max(300).default(""),
  paymentMethodsText: z.string().trim().max(200).default("Pix, cartão e dinheiro"),
  askProfessional: z.boolean().default(true),
  ownerEmployeeId: z.string().uuid().nullable().default(null),
  reminders: z
    .object({
      enabled: z.boolean().default(true),
      hoursBefore: z.array(z.number().int().min(1).max(72)).max(3).default([24, 2]),
    })
    .default({ enabled: true, hoursBefore: [24, 2] }),
  prepayment: z
    .object({
      mode: z.enum(["off", "optional", "required"]).default("off"),
      depositType: z.enum(["percent", "fixed"]).default("percent"),
      depositPercent: z.number().int().min(1).max(100).default(30),
      depositFixedCents: z.number().int().min(100).default(2000),
      fullPaymentDiscountPercent: z.number().int().min(0).max(50).default(10),
      provider: z.enum(["static_pix", "mercadopago"]).default("static_pix"),
      pixKey: z.string().trim().max(77).default(""),
      merchantName: z.string().trim().max(25).default(""),
      merchantCity: z.string().trim().max(15).default(""),
      expiresMinutes: z.number().int().min(5).max(24 * 60).default(30),
    })
    .default({
      mode: "off",
      depositType: "percent",
      depositPercent: 30,
      depositFixedCents: 2000,
      fullPaymentDiscountPercent: 10,
      provider: "static_pix",
      pixKey: "",
      merchantName: "",
      merchantCity: "",
      expiresMinutes: 30,
    }),
  cancellation: z
    .object({
      minHoursBefore: z.number().int().min(0).max(72).default(2),
      depositRefundable: z.boolean().default(false),
    })
    .default({ minHoursBefore: 2, depositRefundable: false }),
  notifyOwner: z
    .object({
      newBooking: z.boolean().default(true),
      cancellation: z.boolean().default(true),
      reschedule: z.boolean().default(true),
      handoff: z.boolean().default(true),
    })
    .default({ newBooking: true, cancellation: true, reschedule: true, handoff: true }),
  handoffHours: z.number().int().min(1).max(72).default(2),
  costPercent: z.number().min(0).max(95).nullable().default(null),
  upsell: z
    .object({ enabled: z.boolean().default(false), serviceIds: z.array(z.string().uuid()).max(3).default([]) })
    .default({ enabled: false, serviceIds: [] }),
  dailySummary: z
    .object({ enabled: z.boolean().default(false), time: z.string().regex(/^\d{2}:\d{2}$/).default("08:00") })
    .default({ enabled: false, time: "08:00" }),
  google: z
    .object({ enabled: z.boolean().default(false), importBusy: z.boolean().default(false) })
    .default({ enabled: false, importBusy: false }),
  alexa: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
});

export type BotSettings = z.infer<typeof settingsSchema>;

export const secretsSchema = z.object({
  mercadoPagoAccessToken: z.string().trim().min(10).optional(),
  mercadoPagoWebhookSecret: z.string().trim().min(8).optional(),
});
export type BotSecrets = z.infer<typeof secretsSchema>;

export function defaultSettings(): BotSettings {
  return settingsSchema.parse({});
}

/** Junta o que está salvo com os padrões novos (configuração antiga continua válida). */
export function mergeSettings(stored: unknown): BotSettings {
  const base = defaultSettings();
  const merged = deepMerge(base, (stored ?? {}) as Record<string, unknown>);
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}

function deepMerge<T>(base: T, patch: Record<string, unknown>): T {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const current = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && current && typeof current === "object" && !Array.isArray(current)
        ? deepMerge(current, v as Record<string, unknown>)
        : v;
  }
  return out as T;
}

export const settingsRepo = {
  async get(businessId: string): Promise<BotSettings> {
    const r = await db().query<{ settings: unknown }>("SELECT settings FROM bot_settings WHERE business_id = $1", [businessId]);
    return mergeSettings(r.rows[0]?.settings);
  },

  async update(businessId: string, patch: Record<string, unknown>): Promise<BotSettings> {
    const current = await this.get(businessId);
    const next = settingsSchema.parse(deepMerge(current, patch));
    await db().query(
      `INSERT INTO bot_settings (business_id, settings) VALUES ($1, $2)
       ON CONFLICT (business_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
      [businessId, JSON.stringify(next)],
    );
    return next;
  },

  async secrets(businessId: string): Promise<BotSecrets> {
    const r = await db().query<{ secrets_enc: string | null }>("SELECT secrets_enc FROM bot_settings WHERE business_id = $1", [
      businessId,
    ]);
    const enc = r.rows[0]?.secrets_enc;
    if (!enc) return {};
    try {
      return secretsSchema.parse(JSON.parse(decrypt(enc)));
    } catch {
      return {};
    }
  },

  async updateSecrets(businessId: string, patch: BotSecrets): Promise<void> {
    const current = await this.secrets(businessId);
    const next = secretsSchema.parse({ ...current, ...patch });
    await db().query(
      `INSERT INTO bot_settings (business_id, secrets_enc) VALUES ($1, $2)
       ON CONFLICT (business_id) DO UPDATE SET secrets_enc = EXCLUDED.secrets_enc, updated_at = now()`,
      [businessId, encrypt(JSON.stringify(next))],
    );
  },
};

export function vocab(settings: BotSettings) {
  return SEGMENTS[settings.segment];
}
