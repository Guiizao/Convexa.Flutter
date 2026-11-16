// Utilitários dos testes que conversam com o bot pelo simulador de WhatsApp.
// O caminho é o real: simulador -> n8n -> convexa-automacao -> ConvexaAPI -> n8n -> simulador.
import { execFileSync } from "node:child_process";

export const SIM = process.env.SIM_URL ?? "http://localhost:3200";
export const API = process.env.API_URL ?? "http://localhost:3000";
export const AUTO = process.env.AUTOMACAO_URL ?? "http://localhost:3100";
export const N8N = process.env.N8N_URL ?? "http://localhost:5678";
export const OWNER = { waId: process.env.OWNER_WAID ?? "5514999990000", name: "Rafael (dono)" };
export const DEMO = { email: process.env.DEMO_EMAIL ?? "dono@navalha.demo", password: process.env.DEMO_PASSWORD ?? "Navalha#2026demo" };

export const rnd = () => String(Math.floor(1000 + Math.random() * 8999));
// Celular do Brasil: 9 + oito dígitos começando em 6-9 (o WhatsApp às vezes entrega sem o 9 da frente)
export const novoCliente = (name = "Cliente Teste") => ({ waId: `55149${6 + Math.floor(Math.random() * 4)}${rnd().slice(1)}${rnd()}`, name });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Registro de tudo o que foi falado, para o relatório. */
export const transcript = [];
const log = (who, m) => transcript.push({ at: new Date().toISOString(), who: who.name, waId: who.waId, ...m });

export async function sim(path, body, method) {
  const r = await fetch(SIM + path, body !== undefined ? { method: method ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: method ?? "GET" });
  return r.json();
}
export async function lastSeq(waId) {
  const all = await sim(`/api/messages?waId=${waId}`);
  return all.at(-1)?.seq ?? 0;
}
export async function inbox(waId, since) {
  return (await sim(`/api/messages?waId=${waId}&since=${since}`)).filter((m) => m.from === "bot");
}
/** Espera o bot ficar quieto e devolve o que ele mandou para `who` desde `since`. */
export async function waitBot(who, since, { quietMs = 1800, timeoutMs = 25000 } = {}) {
  const start = Date.now();
  let last = [];
  let lastChange = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(350);
    const msgs = await inbox(who.waId, since);
    if (msgs.length !== last.length) {
      last = msgs;
      lastChange = Date.now();
    } else if (msgs.length > 0 && Date.now() - lastChange > quietMs) break;
  }
  for (const m of last) log(who, { dir: "bot", kind: m.kind, text: m.text, buttons: m.buttons?.map((b) => b.title), rows: m.sections?.flatMap((s) => s.rows.map((r) => r.title)), template: m.template });
  return last;
}
/** Manda uma mensagem do "celular" e devolve a resposta do bot. */
export async function talk(who, body, opts = {}) {
  const since = await lastSeq(who.waId);
  log(who, { dir: "user", text: body.text ?? body.title ?? (body.image ? "[imagem]" : body.raw ? `[${body.raw.type}]` : "") });
  await sim("/api/send", { waId: who.waId, name: who.name, ...body });
  return waitBot(who, since, opts);
}
export const text = (msgs) => msgs.map((m) => m.text).join("\n---\n");
export const options = (msgs) => msgs.flatMap((m) => [...(m.buttons ?? []).map((b) => b.title), ...(m.sections ?? []).flatMap((s) => s.rows.map((r) => r.title))]);
/** Acha um botão ou linha de lista pelo título e devolve o corpo para "tocar" nele. */
export function tap(msgs, re) {
  for (const m of [...msgs].reverse()) {
    for (const b of m.buttons ?? []) if (re.test(b.title)) return { replyId: b.id, title: b.title, kind: m.kind === "template" ? "template" : "button" };
    for (const s of m.sections ?? []) for (const r of s.rows) if (re.test(r.title)) return { replyId: r.id, title: r.title, kind: "list" };
  }
  throw new Error(`opção ${re} não encontrada em:\n${text(msgs)}\n[${options(msgs).join(" | ")}]`);
}
/** Posição (1, 2, 3...) de uma opção, para responder digitando o número. */
export function numberOf(msgs, re) {
  const all = options(msgs.slice(-1));
  const i = all.findIndex((t) => re.test(t));
  if (i < 0) throw new Error(`opção ${re} não está em [${all.join(" | ")}]`);
  return String(i + 1);
}

