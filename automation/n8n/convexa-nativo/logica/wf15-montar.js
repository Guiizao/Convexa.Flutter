// Transforma as respostas do bot em mensagens da Graph API, respeitando os limites da Meta:
// botões: até 3, título até 20 caracteres e sem repetir; lista: até 10 linhas, título até 24,
// descrição até 72, botão até 20; corpo de interativa até 1024; texto até 4096;
// variáveis de modelo sem quebra de linha e nunca vazias.
const inp = $("When Executed by Another Workflow").first().json;
const cred = $("Buscar credenciais da Meta").first().json ?? {};
const cfg = inp.cfg;
const base = { cfg, phoneNumberId: inp.phoneNumberId, origem: inp.origem ?? "", };
const replies = (inp.replies ?? []).filter((r) => r && (r.text || r.kind === "template"));
if (!replies.length) return [];

const corta = (s, n) => {
  s = String(s ?? "").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
};
const unicos = (titulos) => {
  const vistos = new Map();
  return titulos.map((t) => {
    let x = t, i = 2;
    while (vistos.has(x)) x = corta(t, 17) + " " + i++;
    vistos.set(x, true);
    return x;
  });
};
const resumo = (r) => corta(String(r.text ?? r.name ?? "").replace(/\s+/g, " "), 120);
const linhaSem = (r, status, erro) => ({ json: { linha: { em: new Date().toISOString(), phoneNumberId: inp.phoneNumberId, para: String(r.to || inp.waId), tipo: r.kind, status, metaId: "", erro, resumo: resumo(r), origem: base.origem }, ...(status === "SEM_INTEGRACAO" ? { alerta: { tipo: "INTEGRACAO_META_AUSENTE", mensagem: "Não há token da Meta cadastrado no painel para este número: o bot não consegue responder.", detalhe: { phoneNumberId: inp.phoneNumberId }, chave: "INTEGRACAO:" + inp.phoneNumberId + ":" + new Date().toISOString().slice(0, 13), origem: "WF15" } } : {}) } });

// Teste sem envio real: só registra
if (inp.simular) return replies.map((r) => linhaSem(r, "SIMULADO", ""));
const st = Number(cred.statusCode ?? 0);
if (st === 404 || (st >= 200 && st < 300 && !cred.body?.metaAccessToken)) return replies.map((r) => linhaSem(r, "SEM_INTEGRACAO", "integração da Meta não encontrada"));
if (!(st >= 200 && st < 300)) return replies.map((r) => linhaSem(r, "API_INDISPONIVEL", `HTTP ${st}`));

function graph(r, to) {
  const msg = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (r.kind === "template") {
    const components = [];
    const params = (r.params ?? []).map((p) => ({ type: "text", text: corta(String(p ?? "").replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   "), 1000) || "-" }));
    if (params.length) components.push({ type: "body", parameters: params });
    (r.buttons ?? []).forEach((payload, i) => components.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload: String(payload).slice(0, 256) }] }));
    return [{ ...msg, type: "template", template: { name: r.name, language: { code: r.language || "pt_BR" }, ...(components.length ? { components } : {}) } }];
  }
  const texto = String(r.text ?? "").trim();
  if (r.kind === "buttons" && (r.buttons?.length ?? 0) > 3) r = { ...r, kind: "list", button: "Ver opções", sections: [{ title: "Opções", rows: r.buttons }] };
  const antes = [];
  let corpo = texto;
  if ((r.kind === "buttons" || r.kind === "list") && corpo.length > 1024) {
    antes.push({ ...msg, type: "text", text: { body: corta(corpo, 4096), preview_url: false } });
    corpo = "Escolha uma opção:";
  }
  if (r.kind === "buttons" && r.buttons?.length) {
    const titulos = unicos(r.buttons.map((b) => corta(b.title, 20)));
    return [...antes, { ...msg, type: "interactive", interactive: { type: "button", body: { text: corpo }, action: { buttons: r.buttons.slice(0, 3).map((b, i) => ({ type: "reply", reply: { id: String(b.id).slice(0, 256), title: titulos[i] } })) } } }];
  }
  if (r.kind === "list") {
    let resta = 10;
    const sections = (r.sections ?? [])
      .map((s) => {
        const rows = (s.rows ?? []).slice(0, resta);
        resta -= rows.length;
        const titulos = unicos(rows.map((x) => corta(x.title, 24)));
        return { title: corta(s.title || "Opções", 24), rows: rows.map((x, i) => ({ id: String(x.id).slice(0, 200), title: titulos[i], ...(x.description ? { description: corta(x.description, 72) } : {}) })) };
      })
      .filter((s) => s.rows.length);
    if (sections.length) return [...antes, { ...msg, type: "interactive", interactive: { type: "list", body: { text: corpo }, ...(r.footer ? { footer: { text: corta(r.footer, 60) } } : {}), action: { button: corta(r.button || "Ver opções", 20), sections } } }];
  }
  return [{ ...msg, type: "text", text: { body: corta(texto, 4096), preview_url: /https?:\/\//.test(texto) } }];
}

const out = [];
for (const r of replies) {
  const to = String(r.to || inp.waId).replace(/\D/g, "");
  for (const g of graph(r, to)) out.push({ json: { ...base, to, tipo: g.type === "interactive" ? g.interactive.type : g.type, resumo: resumo(r), interno: !!r.interno, graph: g } });
}
return out;
