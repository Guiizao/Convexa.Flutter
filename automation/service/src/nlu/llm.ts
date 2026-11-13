import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "../env.js";
import { errorInfo, log } from "../lib/log.js";

/**
 * Camada de IA opcional (Claude). Só entra quando ANTHROPIC_API_KEY existe e
 * as regras não entenderam a mensagem. O modelo NUNCA executa nada: ele só
 * reescreve a frase num comando simples que o interpretador determinístico
 * já entende, ou lê um comprovante. A decisão continua no código.
 */

let client: Anthropic | undefined;
function anthropic(): Anthropic | undefined {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) return undefined;
  client ??= new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 });
  return client;
}

export const llmEnabled = () => !!env().ANTHROPIC_API_KEY;

const CUSTOMER_INTENTS = ["book", "my_appointments", "reschedule", "cancel", "prices", "info", "human", "greeting", "thanks", "yes", "no", "unknown"] as const;
const OWNER_INTENTS = ["agenda", "next", "free", "revenue", "block", "leave_early", "arrive_late", "day_off", "notice", "delay", "cancel_appointment", "pending_payments", "pause_bot", "resume_bot", "menu", "unknown"] as const;

const RewriteSchema = z.object({
  intent: z.string(),
  canonical: z.string(),
});

const SYSTEM = `Você interpreta mensagens de WhatsApp em português do Brasil para um sistema de agendamento de um estabelecimento de serviços.
Devolva a intenção e reescreva a mensagem como um comando curto e explícito, com datas e horários por extenso no formato que o sistema entende:
- datas: "hoje", "amanhã", nome do dia da semana ("sexta") ou "dd/mm"
- horários: "14:30"; intervalos: "das 12:00 às 14:00"; a partir de: "a partir das 17:00"
- períodos: "de manhã", "de tarde", "de noite"
Mantenha nomes de serviços e de pessoas como o usuário escreveu. Não invente informação que não está na mensagem.
Se não der para entender, use intent "unknown" e repita a mensagem em canonical.`;

const EXAMPLES: Record<"customer" | "owner", string> = {
  customer: `Exemplos (cliente):
"dá pra encaixar um corte amanhã depois do almoço?" -> intent book, canonical "agendar corte amanhã de tarde"
"não vou conseguir ir naquele horário de sexta" -> intent reschedule, canonical "remarcar meu horário de sexta"`,
  owner: `Exemplos (dono):
"amanhã meio dia vou estar ocupado até as duas, reajusta minha agenda" -> intent block, canonical "bloquear amanhã das 12:00 às 14:00"
"fala pra galera de hoje que a maquininha quebrou" -> intent notice, canonical "avisar clientes de hoje que a maquininha de cartão quebrou"
"quanto entrou essa semana?" -> intent revenue, canonical "faturamento da semana"`,
};

export async function rewrite(
  text: string,
  role: "customer" | "owner",
  context: { today: string; weekday: string; services: string[] },
): Promise<{ intent: string; canonical: string } | undefined> {
  const api = anthropic();
  if (!api) return undefined;
  const intents = role === "owner" ? OWNER_INTENTS : CUSTOMER_INTENTS;
  try {
    const response = await api.beta.messages.parse({
      model: env().ANTHROPIC_MODEL,
      max_tokens: 2048,
      // fallback no servidor: se o modelo recusar, outro modelo responde na mesma chamada
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: zodOutputFormat(RewriteSchema) },
      system: `${SYSTEM}\n\n${EXAMPLES[role]}\n\nIntenções possíveis: ${intents.join(", ")}.`,
      messages: [
        {
          role: "user",
          content: `Hoje é ${context.weekday}, ${context.today}. Serviços do estabelecimento: ${context.services.join(", ") || "não informado"}.\n\nMensagem: """${text.slice(0, 1000)}"""`,
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return undefined;
    const out = response.parsed_output;
    if (!(intents as readonly string[]).includes(out.intent)) return { intent: "unknown", canonical: out.canonical };
    return out;
  } catch (error) {
    log.warn("camada de IA falhou; seguindo só com regras", errorInfo(error));
    return undefined;
  }
}

const ReceiptSchema = z.object({
  isPaymentReceipt: z.boolean(),
  amountCents: z.number().int().nullable(),
  paidAt: z.string().nullable(),
  payeeName: z.string().nullable(),
  payerName: z.string().nullable(),
  endToEndId: z.string().nullable(),
});

export type ReceiptAnalysis = z.infer<typeof ReceiptSchema> & { matchesAmount: boolean | null; summary: string };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Lê o comprovante e diz se o valor bate. Só ajuda o dono; quem aprova é ele. */
export async function analyzeReceipt(
  media: { mimeType: string; data: Buffer },
  expected: { amountCents: number; merchantName?: string },
): Promise<ReceiptAnalysis | undefined> {
  const api = anthropic();
  if (!api) return undefined;
  const mime = media.mimeType.split(";")[0]!.trim();
  const isPdf = mime === "application/pdf";
  if (!isPdf && !IMAGE_TYPES.has(mime)) return undefined;
  const data = media.data.toString("base64");
  try {
    const response = await api.beta.messages.parse({
      model: env().ANTHROPIC_MODEL,
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: zodOutputFormat(ReceiptSchema) },
      messages: [
        {
          role: "user",
          content: [
            isPdf
              ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
              : { type: "image", source: { type: "base64", media_type: mime as "image/png", data } },
            {
              type: "text",
              text:
                "Este arquivo deveria ser um comprovante de Pix. Extraia o valor pago em centavos, a data/hora do pagamento (ISO 8601), " +
                "o nome de quem recebeu, o nome de quem pagou e o ID da transação (E2E) se aparecerem. Use null para o que não estiver visível.",
            },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return undefined;
    const r = response.parsed_output;
    const matchesAmount = r.amountCents === null ? null : r.amountCents === expected.amountCents;
    const parts: string[] = [];
    if (!r.isPaymentReceipt) parts.push("A imagem não parece um comprovante de pagamento.");
    else {
      if (r.amountCents !== null) {
        parts.push(matchesAmount ? "Valor confere." : `Valor no comprovante: R$ ${(r.amountCents / 100).toFixed(2).replace(".", ",")} (diferente do cobrado).`);
      } else parts.push("Não consegui ler o valor.");
      if (r.payeeName) parts.push(`Recebedor: ${r.payeeName}.`);
      if (r.paidAt) parts.push(`Pago em ${r.paidAt.replace("T", " ").slice(0, 16)}.`);
    }
    return { ...r, matchesAmount, summary: parts.join(" ") };
  } catch (error) {
    log.warn("leitura do comprovante falhou", errorInfo(error));
    return undefined;
  }
}
