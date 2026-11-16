// Confere a configuração do número na Meta e cadastra os modelos de mensagem do Convexa.
// Uso:
//   META_TOKEN=<token permanente> WABA_ID=<id da conta do WhatsApp Business> PHONE_NUMBER_ID=<id do número> \
//     node meta-preparar.mjs verificar            # mostra o estado do número, do webhook e dos modelos
//   ... node meta-preparar.mjs criar-modelos      # cria os modelos que faltam (categoria Utilidade, pt_BR)
//   ... node meta-preparar.mjs assinar-webhook    # inscreve o app nos eventos da conta (se as mensagens não chegam)
// Opcional: GRAPH_API_VERSION (padrão v24.0), GRAPH_API_BASE (padrão https://graph.facebook.com)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const templates = JSON.parse(readFileSync(join(here, "..", "simulator", "templates.json"), "utf8"));
const { META_TOKEN, WABA_ID, PHONE_NUMBER_ID } = process.env;
const BASE = `${process.env.GRAPH_API_BASE ?? "https://graph.facebook.com"}/${process.env.GRAPH_API_VERSION ?? "v24.0"}`;
const action = process.argv[2] ?? "verificar";

/** Regras da Meta que derrubam um modelo na análise. Devolve os problemas encontrados. */
export function problemas(name, t) {
  const errs = [];
  const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const distinct = [...new Set(vars)];
  if (!/^[a-z0-9_]+$/.test(name)) errs.push("nome só pode ter letras minúsculas, números e _");
  if (/^\s*\{\{\d+\}\}/.test(t.body)) errs.push("o texto não pode começar com uma variável");
  if (/\{\{\d+\}\}\s*$/.test(t.body)) errs.push("o texto não pode terminar com uma variável");
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(t.body)) errs.push("duas variáveis coladas, sem texto entre elas");
  if (distinct.some((n, i) => n !== i + 1)) errs.push("as variáveis devem ser {{1}}, {{2}}, {{3}}... em ordem, sem pular");
  if (t.body.length > 1024) errs.push("texto com mais de 1024 caracteres");
  if ((t.example ?? []).length !== distinct.length) errs.push(`faltam exemplos: ${distinct.length} variáveis, ${(t.example ?? []).length} exemplos`);
  if ((t.buttons ?? []).length > 10) errs.push("mais de 10 botões");
  for (const b of t.buttons ?? []) if (b.length > 25) errs.push(`botão "${b}" com mais de 25 caracteres`);
  const words = t.body.replace(/\{\{\d+\}\}/g, "").split(/\s+/).filter(Boolean).length;
  if (words < distinct.length * 3) errs.push("pouco texto fixo para tantas variáveis (a Meta pede contexto em volta de cada uma)");
  return errs;
}

/** Corpo do POST /{waba}/message_templates */
export function payload(name, t) {
  return {
    name,
    language: "pt_BR",
    category: "UTILITY",
    components: [
      { type: "BODY", text: t.body, ...(t.example?.length ? { example: { body_text: [t.example] } } : {}) },
      ...(t.buttons?.length ? [{ type: "BUTTONS", buttons: t.buttons.map((text) => ({ type: "QUICK_REPLY", text })) }] : []),
    ],
  };
}

async function graph(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${META_TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`);
  return json;
}

async function listTemplates() {
  const out = [];
  let path = `/${WABA_ID}/message_templates?fields=name,status,category,language&limit=100`;
  while (path) {
    const page = await graph("GET", path);
    out.push(...(page.data ?? []));
    const next = page.paging?.next;
    path = next ? next.replace(BASE, "") : undefined;
  }
  return out;
}

async function main() {
  // sempre: confere os textos antes de falar com a Meta
  let bad = 0;
  for (const [name, t] of Object.entries(templates)) {
    const errs = problemas(name, t);
    if (errs.length) {
      bad++;
      console.log(`✗ ${name}: ${errs.join("; ")}`);
    }
  }
  if (bad) {
    console.log("Corrija os modelos em simulator/templates.json antes de enviar.");
    process.exit(1);
  }
  console.log(`✓ os ${Object.keys(templates).length} modelos passam nas regras de formato da Meta`);
  if (action === "conferir-textos") return;

  const missing = ["META_TOKEN", "WABA_ID", ...(action === "verificar" ? ["PHONE_NUMBER_ID"] : [])].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Faltou: ${missing.join(", ")}. Veja o exemplo no topo deste arquivo.`);
    process.exit(1);
  }

  if (action === "verificar") {
    const n = await graph("GET", `/${PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,name_status,quality_rating,code_verification_status`);
    console.log(`\nNúmero: ${n.display_phone_number}  |  nome exibido: ${n.verified_name} (${n.name_status ?? "?"})  |  qualidade: ${n.quality_rating ?? "?"}  |  verificação por código: ${n.code_verification_status ?? "?"}`);
    if (n.name_status && !["APPROVED", "AVAILABLE_WITHOUT_REVIEW"].includes(n.name_status)) console.log("  ⚠ o nome de exibição ainda não foi aprovado: o número não envia até aprovar.");
    const subs = await graph("GET", `/${WABA_ID}/subscribed_apps`);
    const apps = (subs.data ?? []).map((a) => a.whatsapp_business_api_data?.name ?? a.name ?? a.id);
    console.log(apps.length ? `Webhook: app inscrito na conta (${apps.join(", ")})` : "  ⚠ nenhum app inscrito na conta: as mensagens dos clientes NÃO chegam. Rode: node meta-preparar.mjs assinar-webhook");
  }

  if (action === "assinar-webhook") {
    await graph("POST", `/${WABA_ID}/subscribed_apps`);
    console.log("✓ app inscrito nos eventos da conta do WhatsApp Business.");
    return;
  }

  const existing = await listTemplates();
  const byName = new Map(existing.filter((t) => t.language === "pt_BR").map((t) => [t.name, t]));
  console.log("\nModelos:");
  for (const [name, t] of Object.entries(templates)) {
    const cur = byName.get(name);
    if (cur) {
      const warn = cur.category !== "UTILITY" ? `  ⚠ categoria ${cur.category} (o custo e as regras mudam; o esperado é UTILITY)` : "";
      console.log(`  ${cur.status === "APPROVED" ? "✓" : "…"} ${name}: ${cur.status}${warn}`);
      continue;
    }
    if (action !== "criar-modelos") {
      console.log(`  ✗ ${name}: não existe (rode: node meta-preparar.mjs criar-modelos)`);
      continue;
    }
    try {
      const r = await graph("POST", `/${WABA_ID}/message_templates`, payload(name, t));
      console.log(`  + ${name}: enviado para análise (${r.status ?? "PENDING"})`);
    } catch (error) {
      console.log(`  ✗ ${name}: ${error.message}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
