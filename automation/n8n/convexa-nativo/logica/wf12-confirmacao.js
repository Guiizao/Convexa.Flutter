// WF12 — Confirmação de Agendamento: resposta ao lembrete (WF11), passo
// WAITING_APPOINTMENT_CONFIRMATION_REPLY. Botões do lembrete: lem:sim, lem:remarcar, lem:cancelar
// (os mesmos ids vêm no payload dos botões do modelo "convexa_lembrete").
const d = conv.data ?? {};
let a = d.appt ?? null;
// botão de lembrete antigo (lem:sim:<id>): procura o agendamento pelo id
const idDoBotao = RID.startsWith("lem:") ? RID.split(":")[2] : null;
if ((!a || (idDoBotao && a.id !== idDoBotao)) && (idDoBotao || d.appointmentId)) {
  const r = api("lista", "GET", "/internal/conversation/appointments");
  if (ok(r)) a = (r.body ?? []).find((x) => x.id === (idDoBotao || d.appointmentId)) ?? null;
  if (!a) {
    ocioso();
    return botoes("Não encontrei mais esse agendamento (ele pode ter sido remarcado ou cancelado) 🤔 Quer ver seus horários?", [["menu:meus", "Meus agendamentos"], ["menu:agendar", "Agendar horário"]]);
  }
}
const resposta = RID.startsWith("lem:") ? RID.split(":")[1] : RID === "Confirmo" ? "sim" : RID === "Remarcar" ? "remarcar" : RID === "Cancelar" ? "cancelar" : null;

if (!a) {
  ocioso();
  aplicar(chamarWf("wf01", "WF01", {}));
} else if (resposta === "sim" || (!resposta && (ehSim() || /\b(confirm|estarei|vou sim|vou estar|presenca)/.test(nt)))) {
  ocioso();
  ctx.events.push({ tipo: "confirmado", appointmentId: a.id });
  responder(`Presença confirmada ✅ Te esperamos ${fmtData(a.date)} às *${a.time}*${nomeCliente() ? ", " + nomeCliente() : ""}!`);
} else if (resposta === "remarcar" || /\b(remarc|reagend|mudar|trocar|outro (dia|horario))/.test(nt)) {
  aplicar(chamarWf("wf", "WF04", { acao: "selecionado", appt: a }));
} else if (resposta === "cancelar" || /\b(cancel|desmarc|nao vou|nao poderei)/.test(nt)) {
  aplicar(chamarWf("wf", "WF05", { acao: "selecionado", appt: a }));
} else {
  ocioso();
  aplicar(chamarWf("wf01", "WF01", {}));
}
