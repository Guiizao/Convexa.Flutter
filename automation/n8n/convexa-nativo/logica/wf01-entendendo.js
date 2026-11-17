// WF01 — Entendendo a mensagem: descobre a intenção (botão do menu, regras e, se precisar, a IA)
// e passa para o workflow certo. A IA só classifica: não chama a API nem vê tokens.
const REGRAS = [
  ["atendente", /\b(atendente|humano|uma pessoa|pessoa real|falar com (alguem|voce|uma pessoa|o dono|a dona|o responsavel|a responsavel|gerente)|atendimento humano|reclama)/],
  ["cancelar", /\b(cancel|desmarc|nao vou (poder )?(ir|comparecer)|nao (vou )?conseguir ir)/],
  ["remarcar", /\b(remarc|reagend|mudar (o |meu )?(horario|dia|data)|trocar (o |meu )?(horario|dia|data)|adiar|antecipar|outro horario pro meu)/],
  ["meus", /\b(meus? (horarios?|agendamentos?)|minha (reserva|hora)|tenho (algum )?(horario|agendamento|hora marcada)|quando (e|eh|esta) (o )?meu|que horas (e|eh) (o )?meu|ver (o )?meu|consultar (o )?meu)/],
  ["agendar", /\b(agend|marcar|marca um|reservar|tem (horario|vaga|hora)|horarios? (livres?|disponive)|disponibilidade|quero (cortar|fazer|um horario)|queria (cortar|fazer|um horario)|gostaria de (marcar|agendar|fazer)|encaixe|vaga)/],
  ["servicos", /\b(servicos?|precos?|valor(es)?|quanto (custa|e|eh|fica|sai|cobra)|tabela|o que (voces|vcs) fazem|cardapio|procedimentos?)/],
  ["info", /\b(endereco|onde (fica|e|eh|voces ficam)|localiza|como (chego|chegar)|horario de (funcionamento|atendimento)|que horas (abre|fecha|voces abrem|voces fecham)|abre(m)? (hoje|amanha|sabado|domingo|aos)|fecha(m)?|esta aberto|funcionam|estacionamento|pix|cartao|forma de pagamento|aceita|telefone|instagram|whatsapp de voces|site)/],
  ["saudacao", /^(oi+e?|ola|opa|bom dia|boa tarde|boa noite|e ai|eae|eai|hello|hey|salve|menu|inicio|comecar|recomecar|voltar|sair|parar|reiniciar|ajuda|cancelar tudo)\b/],
  ["agradecimento", /^(obrigad|valeu|vlw|brigad|grat[oa]|thanks|tmj|show|top|perfeito|otimo|beleza|blz|ok obrigad)/],
];
const ALIAS_MENU = { agendar: "agendar", meus: "meus", remarcar: "remarcar", cancelar: "cancelar", servicos: "servicos", info: "info", atendente: "atendente", inicio: "saudacao" };

let intencao = null;
let extra = {};
if (RID.startsWith("menu:")) intencao = ALIAS_MENU[RID.slice(5)] ?? "saudacao";
else if (msg.type === "unsupported") intencao = "naoSuportado";
else {
  for (const [nome, re] of REGRAS) if (re.test(nt)) { intencao = nome; break; }
  if ((!intencao || intencao === "saudacao") && (lerData(T) || lerHora(T)) && nt.split(" ").length <= 8) intencao = "agendar";
}

// Sem regra que resolva: pergunta à IA (se ligada). Falha da IA (sem credencial, fora do ar) cai no "não entendi".
if (!intencao && cfg.ia !== "off" && nt.split(" ").length >= 2) {
  const r = (() => {
    if ("ia" in ctx._res) return ctx._res.ia;
    ctx._next = { kind: "ai", key: "ia", texto: T.slice(0, 500), hoje: `${hoje()} (${DIAS[diaSemana(hoje())]})` };
    throw PENDENTE;
  })();
  const mapa = { AGENDAR: "agendar", CONSULTAR: "meus", REMARCAR: "remarcar", CANCELAR: "cancelar", SERVICOS: "servicos", ESTABELECIMENTO: "info", ATENDENTE: "atendente", SAUDACAO: "saudacao", AGRADECIMENTO: "agradecimento" };
  if (r?.intencao && mapa[r.intencao]) {
    intencao = mapa[r.intencao];
    extra = { servico: r.servico ?? null, data: r.data ?? null, horario: r.horario ?? null };
  }
}

const nome = nomeCliente();
switch (intencao) {
  case "agendar":
    aplicar(chamarWf("wf", "WF02", { acao: "iniciar", texto: T, ...extra }));
    break;
  case "meus":
    aplicar(chamarWf("wf", "WF06", { acao: "listar" }));
    break;
  case "remarcar":
    aplicar(chamarWf("wf", "WF04", { acao: "iniciar" }));
    break;
  case "cancelar":
    aplicar(chamarWf("wf", "WF05", { acao: "iniciar" }));
    break;
  case "servicos":
    aplicar(chamarWf("wf", "WF07", { acao: "responder" }));
    break;
  case "info":
    aplicar(chamarWf("wf", "WF08", {}));
    break;
  case "atendente":
    aplicar(chamarWf("wf", "WF09", { acao: "transferir", motivo: T }));
    break;
  case "agradecimento":
    ocioso();
    responder(`Por nada${nome ? ", " + nome : ""}! 😊 Se precisar de algo, é só chamar.`);
    break;
  case "naoSuportado":
    ocioso();
    menu("Por enquanto eu só consigo ler mensagens de texto 🙂 Escolha uma opção ou escreva o que precisa:");
    break;
  case "saudacao":
    ocioso();
    conv.naoEntendi = 0;
    menu(`Olá${nome ? ", *" + nome + "*" : ""}! 👋 Aqui é o assistente virtual da *${nomeEmpresa()}*.\n\nComo posso ajudar?`);
    break;
  default: {
    ocioso();
    conv.naoEntendi = (conv.naoEntendi ?? 0) + 1;
    if (conv.naoEntendi >= 3) {
      conv.naoEntendi = 0;
      botoes("Ainda não consegui entender 😕 Quer falar com uma pessoa da nossa equipe?", [["menu:atendente", "Falar com atendente"], ["menu:inicio", "Ver o menu"]]);
    } else menu("Desculpe, não entendi 🤔 Escolha uma das opções ou escreva, por exemplo: *quero agendar amanhã às 15h*.");
  }
}
if (intencao && intencao !== "naoSuportado") conv.naoEntendi = 0;
