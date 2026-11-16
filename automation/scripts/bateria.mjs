// Bateria ampla de conversas: cliente, dono, robustez, Alexa e API do painel.
// Tudo passa pelo caminho real (simulador -> n8n -> automação -> ConvexaAPI -> n8n -> simulador).
// Uso:  AUTOMACAO_KEY=... AUTOMACAO_DB_URL=postgresql://.../convexa_automacao node bateria.mjs [area...]
//       áreas: cliente pagamento lembrete dono robustez alexa painel   (sem argumento roda todas)
// Gera um relatório em JSON (BATERIA_OUT, padrão ./bateria-resultado.json).
import { writeFileSync } from "node:fs";
import {
  API, AUTO, N8N, OWNER, SIM, age, apiCall, check, inbox, lastSeq, novoCliente, numberOf, options, panel, panelToken, results, scenario, setSettings, sim, sleep, sql,
  talk, tap, text, tick, transcript, waitBot,
} from "./lib-sim.mjs";

const only = process.argv.slice(2);
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
// limpa bloqueios de rodadas anteriores (bot e Alexa) para a agenda ficar previsível
{
  const blocks = (await apiCall("GET", `/api/time-blocks?from=${new Date().toISOString()}`)).body;
  for (const b of Array.isArray(blocks) ? blocks : blocks.data ?? []) {
    if (/(Bloqueado pel[oa]|Compromisso do|Folga|Saída|Chegada) ?(dono|Alexa)?/i.test(b.reason ?? "")) await apiCall("DELETE", `/api/time-blocks/${b.id}`);
  }
}
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
    let r = await talk(novoCliente("Sem Hora"), { text: "quero marcar um corte amanhã de manhã" });
    if (/preferência/i.test(text(r))) r = await talk({ ...r, waId: r[0]?.to }, {}).catch(() => r);
    check("\"amanhã de manhã\" (sem hora) leva aos horários da manhã ou ao profissional", /preferência|horário|manhã/i.test(text(r)), text(r));
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
    let r = await talk(novoCliente("Dom Fechado"), { text: "quero marcar corte domingo às 10h" });
    if (/preferência/i.test(text(r))) r = await talk(novoCliente("Dom Fechado"), { text: "quero marcar corte domingo às 10h" });
    check("domingo (fechado): avisa que não tem horário e oferece outros dias", /não tem|fechad|outro dia|Qual dia/i.test(text(r)), text(r));
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
    check("remarcar pergunta o novo dia, sem perguntar o serviço de novo", /dia/i.test(text(r)) && !/Qual serviço/i.test(text(r)), text(r));
    r = await talk(c, { text: "sexta às 17h" });
    if (/preferência/i.test(text(r))) r = await talk(c, tap(r, /Sem preferência/));
    check("mostra o novo horário para confirmar", /Novo horário/.test(text(r)) && /17:00/.test(text(r)), text(r));
    r = await talk(c, tap(r, /^Confirmar$/));
    check("remarcado", /Remarquei/.test(text(r)) && /17:00/.test(text(r)), text(r));
    r = await talk(c, { text: "meus horários" });
    check("fica só o horário novo", /17:00/.test(text(r)) && !/11:00/.test(text(r)), text(r));
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

// (as outras áreas são acrescentadas abaixo)
// %%AREAS%%

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
