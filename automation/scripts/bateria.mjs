// Bateria ampla de conversas: cliente, dono, robustez, Alexa e API do painel.
// Tudo passa pelo caminho real (simulador -> n8n -> automação -> ConvexaAPI -> n8n -> simulador).
// Uso:  AUTOMACAO_KEY=... AUTOMACAO_DB_URL=postgresql://.../convexa_automacao node bateria.mjs [area...]
//       áreas: cliente pagamento lembrete dono robustez alexa painel   (sem argumento roda todas)
// Gera um relatório em JSON (BATERIA_OUT, padrão ./bateria-resultado.json).
import { writeFileSync } from "node:fs";
import {
  API, AUTO, N8N, OWNER, SIM, age, alexa, apiCall, apiSql, check, inbox, lastSeq, novoCliente, numberOf, options, panel, panelToken, results, scenario, setSettings, sim, sleep, sql,
  talk, tap, text, tick, transcript, waitBot,
} from "./lib-sim.mjs";

const only = process.argv.slice(2);
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "dono@navalha.demo";
const DEMO_PASS = process.env.DEMO_PASSWORD ?? "Navalha#2026demo";
const runs = (area) => only.length === 0 || only.includes(area);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PDF_B64 = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF").toString("base64");

// ------------------------------------------------------------------ preparo
const original = (await panel("GET", "/status")).body.settings;
const base = {
  agentEnabled: true,
  askProfessional: true,
  handoffHours: 2,
  prepayment: { ...original.prepayment, mode: "off", depositType: "percent", depositPercent: 30, fullPaymentDiscountPercent: 10, provider: "static_pix", expiresMinutes: 30 },
  cancellation: { ...original.cancellation, minHoursBefore: 2, depositRefundable: false },
  reminders: { enabled: true, hoursBefore: [24, 2] },
  notifyOwner: { newBooking: true, cancellation: true, reschedule: true },
};
await setSettings(base);
// Agenda previsível: cancela os agendamentos futuros e apaga os bloqueios da empresa de DEMONSTRAÇÃO.
// Direto no banco local (sem gastar o limite de chamadas da API). Nunca aponte isto para produção.
const status0 = (await panel("GET", "/status")).body;
const BIZ = status0.business.id;
if (process.env.API_DB_URL && /Navalha/.test(status0.business.name)) {
  apiSql(`UPDATE "Appointment" SET status = 'CANCELLED' WHERE "businessId" = '${BIZ}' AND "startAt" > now() AND status IN ('SCHEDULED','CONFIRMED')`);
  apiSql(`DELETE FROM "TimeBlock" WHERE "businessId" = '${BIZ}' AND "endAt" > now()`);
  apiSql(`UPDATE "Business" SET "monthlyMessageLimit" = NULL WHERE id = '${BIZ}'`);
}
if (process.env.AUTOMACAO_DB_URL) sql(`UPDATE payment SET status = 'expired' WHERE business_id = '${BIZ}' AND status IN ('pending','under_review')`);
await sim("/api/rejections", undefined, "DELETE");
await talk(OWNER, { text: "modo dono" });
await talk(OWNER, { text: "menu" }); // abre a janela de 24h do dono

/** Agenda por texto livre e devolve a resposta da confirmação. */
async function agendar(who, frase) {
  let r = await talk(who, { text: frase });
  if (/preferência/i.test(text(r))) r = await talk(who, tap(r, /Sem preferência/));
  return r;
}
async function agendarEConfirmar(who, frase) {
  let r = await agendar(who, frase);
  r = await talk(who, tap(r, /^Confirmar$/));
  return r;
}

