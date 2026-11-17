// Depois do atendimento: agradece e oferece o próximo horário.
// Só com a janela de 24 h aberta (mensagem comum) ou com um modelo aprovado em cfg.tplPos
// (2 variáveis: nome e serviço; 1 botão de resposta rápida "Agendar de novo").
const cfg = $("Config").first().json.cfg;
const convs = new Map($("Conversas").all().map((i) => [i.json.chave, i.json]));
const ags = $input.all().map((i) => i.json).filter((r) => r.appointmentId);
const agora = Date.now();
const H = 3600e3;
const out = [];
const limpa = (s) => String(s ?? "").replace(/[\n\t]+/g, " ").trim() || "-";
for (const a of ags) {
  const fim = Date.parse(a.endAt);
  if (a.status !== "ATIVO" || a.posEnviado || !(fim < agora - 30 * 60e3 && fim > agora - 24 * H)) continue;
  const c = convs.get(a.chave) ?? {};
  const janelaAberta = Date.parse(c.lastInboundAt || 0) > agora - 23.5 * H;
  const primeiro = String(a.nome || "").split(" ")[0];
  let reply = null;
  if (janelaAberta)
    reply = { kind: "buttons", text: `Obrigado pela visita${primeiro ? ", " + primeiro : ""}! 😊 Esperamos que tenha gostado do *${a.servico}*.\n\nQuer deixar o próximo horário agendado?`, buttons: [{ id: "menu:agendar", title: "Agendar próximo" }, { id: "menu:inicio", title: "Agora não" }] };
  else if (cfg.tplPos) reply = { kind: "template", name: cfg.tplPos, language: cfg.tplLang, params: [primeiro || "cliente", a.servico].map(limpa), buttons: ["menu:agendar"] };
  out.push({ json: { tipo: "agendamento", linha: { appointmentId: a.appointmentId, status: "CONCLUIDO", posEnviado: reply ? new Date().toISOString() : "sem_janela_e_sem_modelo" } } });
  if (reply) out.push({ json: { tipo: "envio", acao: "enviar", cfg, origem: "pos-atendimento", phoneNumberId: a.phoneNumberId, waId: a.waId, replies: [reply] } });
}
return out;
