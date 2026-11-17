// WF10 — Dados do Cliente: abre a sessão da conversa na API (token de 5 min, empresa, cliente,
// data/hora local) a cada mensagem e cuida do nome do cliente.
const NAO_NOME = /^(sim|nao|oi|ola|ok|bom dia|boa tarde|boa noite|menu|agendar|quero|obrigad|valeu|teste)\b/;
function limparNome(texto) {
  let s = String(texto ?? "").trim().replace(/^(meu nome (e|é)|me chamo|eu sou( o| a)?|sou( o| a)?|aqui (e|é)( o| a)?|é( o| a)?)\s+/i, "");
  s = s.replace(/[^\p{L}\s'.-]/gu, " ").replace(/\s+/g, " ").trim();
  const palavras = s.split(" ").filter(Boolean).slice(0, 4);
  const nome = palavras.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
  if (nome.length < 2 || nome.length > 60 || NAO_NOME.test(N(nome))) return null;
  return nome;
}

const pedindoNome = conv.step === "WAITING_CUSTOMER_NAME";
const nomeDigitado = pedindoNome ? limparNome(T) : null;
// a sessão abre mesmo sem nome (o nome é opcional na API) para ter o nome da empresa na resposta
const nome = nomeDigitado || (ctx.profileName ? limparNome(ctx.profileName) : null);
const r = api("sessao", "POST", "/internal/conversation/session", { semToken: true, body: { phoneNumberId: ctx.phoneNumberId, phone: ctx.phone, ...(nome ? { name: nome } : {}) } });

if (r.status === 404) {
  alertar("NUMERO_SEM_EMPRESA", `O número da Meta ${ctx.phoneNumberId} não está ligado a nenhuma empresa no painel. A mensagem foi ignorada.`, { phoneNumberId: ctx.phoneNumberId });
  ctx.result = { parar: true, silencio: true };
  return;
}
if (r.status === 400 || r.status === 422) {
  alertar("SESSAO_RECUSADA", `A API recusou abrir a sessão: ${msgApi(r) ?? "dados inválidos"}`, { phoneNumberId: ctx.phoneNumberId, telefone: ctx.phone });
  responder("Não consegui identificar o seu número por aqui 😕 Por favor, fale com a gente por outro canal.");
  ctx.result = { parar: true };
  return;
}
if (!ok(r)) {
  instavel(r, "abrir a sessão da conversa");
  ctx.result = { parar: true };
  return;
}
ctx.session = r.body;

if (pedindoNome && !nomeDigitado) {
  responder("Desculpe, não entendi 😅 Pode me dizer só o seu nome?");
  ctx.result = { parar: true };
  return;
}
if (!ctx.session.customer?.name) {
  responder(`Olá! 👋 Aqui é o assistente virtual da *${nomeEmpresa()}*.\n\nAntes de começar, como posso te chamar?`);
  passo("cadastro", "WAITING_CUSTOMER_NAME", { textoOriginal: T });
  ctx.result = { parar: true };
  return;
}
if (pedindoNome) {
  ocioso();
  menu(`Prazer, *${primeiroNome(ctx.session.customer.name)}*! 😊 Como posso ajudar?`);
  ctx.result = { parar: true };
  return;
}
ctx.result = { parar: false };
