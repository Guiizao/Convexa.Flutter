// Biblioteca comum dos workflows "Convexa - NN". O gerador (build.mjs) cola este arquivo no começo
// de cada node "Lógica". Espera `ctx` (o contexto da conversa) já definido.
//
// Como funciona o laço "Lógica ⇄ Chamar API / Chamar workflow":
// - a Lógica roda do começo a cada volta; o que já foi buscado fica guardado em ctx._res[chave];
// - api()/chamarWf() devolvem o resultado guardado ou, se ainda não existe, pedem a chamada e
//   interrompem esta volta (PENDENTE). Depois da chamada, a Lógica roda de novo;
// - respostas, estado e eventos são restaurados no começo de cada volta (ctx._snap), então
//   nada sai duplicado mesmo rodando várias vezes.

const PENDENTE = { pendente: true };
const cfg = ctx.cfg;
const entrada = ctx.input ?? {};
const msg = ctx.message ?? { type: "text", text: "" };
const T = String(msg.text || msg.title || "").trim();
const RID = String(msg.replyId || "");

// ---------------------------------------------------------------- texto
const N = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const nt = N(T);
const primeiroNome = (s) => String(s ?? "").trim().split(/\s+/)[0] || "";
const nomeCliente = () => primeiroNome(ctx.session?.customer?.name || ctx.profileName || "");
const nomeEmpresa = () => ctx.session?.business?.name || "nossa equipe";
const ehSim = (t = nt) => /^(sim|s|ss|isso|isso mesmo|confirmo|confirmar|confirma|pode|pode sim|pode ser|ok|okay|certo|claro|bora|fechado|positivo|uhum|aham|perfeito|beleza|blz|quero|yes)\b/.test(t);
const ehNao = (t = nt) => /^(nao|n|nn|negativo|nope|deixa|deixa pra la|melhor nao|agora nao|nao quero|desisto|no)\b/.test(t);

// ---------------------------------------------------------------- respostas
const responder = (texto) => ctx.replies.push({ kind: "text", text: texto });
const botoes = (texto, lista, extra = {}) => ctx.replies.push({ kind: "buttons", text: texto, buttons: lista.map(([id, title]) => ({ id, title })), ...extra });
const lista = (texto, botao, linhas, extra = {}) =>
  ctx.replies.push({ kind: "list", text: texto, button: botao, sections: [{ title: extra.secao ?? "Opções", rows: linhas }], ...(extra.footer ? { footer: extra.footer } : {}) });
const conv = ctx.conversation;
const passo = (flow, step, data) => {
  conv.flow = flow;
  conv.step = step;
  if (data !== undefined) conv.data = data;
  conv.stepAt = new Date().toISOString();
};
const ocioso = () => passo(null, "IDLE", {});
const dados = () => (conv.data ??= {});

const OPCOES_MENU = [
  ["menu:agendar", "Agendar horário", "Marcar um novo horário"],
  ["menu:meus", "Meus agendamentos", "Ver o que já está marcado"],
  ["menu:remarcar", "Remarcar", "Trocar dia ou horário"],
  ["menu:cancelar", "Cancelar", "Desmarcar um horário"],
  ["menu:servicos", "Serviços e preços", "O que fazemos e quanto custa"],
  ["menu:info", "Endereço e horários", "Onde fica e quando abre"],
  ["menu:atendente", "Falar com atendente", "Uma pessoa da equipe"],
];
function menu(texto) {
  lista(texto ?? "Como posso ajudar?", "Ver opções", OPCOES_MENU.map(([id, title, description]) => ({ id, title, description })), { secao: "Menu" });
}