// ================================================================== CLIENTE
if (runs("cliente")) {
  await scenario("Cliente", "Saudação abre o menu em lista", async () => {
    const c = novoCliente("Bruna Menu");
    const r = await talk(c, { text: "oi, boa tarde" });
    check("responde com uma lista (mensagem interativa)", r.at(-1)?.kind === "list", JSON.stringify(r.at(-1)));
    const opts = options(r);
    check("lista tem Agendar, Meus horários, Preços, Endereço e Atendente", ["Agendar horário", "Meus horários", "Serviços e preços", "Endereço e horários", "Falar com atendente"].every((o) => opts.includes(o)), opts.join(" | "));
    check("cliente novo não vê Remarcar nem Cancelar", !opts.includes("Remarcar") && !opts.includes("Cancelar horário"), opts.join(" | "));
    check("saudação usa o nome do cliente", /Bruna/.test(text(r)), text(r));
  });

  await scenario("Cliente", "Agendar passo a passo tocando nas opções (lista e botões)", async () => {
    const c = novoCliente("Carlos Toque");
    let r = await talk(c, { text: "menu" });
    r = await talk(c, tap(r, /Agendar horário/));
    check("pergunta o serviço em lista, com preço e duração", r.at(-1)?.kind === "list" && /R\$/.test(JSON.stringify(r.at(-1).sections)), text(r));
    r = await talk(c, tap(r, /^Corte$/));
    check("pergunta o profissional", /preferência/i.test(text(r)) && options(r).includes("Sem preferência"), text(r));
    r = await talk(c, tap(r, /Lucas/));
    check("pergunta o dia em lista, com Outra data no fim", options(r).includes("Outra data") && options(r).length <= 10, options(r).join(" | "));
    r = await talk(c, tap(r, /Amanhã|Terça|Quarta/));
    if (/período/i.test(text(r))) {
      check("com muitos horários, pergunta o período em botões", r.at(-1)?.kind === "buttons", text(r));
      r = await talk(c, tap(r, /Tarde/));
    }
    check("mostra os horários livres em lista", r.at(-1)?.kind === "list" && options(r).some((o) => /^\d{2}:\d{2}$/.test(o)), options(r).join(" | "));
    r = await talk(c, tap(r, /^\d{2}:\d{2}$/));
    check("mostra o resumo com Confirmar / Outro horário / Cancelar", /Confere/.test(text(r)) && options(r).join("|") === "Confirmar|Outro horário|Cancelar", text(r) + options(r).join("|"));
    check("resumo tem serviço, profissional e preço", /Corte/.test(text(r)) && /Lucas/.test(text(r)) && /R\$ 45,00/.test(text(r)), text(r));
    r = await talk(c, tap(r, /^Confirmar$/));
    check("confirma o agendamento e manda o endereço", /Seu horário está marcado/.test(text(r)) && /Rua Bahia/.test(text(r)), text(r));
    r = await talk(c, { text: "menu" });
    check("depois de agendar, o menu passa a ter Remarcar e Cancelar", options(r).includes("Remarcar") && options(r).includes("Cancelar horário"), options(r).join(" | "));
  });

  await scenario("Cliente", "Agendar respondendo só com números", async () => {
    const c = novoCliente("Diego Numero");
    let r = await talk(c, { text: "oi" });
    r = await talk(c, { text: numberOf(r, /Agendar horário/) });
    check("\"1\" no menu abre o agendamento", /serviço/i.test(text(r)) && r.at(-1)?.kind === "list", text(r));
    r = await talk(c, { text: numberOf(r, /^Barba$/) });
    check("número escolhe o serviço", /preferência|dia/i.test(text(r)), text(r));
    if (/preferência/i.test(text(r))) r = await talk(c, { text: numberOf(r, /Sem preferência/) });
    check("número escolhe o profissional e pergunta o dia", /dia/i.test(text(r)), text(r));
    r = await talk(c, { text: "opção 2" });
    if (/período/i.test(text(r))) r = await talk(c, { text: "1" });
    check("\"opção 2\" escolhe o dia e mostra horários", options(r).some((o) => /^\d{2}:\d{2}$/.test(o)), text(r) + options(r).join("|"));
    r = await talk(c, { text: "3" });
    check("número escolhe o horário e mostra o resumo", /Confere/.test(text(r)) && /Barba/.test(text(r)), text(r));
    r = await talk(c, { text: "1" });
    check("\"1\" confirma", /Seu horário está marcado/.test(text(r)), text(r));
  });

  await scenario("Cliente", "Texto livre: várias formas de pedir um horário", async () => {
    const frases = [
      ["quero cortar o cabelo quarta às 10h", /Corte/, /10:00/],
      ["tem como encaixar uma barba sexta 14:30?", /Barba/, /14:30/],
      ["queria marcar corte e barba dia 21 às 9h", /Corte \+ Barba/i, /09:00/],
      ["boa noite, consigo fazer a sobrancelha quinta às 4 da tarde?", /Sobrancelha/, /16:00/],
      ["Marca pra mim um corte na terça que vem ao meio-dia", /Corte/, /12:00/],
    ];
    for (const [frase, servico, hora] of frases) {
      const r = await agendar(novoCliente("Livre Texto"), frase);
      check(`"${frase}" → resumo com serviço e hora certos`, /Confere/.test(text(r)) && servico.test(text(r)) && hora.test(text(r)), text(r));
    }
    const semHora = novoCliente("Sem Hora");
    let r = await talk(semHora, { text: "quero marcar um corte amanhã de manhã" });
    if (/preferência/i.test(text(r))) r = await talk(semHora, tap(r, /Sem preferência/));
    check("\"amanhã de manhã\" (sem hora) mostra só horários da manhã", options(r).length > 0 && options(r).every((o) => !/^\d/.test(o) || Number(o.slice(0, 2)) < 12), text(r) + options(r).join("|"));
    r = await agendar(novoCliente("Sem Marcar"), "pigmentação quinta às 9h");
    check("\"pigmentação quinta às 9h\" (sem a palavra marcar) vira agendamento", /Confere/.test(text(r)) && /Pigmentação/.test(text(r)) && /09:00/.test(text(r)), text(r));
    r = await talk(novoCliente("So Servico"), { text: "queria fazer a barba" });
    check("só o serviço: pula a pergunta do serviço", /preferência|dia/i.test(text(r)) && !/Qual serviço/i.test(text(r)), text(r));
    r = await talk(novoCliente("So Dia"), { text: "tem horário sexta?" });
    check("só o dia: pergunta o serviço", r.at(-1)?.kind === "list" && options(r).includes("Corte"), text(r));
  });

  await scenario("Cliente", "Horário já ocupado: oferece os mais próximos", async () => {
    const a = novoCliente("Ana Primeira");
    const b = novoCliente("Beto Segundo");
    let r = await talk(a, { text: "quero pigmentação quinta às 15h" });
    if (/preferência/i.test(text(r))) r = await talk(a, tap(r, /Pedro/));
    r = await talk(a, tap(r, /^Confirmar$/));
    check("primeiro cliente marca", /Seu horário está marcado/.test(text(r)), text(r));
    r = await talk(b, { text: "quero pigmentação quinta às 15h" });
    if (/preferência/i.test(text(r))) r = await talk(b, tap(r, /Pedro/));
    check("segundo cliente é avisado que 15:00 não tem", /Às 15:00 não tenho/.test(text(r)), text(r));
    check("oferece 2 horários próximos e Ver todos", options(r).length === 3 && options(r).includes("Ver todos"), options(r).join("|"));
    r = await talk(b, tap(r, /Ver todos/));
    check("Ver todos mostra a lista do dia (ou os períodos)", /horário|período/i.test(text(r)) && options(r).length >= 2 && !options(r).includes("15:00"), text(r) + options(r).join("|"));
  });

  await scenario("Cliente", "Dia fechado, data passada e hora fora do expediente", async () => {
    const dom = novoCliente("Dom Fechado");
    let r = await agendar(dom, "quero marcar corte domingo às 10h");
    check("domingo (fechado): avisa que não tem horário e oferece outros dias", /não tenho horário livre|não tem mais horário/i.test(text(r)) && !/Confere/.test(text(r)) && options(r).length > 1, text(r) + options(r).join("|"));
    const c = novoCliente("Tarde Demais");
    r = await agendar(c, "quero barba sábado às 23h");
    check("23h (fora do expediente): não confirma, oferece horários válidos", !/Confere/.test(text(r)) && /não tenho|horário/i.test(text(r)), text(r));
  });

  await scenario("Cliente", "Preços, endereço, horário de funcionamento e agradecimento", async () => {
    const c = novoCliente("Edu Info");
    let r = await talk(c, { text: "quanto custa a barba?" });
    check("preços: lista os serviços com valor e duração", /Barba/.test(text(r)) && /R\$ 35,00/.test(text(r)) && /min/.test(text(r)), text(r));
    check("preços: oferece Agendar", options(r).includes("Agendar"), options(r).join("|"));
    r = await talk(c, { text: "onde vocês ficam?" });
    check("endereço e link do mapa", /Rua Bahia/.test(text(r)) && /maps/.test(text(r)), text(r));
    check("horário de funcionamento por dia, com domingo fechado", /Segunda: 09:00 às 19:00/.test(text(r)) && /Domingo: fechado/.test(text(r)), text(r));
    r = await talk(c, { text: "aceita cartão?" });
    check("formas de pagamento", /cartão/i.test(text(r)), text(r));
    r = await talk(c, { text: "valeu, obrigado!" });
    check("agradecimento recebe resposta curta, sem menu", r.length === 1 && r[0].kind === "text", JSON.stringify(r.map((m) => [m.kind, m.text])));
  });

  await scenario("Cliente", "Consultar e cancelar sem ter nada marcado", async () => {
    const c = novoCliente("Fabi Vazia");
    let r = await talk(c, { text: "tenho algum horário marcado?" });
    check("avisa que não tem nada e oferece Agendar", /não tem nenhum horário/.test(text(r)) && options(r).includes("Agendar"), text(r));
    r = await talk(c, { text: "quero cancelar meu horário" });
    check("cancelar sem horário: não quebra, oferece Agendar ou Atendente", /Não achei nenhum horário/.test(text(r)), text(r));
    r = await talk(c, { text: "quero remarcar" });
    check("remarcar sem horário: idem", /Não achei nenhum horário|não tem nenhum/.test(text(r)), text(r));
  });

  await scenario("Cliente", "Remarcar pelo botão, trocando dia e hora", async () => {
    const c = novoCliente("Gabi Remarca");
    await agendarEConfirmar(c, "corte quarta às 11h");
    let r = await talk(c, { text: "meus horários" });
    check("lista o horário com botões Remarcar / Cancelar / Agendar outro", options(r).join("|") === "Remarcar|Cancelar|Agendar outro", text(r) + options(r).join("|"));
    r = await talk(c, tap(r, /^Remarcar$/));
    check("remarcar pergunta o que mudar: dia/horário ou serviço", options(r).includes("Dia ou horário") && /O que você quer mudar/.test(text(r)), text(r) + options(r).join("|"));
    r = await talk(c, { text: "sexta às 17h" });
    if (/preferência/i.test(text(r))) r = await talk(c, tap(r, /Sem preferência/));
    check("mostra o novo horário para confirmar", /Novo horário/.test(text(r)) && /17:00/.test(text(r)), text(r));
    r = await talk(c, tap(r, /^Confirmar$/));
    check("remarcado", /Remarquei/.test(text(r)) && /17:00/.test(text(r)), text(r));
    r = await talk(c, { text: "meus horários" });
    check("fica só o horário novo", /17:00/.test(text(r)) && !/11:00/.test(text(r)), text(r));
    r = await talk(c, { text: "preciso remarcar para sábado às 9h" });
    if (/preferência/i.test(text(r))) r = await talk(c, tap(r, /Sem preferência/));
    check("\"remarcar para sábado às 9h\" numa frase só vai direto ao resumo", /Novo horário/.test(text(r)) && /09:00/.test(text(r)) && /Sábado/.test(text(r)), text(r));
    r = await talk(c, tap(r, /^Confirmar$/));
    r = await talk(c, { text: "quero remarcar" });
    r = await talk(c, tap(r, /Dia ou horário/));
    check("botão Dia ou horário pergunta o novo dia", /dia/i.test(text(r)) && options(r).includes("Outra data"), text(r));
  });

  await scenario("Cliente", "Cancelar em cima da hora respeita o prazo configurado", async () => {
    await setSettings({ cancellation: { minHoursBefore: 72 } });
    const c = novoCliente("Hugo Prazo");
    await agendarEConfirmar(c, "barba amanhã às 18h");
    let r = await talk(c, { text: "preciso cancelar" });
    check("dentro do prazo mínimo: o bot não cancela e oferece atendente", /menos de 72h/.test(text(r)) && options(r).includes("Falar com atendente"), text(r));
    r = await talk(c, { text: "quero remarcar" });
    check("remarcar também respeita o prazo", /menos de 72h|atendente/i.test(text(r)), text(r));
    await setSettings({ cancellation: { minHoursBefore: 2 } });
    r = await talk(c, { text: "preciso cancelar" });
    r = await talk(c, tap(r, /Sim, cancelar/));
    check("com o prazo normal, cancela", /Cancelado/.test(text(r)), text(r));
  });

  await scenario("Cliente", "Mensagens que não são texto (áudio, figurinha, localização, foto, PDF)", async () => {
    const c = novoCliente("Iara Midia");
    let r = await talk(c, { raw: { type: "audio", audio: { voice: true } }, file: { mime: "audio/ogg", base64: "T2dnUw==" } });
    check("áudio: pede para escrever", /não consigo ouvir áudios/.test(text(r)), text(r));
    r = await talk(c, { raw: { type: "sticker", sticker: { animated: false } }, file: { mime: "image/webp", base64: "UklGRg==" } });
    check("figurinha: responde com o menu", r.at(-1)?.kind === "list", JSON.stringify(r.map((m) => m.kind)));
    r = await talk(c, { raw: { type: "location", location: { latitude: -22.2, longitude: -49.9 } } });
    check("localização: responde com o menu", r.at(-1)?.kind === "list", JSON.stringify(r.map((m) => m.kind)));
    r = await talk(c, { image: PNG });
    check("foto sem pagamento pendente: agradece e mostra o menu", /Recebi seu arquivo/.test(text(r)), text(r));
    r = await talk(c, { raw: { type: "document", document: { filename: "doc.pdf" } }, file: { mime: "application/pdf", base64: PDF_B64 } });
    check("PDF sem pagamento pendente: idem", /Recebi seu arquivo/.test(text(r)), text(r));
    r = await talk(c, { raw: { type: "reaction", reaction: { message_id: "wamid.x", emoji: "👍" } } });
    check("reação (👍): não quebra", r.length <= 1, JSON.stringify(r.map((m) => m.kind)));
    r = await talk(c, { raw: { type: "contacts", contacts: [{ name: { formatted_name: "Fulano" } }] } });
    check("cartão de contato: não quebra", r.length <= 1, JSON.stringify(r.map((m) => m.kind)));
  });

  await scenario("Cliente", "Mensagem sem sentido, emoji e número fora da lista", async () => {
    const c = novoCliente("Joao Confuso");
    let r = await talk(c, { text: "asdf qwer zxcv" });
    check("texto sem sentido: mostra o menu", r.at(-1)?.kind === "list", text(r));
    r = await talk(c, { text: "😀" });
    check("só emoji: mostra o menu", r.at(-1)?.kind === "list", text(r));
    r = await talk(c, { text: "99" });
    check("número que não existe no menu: não quebra", r.length >= 1, text(r));
    r = await talk(c, { text: "x".repeat(3000) });
    check("mensagem gigante (3000 letras): não quebra", r.length >= 1, text(r).slice(0, 200));
  });

  await scenario("Cliente", "Desistir no meio e trocar de assunto", async () => {
    const c = novoCliente("Kiko Desiste");
    let r = await agendar(c, "corte sábado às 10h");
    r = await talk(c, tap(r, /^Cancelar$/));
    check("Cancelar no resumo: não marca nada", !/Seu horário está marcado/.test(text(r)), text(r));
    r = await talk(c, { text: "meus horários" });
    check("nada ficou marcado", /não tem nenhum horário/.test(text(r)), text(r));
    r = await talk(c, { text: "quero agendar" });
    r = await talk(c, { text: "quanto custa?" });
    check("no meio do agendamento, perguntar o preço é respondido", /R\$/.test(text(r)), text(r));
    r = await agendar(c, "barba sábado às 10h");
    r = await talk(c, tap(r, /Outro horário/));
    check("Outro horário volta a escolher dia/horário", /dia|horário/i.test(text(r)) && !/Seu horário está marcado/.test(text(r)), text(r));
  });

  await scenario("Cliente", "Atendente humano: bot pausa, dono responde pelo painel, bot volta", async () => {
    const c = novoCliente("Lia Humano");
    const ownerSince = await lastSeq(OWNER.waId);
    let r = await talk(c, { text: "quero falar com uma pessoa" });
    check("cliente é avisado", /chamei alguém/.test(text(r)), text(r));
    const n = await waitBot(OWNER, ownerSince);
    check("dono recebe o chamado com o botão Reativar bot", /pediu para falar com uma pessoa/.test(text(n)) && options(n).includes("Reativar bot"), text(n));
    const s2 = await lastSeq(OWNER.waId);
    r = await talk(c, { text: "é sobre um pacote mensal" }, { timeoutMs: 5000 });
    check("bot fica quieto com o cliente", r.length === 0, text(r));
    const relay = await waitBot(OWNER, s2, { timeoutMs: 6000 });
    check("mensagem do cliente é repassada ao dono", /pacote mensal/.test(text(relay)), text(relay));
    const since = await lastSeq(c.waId);
    const rep = await panel("POST", `/conversations/${encodeURIComponent("+" + c.waId)}/reply`, { text: "Oi Lia, aqui é o Rafael. Temos pacote sim!" });
    check("painel envia a resposta humana (200)", rep.status === 200, JSON.stringify(rep));
    const got = await waitBot(c, since, { timeoutMs: 8000 });
    check("cliente recebe a resposta do dono pelo número do estabelecimento", /Temos pacote sim/.test(text(got)), text(got));
    const res = await panel("POST", `/conversations/${encodeURIComponent("+" + c.waId)}/resume`);
    check("painel reativa o bot (200)", res.status === 200, JSON.stringify(res));
    r = await talk(c, { text: "menu" });
    check("bot volta a responder", r.at(-1)?.kind === "list", text(r));
  });

  await scenario("Cliente", "Bot pausado para todos: recado único de ausência", async () => {
    await setSettings({ agentEnabled: false });
    const c = novoCliente("Mara Pausa");
    let r = await talk(c, { text: "oi, quero marcar" });
    check("manda um recado de que vão responder", /vamos responder assim que possível/.test(text(r)), text(r));
    r = await talk(c, { text: "alguém aí?" }, { timeoutMs: 5000 });
    check("não repete o recado a cada mensagem", r.length === 0, text(r));
    await setSettings({ agentEnabled: true });
    r = await talk(c, { text: "oi" });
    check("religado, volta a atender", r.at(-1)?.kind === "list", text(r));
  });

  await scenario("Cliente", "Outro tipo de negócio: clínica muda o vocabulário", async () => {
    await setSettings({ segment: "clinica" });
    const c = novoCliente("Nina Clinica");
    let r = await talk(c, { text: "quero agendar" });
    check("pergunta o \"atendimento\" (não \"serviço\")", /atendimento/i.test(text(r)), text(r));
    r = await talk(c, tap(r, /^Corte$/));
    check("pergunta o \"profissional\" (não \"barbeiro\")", /profissional/i.test(text(r)) && !/barbeiro/i.test(text(r)), text(r));
    await setSettings({ segment: "barbearia" });
    r = await talk(novoCliente("Otto Barbearia"), { text: "quero corte" });
    check("barbearia volta a falar \"barbeiro\"", /barbeiro/i.test(text(r)), text(r));
  });
}

