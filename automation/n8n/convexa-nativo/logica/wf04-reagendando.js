// WF04 — Reagendando Agendamento: escolhe o agendamento → novo dia → novo horário → confirmação
// → POST /appointments/{id}/reschedule. Passos: WAITING_RESCHEDULE_DATE, _TIME, _CONFIRMATION.
// A escolha entre vários agendamentos fica no WF06 (WAITING_APPOINTMENT_SELECTION, finalidade REMARCAR).
const FLOW = "remarcar";
const etapa = entrada.acao === "iniciar" ? "INICIO" : entrada.acao === "selecionado" ? "SELECIONADO" : conv.step;
const d = etapa === "INICIO" || etapa === "SELECIONADO" ? {} : { ...(conv.data ?? {}) };
d.tentativas ??= 0;

function pedirDia(intro) {
  passo(FLOW, "WAITING_RESCHEDULE_DATE", d);
  perguntarDia(`${intro ?? `Vamos remarcar ${resumoAgendamento(d.appt)}.`}\n\nPara qual dia você quer mudar? 📅`);
}
function irParaHorarios(chave = "disp") {
  const r = buscarEMostrar(chave, d, d.appt.service.id, "Horários livres para");
  if (r === "escolhido") return confirmar();
  passo(FLOW, r ? "WAITING_RESCHEDULE_TIME" : "WAITING_RESCHEDULE_DATE", d);
}
function confirmar() {
  passo(FLOW, "WAITING_RESCHEDULE_CONFIRMATION", d);
  const prof = profissionalEscolhido(d);
  botoes(
    `Confere a remarcação? 👇\n\nDe: ${fmtData(d.appt.date)} às ${d.appt.time}\nPara: *${fmtData(d.date)} às ${horaEscolhida(d)}*\n✂️ ${d.appt.service.name}${prof ? `\n👤 ${prof}` : ""}`,
    [["rem:sim", "Confirmar"], ["rem:trocar", "Outro horário"], ["rem:nao", "Manter o atual"]],
  );
}
function naoEntendi(pergunta) {
  d.tentativas += 1;
  if (d.tentativas >= 3) {
    ocioso();
    return botoes("Acho que não estou conseguindo te ajudar por aqui 😕 Quer falar com uma pessoa da equipe?", [["menu:atendente", "Falar com atendente"], ["menu:inicio", "Ver o menu"]]);
  }
  pergunta();
}

switch (etapa) {
  case "INICIO": {
    const r = api("lista", "GET", "/internal/conversation/appointments");
    if (!ok(r)) return instavel(r, "listar seus agendamentos");
    const ags = r.body ?? [];
    if (!ags.length) {
      ocioso();
      return botoes("Você não tem nenhum horário marcado no momento 🙂 Quer agendar um?", [["menu:agendar", "Agendar horário"], ["menu:inicio", "Ver o menu"]]);
    }
    if (ags.length === 1) {
      d.appt = ags[0];
      return pedirDia();
    }
    passo("consulta", "WAITING_APPOINTMENT_SELECTION", { finalidade: "REMARCAR", appts: ags });
    return listarAgendamentos("Qual horário você quer remarcar?", ags);
  }
  case "SELECIONADO":
    d.appt = entrada.appt;
    return pedirDia();
  case "WAITING_RESCHEDULE_DATE": {
    const dia = diaDaResposta();
    if (dia === "outro") {
      passo(FLOW, "WAITING_RESCHEDULE_DATE", d);
      return responder("Pode escrever o dia 🙂 Por exemplo: *sexta*, *20/11* ou *dia 25*.");
    }
    if (!dia) return naoEntendi(() => pedirDia("Não entendi o dia 🤔"));
    const erro = validarDia(dia);
    if (erro) return pedirDia(erro);
    d.date = dia;
    d.hora = lerHora(T);
    d.tentativas = 0;
    return irParaHorarios();
  }
  case "WAITING_RESCHEDULE_TIME": {
    const outroDia = RID ? null : lerData(T);
    if (outroDia && outroDia !== d.date && !validarDia(outroDia)) {
      d.date = outroDia;
      d.hora = lerHora(T);
      return irParaHorarios();
    }
    const e = horarioDaResposta(d);
    if (!e) return naoEntendi(() => (passo(FLOW, "WAITING_RESCHEDULE_TIME", d), mostrarHorarios(`Escolha um horário da lista para ${fmtData(d.date)}:`, d.slots ?? [], d.total ?? 0)));
    if (e.indisponivel) {
      passo(FLOW, "WAITING_RESCHEDULE_TIME", d);
      return mostrarHorarios(`O horário das *${e.indisponivel}* não está livre em ${fmtData(d.date)} 😕 Estes estão:`, d.slots ?? [], d.total ?? 0);
    }
    d.escolha = e;
    d.tentativas = 0;
    return confirmar();
  }
  case "WAITING_RESCHEDULE_CONFIRMATION": {
    if (RID === "rem:trocar" || /\b(trocar|outro horario|mudar)\b/.test(nt)) {
      d.escolha = null;
      passo(FLOW, "WAITING_RESCHEDULE_TIME", d);
      return mostrarHorarios(`Sem problema! Horários livres para ${fmtData(d.date)}:`, d.slots ?? [], d.total ?? 0);
    }
    if (RID === "rem:nao" || ehNao()) {
      ocioso();
      return responder(`Combinado, mantive ${resumoAgendamento(d.appt)} 👍`);
    }
    if (RID !== "rem:sim" && !ehSim()) return naoEntendi(confirmar);
    let ultimo = null;
    const candidatos = candidatosDe(d);
    for (let i = 0; i < candidatos.length; i++) {
      const c = candidatos[i];
      const r = api("rem" + i, "POST", `/internal/conversation/appointments/${d.appt.id}/reschedule`, { body: { startAt: c.startAt, employeeId: c.employeeId } });
      ultimo = r;
      if (ok(r)) {
        ocioso();
        ctx.events.push({ tipo: "remarcado", appointment: r.body, anterior: d.appt.id });
        return responder(`✅ *Remarcado!*\n\n${resumoAgendamento(r.body)}\n\nTe mando um lembrete antes do horário 😉`);
      }
      if (r.status !== 409) break;
    }
    if (ultimo?.status === 404) {
      ocioso();
      return botoes("Não encontrei mais esse agendamento (ele pode ter sido cancelado) 🤔 Quer marcar um novo?", [["menu:agendar", "Agendar horário"], ["menu:inicio", "Ver o menu"]]);
    }
    if (ultimo && (ultimo.status === 409 || ultimo.status === 400)) {
      responder(`Poxa, ${msgApi(ultimo) ? msgApi(ultimo).toLowerCase() : "esse horário não está mais disponível"} 😕 Vou buscar outros horários.`);
      d.hora = null;
      return irParaHorarios("disp_conflito");
    }
    passo(FLOW, "WAITING_RESCHEDULE_CONFIRMATION", d);
    return instavel(ultimo, "remarcar o agendamento");
  }
  default:
    ocioso();
    aplicar(chamarWf("wf01", "WF01", {}));
}