// ------------------------------------------------------------------ resultado
export const results = [];
let current;
export function check(name, cond, detail = "") {
  current.checks.push({ name, ok: !!cond, detail: cond ? "" : String(detail).slice(0, 600) });
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}\n${String(detail).split("\n").slice(0, 8).map((l) => "      " + l).join("\n")}`);
}
export async function scenario(area, title, fn) {
  await budget().catch(() => {});
  current = { area, title, checks: [], from: transcript.length };
  results.push(current);
  console.log(`\n▶ [${area}] ${title}`);
  try {
    await fn();
  } catch (error) {
    current.checks.push({ name: "cenário terminou sem erro", ok: false, detail: error.message.slice(0, 600) });
    console.log(`  ✗ erro: ${error.message.split("\n").slice(0, 6).join("\n      ")}`);
  }
  current.to = transcript.length;
}

// ------------------------------------------------------------------ painel e banco
let token;
export async function panelToken() {
  if (token) return token;
  const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(DEMO) }).then((x) => x.json());
  token = r.accessToken ?? r.data?.accessToken;
  if (!token) throw new Error("login do painel falhou: " + JSON.stringify(r).slice(0, 200));
  return token;
}
export async function panel(method, path, body) {
  const r = await fetch(`${AUTO}/v1/panel${path}`, {
    method,
    headers: { Authorization: `Bearer ${await panelToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
export async function apiCall(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await panelToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
export const setSettings = (patch) => panel("PUT", "/settings", patch);

/** SQL no banco da automação (só para "viajar no tempo": vencer um sinal, fechar a janela de 24h). */
export function sql(query) {
  const url = process.env.AUTOMACAO_DB_URL;
  if (!url) throw new Error("defina AUTOMACAO_DB_URL para os cenários que mexem no relógio");
  return execFileSync("psql", [url, "-tAc", query], { encoding: "utf8" }).trim();
}
/** Roda o relógio (lembretes, sinais vencidos) e entrega o que saiu, pelo mesmo webhook que o n8n usa. */
export async function tick() {
  const key = process.env.AUTOMACAO_KEY;
  if (!key) throw new Error("defina AUTOMACAO_KEY");
  const r = await fetch(`${AUTO}/v1/jobs/tick`, { method: "POST", headers: { "x-automacao-key": key } }).then((x) => x.json());
  const n = (r.batches ?? []).reduce((s, b) => s + b.messages.length, 0);
  if (n) await fetch(`${N8N}/webhook/convexa-enviar`, { method: "POST", headers: { "Content-Type": "application/json", "x-automacao-key": key }, body: JSON.stringify({ batches: r.batches }) });
  return n;
}
/** Faz de conta que o número não escreve há `hours` horas, no simulador (Meta) e no banco do bot. */
export async function age(who, hours) {
  await sim("/api/age", { waId: who.waId, hours });
  sql(`UPDATE conversation SET last_inbound_at = now() - interval '${Number(hours)} hours' WHERE phone = '+${who.waId}'`);
}

/** SQL no banco da ConvexaAPI. Só em ambiente local de testes (limpar a agenda da empresa de demonstração, simular cota). */
export function apiSql(query) {
  const url = process.env.API_DB_URL;
  if (!url) throw new Error("defina API_DB_URL para os cenários que limpam a agenda de demonstração");
  return execFileSync("psql", [url, "-tAc", query], { encoding: "utf8" }).trim();
}
/**
 * A ConvexaAPI limita /api a 300 chamadas por 15 min por IP, e os testes rodam tudo de um IP só.
 * Antes de cada cenário, se sobrar pouco, espera a janela virar (isso não acontece com clientes reais
 * espalhados no tempo; é efeito de rodar centenas de conversas em minutos).
 */
export async function budget(min = 70) {
  const r = await fetch(`${API}/api/business`, { headers: { Authorization: `Bearer ${await panelToken()}` } });
  const m = (r.headers.get("ratelimit") ?? "").match(/remaining=(\d+), reset=(\d+)/);
  if (!m) return;
  if (Number(m[1]) < min) {
    console.log(`  (limite da API quase no fim: ${m[1]} chamadas; esperando ${m[2]} s a janela virar)`);
    await sleep((Number(m[2]) + 2) * 1000);
  }
}
/** Chamada da Alexa, pelo webhook do n8n, no formato que a Amazon manda. */
export async function alexa(userId, intent, slots = {}, attributes = {}, type = "IntentRequest") {
  const body = {
    version: "1.0",
    session: { new: !Object.keys(attributes).length, sessionId: "s-" + userId, application: { applicationId: "amzn1.ask.skill.teste" }, user: { userId }, attributes },
    context: { System: { application: { applicationId: "amzn1.ask.skill.teste" }, user: { userId } } },
    request: {
      type,
      requestId: "r" + Date.now(),
      timestamp: new Date().toISOString(),
      locale: "pt-BR",
      ...(type === "IntentRequest" ? { intent: { name: intent, slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, value: v }])) } } : {}),
    },
  };
  const r = await fetch(`${N8N}/webhook/alexa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  const speech = (j.response?.outputSpeech?.ssml ?? "").replace(/<[^>]+>/g, "");
  transcript.push({ at: new Date().toISOString(), who: "Alexa", waId: userId, dir: "user", text: `${type === "IntentRequest" ? intent : type} ${JSON.stringify(slots)}` });
  transcript.push({ at: new Date().toISOString(), who: "Alexa", waId: userId, dir: "bot", kind: "voz", text: speech });
  return { status: r.status, speech, end: j.response?.shouldEndSession, attributes: j.sessionAttributes ?? {} };
}
