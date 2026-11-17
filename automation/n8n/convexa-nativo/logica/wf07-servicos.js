// WF07 — Informações dos Serviços: GET /internal/conversation/services.
// acao "dados": só devolve a lista em ctx.result (usado pelo WF02).
// acao "responder": manda a tabela de serviços e preços ao cliente.
const r = api("servicos", "GET", "/internal/conversation/services");
if (!ok(r)) {
  ctx.result = { erro: r.erro ?? msgApi(r) ?? "falha ao listar serviços", status: r.status };
  if (entrada.acao === "responder") instavel(r, "listar os serviços");
  return;
}
const servicos = Array.isArray(r.body) ? r.body : [];
ctx.result = { services: servicos };
if (entrada.acao !== "responder") return;

ocioso();
if (!servicos.length) {
  return botoes(`A *${nomeEmpresa()}* ainda não cadastrou os serviços por aqui 😕`, [["menu:atendente", "Falar com atendente"], ["menu:inicio", "Menu"]]);
}
const linhas = servicos.map((s) => `• *${s.name}*${s.priceCents != null ? ` — ${reais(s.priceCents)}` : ""}${s.durationMinutes ? ` (${duracao(s.durationMinutes)})` : ""}`);
// mensagens de texto têm limite de 4096 caracteres: divide se a tabela for grande
let bloco = `📋 *Serviços da ${nomeEmpresa()}*\n`;
for (const l of linhas) {
  if ((bloco + "\n" + l).length > 3500) {
    responder(bloco);
    bloco = "";
  }
  bloco += "\n" + l;
}
responder(bloco.trim());
botoes("Quer agendar algum deles?", [["menu:agendar", "Agendar horário"], ["menu:inicio", "Ver o menu"]]);