// ================================================================== PAGAMENTO
if (runs("pagamento")) {
  await scenario("Pagamento", "Sinal opcional: pagar no local", async () => {
    await setSettings({ prepayment: { mode: "optional" } });
    const c = novoCliente("Paulo Local");
    let r = await agendarEConfirmar(c, "corte quarta às 9h");
    check("depois de marcar, oferece Sinal / Tudo com desconto / Pagar no local", options(r).some((o) => /^Sinal R\$ 13,50$/.test(o)) && options(r).some((o) => /^Tudo R\$ 40,50$/.test(o)) && options(r).some((o) => /local/i.test(o)), options(r).join("|"));
    check("explica o desconto de 10% (R$ 40,50 em vez de R$ 45,00)", /10%/.test(text(r)) && /R\$ 40,50/.test(text(r)) && /R\$ 45,00/.test(text(r)), text(r));
    r = await talk(c, tap(r, /local/i));
    check("pagar no local: mantém o horário sem cobrar", r.length >= 1 && !/000201/.test(text(r)), text(r));
  });

  await scenario("Pagamento", "Pagamento total com desconto, comprovante em PDF, dono recusa e depois aprova pelo painel", async () => {
    const c = novoCliente("Rita Total");
    let r = await agendarEConfirmar(c, "corte quarta às 9h30");
    const ownerSince = await lastSeq(OWNER.waId);
    r = await talk(c, tap(r, /^Tudo/));
    const pix = r.find((m) => /^000201/.test(m.text))?.text ?? "";
    check("manda o Pix copia e cola numa mensagem só com o código", /^000201/.test(pix) && !/\s/.test(pix.replace(/ /g, "")), text(r));
    check("valor do Pix é o total com desconto (40.50)", /540540\.50/.test(pix), pix);
    check("Pix tem a chave, o nome e a cidade do recebedor", /br\.gov\.bcb\.pix/i.test(pix) && /Barbearia Navalha/.test(pix) && /Marilia/i.test(pix), pix);
    check("manda o QR Code como imagem", r.some((m) => m.kind === "image" && /^https?:\/\//.test(m.link ?? "")), JSON.stringify(r.map((m) => [m.kind, m.link])));
    r = await talk(c, { text: "já paguei" });
    check("\"já paguei\" sem comprovante: pede a foto", /foto/.test(text(r)), text(r));
    r = await talk(c, { raw: { type: "document", document: { filename: "comprovante.pdf" } }, file: { mime: "application/pdf", base64: PDF_B64 } });
    check("comprovante em PDF é aceito", /Recebi seu comprovante/.test(text(r)), text(r));
    let toOwner = await waitBot(OWNER, ownerSince);
    check("dono recebe o comprovante com Aprovar / Recusar", options(toOwner).includes("Aprovar") && options(toOwner).includes("Recusar"), text(toOwner));
    r = await talk(c, { text: "e aí, confirmou?" });
    check("cliente pergunta de novo: bot diz que está em conferência", /em conferência/.test(text(r)), text(r));
    const since = await lastSeq(c.waId);
    const rej = await talk(OWNER, tap(toOwner, /Recusar/));
    check("dono recusa", /Recusado/.test(text(rej)), text(rej));
    const told = await waitBot(c, since, { timeoutMs: 8000 });
    check("cliente é avisado da recusa e pode mandar de novo", /não conseguimos confirmar|não foi possível confirmar|conferir/i.test(text(told)), text(told));
    r = await talk(c, { image: PNG });
    check("cliente reenvia o comprovante (foto)", /Recebi seu comprovante/.test(text(r)), text(r));
    const pend = await panel("GET", "/payments?status=under_review");
    const mine = (pend.body.data ?? pend.body).find((p) => p.customerPhone === "+" + c.waId);
    check("comprovante aparece no painel (Automação → Comprovantes)", !!mine && mine.kind === "full" && mine.amountCents === 4050, JSON.stringify(pend.body).slice(0, 300));
    const img = mine?.receiptUrl ? await fetch(mine.receiptUrl) : undefined;
    check("link do comprovante abre a imagem (URL assinada)", img?.status === 200 && /image|pdf/.test(img.headers.get("content-type") ?? ""), `${mine?.receiptUrl} -> ${img?.status}`);
    const bad = mine?.receiptUrl ? await fetch(mine.receiptUrl.replace(/([?&]s=)[^&]{6}/, "$1AAAAAA")) : undefined;
    check("link com assinatura adulterada é recusado (403)", bad?.status === 403, String(bad?.status));
    const late = mine?.receiptUrl ? await fetch(mine.receiptUrl.replace(/([?&]e=)\d+/, "$19999999999")) : undefined;
    check("link com validade adulterada é recusado (403)", late?.status === 403, String(late?.status));
    const other = mine?.receiptUrl ? await fetch(mine.receiptUrl.replace(/receipts\/[0-9a-f-]{8}/, "receipts/00000000")) : undefined;
    check("assinatura de um comprovante não abre outro (403)", other?.status === 403, String(other?.status));
    const s2 = await lastSeq(c.waId);
    const ap = await panel("POST", `/payments/${mine.id}/approve`);
    check("dono aprova pelo painel (200)", ap.status === 200, JSON.stringify(ap));
    const ok = await waitBot(c, s2, { timeoutMs: 8000 });
    check("cliente recebe a confirmação do pagamento", /Pagamento de R\$ 40,50 confirmado/.test(text(ok)), text(ok));
    const again = await panel("POST", `/payments/${mine.id}/approve`);
    check("aprovar duas vezes não manda mensagem em dobro", (await inbox(c.waId, s2)).filter((m) => /confirmado/.test(m.text)).length === 1, JSON.stringify(again));
  });

  await scenario("Pagamento", "Sinal obrigatório vence: horário é liberado e o cliente é avisado", async () => {
    await setSettings({ prepayment: { mode: "required" } });
    const c = novoCliente("Saulo Vence");
    let r = await agendarEConfirmar(c, "barba quarta às 10h30");
    check("obrigatório: só oferece Sinal ou Tudo (sem pagar no local)", options(r).length === 2 && !options(r).some((o) => /local/i.test(o)), options(r).join("|"));
    check("avisa o prazo para pagar", /30 minutos/.test(text(r)), text(r));
    r = await talk(c, tap(r, /^Sinal/));
    check("gera o Pix do sinal (30% de R$ 35,00 = 10.50)", r.some((m) => /540510\.50/.test(m.text)), text(r));
    sql(`UPDATE payment SET expires_at = now() - interval '1 minute' WHERE customer_phone = '+${c.waId}' AND status = 'pending'`);
    const since = await lastSeq(c.waId);
    await tick();
    const told = await waitBot(c, since, { timeoutMs: 12000 });
    check("cliente é avisado que o prazo acabou, com botão para agendar de novo", /prazo do sinal acabou/.test(text(told)) && options(told).some((o) => /Agendar/.test(o)), text(told));
    r = await talk(c, { text: "meus horários" });
    check("o horário foi liberado", /não tem nenhum horário/.test(text(r)), text(r));
    r = await agendar(novoCliente("Tais Pega"), "barba quarta às 10h30");
    check("outro cliente consegue o horário liberado", /Confere/.test(text(r)) && /10:30/.test(text(r)), text(r));
    await setSettings({ prepayment: { mode: "off" } });
  });
}

// ================================================================== LEMBRETE
if (runs("lembrete")) {
  await scenario("Lembrete", "Lembrete dentro da janela de 24h: botões Confirmo / Remarcar / Cancelar", async () => {
    const c = novoCliente("Ugo Lembrete");
    const r0 = await agendarEConfirmar(c, "corte amanhã às 16h");
    check("agendado para amanhã", /Seu horário está marcado/.test(text(r0)), text(r0));
    // lembrete "N horas antes": escolhe N para o horário cair na janela agora
    const appts = (await apiCall("GET", `/api/appointments?from=${new Date().toISOString()}&status=SCHEDULED`)).body;
    const mine = (Array.isArray(appts) ? appts : appts.data ?? []).find((a) => a.customer?.phone === "+" + c.waId);
    const hours = Math.ceil((Date.parse(mine.startAt) - Date.now()) / 3600_000);
    await setSettings({ reminders: { enabled: true, hoursBefore: [hours] } });
    const since = await lastSeq(c.waId);
    await tick();
    let rem = await waitBot(c, since, { timeoutMs: 15000 });
    check(`lembrete chega ${hours}h antes, com os 3 botões`, /Lembrete do seu horário/.test(text(rem)) && options(rem).join("|") === "Confirmo|Remarcar|Cancelar", text(rem) + options(rem).join("|"));
    check("dentro da janela vai como mensagem interativa (não modelo)", rem.at(-1)?.kind === "buttons", String(rem.at(-1)?.kind));
    const s2 = await lastSeq(c.waId);
    await tick();
    check("o mesmo lembrete não é enviado duas vezes", (await inbox(c.waId, s2)).length === 0, "repetiu");
    let r = await talk(c, tap(rem, /Confirmo/));
    check("Confirmo: presença confirmada", /Presença confirmada/.test(text(r)), text(r));
    const after = (await apiCall("GET", `/api/appointments/${mine.id}`)).body;
    check("na agenda o horário vira CONFIRMADO", after.status === "CONFIRMED", after.status);
    r = await talk(c, { text: "2" });
    check("depois da resposta, um \"2\" solto não aciona o botão antigo Remarcar", !/Novo horário|O que você quer mudar|Qual dia/.test(text(r)), text(r));
  });

  await scenario("Lembrete", "Lembrete fora da janela de 24h sai como modelo aprovado e os botões funcionam", async () => {
    const c = novoCliente("Vera Modelo");
    await agendarEConfirmar(c, "barba amanhã às 17h");
    const appts = (await apiCall("GET", `/api/appointments?from=${new Date().toISOString()}&status=SCHEDULED`)).body;
    const mine = (Array.isArray(appts) ? appts : appts.data ?? []).find((a) => a.customer?.phone === "+" + c.waId);
    const hours = Math.ceil((Date.parse(mine.startAt) - Date.now()) / 3600_000);
    await setSettings({ reminders: { enabled: true, hoursBefore: [hours] } });
    await age(c, 30); // cliente não escreve há 30 horas
    const since = await lastSeq(c.waId);
    await tick();
    const rem = await waitBot(c, since, { timeoutMs: 15000 });
    check("fora da janela usa o modelo convexa_lembrete", rem.at(-1)?.kind === "template" && rem.at(-1)?.template === "convexa_lembrete", JSON.stringify(rem.map((m) => [m.kind, m.template])));
    check("texto do modelo preenchido com nome, serviço, dia, hora e profissional", /Vera/.test(text(rem)) && /Barba/.test(text(rem)) && /17:00/.test(text(rem)), text(rem));
    let r = await talk(c, tap(rem, /Remarcar/));
    check("botão Remarcar do modelo abre a remarcação", /dia|mudar/i.test(text(r)), text(r));
    r = await talk(c, { text: "menu" });
    const rem2 = [{ ...rem.at(-1) }];
    r = await talk(c, tap(rem2, /Cancelar/));
    check("botão Cancelar do modelo pede confirmação", /Cancelar Barba/.test(text(r)) && options(r).includes("Sim, cancelar"), text(r));
    r = await talk(c, { text: "1" });
    check("\"1\" confirma o cancelamento (resposta por número)", /Cancelado/.test(text(r)), text(r));
    await setSettings({ reminders: { enabled: true, hoursBefore: [24, 2] } });
  });

  await scenario("Lembrete", "Lembretes desligados: nada é enviado", async () => {
    const c = novoCliente("Wal Silencio");
    await agendarEConfirmar(c, "corte amanhã às 15h");
    const appts = (await apiCall("GET", `/api/appointments?from=${new Date().toISOString()}&status=SCHEDULED`)).body;
    const mine = (Array.isArray(appts) ? appts : appts.data ?? []).find((a) => a.customer?.phone === "+" + c.waId);
    const hours = Math.ceil((Date.parse(mine.startAt) - Date.now()) / 3600_000);
    await setSettings({ reminders: { enabled: false, hoursBefore: [hours] } });
    const since = await lastSeq(c.waId);
    await tick();
    await sleep(4000);
    check("com lembretes desligados o cliente não recebe nada", (await inbox(c.waId, since)).length === 0, text(await inbox(c.waId, since)));
    await setSettings({ reminders: { enabled: true, hoursBefore: [24, 2] } });
  });
}

// ================================================================== DONO
if (runs("dono")) {
  // três clientes marcados amanhã, para o dono ter o que consultar
  const c1 = novoCliente("Alice Souza");
  const c2 = novoCliente("Bruno Lima");
  const c3 = novoCliente("Caio Reis");
  await scenario("Dono", "Preparo: três clientes marcam para amanhã", async () => {
    let r = await talk(c1, { text: "corte amanhã às 10h com o Lucas" });
    r = await talk(c1, tap(r, /^Confirmar$/));
    check("Alice marca corte 10h com Lucas (\"com o Lucas\" na frase escolhe o profissional)", /Seu horário está marcado/.test(text(r)) && /Lucas/.test(text(r)), text(r));
    r = await talk(c2, { text: "barba amanhã às 14h com o Pedro" });
    r = await talk(c2, tap(r, /^Confirmar$/));
    check("Bruno marca barba 14h com Pedro", /Seu horário está marcado/.test(text(r)) && /Pedro/.test(text(r)), text(r));
    r = await talk(c3, { text: "corte amanhã às 17h30 com o Lucas" });
    r = await talk(c3, tap(r, /^Confirmar$/));
    check("Caio marca corte 17h30 com Lucas", /Seu horário está marcado/.test(text(r)), text(r));
  });

  await scenario("Dono", "Avisos de novo agendamento chegam ao dono", async () => {
    const all = await inbox(OWNER.waId, 0);
    const novos = all.filter((m) => /Novo agendamento/.test(m.text));
    check("dono foi avisado dos três agendamentos, com nome, serviço e horário", ["Alice", "Bruno", "Caio"].every((n) => novos.some((m) => m.text.includes(n))), text(novos.slice(-4)));
    check("aviso traz o telefone formatado do cliente", /\(14\) 9\d{4}-\d{4}/.test(text(novos.slice(-3))), text(novos.slice(-3)));
  });

  await scenario("Dono", "Menu do dono em lista e escolha por número", async () => {
    let r = await talk(OWNER, { text: "menu" });
    check("menu em lista com Agenda e Gestão", r.at(-1)?.kind === "list" && ["Agenda de hoje", "Agenda de amanhã", "Próximo cliente", "Horários livres hoje", "Faturamento do mês", "Bloquear horário", "Avisar clientes", "Comprovantes", "Pausar o bot", "Testar como cliente"].every((o) => options(r).includes(o)), options(r).join("|"));
    check("lista do dono respeita o limite de 10 linhas da Meta", options(r).length <= 10, String(options(r).length));
    r = await talk(OWNER, { text: "2" });
    check("\"2\" abre a Agenda de amanhã", /Agenda de/.test(text(r)) && /Alice/.test(text(r)), text(r));
  });

  await scenario("Dono", "Consultas: agenda, próximo, horários livres, faturamento", async () => {
    let r = await talk(OWNER, { text: "o que eu tenho amanhã?" });
    check("agenda de amanhã lista os clientes em ordem de horário", /\d+ clientes/.test(text(r)) && text(r).indexOf("Alice") < text(r).indexOf("Bruno") && text(r).indexOf("Bruno") < text(r).indexOf("Caio"), text(r));
    const times = [...text(r).matchAll(/\*(\d{2}:\d{2})\*/g)].map((m) => m[1]);
    check("horários em ordem crescente e com o total previsto em reais", times.length >= 3 && times.join() === [...times].sort().join() && /R\$ \d+,\d{2}\)/.test(text(r)), text(r));
    r = await talk(OWNER, { text: "quem é o próximo cliente?" });
    check("próximo cliente com nome, serviço, hora e telefone", /Próximo/.test(text(r)) && /\(14\)/.test(text(r)), text(r));
    r = await talk(OWNER, { text: "tenho horário livre amanhã?" });
    check("horários livres por profissional", /Horários livres/.test(text(r)) && /Lucas/.test(text(r)) && /Pedro/.test(text(r)), text(r));
    check("a janela do Lucas pula o corte das 10h", /Lucas\*?: 09:00–10:00/.test(text(r)), text(r));
    r = await talk(OWNER, { text: "quanto faturei esse mês?" });
    check("faturamento do mês com realizado, a receber e previsto", /Faturamento/.test(text(r)) && /Realizado/.test(text(r)) && /A receber/.test(text(r)), text(r));
    r = await talk(OWNER, { text: "faturamento de hoje" });
    check("faturamento de hoje", /Faturamento/.test(text(r)) && /hoje/i.test(text(r)), text(r));
    r = await talk(OWNER, { text: "qual meu lucro essa semana?" });
    check("lucro da semana (usa o custo médio do painel)", /Lucro estimado|custo médio/i.test(text(r)), text(r));
    r = await talk(OWNER, { text: "agenda de domingo" });
    check("dia sem clientes: avisa que não tem ninguém", /não tem nenhum cliente/.test(text(r)), text(r));
  });

  await scenario("Dono", "Bloqueio sem conflito e Desfazer", async () => {
    let r = await talk(OWNER, { text: "bloqueia sexta das 12 às 13" });
    if (/de quem/i.test(text(r))) r = await talk(OWNER, tap(r, /De todos/));
    check("bloqueia e oferece Desfazer", /Pronto, bloqueei sexta-feira/.test(text(r)) && /12:00 às 13:00/.test(text(r)) && options(r).includes("Desfazer"), text(r));
    let c = await agendar(novoCliente("Dani Bloq"), "corte sexta às 12h");
    check("cliente não consegue marcar no horário bloqueado", /Às 12:00 não tenho/.test(text(c)), text(c));
    r = await talk(OWNER, tap(r, /Desfazer/));
    check("Desfazer remove o bloqueio", /Bloqueio desfeito/.test(text(r)), text(r));
    c = await agendar(novoCliente("Davi Livre"), "corte sexta às 12h");
    check("depois de desfazer, o horário volta a ficar livre", /Confere/.test(text(c)) && /12:00/.test(text(c)), text(c));
  });

  await scenario("Dono", "\"Amanhã ao meio-dia vou estar ocupado\": pergunta até quando e reajusta", async () => {
    let r = await talk(OWNER, { text: "amanhã às 14h vou estar ocupado, reajusta minha agenda" });
    check("só com a hora de início, pergunta até que horas", /Até que horas a partir das 14:00/.test(text(r)), text(r));
    r = await talk(OWNER, { text: "até as 15h" });
    if (/de quem/i.test(text(r))) r = await talk(OWNER, tap(r, /De todos/));
    check("bloqueia e acha o Bruno (barba 14h) no intervalo", /Bloqueei/.test(text(r)) && /Bruno/.test(text(r)) && /1 cliente/.test(text(r)), text(r));
    check("oferece Pedir p/ remarcar, Cancelar e avisar, Deixar como está", options(r).join("|") === "Pedir p/ remarcar|Cancelar e avisar|Deixar como está", options(r).join("|"));
    const since = await lastSeq(c2.waId);
    r = await talk(OWNER, tap(r, /remarcar/i));
    check("dono é informado do envio, com o nome do cliente", /Mandei mensagem para Bruno/.test(text(r)), text(r));
    const ask = await waitBot(c2, since, { timeoutMs: 10000 });
    check("Bruno recebe o pedido de remarcação com Escolher horário / Cancelar", /não vai poder ser mantido/.test(text(ask)) && options(ask).includes("Escolher horário"), text(ask));
    const os = await lastSeq(OWNER.waId);
    let c = await talk(c2, tap(ask, /Escolher horário/));
    c = await talk(c2, { text: "amanhã às 16h" });
    if (/preferência/i.test(text(c))) c = await talk(c2, tap(c, /Sem preferência/));
    c = await talk(c2, tap(c, /^Confirmar$/));
    check("Bruno remarca para 16h", /Remarquei/.test(text(c)) && /16:00/.test(text(c)), text(c));
    const done = await waitBot(OWNER, os, { timeoutMs: 8000 });
    check("dono é avisado que Bruno remarcou e que todos responderam", /Bruno.*remarcou/.test(text(done)) && /Todos os clientes afetados já responderam/.test(text(done)), text(done));
  });

  await scenario("Dono", "Sair mais cedo: cancelar e avisar quem estava marcado", async () => {
    let r = await talk(OWNER, { text: "amanhã vou sair mais cedo, às 17h" });
    if (/de quem/i.test(text(r))) r = await talk(OWNER, tap(r, /De todos/));
    check("bloqueia a partir das 17h e acha o Caio (17h30)", /a partir das 17:00/.test(text(r)) && /Caio/.test(text(r)), text(r));
    const since = await lastSeq(c3.waId);
    r = await talk(OWNER, tap(r, /Cancelar e avisar/));
    check("confirma o cancelamento e o aviso", /Cancelei o agendamento e avisei Caio/.test(text(r)), text(r));
    const told = await waitBot(c3, since, { timeoutMs: 10000 });
    check("Caio recebe o aviso do cancelamento com botão para remarcar", /precisamos cancelar/.test(text(told)) && options(told).some((o) => /Remarcar/.test(o)), text(told));
    const mine = await talk(c3, { text: "meus horários" });
    check("o horário do Caio foi cancelado na agenda", /não tem nenhum horário/.test(text(mine)), text(mine));
  });

  await scenario("Dono", "Chegar mais tarde e folga", async () => {
    let r = await talk(OWNER, { text: "quinta só chego às 11" });
    if (/de quem/i.test(text(r))) r = await talk(OWNER, tap(r, /De todos/));
    check("chegar mais tarde bloqueia até as 11h", /até as 11:00/.test(text(r)), text(r));
    r = await talk(OWNER, { text: "sábado não vou abrir" });
    if (/de quem/i.test(text(r))) r = await talk(OWNER, tap(r, /De todos/));
    check("folga bloqueia o dia todo", /o dia todo/.test(text(r)), text(r));
    const c = await agendar(novoCliente("Enzo Folga"), "corte sábado às 10h");
    check("cliente não consegue marcar no dia de folga", !/Confere/.test(text(c)), text(c));
  });

  await scenario("Dono", "Avisar os clientes do dia: confirma antes de enviar", async () => {
    let r = await talk(OWNER, { text: "avisa meus clientes de amanhã que vamos atender na sala 2" });
    check("mostra a mensagem, quantos e quem vai receber, com Enviar / Cancelar", /sala 2/i.test(text(r)) && options(r).includes("Enviar") && /\d+ clientes/.test(text(r)) && /Alice/.test(text(r)) && /Bruno/.test(text(r)), text(r));
    const quantos = Number(text(r).match(/(\d+) clientes/)?.[1]);
    const s1 = await lastSeq(c1.waId);
    const s2 = await lastSeq(c2.waId);
    r = await talk(OWNER, tap(r, /^Enviar$/));
    check("confirma o envio para a mesma quantidade anunciada", new RegExp(`Aviso enviado para ${quantos} clientes`).test(text(r)), text(r));
    const a = await waitBot(c1, s1, { timeoutMs: 10000 });
    const b = await waitBot(c2, s2, { timeoutMs: 6000 });
    check("Alice e Bruno recebem o aviso com o texto do dono", /sala 2/i.test(text(a)) && /sala 2/i.test(text(b)), text(a) + text(b));
    check("aviso tem os botões Ok, entendi e Remarcar", options(a).some((o) => /Ok/.test(o)) && options(a).some((o) => /Remarcar/.test(o)), options(a).join("|"));
    const ok = await talk(c1, tap(a, /Ok/));
    check("\"Ok, entendi\" recebe um obrigado, sem menu", ok.length === 1 && /Obrigado/.test(text(ok)), text(ok));
    r = await talk(OWNER, { text: "avisa os clientes de amanhã que vou atrasar" });
    r = await talk(OWNER, tap(r, /Cancelar/));
    check("Cancelar não envia nada", /não enviei nada/.test(text(r)), text(r));
    r = await talk(OWNER, { text: "avisa meus clientes de domingo que estaremos fechados" });
    check("dia sem clientes: avisa que não há ninguém para avisar", /Não tem cliente marcado/.test(text(r)), text(r));
  });

  await scenario("Dono", "Cancelar o horário de um cliente pelo nome", async () => {
    let r = await talk(OWNER, { text: "cancela o horário da Alice amanhã" });
    check("acha o agendamento e pede confirmação", /Cancelar Corte de \*Alice/.test(text(r)) && options(r).length >= 2, text(r) + options(r).join("|"));
    const since = await lastSeq(c1.waId);
    r = await talk(OWNER, tap(r, /Sim|Cancelar/));
    check("cancela e avisa o cliente", /Cancelado e cliente avisado/.test(text(r)), text(r));
    const told = await waitBot(c1, since, { timeoutMs: 10000 });
    check("Alice recebe o aviso", told.length >= 1 && /cancel/i.test(text(told)), text(told));
    r = await talk(OWNER, { text: "cancela o horário do Zózimo amanhã" });
    check("nome que não existe: avisa que não achou", /Não achei esse agendamento/.test(text(r)), text(r));
  });

  await scenario("Dono", "Comprovantes pendentes, pausar e ativar o bot, modo cliente", async () => {
    let r = await talk(OWNER, { text: "tem comprovante pendente?" });
    check("sem pendências: responde que não há", /Nenhum comprovante esperando/.test(text(r)), text(r));
    r = await talk(OWNER, { text: "pausa o bot" });
    check("pausa o bot", /Bot pausado/.test(text(r)), text(r));
    let c = await talk(novoCliente("Fred Pausado"), { text: "oi" });
    check("com o bot pausado o cliente recebe só o recado de ausência", /vamos responder assim que possível/.test(text(c)), text(c));
    r = await talk(OWNER, { text: "liga o bot" });
    check("ativa o bot", /Bot ativado/.test(text(r)), text(r));
    r = await talk(OWNER, { text: "modo cliente" });
    check("entra no modo cliente por 30 minutos", /Modo cliente/.test(text(r)), text(r));
    r = await talk(OWNER, { text: "oi" });
    check("no modo cliente o dono vê o menu de cliente", options(r).includes("Agendar horário"), options(r).join("|"));
    r = await talk(OWNER, { text: "modo dono" });
    check("volta ao modo dono", /De volta ao modo dono/.test(text(r)) && options(r).includes("Agenda de hoje"), text(r));
  });

  await scenario("Dono", "Frase não entendida e mensagem que não é texto", async () => {
    let r = await talk(OWNER, { text: "abracadabra pé de cabra" });
    check("não entendeu: mostra o menu do dono", /Não entendi/.test(text(r)) && r.at(-1)?.kind === "list", text(r));
    r = await talk(OWNER, { raw: { type: "audio", audio: { voice: true } }, file: { mime: "audio/ogg", base64: "T2dnUw==" } });
    check("áudio do dono: explica que entende texto e botões", /texto e os botões/.test(text(r)), text(r));
  });

  await scenario("Dono", "Dono fora da janela de 24h recebe aviso por modelo aprovado", async () => {
    await age(OWNER, 30);
    const since = await lastSeq(OWNER.waId);
    const c = novoCliente("Gil Janela");
    await agendarEConfirmar(c, "corte quinta às 15h");
    const n = await waitBot(OWNER, since, { timeoutMs: 10000 });
    check("aviso de novo agendamento sai como modelo convexa_aviso_dono", n.at(-1)?.kind === "template" && n.at(-1)?.template === "convexa_aviso_dono", JSON.stringify(n.map((m) => [m.kind, m.template, m.text])));
    check("modelo traz o conteúdo do aviso numa linha só", /Novo agendamento: Gil Janela/.test(text(n)) && !/\n/.test(n.at(-1)?.raw?.template?.components?.[0]?.parameters?.[1]?.text ?? ""), text(n));
    const r = await talk(OWNER, tap(n, /Abrir menu/));
    check("botão Abrir menu do modelo abre o menu do dono", options(r).includes("Agenda de hoje"), options(r).join("|"));
  });
}

// ================================================================== ROBUSTEZ
if (runs("robustez")) {
  const KEY = process.env.AUTOMACAO_KEY;

  await scenario("Robustez", "Webhook repetido pela Meta não gera resposta em dobro", async () => {
    const c = novoCliente("Rep Etido");
    await talk(c, { text: "oi" });
    const since = await lastSeq(c.waId);
    const wamid = "wamid.DUP" + Date.now();
    const msg = { type: "text", text: { body: "quanto custa?" } };
    const a = await sim("/api/webhook", { waId: c.waId, name: c.name, message: msg, opts: { wamid } });
    const b = await sim("/api/webhook", { waId: c.waId, name: c.name, message: msg, opts: { wamid } });
    const got = await waitBot(c, since, { timeoutMs: 9000 });
    check("as duas entregas são aceitas (200)", a.status === 200 && b.status === 200, JSON.stringify([a, b]));
    check("o bot responde uma vez só", got.filter((m) => /R\$/.test(m.text)).length === 1, text(got));
  });

  await scenario("Robustez", "Assinatura da Meta: webhook falso é ignorado", async () => {
    const c = novoCliente("Fal Sario");
    await talk(c, { text: "oi" });
    const since = await lastSeq(c.waId);
    const msg = { type: "text", text: { body: "quero agendar" } };
    const bad = await sim("/api/webhook", { waId: c.waId, name: c.name, message: msg, opts: { badSignature: true } });
    const none = await sim("/api/webhook", { waId: c.waId, name: c.name, message: msg, opts: { noSignature: true } });
    await sleep(5000);
    check("webhook com assinatura errada não gera resposta", (await inbox(c.waId, since)).length === 0, text(await inbox(c.waId, since)) + JSON.stringify([bad, none]));
    const direct = await fetch(`${AUTO}/v1/whatsapp/inbound`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: {} }) });
    check("serviço recusa chamada sem a chave do n8n (401)", direct.status === 401, String(direct.status));
    const wrong = await fetch(`${AUTO}/v1/whatsapp/inbound`, { method: "POST", headers: { "Content-Type": "application/json", "x-automacao-key": "x".repeat(40) }, body: JSON.stringify({ payload: {} }) });
    check("serviço recusa chave errada (401)", wrong.status === 401, String(wrong.status));
    const t = await fetch(`${AUTO}/v1/jobs/tick`, { method: "POST" });
    check("relógio recusa chamada sem chave (401)", t.status === 401, String(t.status));
    const send = await fetch(`${N8N}/webhook/convexa-enviar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batches: [{ phoneNumberId: "100000000000001", messages: [{ to: "+" + c.waId, graph: { type: "text", text: { body: "spam" } } }] }] }) });
    await sleep(2500);
    check("webhook de envio do n8n recusa quem não tem a chave", send.status >= 400 && !(await inbox(c.waId, since)).some((m) => /spam/.test(m.text)), String(send.status));
    const r = await talk(c, { text: "menu" });
    check("mensagem legítima continua funcionando", r.at(-1)?.kind === "list", text(r));
  });

  await scenario("Robustez", "Avisos de entrega e leitura (statuses) são ignorados sem erro", async () => {
    const c = novoCliente("Sta Tus");
    await talk(c, { text: "oi" });
    const since = await lastSeq(c.waId);
    const st = (status, extra = {}) => sim("/api/webhook", { waId: c.waId, opts: { statuses: [{ id: "wamid.OUT1", status, timestamp: "1", recipient_id: c.waId, ...extra }] } });
    const r1 = await st("sent");
    const r2 = await st("delivered");
    const r3 = await st("read");
    const r4 = await st("failed", { errors: [{ code: 131047, title: "Re-engagement message" }] });
    await sleep(3000);
    check("os 4 status são aceitos (200)", [r1, r2, r3, r4].every((r) => r.status === 200), JSON.stringify([r1, r2, r3, r4]));
    check("nenhuma mensagem é enviada por causa deles", (await inbox(c.waId, since)).length === 0, text(await inbox(c.waId, since)));
  });

  await scenario("Robustez", "Celular sem o 9º dígito (como o WhatsApp às vezes entrega) é o mesmo cliente", async () => {
    const c = novoCliente("Nono Digito");
    await agendarEConfirmar(c, "corte sexta às 9h");
    const sem9 = c.waId.slice(0, 4) + c.waId.slice(5); // 55 14 9XXXX-XXXX -> 55 14 XXXX-XXXX
    const old = { waId: sem9, name: c.name };
    const since = await lastSeq(sem9);
    await sim("/api/send", { waId: c.waId, name: c.name, text: "meus horários", opts: { fromWaId: sem9 } });
    const r = await waitBot(old, since);
    check("mensagem vinda sem o 9 acha o agendamento do mesmo cliente", /09:00/.test(text(r)) && /Corte/.test(text(r)), text(r));
    check("a resposta vai para o número como o WhatsApp entregou (sem o 9)", r.length > 0, "nada chegou no número sem o 9");
  });

  await scenario("Robustez", "Mensagem sem telefone (usuário com username do WhatsApp): não quebra", async () => {
    const c = novoCliente("User Name");
    await talk(c, { text: "oi" });
    const since = await lastSeq(c.waId);
    await sim("/api/send", { waId: c.waId, name: c.name, text: "oi de novo", opts: { omitFrom: true } });
    await sleep(4000);
    check("sem telefone o bot não consegue responder (limitação registrada no log)", (await inbox(c.waId, since)).length === 0, text(await inbox(c.waId, since)));
    const r = await talk(c, { text: "menu" });
    check("as mensagens seguintes, com telefone, funcionam normalmente", r.at(-1)?.kind === "list", text(r));
  });

  await scenario("Robustez", "Dois clientes confirmam o mesmo horário ao mesmo tempo", async () => {
    const a = novoCliente("Corre Um");
    const b = novoCliente("Corre Dois");
    let ra = await talk(a, { text: "sobrancelha sexta às 15h com o Pedro" });
    let rb = await talk(b, { text: "sobrancelha sexta às 15h com o Pedro" });
    check("os dois chegam ao resumo do mesmo horário", /Confere/.test(text(ra)) && /Confere/.test(text(rb)) && /15:00/.test(text(ra)) && /15:00/.test(text(rb)), text(ra) + text(rb));
    const [fa, fb] = await Promise.all([talk(a, tap(ra, /^Confirmar$/)), talk(b, tap(rb, /^Confirmar$/))]);
    const won = [fa, fb].filter((r) => /Seu horário está marcado/.test(text(r))).length;
    check("só um dos dois fica com o horário", won === 1, text(fa) + "\n=====\n" + text(fb));
    const loser = /Seu horário está marcado/.test(text(fa)) ? fb : fa;
    check("o outro é avisado e recebe outras opções", /acabou de ser|não está mais|ocupado|não tenho/i.test(text(loser)) && options(loser).length > 0, text(loser) + options(loser).join("|"));
  });

  await scenario("Robustez", "Rajada de mensagens do mesmo cliente", async () => {
    const c = novoCliente("Ra Jada");
    await talk(c, { text: "oi" });
    const since = await lastSeq(c.waId);
    await Promise.all(["quero", "marcar", "um corte", "amanhã"].map((t) => sim("/api/send", { waId: c.waId, name: c.name, text: t })));
    const got = await waitBot(c, since, { timeoutMs: 20000, quietMs: 3500 });
    check("o bot responde sem erro (\"algo deu errado\" não aparece)", got.length >= 1 && !/algo deu errado/.test(text(got)), text(got));
    const r = await talk(c, { text: "menu" });
    check("a conversa continua utilizável depois", r.at(-1)?.kind === "list", text(r));
  });

  await scenario("Robustez", "Nomes compridos e texto estranho respeitam os limites da Meta", async () => {
    const created = await apiCall("POST", "/api/services", { name: "Hidratação capilar profunda com queratina e escova", durationMinutes: 90, priceCents: 18990, active: true });
    check("serviço com nome de 49 letras criado pela API", created.status === 201 || created.status === 200, JSON.stringify(created).slice(0, 200));
    const emps = (await apiCall("GET", "/api/employees?perPage=100")).body.data ?? [];
    const pedro = emps.find((e) => e.name === "Pedro");
    if (pedro && created.body.id) await apiCall("PUT", `/api/employees/${pedro.id}/services`, { serviceIds: [...pedro.services.map((s) => s.serviceId), created.body.id] });
    await sleep(61_000); // cadastro fica 60 s em memória no bot
    const c = novoCliente("Maria Aparecida dos Santos Oliveira Nascimento 🌸 'aspas' \"duplas\"");
    let r = await talk(c, { text: "quero agendar" });
    const row = options(r).find((o) => /^Hidrata/.test(o));
    check("na lista o nome do serviço é cortado em até 24 caracteres", !!row && row.length <= 24, JSON.stringify(options(r)));
    r = await talk(c, tap(r, /^Hidrata/));
    check("escolher a linha cortada funciona", /preferência|dia/i.test(text(r)), text(r));
    r = await talk(c, { text: "'; DROP TABLE conversation; --" });
    check("texto com cara de SQL é tratado como texto comum", r.length >= 1 && !/algo deu errado/.test(text(r)), text(r));
    r = await talk(c, { text: "menu" });
    check("saudação usa só o primeiro nome do perfil", r.length >= 1, text(r));
    if (created.body.id) await apiCall("PATCH", `/api/services/${created.body.id}`, { active: false });
  });

  await scenario("Robustez", "Limite mensal de mensagens (cota da ConvexaAPI) atingido", async () => {
    const sent = apiSql(`SELECT COALESCE(SUM(sent),0) FROM "MessageUsage" WHERE "businessId" = '${BIZ}' AND month = to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM')`);
    apiSql(`UPDATE "Business" SET "monthlyMessageLimit" = ${Number(sent)} WHERE id = '${BIZ}'`);
    const c = novoCliente("Co Ta");
    let r = await talk(c, { text: "oi" }, { timeoutMs: 7000 });
    check("com a cota no limite o bot não envia (a mensagem é descartada pelo n8n)", r.length === 0, text(r));
    apiSql(`UPDATE "Business" SET "monthlyMessageLimit" = NULL WHERE id = '${BIZ}'`);
    r = await talk(c, { text: "oi" });
    check("liberada a cota, volta a responder", r.at(-1)?.kind === "list", text(r));
  });

  await scenario("Robustez", "Número da Meta que não pertence a nenhuma empresa", async () => {
    const payload = { object: "whatsapp_business_account", entry: [{ id: "x", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "999999999999999" }, contacts: [{ wa_id: "5511988887777", profile: { name: "Zé" } }], messages: [{ from: "5511988887777", id: "wamid.X" + Date.now(), timestamp: "1", type: "text", text: { body: "oi" } }] } }] }] };
    const r = await sim("/api/webhook", { payload });
    check("o n8n aceita o webhook (a Meta não fica reenviando)", r.status === 200, JSON.stringify(r));
    const h = await fetch(`${AUTO}/health`).then((x) => x.status);
    check("o serviço continua de pé", h === 200, String(h));
  });
}

