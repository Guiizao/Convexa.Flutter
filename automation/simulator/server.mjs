// Simulador de WhatsApp para testar o Convexa sem número real.
//  - Faz o papel da Graph API da Meta: recebe o que o n8n envia (/graph/...)
//  - Faz o papel do celular: manda webhooks assinados para o n8n
//  - Tela de chat em http://localhost:3200 e API para testes automáticos
// Sem dependências: só Node 20+.
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = {
  port: Number(process.env.PORT ?? 3200),
  webhookUrl: process.env.N8N_WEBHOOK_URL ?? "http://127.0.0.1:5678/webhook/whatsapp",
  appSecret: process.env.APP_SECRET ?? "simulador-app-secret",
  accessToken: process.env.ACCESS_TOKEN ?? "SIMULADOR-ACCESS-TOKEN",
  phoneNumberId: process.env.PHONE_NUMBER_ID ?? "100000000000001",
  displayPhone: process.env.DISPLAY_PHONE ?? "551433330000",
  businessName: process.env.BUSINESS_NAME ?? "Barbearia Navalha",
  publicBase: process.env.PUBLIC_BASE ?? "http://127.0.0.1:3200",
};
const templates = JSON.parse(readFileSync(join(here, "templates.json"), "utf8"));

/** @type {Map<string, {waId:string,name:string,messages:any[]}>} */
const chats = new Map();
const media = new Map(); // id -> { mime, data }
const sse = new Set();
let seq = 0;

// Última mensagem recebida de cada número: a Meta só aceita mensagem livre (não-modelo)
// para quem escreveu nas últimas 24h. Fica em arquivo para sobreviver a um reinício do simulador.
const stateFile = process.env.STATE_FILE ?? join(tmpdir(), `convexa-simulador-${cfg.phoneNumberId}.json`);
/** @type {Record<string, number>} */
const lastInbound = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
const saveState = () => writeFileSync(stateFile, JSON.stringify(lastInbound));
const windowOpen = (waId) => Date.now() - (lastInbound[waId] ?? 0) < 24 * 3600_000;
/** Tudo o que a "Meta" recusou, para os testes conferirem que nada foi rejeitado. */
const rejections = [];

function chat(waId, name) {
  let c = chats.get(waId);
  if (!c) chats.set(waId, (c = { waId, name: name ?? waId, messages: [] }));
  if (name) c.name = name;
  return c;
}

function push(waId, msg) {
  const m = { seq: ++seq, at: new Date().toISOString(), ...msg };
  chat(waId).messages.push(m);
  const data = `data: ${JSON.stringify({ waId, message: m })}\n\n`;
  for (const res of sse) res.write(data);
  return m;
}

/** Converte o corpo que o bot mandou num formato fácil de desenhar. */
function render(graph) {
  if (graph.type === "text") return { kind: "text", text: graph.text.body };
  if (graph.type === "image") return { kind: "image", link: graph.image.link, text: graph.image.caption ?? "" };
  if (graph.type === "interactive") {
    const i = graph.interactive;
    const base = { header: i.header?.text, text: i.body?.text ?? "", footer: i.footer?.text };
    if (i.type === "button") return { kind: "buttons", ...base, buttons: i.action.buttons.map((b) => ({ id: b.reply.id, title: b.reply.title })) };
    if (i.type === "list") return { kind: "list", ...base, button: i.action.button, sections: i.action.sections };
  }
  if (graph.type === "template") {
    const t = templates[graph.template.name];
    const body = (graph.template.components ?? []).find((c) => c.type === "body");
    const params = (body?.parameters ?? []).map((p) => p.text);
    const payloads = (graph.template.components ?? []).filter((c) => c.type === "button").map((c) => c.parameters?.[0]?.payload);
    const text = (t?.body ?? `[template ${graph.template.name}] ${params.join(" | ")}`).replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
    return { kind: "template", template: graph.template.name, text, buttons: (t?.buttons ?? []).map((title, idx) => ({ id: payloads[idx], title })).filter((b) => b.id) };
  }
  return { kind: "unknown", text: JSON.stringify(graph) };
}

