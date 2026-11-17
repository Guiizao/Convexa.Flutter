// WF05 — Cancelando Agendamento: escolhe → confirma → POST /appointments/{id}/cancel.
// Passos: WAITING_CANCEL_SELECTION, WAITING_CANCEL_CONFIRMATION.
const FLOW = "cancelar";
const etapa = entrada.acao === "iniciar" ? "INICIO" : entrada.acao === "selecionado" ? "SELECIONADO" : conv.step;
const d = etapa === "INICIO" || etapa === "SELECIONADO" ? {} : { ...(conv.data ?? {}) };
d.tentativas ??= 0;

function perguntarConfirmacao() {
  passo(FLOW, "WAITING_CANCEL_CONFIRMATION", d);
  botoes(`Confirma o cancelamento de ${resumoAgendamento(d.appt)}?`, [["can:sim", "Sim, cancelar"], ["can:nao", "Não, manter"]]);
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
      return botoes("Você não tem nenhum horário marcado para cancelar 🙂", [["menu:agendar", "Agendar horário"], ["menu:inicio", "Ver o menu"]]);
    }
    if (ags.length === 1) {
      d.appt = ags[0];
      return perguntarConfirmacao();
    }
    d.appts = ags;
    passo(FLOW, "WAITING_CANCEL_SELECTION", d);
    return listarAgendamentos("Qual horário você quer cancelar?", ags);
  }
  case "SELECIONADO":
    d.appt = entrada.appt;
    return perguntarConfirmacao();
  case "WAITING_CANCEL_SELECTION": {
    const a = acharAgendamento(d.appts ?? []);
    if (!a) return naoEntendi(() => (passo(FLOW, "WAITING_CANCEL_SELECTION", d), listarAgendamentos("Não identifiquei qual 🤔 Escolha na lista:", d.appts ?? [])));
    d.appt = a;
    delete d.appts;
    d.tentativas = 0;
    return perguntarConfirmacao();
  }
  case "WAITING_CANCEL_CONFIRMATION": {
    if (RID === "can:nao" || (RID !== "can:sim" && ehNao())) {
      ocioso();
      return responder(`Combinado, mantive ${resumoAgendamento(d.appt)} 👍`);
    }
    if (RID !== "can:sim" && !ehSim()) return naoEntendi(perguntarConfirmacao);
    const r = api("cancelar", "POST", `/internal/conversation/appointments/${d.appt.id}/cancel`);
    if (ok(r) || r.status === 404 || r.status === 409) {
      ocioso();
      ctx.events.push({ tipo: "cancelado", appointmentId: d.appt.id });
      return botoes(
        r.status === 404 ? "Esse horário já não estava mais na agenda 👍 Quer marcar outro?" : `Cancelado ✅ ${resumoAgendamento(d.appt)} foi desmarcado.\n\nQuer marcar outro horário?`,
        [["menu:agendar", "Agendar outro"], ["menu:inicio", "Não, obrigado"]],
      );
    }
    passo(FLOW, "WAITING_CANCEL_CONFIRMATION", d);
    return instavel(r, "cancelar o agendamento");
  }
  default:
    ocioso();
    aplicar(chamarWf("wf01", "WF01", {}));
}
