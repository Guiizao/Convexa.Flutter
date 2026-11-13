import { clip } from "../lib/text.js";

/**
 * Corpo final da Graph API (POST /{phone-number-id}/messages), sem o "to".
 * O n8n só acrescenta o destinatário e envia.
 */
export type GraphBody = Record<string, unknown> & { type: string };

export type Out = {
  to: string; // E.164
  body: GraphBody;
  /** Texto legível para log, painel e simulador */
  preview: string;
  /** true = só pode sair dentro da janela de 24h (mensagem livre) */
  session: boolean;
};

export type Button = { id: string; title: string };
export type Row = { id: string; title: string; description?: string };
export type Section = { title?: string; rows: Row[] };

// Limites da Meta
const L = { body: 1024, text: 4096, button: 20, rowTitle: 24, rowDesc: 72, sectionTitle: 24, header: 60, footer: 60, id: 200 };

export function text(to: string, body: string): Out {
  return { to, session: true, preview: body, body: { type: "text", text: { body: clip(body, L.text), preview_url: false } } };
}

export function buttons(to: string, body: string, btns: Button[], opts: { header?: string; footer?: string } = {}): Out {
  const list = btns.slice(0, 3);
  if (list.length === 0) return text(to, body);
  return {
    to,
    session: true,
    preview: `${body}\n${list.map((b) => `[${b.title}]`).join(" ")}`,
    body: {
      type: "interactive",
      interactive: {
        type: "button",
        ...(opts.header ? { header: { type: "text", text: clip(opts.header, L.header) } } : {}),
        body: { text: clip(body, L.body) },
        ...(opts.footer ? { footer: { text: clip(opts.footer, L.footer) } } : {}),
        action: {
          buttons: list.map((b) => ({ type: "reply", reply: { id: b.id.slice(0, L.id), title: clip(b.title, L.button) } })),
        },
      },
    },
  };
}

export function list(
  to: string,
  body: string,
  buttonText: string,
  sections: Section[],
  opts: { header?: string; footer?: string } = {},
): Out {
  // A Meta aceita no máximo 10 linhas somando todas as seções
  let budget = 10;
  const trimmed = sections
    .map((s) => {
      const rows = s.rows.slice(0, budget);
      budget -= rows.length;
      return { ...s, rows };
    })
    .filter((s) => s.rows.length > 0);
  if (trimmed.length === 0) return text(to, body);
  const multi = trimmed.length > 1;
  return {
    to,
    session: true,
    preview: `${body}\n${trimmed
      .map((s) => `${s.title ? `— ${s.title}\n` : ""}${s.rows.map((r) => `• ${r.title}${r.description ? ` (${r.description})` : ""}`).join("\n")}`)
      .join("\n")}`,
    body: {
      type: "interactive",
      interactive: {
        type: "list",
        ...(opts.header ? { header: { type: "text", text: clip(opts.header, L.header) } } : {}),
        body: { text: clip(body, L.body) },
        ...(opts.footer ? { footer: { text: clip(opts.footer, L.footer) } } : {}),
        action: {
          button: clip(buttonText, L.button),
          sections: trimmed.map((s) => ({
            // com mais de uma seção o título é obrigatório
            ...(s.title || multi ? { title: clip(s.title ?? "Opções", L.sectionTitle) } : {}),
            rows: s.rows.map((r) => ({
              id: r.id.slice(0, L.id),
              title: clip(r.title, L.rowTitle),
              ...(r.description ? { description: clip(r.description, L.rowDesc) } : {}),
            })),
          })),
        },
      },
    },
  };
}

export function image(to: string, link: string, caption?: string): Out {
  return {
    to,
    session: true,
    preview: `[imagem] ${caption ?? ""}`.trim(),
    body: { type: "image", image: { link, ...(caption ? { caption: clip(caption, L.body) } : {}) } },
  };
}

/** Template aprovado: único jeito de falar com quem não escreveu nas últimas 24h. */
export function template(
  to: string,
  name: string,
  params: string[],
  quickReplies: string[] = [],
  previewText?: string,
): Out {
  const components: unknown[] = [];
  if (params.length) {
    components.push({ type: "body", parameters: params.map((p) => ({ type: "text", text: clip(p.replace(/\s*\n\s*/g, " "), 300) })) });
  }
  quickReplies.forEach((payload, index) =>
    components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] }),
  );
  return {
    to,
    session: false,
    preview: previewText ?? `[template ${name}] ${params.join(" | ")}`,
    body: { type: "template", template: { name, language: { code: "pt_BR" }, components } },
  };
}

/** Envia sessão se a janela de 24h estiver aberta; senão usa o template. */
export function sessionOrTemplate(windowOpen: boolean, session: Out, fallback: Out): Out {
  return windowOpen ? session : fallback;
}