// ================================================================== ALEXA
if (runs("alexa")) {
  const user = "amzn1.ask.account.TESTE" + Date.now();
  const amanha = new Date(Date.now() + 21 * 3600_000).toISOString().slice(0, 10); // amanhã em São Paulo (UTC-3)
  const cx = novoCliente("Helena Voz");

  await scenario("Alexa", "Preparo: uma cliente marca para amanhã às 11h", async () => {
    let r = await talk(cx, { text: "corte amanhã às 11h com o Lucas" });
    r = await talk(cx, tap(r, /^Confirmar$/));
    check("Helena marca corte amanhã 11h", /Seu horário está marcado/.test(text(r)), text(r));
  });

  await scenario("Alexa", "Vincular a Alexa com o código do painel", async () => {
    let a = await alexa(user, "AgendaIntent");
    check("Alexa não vinculada explica como vincular", /gere um código/.test(a.speech), a.speech);
    a = await alexa(user, "VincularIntent", { codigo: "000000" });
    check("código errado é recusado", /não é válido ou já expirou/.test(a.speech), a.speech);
    const code = (await panel("POST", "/alexa/code")).body.code;
    check("painel gera um código de 6 dígitos", /^\d{6}$/.test(code ?? ""), String(code));
    a = await alexa(user, "VincularIntent", { codigo: code });
    check("código certo vincula à empresa", /Vinculei esta Alexa à Barbearia Navalha/.test(a.speech), a.speech);
    a = await alexa(user + "-outro", "VincularIntent", { codigo: code });
    check("o mesmo código não serve duas vezes", /não é válido ou já expirou/.test(a.speech), a.speech);
  });

  await scenario("Alexa", "Consultas por voz", async () => {
    let a = await alexa(user, "", {}, {}, "LaunchRequest");
    check("abrir a skill dá as boas-vindas e fica ouvindo", a.speech.length > 10 && a.end === false, a.speech);
    a = await alexa(user, "AMAZON.HelpIntent");
    check("ajuda lista exemplos de pergunta", /qual é a minha agenda/.test(a.speech), a.speech);
    a = await alexa(user, "AgendaIntent", { dia: amanha });
    check("agenda de amanhã fala a quantidade, o valor e os nomes", /Amanhã você tem/.test(a.speech) && /Helena/.test(a.speech) && /reais/.test(a.speech), a.speech);
    check("fala a hora por extenso (\"11 horas\"), sem 11:00", /11 horas/.test(a.speech) && !/11:00/.test(a.speech), a.speech);
    a = await alexa(user, "ProximoClienteIntent");
    check("próximo cliente", /O próximo é/.test(a.speech), a.speech);
    a = await alexa(user, "HorariosLivresIntent", { dia: amanha });
    check("horários livres por profissional", /Horários livres amanhã/.test(a.speech) && /Lucas/.test(a.speech), a.speech);
    a = await alexa(user, "FaturamentoIntent", { periodo: amanha.slice(0, 7) });
    check("faturamento do mês em reais", /você faturou/.test(a.speech) && /reais/.test(a.speech), a.speech);
    a = await alexa(user, "LucroIntent");
    check("lucro (ou pede o custo médio)", /lucro estimado|custo médio/i.test(a.speech), a.speech);
    a = await alexa(user, "ComprovantesIntent");
    check("comprovantes pendentes", /comprovante/.test(a.speech), a.speech);
    a = await alexa(user, "AMAZON.FallbackIntent");
    check("frase não entendida: não quebra", a.status === 200 && a.speech.length > 0, a.speech);
  });

  await scenario("Alexa", "Bloquear por voz e pedir remarcação pelo WhatsApp (com confirmação)", async () => {
    let a = await alexa(user, "BloquearIntent", { dia: amanha, inicio: "10:30", fim: "11:30" });
    check("bloqueia e pergunta se pede para remarcar", /Bloqueei amanhã das 10 e meia às 11 e meia/.test(a.speech) && /Helena/.test(a.speech) && a.end === false, a.speech);
    const since = await lastSeq(cx.waId);
    const no = await alexa(user, "AMAZON.NoIntent", {}, a.attributes);
    check("\"não\": nada é enviado", /não mandei nada/.test(no.speech), no.speech);
    await sleep(2500);
    check("a cliente não recebe nada depois do \"não\"", (await inbox(cx.waId, since)).length === 0, text(await inbox(cx.waId, since)));
    const yes = await alexa(user, "AMAZON.YesIntent", {}, a.attributes);
    check("\"sim\": confirma que mandou no WhatsApp, citando a cliente", /Mandei mensagem no WhatsApp para Helena/.test(yes.speech), yes.speech);
    const got = await waitBot(cx, since, { timeoutMs: 12000 });
    check("a cliente recebe o pedido de remarcação no WhatsApp", /não vai poder ser mantido/.test(text(got)) && options(got).includes("Escolher horário"), text(got));
    a = await alexa(user, "BloquearIntent", { dia: amanha, inicio: "12:00" });
    check("só a hora de início: bloqueia 1 hora (do meio-dia às 13 horas)", /do meio-dia às 13 horas/.test(a.speech), a.speech);
    a = await alexa(user, "BloquearIntent", { dia: amanha });
    check("sem horário: pede o horário, com exemplo", /Não entendi o horário/.test(a.speech) && a.end === false, a.speech);
  });

  await scenario("Alexa", "Avisar clientes, atraso, pausar e ativar o bot por voz", async () => {
    let a = await alexa(user, "AvisarClientesAmanhaIntent", { mensagem: "vamos abrir meia hora mais tarde" });
    check("aviso: repete a mensagem, diz quantos recebem e pede confirmação", /Vou mandar para \d+ clientes?/.test(a.speech) && /meia hora mais tarde/i.test(a.speech) && a.end === false, a.speech);
    const since = await lastSeq(cx.waId);
    const yes = await alexa(user, "AMAZON.YesIntent", {}, a.attributes);
    check("\"sim\": avisa pelo WhatsApp", /avisei (Helena|os \d+ clientes) pelo WhatsApp/.test(yes.speech), yes.speech);
    const got = await waitBot(cx, since, { timeoutMs: 12000 });
    check("a cliente recebe o aviso", /meia hora mais tarde/i.test(text(got)), text(got));
    a = await alexa(user, "AvisarClientesIntent", {});
    check("aviso sem mensagem: pergunta qual é o aviso", /Qual é o aviso/.test(a.speech), a.speech);
    a = await alexa(user, "AtrasoIntent", { minutos: "20" });
    check("atraso: avisa quem está nas próximas 3 horas (ou diz que não há ninguém)", /próximas três horas/.test(a.speech), a.speech);
    a = await alexa(user, "PausarBotIntent");
    const st1 = (await panel("GET", "/status")).body.settings.agentEnabled;
    check("pausar o bot por voz desliga o atendimento", st1 === false, a.speech);
    a = await alexa(user, "AtivarBotIntent");
    const st2 = (await panel("GET", "/status")).body.settings.agentEnabled;
    check("ativar o bot por voz religa", st2 === true, a.speech);
    a = await alexa(user, "AMAZON.StopIntent");
    check("parar encerra a sessão", a.end !== false, a.speech);
  });

  await scenario("Alexa", "Desvincular pelo painel", async () => {
    const before = (await panel("GET", "/status")).body.alexa.linkedDevices;
    check("painel mostra o dispositivo vinculado", before >= 1, String(before));
    const del = await panel("DELETE", "/alexa");
    check("desvincular (200)", del.status === 200, JSON.stringify(del));
    const a = await alexa(user, "AgendaIntent");
    check("depois de desvincular, a Alexa pede o código de novo", /gere um código/.test(a.speech), a.speech);
  });
}

