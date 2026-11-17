// WF02 — Criando Agendamento: serviço → dia → horário → confirmação → POST /appointments.
// Passos: WAITING_SERVICE, WAITING_DATE, WAITING_TIME, WAITING_APPOINTMENT_CONFIRMATION.
const FLOW = "agendar";
const etapa = entrada.acao === "iniciar" ? "INICIO" : conv.step;
const d = etapa === "INICIO" ? {} : { ...(conv.data ?? {}) };
d.tentativas ??= 0;

const servicosResp = chamarWf("svc", "WF07", { acao: "dados" });
const sres = servicosResp.ctx?.result ?? {};
if (sres.erro) return instavel({ status: sres.status, erro: sres.erro }, "listar os serviços");
const servicos = sres.services ?? [];
if (!servicos.length) {
  ocioso();
  return botoes(`A *${nomeEmpresa()}* ainda não tem serviços disponíveis para agendar por aqui 😕`, [["menu:atendente", "Falar com atendente"], ["menu:inicio", "Menu"]]);
}

function perguntarServico(texto) {
  passo(FLOW, "WAITING_SERVICE", d);
  if (servicos.length <= 3)
    return botoes(texto, servicos.map((s) => ["svc:" + s.id, s.name]));
  lista(
    texto,
    "Ver serviços",
    servicos.slice(0, 10).map((s) => ({ id: "svc:" + s.id, title: s.name, description: [reais(s.priceCents), duracao(s.durationMinutes)].filter(Boolean).join(" · ") })),
    { secao: "Serviços" },
  );
  if (servicos.length > 10) responder("Não achou na lista? Escreva o nome do serviço 🙂");
}
function irParaDia() {
  if (d.date) return irParaHorarios();
  passo(FLOW, "WAITING_DATE", d);
  perguntarDia(`Ótimo, *${d.service.name}*! Para qual dia? 📅`);
}
function irParaHorarios(chave = "disp") {
  const r = buscarEMostrar(chave, d, d.service.id, "Horários livres para");
  if (r === "escolhido") return confirmar();
  passo(FLOW, r ? "WAITING_TIME" : "WAITING_DATE", d);
}
function confirmar() {
  passo(FLOW, "WAITING_APPOINTMENT_CONFIRMATION", d);
  const prof = profissionalEscolhido(d);
  botoes(
    `Confere os dados? 👇\n\n✂️ *${d.service.name}*\n📅 ${fmtData(d.date)} às *${horaEscolhida(d)}*${prof ? `\n👤 ${prof}` : ""}${d.service.priceCents != null ? `\n💰 ${reais(d.service.priceCents)}` : ""}`,
    [["conf:sim", "Confirmar"], ["conf:trocar", "Trocar horário"], ["conf:nao", "Desistir"]],
  );
}
function escolherServico(texto) {
  if (RID.startsWith("svc:")) return servicos.find((s) => s.id === RID.slice(4)) ?? null;
  const i = numeroEscolhido(Math.min(servicos.length, 10));
  if (i !== null) return servicos[i];
  return acharServico(texto, servicos);
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
    d.service = entrada.servico ? acharServico(entrada.servico, servicos) : null;
    d.service ??= acharServico(entrada.texto ?? T, servicos);
    if (!d.service && servicos.length === 1) d.service = servicos[0];
    const dia = lerData(entrada.data || entrada.texto || T);
    if (dia && !validarDia(dia)) d.date = dia;
    d.hora = lerHora(entrada.horario || entrada.texto || T);
    if (!d.service) return perguntarServico("Vamos agendar! 😊 Qual serviço você quer?");
    return irParaDia();
  }
  case "WAITING_SERVICE": {
    const s = escolherServico(T);
    if (!s) return naoEntendi(() => perguntarServico("Não encontrei esse serviço 🤔 Escolha um da lista:"));
    d.service = s;
    d.tentativas = 0;
    const dia = lerData(T);
    if (dia && !validarDia(dia)) d.date = dia;
    d.hora ??= lerHora(T);
    return irParaDia();
  }
  case "WAITING_DATE": {
    const dia = diaDaResposta();
    if (dia === "outro") {
      passo(FLOW, "WAITING_DATE", d);
      return responder("Pode escrever o dia 🙂 Por exemplo: *sexta*, *20/11* ou *dia 25*.");
    }
    if (!dia) return naoEntendi(() => (passo(FLOW, "WAITING_DATE", d), perguntarDia("Não entendi o dia 🤔")));
    const erro = validarDia(dia);
    if (erro) return (passo(FLOW, "WAITING_DATE", d), perguntarDia(erro));
    d.date = dia;
    d.hora = lerHora(T);
    d.tentativas = 0;
    return irParaHorarios();
  }
  case "WAITING_TIME": {
    const outroDia = RID ? null : lerData(T);
    if (outroDia && outroDia !== d.date && !validarDia(outroDia)) {
      d.date = outroDia;
      d.hora = lerHora(T);
      return irParaHorarios();
    }
    const e = horarioDaResposta(d);
    if (!e) return naoEntendi(() => (passo(FLOW, "WAITING_TIME", d), mostrarHorarios(`Escolha um horário da lista para ${fmtData(d.date)}:`, d.slots ?? [], d.total ?? 0)));
    if (e.indisponivel) {
      passo(FLOW, "WAITING_TIME", d);
      return mostrarHorarios(`O horário das *${e.indisponivel}* não está livre em ${fmtData(d.date)} 😕 Estes estão:`, d.slots ?? [], d.total ?? 0);
    }
    d.escolha = e;
    d.tentativas = 0;
    return confirmar();
  }
  case "WAITING_APPOINTMENT_CONFIRMATION": {
    if (RID === "conf:trocar" || /\b(trocar|outro horario|mudar)\b/.test(nt)) {
      if (d.slots?.length) {
        d.escolha = null;
        passo(FLOW, "WAITING_TIME", d);
        return mostrarHorarios(`Sem problema! Horários livres para ${fmtData(d.date)}:`, d.slots, d.total ?? 0);
      }
      return irParaHorarios("disp_troca");
    }
    if (RID === "conf:nao" || ehNao()) {
      ocioso();
      return responder("Tudo bem, não agendei nada 👍 Quando quiser, é só me chamar!");
    }
    if (RID !== "conf:sim" && !ehSim()) {
      const h = lerHora(T);
      if (h) {
        const e = horarioPedido(d, h);
        if (e) {
          d.escolha = e;
          return confirmar();
        }
      }
      return naoEntendi(confirmar);
    }
    const candidatos = candidatosDe(d);
    let ultimo = null;
    for (let i = 0; i < candidatos.length; i++) {
      const c = candidatos[i];
      const r = api("book" + i, "POST", "/internal/conversation/appointments", { body: { serviceId: d.service.id, employeeId: c.employeeId, startAt: c.startAt } });
      ultimo = r;
      if (ok(r)) {
        ocioso();
        ctx.events.push({ tipo: "agendado", appointment: r.body });
        return responder(`✅ *Agendado!*\n\n${resumoAgendamento(r.body)}\n\nVou te mandar um lembrete antes do horário. Para remarcar ou cancelar, é só me chamar aqui 😉`);
      }
      if (r.status !== 409) break;
    }
    if (ultimo && (ultimo.status === 409 || ultimo.status === 400)) {
      responder(`Poxa, ${msgApi(ultimo) ? msgApi(ultimo).toLowerCase() : "esse horário não está mais disponível"} 😕 Vou buscar outros horários.`);
      d.hora = null;
      return irParaHorarios("disp_conflito");
    }
    passo(FLOW, "WAITING_APPOINTMENT_CONFIRMATION", d);
    return instavel(ultimo, "criar o agendamento");
  }
  default:
    ocioso();
    aplicar(chamarWf("wf01", "WF01", {}));
}
