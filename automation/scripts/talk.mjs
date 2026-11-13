// Conversa com o bot direto pelo serviço, mandando webhooks no formato da Meta.
// Uso:
//   node talk.mjs <telefone> "texto"
//   node talk.mjs <telefone> --reply <id> "<título>"
//   node talk.mjs <telefone> --image <arquivo>
// Env: AUTOMACAO_URL, AUTOMACAO_KEY, APP_SECRET, PHONE_NUMBER_ID, NAME
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const URL_ = process.env.AUTOMACAO_URL ?? "http://localhost:3100";
const KEY = process.env.AUTOMACAO_KEY;
const SECRET = process.env.APP_SECRET ?? "simulador-app-secret";
const PNID = process.env.PHONE_NUMBER_ID ?? "100000000000001";

export async function send(waId, message, { name = process.env.NAME ?? "Cliente Teste", media } = {}) {
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
              metadata: { display_phone_number: "551433330000", phone_number_id: PNID },
              contacts: [{ profile: { name }, wa_id: waId }],
              messages: [{ from: waId, id: `wamid.${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
            },
          },
        ],
      },
    ],
  };
  const rawBody = JSON.stringify(payload);
  const signature = "sha256=" + createHmac("sha256", SECRET).update(rawBody).digest("hex");
  const res = await fetch(`${URL_}/v1/whatsapp/inbound`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-automacao-key": KEY },
    body: JSON.stringify({ payload, rawBody, signature, media }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data.batches.flatMap((b) => b.messages);
}

export const text = (body) => ({ type: "text", text: { body } });
export const reply = (id, title) => ({
  type: "interactive",
  interactive: id.length && title !== undefined && title.startsWith("#list")
    ? { type: "list_reply", list_reply: { id, title: title.slice(5) } }
    : { type: "button_reply", button_reply: { id, title: title ?? id } },
});

export function show(messages) {
  for (const m of messages) {
    const g = m.graph;
    const head = `  → para ${m.to}${m.session ? "" : " [TEMPLATE]"}`;
    if (g.type === "interactive") {
      const i = g.interactive;
      console.log(`${head}\n    ${i.body.text.replace(/\n/g, "\n    ")}`);
      if (i.type === "button") console.log("    " + i.action.buttons.map((b) => `[${b.reply.title} ⟨${b.reply.id}⟩]`).join(" "));
      else for (const s of i.action.sections) for (const r of s.rows) console.log(`    • ${r.title}${r.description ? ` — ${r.description}` : ""} ⟨${r.id}⟩`);
    } else if (g.type === "text") console.log(`${head}\n    ${g.text.body.replace(/\n/g, "\n    ")}`);
    else if (g.type === "image") console.log(`${head}\n    [imagem] ${g.image.caption ?? ""} (${g.image.link.slice(0, 60)}…)`);
    else console.log(`${head}\n    ${m.preview}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [waId, ...rest] = process.argv.slice(2);
  let msg;
  let media;
  if (rest[0] === "--reply") msg = reply(rest[1], rest[2]);
  else if (rest[0] === "--image") {
    const id = `media-${randomUUID()}`;
    msg = { type: "image", image: { id, mime_type: "image/png" } };
    media = { [id]: { mimeType: "image/png", base64: readFileSync(rest[1]).toString("base64") } };
  } else msg = text(rest.join(" "));
  show(await send(waId, msg, { media }));
}