// ================================================================== PAINEL
if (runs("painel")) {
  await scenario("Painel", "Acesso: sem token, token inválido e status", async () => {
    const no = await fetch(`${AUTO}/v1/panel/status`);
    check("sem token: 401", no.status === 401, String(no.status));
    const bad = await fetch(`${AUTO}/v1/panel/status`, { headers: { Authorization: "Bearer abc.def.ghi" } });
    check("token inválido: 401", bad.status === 401, String(bad.status));
    const st = await panel("GET", "/status");
    check("status traz empresa, WhatsApp, vínculo, regras e integrações", st.status === 200 && ["business", "whatsapp", "link", "settings", "secrets", "segments", "google", "alexa", "ai"].every((k) => k in st.body), Object.keys(st.body).join(","));
    check("status nunca devolve segredo (só verdadeiro/falso)", Object.values(st.body.secrets).every((v) => typeof v === "boolean") && !JSON.stringify(st.body).includes("password"), JSON.stringify(st.body.secrets));
    const cors = await fetch(`${AUTO}/v1/panel/status`, { method: "OPTIONS", headers: { Origin: "https://site-malicioso.example", "Access-Control-Request-Method": "GET" } });
    check("CORS: origem desconhecida não é liberada", !cors.headers.get("access-control-allow-origin"), String(cors.headers.get("access-control-allow-origin")));
  });

  await scenario("Painel", "Regras inválidas são recusadas e nada muda", async () => {
    const before = (await panel("GET", "/status")).body.settings;
    const cases = [
      [{ prepayment: { depositPercent: 500 } }, "sinal de 500%"],
      [{ reminders: { hoursBefore: [100] } }, "lembrete 100h antes"],
      [{ segment: "foguete" }, "tipo de negócio inexistente"],
      [{ prepayment: { mode: "talvez" } }, "modo de sinal inexistente"],
      [{ ownerPhones: ["1", "2", "3", "4", "5", "6"] }, "6 números de dono"],
    ];
    for (const [patch, label] of cases) {
      const r = await setSettings(patch);
      check(`${label}: 400`, r.status === 400, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    }
    const after = (await panel("GET", "/status")).body.settings;
    check("as regras continuam iguais", JSON.stringify(before) === JSON.stringify(after), "mudou");
    const ok = await setSettings({ costPercent: 35 });
    check("alteração válida é salva e devolvida", ok.status === 200 && ok.body.settings.costPercent === 35, JSON.stringify(ok.body).slice(0, 120));
  });

  await scenario("Painel", "Conversas, histórico, resposta fora da janela e aviso do dia", async () => {
    const c = novoCliente("Ines Painel");
    await agendarEConfirmar(c, "corte amanhã às 13h");
    const list = (await panel("GET", "/conversations")).body.data ?? [];
    const mine = list.find((x) => x.phone === "+" + c.waId);
    check("conversa aparece na lista com nome, última mensagem e janela aberta", !!mine && mine.name === c.name && mine.windowOpen === true && !!mine.lastBody, JSON.stringify(mine));
    const hist = (await panel("GET", `/conversations/${encodeURIComponent("+" + c.waId)}`)).body;
    const lines = hist.data ?? hist.messages ?? hist;
    check("histórico traz as mensagens dos dois lados", Array.isArray(lines) && lines.length >= 4, JSON.stringify(hist).slice(0, 200));
    const since = await lastSeq(c.waId);
    const tomorrow = new Date(Date.now() + 21 * 3600_000).toISOString().slice(0, 10);
    const n = await panel("POST", "/notice", { date: tomorrow, message: "Teremos café na recepção ☕" });
    check("aviso do dia pelo painel informa quantos receberam", n.status === 200 && n.body.sent >= 1 && n.body.delivered === true, JSON.stringify(n));
    const got = await waitBot(c, since, { timeoutMs: 12000 });
    check("cliente recebe o aviso do painel", /café na recepção/.test(text(got)), text(got));
    await age(c, 30);
    const late = await panel("POST", `/conversations/${encodeURIComponent("+" + c.waId)}/reply`, { text: "Oi!" });
    check("responder depois de 24h é recusado com explicação (409)", late.status === 409 && /24h/.test(late.body.message ?? ""), JSON.stringify(late));
    const rev = await panel("GET", "/reports/revenue?period=month");
    check("relatório de faturamento do mês", rev.status === 200 && "upcoming" in rev.body && "done" in rev.body, JSON.stringify(rev.body).slice(0, 160));
  });

  await scenario("Painel", "Uma empresa não enxerga os dados de outra", async () => {
    const slug = "isolamento-" + Date.now();
    const reg = await fetch(`${API}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business: { name: "Empresa Isolada", slug, timezone: "America/Sao_Paulo" }, owner: { name: "Outra Dona", email: `${slug}@exemplo.com`, password: "Isolada#2026teste" } }),
    }).then((x) => x.json());
    const other = reg.accessToken ?? reg.data?.accessToken;
    check("segunda empresa criada para o teste", !!other, JSON.stringify(reg).slice(0, 160));
    const call = async (method, path, body) => {
      const r = await fetch(`${AUTO}/v1/panel${path}`, { method, headers: { Authorization: `Bearer ${other}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const st = await call("GET", "/status");
    check("a outra empresa vê só o próprio status", st.status === 200 && st.body.business.name === "Empresa Isolada", JSON.stringify(st.body.business));
    const convs = await call("GET", "/conversations");
    check("lista de conversas da outra empresa vem vazia", (convs.body.data ?? []).length === 0, JSON.stringify(convs.body).slice(0, 160));
    const mineList = (await panel("GET", "/conversations")).body.data ?? [];
    const victim = mineList.find((x) => x.role === "customer");
    const hist = await call("GET", `/conversations/${encodeURIComponent(victim.phone)}`);
    const lines = hist.body.data ?? hist.body.messages ?? hist.body;
    check("histórico de um cliente da Navalha não abre para a outra empresa", hist.status >= 400 || (Array.isArray(lines) && lines.length === 0), JSON.stringify(hist).slice(0, 160));
    const pays = (await panel("GET", "/payments?status=paid")).body;
    const pay = (pays.data ?? pays)[0];
    if (pay) {
      const ap = await call("POST", `/payments/${pay.id}/reject`);
      check("a outra empresa não consegue mexer num pagamento da Navalha", ap.status >= 400, JSON.stringify(ap));
    }
    const reply = await call("POST", `/conversations/${encodeURIComponent(victim.phone)}/reply`, { text: "invasão" });
    check("a outra empresa não consegue mandar mensagem a um cliente da Navalha", reply.status >= 400, JSON.stringify(reply));
    const link = await call("POST", "/link", { email: DEMO_EMAIL, password: DEMO_PASS });
    check("não dá para conectar a automação com a conta de outra empresa (403)", link.status === 403, JSON.stringify(link));
  });

  await scenario("Painel", "Conexão da automação e segredos", async () => {
    const wrong = await panel("POST", "/link", { email: DEMO_EMAIL, password: "senha-errada-123" });
    check("senha errada na conexão: 400 com mensagem clara", wrong.status === 400 && /não conferem/.test(wrong.body.message ?? ""), JSON.stringify(wrong));
    const st = (await panel("GET", "/status")).body;
    check("tentativa com senha errada não derruba a conexão existente", st.link.status === "active", JSON.stringify(st.link));
    const sec = await panel("PUT", "/secrets", { mercadoPagoWebhookSecret: "segredo-de-teste-123" });
    const st2 = (await panel("GET", "/status")).body;
    check("segredo salvo aparece só como \"configurado\"", sec.status === 200 && st2.secrets.mercadoPagoWebhookSecret === true && !JSON.stringify(st2).includes("segredo-de-teste-123"), JSON.stringify(st2.secrets));
    const raw = sql(`SELECT secrets_enc FROM bot_settings WHERE business_id = '${BIZ}'`);
    check("no banco o segredo fica cifrado (não aparece em texto puro)", raw.length > 20 && !raw.includes("segredo-de-teste-123"), raw.slice(0, 40));
    const pw = sql(`SELECT to_json(l)::text FROM business_link l WHERE business_id = '${BIZ}'`);
    check("a senha do dono guardada para o bot também fica cifrada", !pw.includes(DEMO_PASS), "senha em texto puro no banco!");
  });
}


// ------------------------------------------------------------------ fim
await setSettings({ ...base, prepayment: original.prepayment, reminders: original.reminders, cancellation: original.cancellation, segment: original.segment, agentEnabled: true });
{
  const rej = await sim("/api/rejections");
  await scenario("Meta", "Nenhuma mensagem do bot foi recusada pelas regras da Meta (simulada)", async () => {
    check(`0 recusas em ${transcript.filter((t) => t.dir === "bot").length} mensagens enviadas pelo bot`, rej.length === 0, rej.map((r) => `${r.to} ${r.type}: ${r.message}`).join("\n"));
  });
}
const total = results.flatMap((r) => r.checks);
const failed = total.filter((c) => !c.ok);
writeFileSync(process.env.BATERIA_OUT ?? "./bateria-resultado.json", JSON.stringify({ at: new Date().toISOString(), total: total.length, failed: failed.length, results, transcript }, null, 1));
console.log(`\n${results.length} cenários, ${total.length} verificações, ${failed.length} falharam`);
process.exitCode = failed.length ? 1 : 0;