// ---------------------------------------------------------------- API e subworkflows
const ok = (r) => !!r && r.status >= 200 && r.status < 300;
const msgApi = (r) => (r?.body && typeof r.body === "object" ? r.body.message : null) || null;
/** Chamada à ConvexaAPI. `semToken` para /internal/conversation/session (só a chave interna). */
function api(chave, method, path, opts = {}) {
  if (chave in ctx._res) return ctx._res[chave];
  ctx._next = { kind: "api", key: chave, method, url: cfg.apiUrl + path, query: opts.query ?? null, body: opts.body ?? null, token: opts.semToken ? null : ctx.session?.token ?? null };
  throw PENDENTE;
}
/** Chama outro workflow Convexa (pelo apelido em cfg.wf) e devolve o contexto que ele produziu. */
function chamarWf(chave, apelido, input = {}) {
  if (chave in ctx._res) return ctx._res[chave];
  const workflowId = cfg.wf[apelido];
  if (!workflowId) throw new Error(`workflow ${apelido} não configurado`);
  ctx._next = { kind: "wf", key: chave, workflowId, input };
  throw PENDENTE;
}
/** Junta no contexto atual o que o subworkflow respondeu e mudou. */
function aplicar(r) {
  if (!r?.ctx) return;
  ctx.replies.push(...(r.ctx.replies ?? []));
  ctx.events.push(...(r.ctx.events ?? []));
  ctx.alerts.push(...(r.ctx.alerts ?? []));
  if (r.ctx.conversation) {
    for (const k of Object.keys(conv)) delete conv[k];
    Object.assign(conv, r.ctx.conversation);
  }
}
const alertar = (tipo, mensagem, detalhe = {}) => ctx.alerts.push({ tipo, mensagem, detalhe, chave: `${tipo}:${ctx.phoneNumberId ?? ""}:${new Date().toISOString().slice(0, 13)}` });
function instavel(r, onde) {
  alertar("API_INSTAVEL", `Falha ao ${onde} (HTTP ${r?.status ?? "sem resposta"})`, { status: r?.status, erro: r?.erro ?? msgApi(r) });
  responder("Estou com uma instabilidade agora 😕 Pode tentar de novo em alguns minutos? Se preferir, digite *atendente*.");
}

