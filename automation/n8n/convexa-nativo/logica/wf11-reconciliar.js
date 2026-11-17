// Para cada cliente verificado: atualiza a tabela de agendamentos com o que a API diz, marca como
// cancelado o que sumiu da agenda e manda o lembrete de quem está dentro da janela.
// Lembrete: com a janela de 24 h aberta vai com botões; fechada, vai pelo modelo aprovado na Meta
// (cfg.tplLembrete, padrão "convexa_lembrete": 6 variáveis e 3 botões de resposta rápida).
const clientes = $("Clientes a verificar").all().map((i) => i.json);
const sessoes = $("Abrir sessão").all().map((i) => i.json);
const listas = $input.all().map((i) => i.json);
const ags = $("Agendamentos").all().map((i) => i.json).filter((r) => r.appointmentId);
const agora = Date.now();
const H = 3600e3;
const out = [];
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const quando = (a) => `${a.weekday || DIAS[new Date(a.date + "T12:00:00Z").getUTCDay()]}, ${a.date.slice(8, 10)}/${a.date.slice(5, 7)}`;
const limpa = (s) => String(s ?? "").replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim() || "-";

clientes.forEach((cli, i) => {
  const sess = sessoes[i] ?? {};
  const lst = listas[i] ?? {};
  const cfg = cli.cfg;
  if (!(lst.statusCode >= 200 && lst.statusCode < 300) || !Array.isArray(lst.body)) return; // tenta de novo na próxima rodada
  const empresa = sess.body?.business?.name ?? "";
  const nome = sess.body?.customer?.name || cli.nome || "";
  const futuros = lst.body;
  const ids = new Set(futuros.map((a) => a.id));
  const salvos = new Map(ags.filter((r) => r.chave === cli.chave).map((r) => [r.appointmentId, r]));

  // sumiu da lista antes de começar: cancelado (pelo painel ou por outra pessoa)
  for (const [id, r] of salvos) if (r.status === "ATIVO" && !ids.has(id) && Date.parse(r.startAt) > agora) out.push({ json: { tipo: "agendamento", linha: { appointmentId: id, status: "CANCELADO" } } });

  let conv = {};
  try { conv = cli.conversa ? JSON.parse(cli.conversa) : {}; } catch (e) { conv = {}; }
  const janelaAberta = Date.parse(cli.lastInboundAt || 0) > agora - 23.5 * H;
  let lembrou = false;

  for (const a of futuros) {
    const antes = salvos.get(a.id);
    const mudouHorario = antes && antes.startAt && Date.parse(antes.startAt) !== Date.parse(a.startAt);
    const linha = {
      appointmentId: a.id, chave: cli.chave, phoneNumberId: cli.phoneNumberId, waId: cli.waId, phone: cli.phone, nome,
      servico: a.service?.name ?? "", profissional: a.employee?.name ?? "", startAt: new Date(a.startAt).toISOString(), endAt: new Date(a.endAt).toISOString(),
      data: a.date, hora: a.time, status: "ATIVO",
      ...(antes && !mudouHorario ? {} : { lembreteEnviado: "", posEnviado: "" }),
    };
    const ini = Date.parse(a.startAt);
    const jaLembrado = antes && !mudouHorario && antes.lembreteEnviado;
    const dentro = ini - agora <= cfg.reminderHours * H && ini - agora > 45 * 60e3;
    if (!jaLembrado && dentro && !lembrou) {
      const botoesIds = ["lem:sim:" + a.id, "lem:remarcar:" + a.id, "lem:cancelar:" + a.id];
      let reply = null;
      if (janelaAberta)
        reply = { kind: "buttons", text: `⏰ *Lembrete${nome ? ", " + nome.split(" ")[0] : ""}!*\n\nVocê tem *${a.service?.name ?? "um horário"}* ${quando(a)} às *${a.time}*${a.employee?.name ? ` com ${a.employee.name}` : ""}${empresa ? ` na ${empresa}` : ""}.\n\nPosso confirmar sua presença?`, buttons: [{ id: botoesIds[0], title: "Confirmo presença" }, { id: botoesIds[1], title: "Remarcar" }, { id: botoesIds[2], title: "Cancelar" }] };
      else if (cfg.tplLembrete)
        reply = { kind: "template", name: cfg.tplLembrete, language: cfg.tplLang, params: [nome.split(" ")[0] || "cliente", empresa, a.service?.name, quando(a), a.time, a.employee?.name || "nossa equipe"].map(limpa), buttons: botoesIds };
      if (reply) {
        lembrou = true;
        linha.lembreteEnviado = new Date().toISOString();
        out.push({ json: { tipo: "envio", acao: "enviar", cfg, origem: "lembrete", phoneNumberId: cli.phoneNumberId, waId: cli.waId, replies: [reply] } });
        // a próxima resposta do cliente vai para o WF12 (se ele não estiver no meio de outra conversa)
        if ((conv.mode ?? "AI") !== "HUMAN" && (conv.step ?? "IDLE") === "IDLE") {
          const nova = { mode: "AI", ...conv, flow: "lembrete", step: "WAITING_APPOINTMENT_CONFIRMATION_REPLY", data: { appt: a }, stepAt: new Date().toISOString() };
          out.push({ json: { tipo: "conversa", linha: { chave: cli.chave, conversa: JSON.stringify(nova), step: nova.step } } });
        }
      } else linha.lembreteEnviado = "sem_janela_e_sem_modelo";
    }
    out.push({ json: { tipo: "agendamento", linha } });
  }
  out.push({ json: { tipo: "conversa", linha: { chave: cli.chave, sincronizadoEm: new Date().toISOString() } } });
});
return out;
