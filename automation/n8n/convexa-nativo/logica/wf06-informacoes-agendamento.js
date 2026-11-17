// WF06 — Informações de Agendamento: lista os próximos horários do cliente e trata a escolha de
// um deles (WAITING_APPOINTMENT_SELECTION). Finalidades: DETALHES (ver e agir), REMARCAR, ACAO.
const etapa = entrada.acao === "listar" ? "LISTAR" : conv.step;
const d = etapa === "LISTAR" ? {} : { ...(conv.data ?? {}) };
d.tentativas ??= 0;

function detalhes(a) {
  passo("consulta", "WAITING_APPOINTMENT_SELECTION", { finalidade: "ACAO", appt: a });
  const status = a.status === "CONFIRMED" ? "\n✅ Presença confirmada" : "";
  botoes(
    `📅 *Seu horário*\n\n✂️ ${a.service?.name ?? ""}\n🗓️ ${fmtData(a.date)} às *${a.time}*${a.employee?.name ? `\n👤 ${a.employee.name}` : ""}${a.priceCents != null ? `\n💰 ${reais(a.priceCents)}` : ""}${status}`,
    [["ag:remarcar", "Remarcar"], ["ag:cancelar", "Cancelar"], ["menu:inicio", "Menu"]],
  );
}

if (etapa === "LISTAR") {
  const r = api("lista", "GET", "/internal/conversation/appointments");
  if (!ok(r)) return instavel(r, "listar seus agendamentos");
  const ags = r.body ?? [];
  if (!ags.length) {
    ocioso();
    return botoes("Você não tem nenhum horário marcado no momento 🙂 Quer agendar?", [["menu:agendar", "Agendar horário"], ["menu:inicio", "Ver o menu"]]);
  }
  if (ags.length === 1) return detalhes(ags[0]);
  responder(`📅 *Seus próximos horários*\n\n${ags.slice(0, 10).map((a, i) => `${i + 1}. ${resumoAgendamento(a)}`).join("\n")}`);
  passo("consulta", "WAITING_APPOINTMENT_SELECTION", { finalidade: "DETALHES", appts: ags });
  return listarAgendamentos("Quer remarcar ou cancelar algum? Escolha na lista:", ags, "Escolher horário");
}

// WAITING_APPOINTMENT_SELECTION
if (d.finalidade === "ACAO") {
  if (RID === "ag:remarcar" || /\b(remarc|reagend|mudar|trocar)/.test(nt)) return aplicar(chamarWf("wf", "WF04", { acao: "selecionado", appt: d.appt }));
  if (RID === "ag:cancelar" || /\b(cancel|desmarc)/.test(nt)) return aplicar(chamarWf("wf", "WF05", { acao: "selecionado", appt: d.appt }));
  ocioso();
  return aplicar(chamarWf("wf01", "WF01", {}));
}
const a = acharAgendamento(d.appts ?? []);
if (!a) {
  if (RID.startsWith("menu:") || (!RID && numeroEscolhido(99) === null && nt.split(" ").length > 2)) {
    ocioso();
    return aplicar(chamarWf("wf01", "WF01", {}));
  }
  d.tentativas += 1;
  if (d.tentativas >= 3) {
    ocioso();
    return menu("Não consegui identificar o horário 😕 Como posso ajudar?");
  }
  passo("consulta", "WAITING_APPOINTMENT_SELECTION", d);
  return listarAgendamentos("Não identifiquei qual horário 🤔 Escolha na lista:", d.appts ?? []);
}
if (d.finalidade === "REMARCAR") return aplicar(chamarWf("wf", "WF04", { acao: "selecionado", appt: a }));
return detalhes(a);
