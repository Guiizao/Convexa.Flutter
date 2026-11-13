import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(3100),
  HOST: z.string().default("0.0.0.0"),
  // URL pública deste serviço (callback do Google, imagem do QR Pix, webhook do Mercado Pago)
  PUBLIC_URL: z.string().url().default("http://localhost:3100"),
  // URL pública do painel, para links mandados ao dono
  PANEL_URL: z.string().url().default("http://localhost:8080"),
  DATABASE_URL: z.string().min(1),
  CONVEXA_API_URL: z.string().url(),
  INTERNAL_API_KEY: z.string().min(32),
  // Segredo compartilhado com o n8n (header x-automacao-key)
  AUTOMACAO_KEY: z.string().min(32),
  // 32 bytes em base64: cifra senha do dono, tokens do Google e do Mercado Pago
  ENCRYPTION_KEY: z.string().min(40),
  // Webhook do n8n que envia um lote de mensagens (ações do painel e da Alexa)
  N8N_SEND_WEBHOOK_URL: z.string().url().optional(),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  // Opcional: liga a camada de IA (Claude) para entender texto livre e ler comprovantes
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  // Opcional: Google Agenda
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Opcional: Alexa (id da skill, para validar que a requisição é da nossa skill)
  ALEXA_SKILL_ID: z.string().optional(),
  ALEXA_VERIFY_SIGNATURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Exige a assinatura X-Hub-Signature-256 da Meta (desligue só em teste local sem simulador)
  WHATSAPP_REQUIRE_SIGNATURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= load();
  return cached;
}

/** Só para testes. */
export function setEnvForTests(values: Partial<Env>) {
  cached = { ...(cached ?? ({} as Env)), ...values } as Env;
}
