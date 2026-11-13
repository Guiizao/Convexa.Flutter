// Simulador de WhatsApp para testar o Convexa sem número real.
//  - Faz o papel da Graph API da Meta: recebe o que o n8n envia (/graph/...)
//  - Faz o papel do celular: manda webhooks assinados para o n8n
//  - Tela de chat em http://localhost:3200 e API para testes automáticos
// Sem dependências: só Node 20+.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
  if (graph.type === "interactive") {
    const i = graph.interactive;
    if ((i.body?.text ?? "").length > 1024) errs.push("body > 1024");
    if (i.type === "button") {
      if (i.action.buttons.length > 3) errs.push("mais de 3 botões");
      for (const b of i.action.buttons) if (b.reply.title.length > 20) errs.push(`botão "${b.reply.title}" > 20`);
    }
    if (i.type === "list") {
      if (i.action.button.length > 20) errs.push("texto do botão da lista > 20");
      const rows = i.action.sections.flatMap((s) => s.rows);
      if (rows.length > 10) errs.push("lista com mais de 10 linhas");
      for (const r of rows) {
        if (r.title.length > 24) errs.push(`linha "${r.title}" > 24`);
        if ((r.description ?? "").length > 72) errs.push(`descrição > 72`);
      }
      if (i.action.sections.length > 1 && i.action.sections.some((s) => !s.title)) errs.push("seção sem título");
    }
  }
  if (graph.type === "text" && graph.text.body.length > 4096) errs.push("texto > 4096");
  return errs;
}

async function toWebhook(waId, name, message) {
  const payload = {
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
              contacts: [{ profile: { name }, wa_id: waId }],
              messages: [{ from: waId, id: `wamid.SIM${randomUUID().replace(/-/g, "")}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
            },
          },
        ],
      },
    ],
  };
  const raw = JSON.stringify(payload);
  const signature = "sha256=" + createHmac("sha256", cfg.appSecret).update(raw).digest("hex");
  const res = await fetch(cfg.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature }, body: raw });
  if (!res.ok) throw new Error(`n8n respondeu ${res.status}: ${await res.text()}`);
}

async function userSends({ waId, name, text, replyId, title, kind, image }) {
  const c = chat(waId, name);
  let message;
  let shown;
  if (image) {
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
  await toWebhook(waId, c.name, message);
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
      const errs = validate(graph);
      if (errs.length) return json(res, 400, { error: { message: `(#131009) Parameter value is not valid: ${errs.join("; ")}`, code: 131009 } });
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