function validate(graph) {
  // Os mesmos limites que a Meta aplica: o simulador recusa o que a Meta recusaria
  const errs = [];
  const dup = (list) => list.find((x, i) => list.indexOf(x) !== i);
  if (!/^\d{10,15}$/.test(String(graph.to ?? ""))) errs.push(`destinatário inválido: ${graph.to}`);
  if (graph.type === "interactive") {
    const i = graph.interactive;
    const body = i.body?.text ?? "";
    if (!body.trim()) errs.push("body vazio");
    if (body.length > 1024) errs.push("body > 1024");
    if ((i.header?.text ?? "").length > 60) errs.push("header > 60");
    if ((i.footer?.text ?? "").length > 60) errs.push("footer > 60");
    if (i.type === "button") {
      const btns = i.action?.buttons ?? [];
      if (btns.length < 1 || btns.length > 3) errs.push(`botões: ${btns.length} (aceita de 1 a 3)`);
      for (const b of btns) {
        if (!b.reply?.title?.trim()) errs.push("botão sem título");
        if ((b.reply?.title ?? "").length > 20) errs.push(`botão "${b.reply.title}" > 20`);
        if (!b.reply?.id || b.reply.id.length > 256) errs.push("id de botão vazio ou > 256");
      }
      if (dup(btns.map((b) => b.reply?.id))) errs.push(`id de botão repetido: ${dup(btns.map((b) => b.reply?.id))}`);
      if (dup(btns.map((b) => b.reply?.title))) errs.push(`título de botão repetido: ${dup(btns.map((b) => b.reply?.title))}`);
    } else if (i.type === "list") {
      const label = i.action?.button ?? "";
      if (!label.trim() || label.length > 20) errs.push("texto do botão da lista vazio ou > 20");
      const sections = i.action?.sections ?? [];
      const rows = sections.flatMap((s) => s.rows ?? []);
      if (sections.length < 1 || sections.length > 10) errs.push(`seções: ${sections.length} (aceita de 1 a 10)`);
      if (rows.length < 1 || rows.length > 10) errs.push(`linhas: ${rows.length} (aceita de 1 a 10 no total)`);
      for (const r of rows) {
        if (!r.title?.trim()) errs.push("linha sem título");
        if ((r.title ?? "").length > 24) errs.push(`linha "${r.title}" > 24`);
        if ((r.description ?? "").length > 72) errs.push(`descrição "${r.description}" > 72`);
        if (!r.id || r.id.length > 200) errs.push("id de linha vazio ou > 200");
      }
      if (dup(rows.map((r) => r.id))) errs.push(`id de linha repetido: ${dup(rows.map((r) => r.id))}`);
      for (const s of sections) if ((s.title ?? "").length > 24) errs.push(`título de seção "${s.title}" > 24`);
      if (sections.length > 1 && sections.some((s) => !s.title)) errs.push("seção sem título");
    } else errs.push(`tipo interativo não suportado: ${i.type}`);
  } else if (graph.type === "text") {
    if (!graph.text?.body?.trim()) errs.push("texto vazio");
    if ((graph.text?.body ?? "").length > 4096) errs.push("texto > 4096");
  } else if (graph.type === "image") {
    if (!/^https?:\/\//.test(graph.image?.link ?? "")) errs.push("imagem sem link http(s)");
    if ((graph.image?.caption ?? "").length > 1024) errs.push("legenda > 1024");
  } else if (graph.type === "template") {
    const t = templates[graph.template?.name];
    if (!t) return [`(#132001) modelo "${graph.template?.name}" não existe ou não foi aprovado`];
    if (graph.template.language?.code !== "pt_BR") errs.push(`(#132001) idioma ${graph.template.language?.code} não existe para o modelo`);
    const expected = new Set(t.body.match(/\{\{\d+\}\}/g) ?? []).size;
    const params = ((graph.template.components ?? []).find((c) => c.type === "body")?.parameters ?? []).map((x) => x.text);
    if (params.length !== expected) errs.push(`(#132000) modelo espera ${expected} variáveis, vieram ${params.length}`);
    for (const x of params) {
      if (typeof x !== "string" || !x.trim()) errs.push("(#131008) variável de modelo vazia");
      else if (/[\n\t]| {5,}/.test(x)) errs.push("(#132018) variável com quebra de linha, tab ou mais de 4 espaços seguidos");
    }
    const filled = t.body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
    if (filled.length > 1024) errs.push("(#132005) texto do modelo preenchido > 1024");
    const btns = (graph.template.components ?? []).filter((c) => c.type === "button");
    for (const c of btns) {
      if (Number(c.index) >= t.buttons.length) errs.push(`(#132000) botão ${c.index} não existe no modelo`);
      if ((c.parameters?.[0]?.payload ?? "").length > 128) errs.push("payload do botão > 128");
    }
  } else errs.push(`tipo não suportado pelo simulador: ${graph.type}`);
  return errs;
}

function webhookPayload(waId, name, message, opts = {}) {
  // opts.fromWaId: o WhatsApp às vezes entrega celular do Brasil sem o 9º dígito
  // opts.omitFrom: usuário com "username" — a Meta manda só o user_id (BSUID), sem telefone
  const from = opts.fromWaId ?? waId;
  const contact = opts.omitFrom ? { profile: { name }, user_id: `BR.${waId}` } : { profile: { name }, wa_id: from };
  const msg = { ...(opts.omitFrom ? { from_user_id: `BR.${waId}` } : { from }), id: opts.wamid ?? `wamid.SIM${randomUUID().replace(/-/g, "")}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message };
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: cfg.displayPhone, phone_number_id: cfg.phoneNumberId },
              ...(opts.statuses ? { statuses: opts.statuses } : { contacts: [contact], messages: [msg] }),
            },
          },
        ],
      },
    ],
  };
}

async function postWebhook(payload, { badSignature = false, noSignature = false } = {}) {
  const raw = JSON.stringify(payload);
  const signature = "sha256=" + createHmac("sha256", badSignature ? "segredo-errado" : cfg.appSecret).update(raw).digest("hex");
  const res = await fetch(cfg.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", ...(noSignature ? {} : { "X-Hub-Signature-256": signature }) }, body: raw });
  return res;
}

async function toWebhook(waId, name, message, opts = {}) {
  if (!opts.statuses) {
    // a janela de 24h vale para o número como a Meta entregou (com ou sem o 9º dígito)
    lastInbound[opts.fromWaId ?? waId] = Date.now();
    if (opts.fromWaId) lastInbound[waId] = Date.now(); // o mesmo WhatsApp, nos dois formatos
    saveState();
  }
  const res = await postWebhook(webhookPayload(waId, name, message, opts), opts);
  if (!res.ok) throw new Error(`n8n respondeu ${res.status}: ${await res.text()}`);
}

async function userSends({ waId, name, text, replyId, title, kind, image, raw, file, opts }) {
  const c = chat(waId, name);
  let message;
  let shown;
  if (raw) {
    // mensagem crua, no formato da Meta (áudio, figurinha, localização, reação...)
    message = raw;
    if (file) {
      const id = `SIMMEDIA${randomUUID().replace(/-/g, "")}`;
      media.set(id, { mime: file.mime, data: Buffer.from(file.base64, "base64") });
      message = { ...raw, [raw.type]: { ...(raw[raw.type] ?? {}), id, mime_type: file.mime, sha256: "sim" } };
    }
    shown = { kind: raw.type, text: raw[raw.type]?.caption ?? `[${raw.type}]` };
  } else if (image) {
    const id = `SIMMEDIA${randomUUID().replace(/-/g, "")}`;
    const [meta, b64] = image.split(",");
    const mime = meta.match(/data:(.*?);base64/)?.[1] ?? "image/jpeg";
    media.set(id, { mime, data: Buffer.from(b64, "base64") });
    message = { type: "image", image: { id, mime_type: mime, sha256: "sim" } };
    shown = { kind: "image", link: `/media/${id}?view=1`, text: "" };
  } else if (replyId) {
    message =
      kind === "template"
        ? { type: "button", button: { payload: replyId, text: title } }
        : { type: "interactive", interactive: kind === "list" ? { type: "list_reply", list_reply: { id: replyId, title } } : { type: "button_reply", button_reply: { id: replyId, title } } };
    shown = { kind: "reply", text: title };
  } else {
    message = { type: "text", text: { body: text } };
    shown = { kind: "text", text };
  }
  push(waId, { from: "user", ...shown });
  await toWebhook(waId, c.name, message, opts ?? {});
}

// --------------------------------------------------------------------- HTTP
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
const authorized = (req) => req.headers.authorization === `Bearer ${cfg.accessToken}`;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    // ---- Graph API simulada
    let m = url.pathname.match(/^\/graph\/v[\d.]+\/(\d+)\/messages$/);
    if (m && req.method === "POST") {
      if (!authorized(req)) return json(res, 401, { error: { message: "Invalid OAuth access token", code: 190 } });
      if (m[1] !== cfg.phoneNumberId) return json(res, 400, { error: { message: "Unsupported phone number id", code: 100 } });
      const graph = JSON.parse(await readBody(req));
      const reject = (code, message) => {
        rejections.push({ at: new Date().toISOString(), to: graph.to, type: graph.type, code, message, body: graph });
        return json(res, 400, { error: { message, code, type: "OAuthException" } });
      };
      const errs = validate(graph);
      if (errs.length) return reject(131009, `(#131009) Parameter value is not valid: ${errs.join("; ")}`);
      // Fora da janela de 24h a Meta só entrega modelo aprovado
      if (graph.type !== "template" && !windowOpen(graph.to)) {
        return reject(131047, "(#131047) Re-engagement message: more than 24 hours have passed since the customer last replied to this number");
      }
      const wamid = `wamid.OUT${randomUUID().replace(/-/g, "")}`;
      push(graph.to, { from: "bot", wamid, ...render(graph), raw: graph });
      return json(res, 200, { messaging_product: "whatsapp", contacts: [{ input: graph.to, wa_id: graph.to }], messages: [{ id: wamid }] });
    }
    m = url.pathname.match(/^\/graph\/v[\d.]+\/(SIMMEDIA\w+)$/);
    if (m && req.method === "GET") {
      if (!authorized(req)) return json(res, 401, { error: { message: "Invalid OAuth access token", code: 190 } });
      const f = media.get(m[1]);
      if (!f) return json(res, 404, { error: { message: "media not found" } });
      return json(res, 200, { messaging_product: "whatsapp", url: `${cfg.publicBase}/media/${m[1]}`, mime_type: f.mime, sha256: "sim", file_size: f.data.length, id: m[1] });
    }
    m = url.pathname.match(/^\/media\/(SIMMEDIA\w+)$/);
    if (m && req.method === "GET") {
      if (!authorized(req) && url.searchParams.get("view") !== "1") return json(res, 401, {});
      const f = media.get(m[1]);
      if (!f) return json(res, 404, {});
      res.writeHead(200, { "Content-Type": f.mime });
      return res.end(f.data);
    }

    // ---- API do simulador (tela e testes)
    if (url.pathname === "/api/config") return json(res, 200, { businessName: cfg.businessName, displayPhone: cfg.displayPhone });
    if (url.pathname === "/api/chats") {
      return json(res, 200, [...chats.values()].map((c) => ({ waId: c.waId, name: c.name, count: c.messages.length, last: c.messages.at(-1) })));
    }
    if (url.pathname === "/api/messages") {
      const c = chats.get(url.searchParams.get("waId") ?? "");
      const since = Number(url.searchParams.get("since") ?? 0);
      return json(res, 200, (c?.messages ?? []).filter((x) => x.seq > since));
    }
    if (url.pathname === "/api/send" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      await userSends(body);
      return json(res, 200, { ok: true, seq });
    }
    if (url.pathname === "/api/rejections") {
      if (req.method === "DELETE") rejections.length = 0;
      return json(res, 200, rejections);
    }
    // Faz de conta que o cliente não escreve há N horas (para testar a janela de 24h)
    if (url.pathname === "/api/age" && req.method === "POST") {
      const { waId, hours } = JSON.parse(await readBody(req));
      lastInbound[waId] = Date.now() - hours * 3600_000;
      saveState();
      return json(res, 200, { ok: true, windowOpen: windowOpen(waId) });
    }
    // Webhook cru: assinatura errada, sem assinatura, status de entrega, payload qualquer
    if (url.pathname === "/api/webhook" && req.method === "POST") {
      const { waId, name, message, opts, payload } = JSON.parse(await readBody(req));
      const r = await postWebhook(payload ?? webhookPayload(waId, name ?? waId, message, opts ?? {}), opts ?? {});
      return json(res, 200, { status: r.status, body: (await r.text()).slice(0, 300) });
    }
    if (url.pathname === "/api/reset" && req.method === "POST") {
      chats.clear();
      media.clear();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": ok\n\n");
      sse.add(res);
      req.on("close", () => sse.delete(res));
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(readFileSync(join(here, "public", "index.html")));
    }
    json(res, 404, { error: "não encontrado" });
  } catch (error) {
    json(res, 500, { error: String(error?.message ?? error) });
  }
}).listen(cfg.port, () => console.log(`Simulador de WhatsApp em http://localhost:${cfg.port} (webhook -> ${cfg.webhookUrl})`));