// ---------------------------------------------------------------- datas (sempre no fuso da empresa, pelo "now" da API)
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const DIAS_N = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const hoje = () => ctx.session?.now?.date ?? new Date().toISOString().slice(0, 10);
const agoraHora = () => ctx.session?.now?.time ?? "00:00";
const tz = () => ctx.session?.business?.timezone ?? "America/Sao_Paulo";
const ymd = (y, m, d) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const partes = (s) => s.split("-").map(Number);
const somarDias = (s, n) => {
  const [y, m, d] = partes(s);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const diaSemana = (s) => {
  const [y, m, d] = partes(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const dataValida = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
function fmtData(s) {
  if (!s) return "";
  const [, m, d] = partes(s);
  const rot = s === hoje() ? "hoje, " : s === somarDias(hoje(), 1) ? "amanhã, " : "";
  return `${rot}${DIAS[diaSemana(s)]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}
/** "hoje", "amanhã", "depois de amanhã", "sexta", "próxima segunda", "20/11", "20/11/2026", "dia 20", "20 de novembro". */
function lerData(texto) {
  const t = N(texto);
  if (!t) return null;
  const base = hoje();
  const [by, bm, bd] = partes(base);
  if (/\bdepois de amanha\b/.test(t)) return somarDias(base, 2);
  if (/\bamanha\b/.test(t)) return somarDias(base, 1);
  if (/\bhoje\b/.test(t)) return base;
  let m = t.match(/\b(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{2,4}))?\b/);
  if (m) {
    const d = +m[1], mes = +m[2];
    let y = m[3] ? +m[3] : by;
    if (y < 100) y += 2000;
    if (!dataValida(y, mes, d)) return null;
    let s = ymd(y, mes, d);
    if (!m[3] && s < base) s = ymd(y + 1, mes, d);
    return s;
  }
  m = t.match(/\b(\d{1,2}) de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
  if (m) {
    const d = +m[1], mes = MESES.indexOf(m[2]) + 1;
    if (!dataValida(by, mes, d)) return null;
    let s = ymd(by, mes, d);
    if (s < base) s = ymd(by + 1, mes, d);
    return s;
  }
  m = t.match(/\bdia (\d{1,2})\b/);
  if (m) {
    const d = +m[1];
    let y = by, mes = bm;
    if (d < bd) mes += 1;
    if (mes > 12) (mes = 1), (y += 1);
    return dataValida(y, mes, d) ? ymd(y, mes, d) : null;
  }
  const curtos = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
  for (let i = 0; i < 7; i++) {
    const re = new RegExp(`\\b(${DIAS_N[i]}|${Object.keys(curtos)[i]})(-feira)?\\b`);
    if (re.test(t)) {
      let delta = (i - diaSemana(base) + 7) % 7;
      if (delta === 0 && /\b(proxima|proximo|que vem)\b/.test(t)) delta = 7;
      return somarDias(base, delta);
    }
  }
  if (/\b(semana que vem|proxima semana)\b/.test(t)) return somarDias(base, 7);
  return null;
}
/** "14h", "14:30", "14h30", "às 9", "9 da manhã", "3 da tarde", "meio-dia". Devolve "HH:MM". */
function lerHora(texto) {
  const t = N(texto);
  if (!t) return null;
  if (/\bmeio[ -]?dia\b/.test(t)) return "12:00";
  let m = t.match(/\b(\d{1,2})\s*(?:h|hs|hrs?|horas?|:)\s*(\d{2})?\b/) || t.match(/\bas (\d{1,2})(?::(\d{2}))?\b/) || t.match(/\b(\d{1,2})(?::(\d{2}))? (?:da|de) (?:manha|tarde|noite)\b/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (/\b(da|de) (tarde|noite)\b/.test(t) && h >= 1 && h <= 11) h += 12;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
/** Instante ISO (com Z) de uma data e hora no fuso da empresa. */
function instante(data, hora, zona = tz()) {
  const [y, m, d] = partes(data);
  const [hh, mm] = hora.split(":").map(Number);
  const alvo = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms;
  };
  let t = alvo - offset(alvo);
  t = alvo - offset(t);
  return new Date(t).toISOString();
}

// ---------------------------------------------------------------- dinheiro e duração
const reais = (c) => (c == null ? "" : "R$ " + (c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, "."));
const duracao = (min) => (!min ? "" : min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`);

// ---------------------------------------------------------------- escolha de opções
/** Número digitado sozinho ("2") para uma lista de n opções. */
function numeroEscolhido(n) {
  const m = nt.match(/^(?:opcao |numero |o |a )?(\d{1,2})[.)]?$/);
  if (!m) return null;
  const i = +m[1] - 1;
  return i >= 0 && i < n ? i : null;
}
/** Serviço citado no texto (pelo nome, sem números para não confundir com datas). */
function acharServico(texto, servicos) {
  const t = N(texto);
  if (!t) return null;
  let melhor = null, nota = 0;
  for (const s of servicos) {
    const nome = N(s.name);
    if (!nome) continue;
    if (t === nome) return s;
    let p = 0;
    if (t.includes(nome)) p = 100 + nome.length;
    else {
      const palavras = nome.split(" ").filter((w) => w.length >= 4 && !["para", "com", "sem", "simples"].includes(w));
      const hits = palavras.filter((w) => new RegExp(`\\b${w.slice(0, Math.max(4, w.length - 2))}`).test(t)).length;
      if (hits) p = hits * 10 + (hits === palavras.length ? 5 : 0);
    }
    if (p > nota) (nota = p), (melhor = s);
  }
  return melhor;
}
const resumoAgendamento = (a) => `*${a.service?.name ?? "Atendimento"}* — ${fmtData(a.date)} às *${a.time}*${a.employee?.name ? ` com ${a.employee.name}` : ""}`;
/** Escolhe um agendamento por botão/lista, número, data ou nome do serviço. */
function acharAgendamento(ags) {
  if (RID.startsWith("appt:")) return ags.find((a) => a.id === RID.slice(5)) ?? null;
  const i = numeroEscolhido(ags.length);
  if (i !== null) return ags[i];
  const d = lerData(T);
  const porData = d ? ags.filter((a) => a.date === d) : [];
  if (porData.length === 1) return porData[0];
  const s = acharServico(T, ags.map((a) => ({ ...a.service, _a: a })));
  return s?._a ?? null;
}
function listarAgendamentos(texto, ags, botao = "Escolher") {
  lista(
    texto,
    botao,
    ags.slice(0, 10).map((a) => ({ id: "appt:" + a.id, title: `${String(a.date).slice(8, 10)}/${String(a.date).slice(5, 7)} às ${a.time}`, description: `${a.service?.name ?? ""}${a.employee?.name ? " · " + a.employee.name : ""}` })),
    { secao: "Seus horários" },
  );
}

// ---------------------------------------------------------------- escolha de dia e horário (agendar e remarcar)
const BOTOES_DIA = [["dia:hoje", "Hoje"], ["dia:amanha", "Amanhã"], ["dia:outro", "Outro dia"]];
function perguntarDia(texto) {
  botoes(`${texto}\n\nVocê também pode escrever, por exemplo: *sexta*, *20/11* ou *dia 25*.`, BOTOES_DIA);
}
/** Lê o dia da resposta. Devolve "YYYY-MM-DD", "outro" (pediu para digitar) ou null. */
function diaDaResposta() {
  if (RID === "dia:hoje") return hoje();
  if (RID === "dia:amanha") return somarDias(hoje(), 1);
  if (RID === "dia:outro") return "outro";
  return lerData(T);
}
function validarDia(dia) {
  if (dia < hoje()) return "Essa data já passou 🙂 Qual outro dia fica bom?";
  if (dia > somarDias(hoje(), 120)) return "Consigo agendar até 4 meses à frente. Qual dia mais próximo fica bom?";
  return null;
}
/** Mostra os horários livres em lista (até 10). */
function mostrarHorarios(texto, slots, total) {
  const varios = new Set(slots.map((s) => s.employeeId)).size > 1;
  lista(
    texto + (total > slots.length ? `\n\nNão achou o horário que queria? Escreva, por exemplo, *16h* que eu verifico.` : ""),
    "Ver horários",
    slots.slice(0, 10).map((s, i) => ({ id: "slot:" + i, title: s.time + (varios && s.employeeName ? ` · ${primeiroNome(s.employeeName)}` : ""), description: s.employeeName ? `com ${s.employeeName}` : "" })),
    { secao: "Horários livres" },
  );
}
/**
 * O cliente pediu um horário que não está entre os 10 primeiros livres que a API devolve.
 * Se a lista foi cortada (total > 10) e o horário é depois do último mostrado, ele pode estar
 * livre: tentamos reservar na confirmação, com cada profissional, e a API decide.
 */
function horarioPedido(d, hora) {
  const slots = d.slots ?? [];
  const exato = slots.find((s) => s.time === hora);
  if (exato) return { slot: exato };
  const ultimo = slots.at(-1)?.time ?? "00:00";
  if ((d.total ?? 0) > slots.length && hora > ultimo) {
    const profissionais = [...new Map(slots.map((s) => [s.employeeId, s.employeeName])).entries()].map(([employeeId, employeeName]) => ({ employeeId, employeeName }));
    return { tentativa: { time: hora, startAt: instante(d.date, hora), candidatos: profissionais } };
  }
  return null;
}
/** Horário escolhido na resposta (lista, número ou "14h"). */
function horarioDaResposta(d) {
  const slots = d.slots ?? [];
  if (RID.startsWith("slot:")) {
    const s = slots[+RID.slice(5)];
    return s ? { slot: s } : null;
  }
  const i = numeroEscolhido(slots.length);
  if (i !== null) return { slot: slots[i] };
  const h = lerHora(T);
  return h ? horarioPedido(d, h) ?? { indisponivel: h } : null;
}
const candidatosDe = (d) => (d.escolha?.slot ? [{ employeeId: d.escolha.slot.employeeId, startAt: d.escolha.slot.startAt }] : (d.escolha?.tentativa?.candidatos ?? []).map((c) => ({ employeeId: c.employeeId, startAt: d.escolha.tentativa.startAt })));
const horaEscolhida = (d) => d.escolha?.slot?.time ?? d.escolha?.tentativa?.time ?? "";
const profissionalEscolhido = (d) => d.escolha?.slot?.employeeName ?? (d.escolha?.tentativa?.candidatos?.length === 1 ? d.escolha.tentativa.candidatos[0].employeeName : null);

/** Busca horários livres no WF03 e mostra. Devolve false se não deu (já respondeu ao cliente). */
function buscarEMostrar(chave, d, servicoId, textoIntro) {
  const r = chamarWf(chave, "WF03", { serviceId: servicoId, date: d.date, buscarProximos: true, dias: 7 });
  const res = r.ctx?.result ?? {};
  if (res.erro) {
    instavel({ status: res.status, erro: res.erro }, "consultar horários");
    return false;
  }
  if (!res.slots?.length) {
    perguntarDia(`Não encontrei horários livres de ${fmtData(d.date)} até ${fmtData(somarDias(d.date, 7))} 😕 Quer tentar outra data?`);
    d.date = null;
    return false;
  }
  let aviso = "";
  if (res.date !== d.date) aviso = `Em ${fmtData(d.date)} não há horários livres. O próximo dia com vaga é *${fmtData(res.date)}*.\n\n`;
  d.date = res.date;
  d.slots = res.slots;
  d.total = res.totalSlots ?? res.slots.length;
  d.escolha = null;
  if (d.hora) {
    const e = horarioPedido(d, d.hora);
    d.hora = null;
    if (e) {
      d.escolha = e;
      return "escolhido";
    }
    aviso += `O horário que você pediu não está livre.\n\n`;
  }
  mostrarHorarios(`${aviso}${textoIntro} ${fmtData(d.date)}:`, d.slots, d.total);
  return true;
}
