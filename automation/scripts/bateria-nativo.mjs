// Bateria dos workflows "Convexa - 00…17" (n8n puro, sem o serviço convexa-automacao).
// Caminho real: simulador (Meta) -> n8n WF00 -> subworkflows -> ConvexaAPI -> WF15 -> simulador.
// Pré-requisitos: simulador com N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/convexa/message,
// workflows importados e publicados (automation/n8n/convexa-nativo/setup.sh).
// Uso: INTERNAL_API_KEY=... API_DB_URL=postgresql://.../convexa N8N_DB_URL=postgresql://.../n8n node bateria-nativo.mjs [area...]
//      áreas: agendar consultar remarcar cancelar info atendente robustez lembrete seguranca cota
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { N8N, SIM, apiSql, check, novoCliente, options, results, scenario, sim, sleep, talk, tap, text, transcript, waitBot, lastSeq } from "./lib-sim.mjs";

const only = process.argv.slice(2);
const runs = (a) => only.length === 0 || only.includes(a);
const KEY = process.env.INTERNAL_API_KEY;
const PNID = process.env.PHONE_NUMBER_ID ?? "100000000000001";
const APP_SECRET = process.env.SIM_APP_SECRET ?? "simulador-app-secret";
const WEBHOOK = `${N8N}/webhook/convexa/message`;
const opts = { timeoutMs: 40000, quietMs: 2500 };

// ------------------------------------------------------------------ banco do n8n (tabelas convexa_*)
function n8nSql(q) {
  const url = process.env.N8N_DB_URL;
  if (!url) throw new Error("defina N8N_DB_URL");
  const ids = Object.fromEntries(execFileSync("psql", [url, "-tAc", "select name, id from data_table where name like 'convexa_%'"], { encoding: "utf8" }).trim().split("\n").map((l) => l.split("|")).map(([n, id]) => [n.replace("convexa_", ""), id]));
  return execFileSync("psql", [url, "-tAc", q.replace(/\{(\w+)\}/g, (_, t) => `"data_table_user_${ids[t]}"`)], { encoding: "utf8" }).trim();
}
const rodar = (caminho) => fetch(`${N8N}/webhook/convexa/${caminho}`, { method: "POST", headers: { "x-internal-key": KEY } }).then((r) => r.status);
const BIZ = apiSql(`SELECT id FROM "Business" WHERE "metaPhoneNumberId" = '${PNID}'`).split("\n")[0];
if (!BIZ) throw new Error("empresa de demonstração não encontrada");
// agenda previsível (só na empresa de DEMONSTRAÇÃO do banco local)
apiSql(`UPDATE "Appointment" SET status = 'CANCELLED' WHERE "businessId" = '${BIZ}' AND "startAt" > now() AND status IN ('SCHEDULED','CONFIRMED')`);
apiSql(`DELETE FROM "TimeBlock" WHERE "businessId" = '${BIZ}' AND "endAt" > now()`);
apiSql(`UPDATE "Business" SET "monthlyMessageLimit" = NULL WHERE id = '${BIZ}'`);
n8nSql(`DELETE FROM {empresas}`);

const agendamentosDe = (c) =>
  apiSql(`SELECT a.id || '|' || a.status || '|' || to_char(a."startAt" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') || '|' || s.name FROM "Appointment" a JOIN "Customer" cu ON cu.id = a."customerId" JOIN "Service" s ON s.id = a."serviceId" WHERE a."businessId" = '${BIZ}' AND cu.phone = '+${c.waId}' ORDER BY a."createdAt"`)
    .split("\n").filter(Boolean).map((l) => { const [id, status, quando, servico] = l.split("|"); return { id, status, quando, servico }; });
const ultimo = (msgs) => msgs.at(-1) ?? {};
const tudo = (msgs) => text(msgs) + "\n" + options(msgs).join(" | ");

/** Webhook "da Meta" montado à mão (para duplicata, assinatura errada, tipos de mensagem). */
async function webhookCru(waId, name, message, { assinatura, pnid = PNID } = {}) {
  const payload = { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "5514000000000", phone_number_id: pnid }, contacts: [{ profile: { name }, wa_id: waId }], messages: [{ from: waId, id: message.id ?? "wamid." + randomUUID(), timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] };
  const raw = JSON.stringify(payload);
  const sig = assinatura ?? "sha256=" + createHmac("sha256", APP_SECRET).update(raw).digest("hex");
  const r = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
  return { status: r.status, body: await r.text(), payload };
}
async function cru(c, message, o = {}) {
  const since = await lastSeq(c.waId);
  const r = await webhookCru(c.waId, c.name, message, o);
  const msgs = await waitBot(c, since, { timeoutMs: o.esperar ?? 20000, quietMs: 2500 });
  return { ...r, msgs };
}

/** Agenda do começo ao fim tocando nas opções. Devolve o texto final. */
async function agendarPorBotoes(c, { dia = /Amanhã/ } = {}) {
  let r = await talk(c, { text: "oi" }, opts);
  r = await talk(c, tap(r, /Agendar horário/), opts);
  r = await talk(c, tap(r, /Corte/), opts);
  r = await talk(c, tap(r, dia), opts);
  r = await talk(c, tap(r, /^\d{2}:\d{2}/), opts);
  return talk(c, tap(r, /Confirmar/), opts);
}

// ================================================================== cenários
if (runs("agendar")) {
  await scenario("agendar", "Menu → serviço → dia → horário → confirmar (só botões e listas)", async () => {
    const c = novoCliente("Bruna Botões");
    let r = await talk(c, { text: "oi" }, opts);
    check("saudação com o nome do WhatsApp e da empresa", /Bruna/.test(text(r)) && /Navalha/.test(text(r)), text(r));
    check("menu em lista com 7 opções", ultimo(r).kind === "list" && options(r).length === 7, tudo(r));
    r = await talk(c, tap(r, /Agendar horário/), opts);
    check("pergunta o serviço", /serviço/i.test(text(r)) && options(r).some((o) => /Corte/.test(o)), tudo(r));
    r = await talk(c, tap(r, /Corte/), opts);
    check("pergunta o dia com botões Hoje/Amanhã/Outro dia", ["Hoje", "Amanhã", "Outro dia"].every((b) => options(r).includes(b)), tudo(r));
    r = await talk(c, tap(r, /Amanhã/), opts);
    check("lista de horários livres", ultimo(r).kind === "list" && options(r).some((o) => /^\d{2}:\d{2}/.test(o)), tudo(r));
    r = await talk(c, tap(r, /^\d{2}:\d{2}/), opts);
    check("resumo para confirmar", /Confere/.test(text(r)) && options(r).includes("Confirmar"), tudo(r));
    r = await talk(c, tap(r, /Confirmar/), opts);
    check("agendado com sucesso", /Agendado/.test(text(r)), tudo(r));
    const ags = agendamentosDe(c);
    check("agendamento criado na API", ags.length === 1 && ags[0].status === "SCHEDULED", JSON.stringify(ags));
    await sleep(1500);
    check("registrado na tabela convexa_agendamentos", n8nSql(`SELECT count(*) FROM {agendamentos} WHERE "appointmentId" = '${ags[0]?.id}' AND status = 'ATIVO'`) === "1");
  });

  await scenario("agendar", "Texto livre: 'quero cortar o cabelo amanhã às 15h'", async () => {
    const c = novoCliente("Caio Texto");
    let r = await talk(c, { text: "quero agendar um corte amanhã às 15h" }, opts);
    const t = tudo(r);
    check("entendeu serviço, dia e hora e foi direto ao resumo (ou mostrou horários)", /Confere/.test(t) || /Horários livres/.test(t), t);
    if (/Confere/.test(t)) {
      check("resumo com 15:00", /15:00/.test(t), t);
      r = await talk(c, { text: "sim" }, opts);
      check("'sim' confirma", /Agendado/.test(text(r)), tudo(r));
      check("horário 15:00 gravado", agendamentosDe(c).some((a) => a.quando.endsWith("15:00")), JSON.stringify(agendamentosDe(c)));
    }
  });

  await scenario("agendar", "Respostas digitadas: número da opção, 'sexta', '2'", async () => {
    const c = novoCliente("Diego Digita");
    let r = await talk(c, { text: "quero marcar" }, opts);
    r = await talk(c, { text: "1" }, opts);
    check("'1' escolhe o primeiro serviço", /Para qual dia/.test(text(r)), tudo(r));
    r = await talk(c, { text: "sexta" }, opts);
    check("'sexta' vira data e mostra horários", /Horários livres/.test(text(r)) || /próximo dia com vaga/.test(text(r)), tudo(r));
    r = await talk(c, { text: "2" }, opts);
    check("'2' escolhe o segundo horário", /Confere/.test(text(r)), tudo(r));
    r = await talk(c, { text: "não" }, opts);
    check("'não' desiste sem agendar", /não agendei/.test(text(r)) && agendamentosDe(c).length === 0, tudo(r));
  });

  await scenario("agendar", "Data no passado e dia sem vaga", async () => {
    const c = novoCliente("Elisa Datas");
    let r = await talk(c, { text: "quero agendar corte" }, opts);
    if (/Para qual dia/.test(text(r))) {
      r = await talk(c, { text: "01/01/2020" }, opts);
      check("data passada é recusada", /já passou/.test(text(r)), tudo(r));
      r = await talk(c, { text: "domingo" }, opts);
      check("domingo (fechado) sugere o próximo dia com vaga", /próximo dia com vaga|Horários livres/.test(text(r)), tudo(r));
    } else check("chegou na pergunta do dia", false, tudo(r));
  });

  await scenario("agendar", "Horário ocupado entre a escolha e a confirmação (409)", async () => {
    const a = novoCliente("Fabio Primeiro");
    const b = novoCliente("Gabi Segunda");
    let ra = await talk(a, { text: "quero agendar corte amanhã" }, opts);
    let rb = await talk(b, { text: "quero agendar corte amanhã" }, opts);
    ra = await talk(a, tap(ra, /^\d{2}:\d{2}/), opts);
    rb = await talk(b, tap(rb, /^\d{2}:\d{2}/), opts);
    ra = await talk(a, { text: "confirmar" }, opts);
    check("primeiro confirma", /Agendado/.test(text(ra)), tudo(ra));
    rb = await talk(b, { text: "confirmar" }, opts);
    const t = tudo(rb);
    check("segundo recebe aviso de conflito e novos horários (ou outro profissional)", /não está mais disponível|conflito|Agendado/.test(t), t);
  });
}

if (runs("consultar") || runs("remarcar") || runs("cancelar")) {
  const c = novoCliente("Helena Agenda");
  await agendarPorBotoes(c);
  if (runs("consultar"))
    await scenario("consultar", "Meus agendamentos com 1 horário: detalhes e botões", async () => {
      const r = await talk(c, { text: "quais são meus horários?" }, opts);
      check("mostra o horário marcado", /Seu horário/.test(text(r)) && /Corte/.test(text(r)), tudo(r));
      check("oferece Remarcar e Cancelar", options(r).includes("Remarcar") && options(r).includes("Cancelar"), tudo(r));
    });
  if (runs("remarcar"))
    await scenario("remarcar", "Remarcar pelo pedido em texto", async () => {
      const antes = agendamentosDe(c).find((a) => a.status === "SCHEDULED");
      let r = await talk(c, { text: "preciso remarcar" }, opts);
      check("pergunta o novo dia", /Para qual dia/.test(text(r)), tudo(r));
      r = await talk(c, { text: "depois de amanhã" }, opts);
      check("mostra horários do novo dia", /Horários livres/.test(text(r)) || /próximo dia/.test(text(r)), tudo(r));
      r = await talk(c, tap(r, /^\d{2}:\d{2}/), opts);
      check("resumo De/Para", /De:/.test(text(r)) && /Para:/.test(text(r)), tudo(r));
      r = await talk(c, tap(r, /Confirmar/), opts);
      check("remarcado", /Remarcado/.test(text(r)), tudo(r));
      const depois = agendamentosDe(c).find((a) => a.id === antes?.id);
      check("mesmo agendamento com novo horário na API", depois && depois.quando !== antes.quando, JSON.stringify({ antes, depois }));
    });
  if (runs("cancelar"))
    await scenario("cancelar", "Cancelar com confirmação", async () => {
      let r = await talk(c, { text: "quero cancelar meu horário" }, opts);
      check("pede confirmação", /Confirma o cancelamento/.test(text(r)), tudo(r));
      r = await talk(c, tap(r, /Sim, cancelar/), opts);
      check("cancelado e oferece agendar outro", /Cancelado/.test(text(r)) && options(r).includes("Agendar outro"), tudo(r));
      check("cancelado na API", agendamentosDe(c).every((a) => a.status === "CANCELLED"), JSON.stringify(agendamentosDe(c)));
      r = await talk(c, { text: "cancelar" }, opts);
      check("sem horários: avisa e oferece agendar", /não tem nenhum horário/.test(text(r)), tudo(r));
    });
  if (runs("cancelar"))
    await scenario("cancelar", "Vários horários: escolher na lista qual cancelar", async () => {
      const d = novoCliente("Igor Dois");
      await agendarPorBotoes(d, { dia: /Amanhã/ });
      await agendarPorBotoes(d, { dia: /Hoje|Amanhã/ });
      let r = await talk(d, { text: "cancelar" }, opts);
      check("lista os horários para escolher", ultimo(r).kind === "list" && options(r).length >= 2, tudo(r));
      r = await talk(d, { text: "2" }, opts);
      check("'2' escolhe o segundo", /Confirma o cancelamento/.test(text(r)), tudo(r));
      r = await talk(d, { text: "não" }, opts);
      check("'não' mantém", /mantive/.test(text(r)), tudo(r));
    });
}

if (runs("info")) {
  await scenario("info", "Serviços e preços", async () => {
    const c = novoCliente("Joana Preço");
    const r = await talk(c, { text: "quanto custa o corte?" }, opts);
    check("tabela com preço em reais", /Serviços da/.test(text(r)) && /R\$ \d/.test(text(r)), tudo(r));
    check("oferece agendar", options(r).includes("Agendar horário"), tudo(r));
  });
  await scenario("info", "Endereço sem cadastro e depois com cadastro em convexa_empresas", async () => {
    const c = novoCliente("Kleber Endereço");
    let r = await talk(c, { text: "qual o endereço de vocês?" }, opts);
    check("sem cadastro: oferece atendente", /Ainda não tenho o endereço/.test(text(r)) && options(r).includes("Falar com atendente"), tudo(r));
    n8nSql(`INSERT INTO {empresas} ("phoneNumberId", nome, endereco, horarios, pagamento) VALUES ('${PNID}', 'Barbearia Navalha', 'Rua das Flores, 123 - Centro', 'Seg a sex 9h às 19h; sáb 9h às 14h', 'Pix, cartão e dinheiro')`);
    r = await talk(c, { text: "vocês aceitam pix?" }, opts);
    check("com cadastro: endereço, horário e pagamento", /Rua das Flores/.test(text(r)) && /sáb 9h/.test(text(r)) && /Pix/.test(text(r)), tudo(r));
  });
}

if (runs("atendente")) {
  await scenario("atendente", "Pedir atendente, bot em silêncio, 'menu' volta", async () => {
    const c = novoCliente("Lia Humana");
    let r = await talk(c, { text: "quero falar com um atendente" }, opts);
    check("confirma a transferência", /avisei a equipe/.test(text(r)), tudo(r));
    await sleep(1500);
    check("alerta ATENDIMENTO_SOLICITADO registrado", Number(n8nSql(`SELECT count(*) FROM {erros} WHERE tipo = 'ATENDIMENTO_SOLICITADO' AND mensagem LIKE '%${c.waId}%'`)) >= 1);
    r = await talk(c, { text: "oi, alguém aí?" }, { ...opts, timeoutMs: 9000 });
    check("em atendimento humano o bot não responde", r.length === 0, tudo(r));
    r = await talk(c, { text: "menu" }, opts);
    check("'menu' devolve ao bot", /Voltei/.test(text(r)) && options(r).length === 7, tudo(r));
  });
}

if (runs("robustez")) {
  await scenario("robustez", "Áudio/imagem, texto sem sentido (IA sem chave cai no 'não entendi'), 'sair' no meio", async () => {
    const c = novoCliente("Mario Robusto");
    let r0 = await talk(c, { raw: { type: "audio", audio: { mime_type: "audio/ogg" } }, file: { mime: "audio/ogg", base64: "AAAA" } }, opts);
    check("áudio: avisa que só lê texto", /só consigo ler mensagens de texto/.test(text(r0)), tudo(r0));
    let r = await talk(c, { text: "xpto qwerty zzz bla" }, opts);
    check("texto sem sentido: 'não entendi' com o menu", /não entendi/i.test(text(r)) && options(r).length === 7, tudo(r));
    check("responde em poucos segundos mesmo com a IA fora do ar", transcript.at(-1) && Date.parse(transcript.at(-1).at) - Date.parse(transcript.at(-2).at) < 15000, "demorou");
    r = await talk(c, { text: "quero agendar" }, opts);
    r = await talk(c, { text: "sair" }, opts);
    check("'sair' no meio do fluxo volta ao menu", options(r).length === 7 && !/não entendi/.test(text(r)), tudo(r));
    const x = await talk(c, { raw: { type: "reaction", reaction: { message_id: "wamid.x", emoji: "👍" } } }, { ...opts, timeoutMs: 8000 });
    check("reação é ignorada", x.length === 0, tudo(x));
  });
  await scenario("robustez", "Webhook repetido pela Meta (mesmo id) responde uma vez só", async () => {
    const c = novoCliente("Nina Dupla");
    await talk(c, { text: "oi" }, opts);
    const id = "wamid." + randomUUID();
    const since = await lastSeq(c.waId);
    await webhookCru(c.waId, c.name, { id, type: "text", text: { body: "quanto custa?" } });
    await sleep(6000);
    await webhookCru(c.waId, c.name, { id, type: "text", text: { body: "quanto custa?" } });
    const msgs = await waitBot(c, since, { timeoutMs: 15000, quietMs: 4000 });
    check("só uma resposta de serviços", msgs.filter((m) => /Serviços da/.test(m.text ?? "")).length === 1, tudo(msgs));
  });
  await scenario("robustez", "Celular sem o 9 (formato antigo) usa o mesmo cliente da API", async () => {
    const com9 = novoCliente("Otto Nove");
    const sem9 = { waId: com9.waId.slice(0, 4) + com9.waId.slice(5), name: com9.name };
    await talk(com9, { text: "oi" }, opts);
    const r = await talk(sem9, { text: "oi" }, opts);
    check("responde para o número como chegou", r.length > 0, "sem resposta");
    const n = apiSql(`SELECT count(*) FROM "Customer" WHERE "businessId" = '${BIZ}' AND phone = '+${com9.waId}'`);
    check("um cliente só na API (+55 DD 9 XXXX-XXXX)", n === "1", n);
  });
}

if (runs("seguranca")) {
  await scenario("seguranca", "Assinatura, verificação do webhook e número desconhecido", async () => {
    const c = novoCliente("Paula Segura");
    const x = await cru(c, { type: "text", text: { body: "oi" } }, { assinatura: "sha256=" + "0".repeat(64), esperar: 6000 });
    check("assinatura errada: 401 e nenhuma resposta", x.status === 401 && x.msgs.length === 0, `${x.status} ${x.body}`);
    const y = await cru(c, { type: "text", text: { body: "oi" } }, { assinatura: "", esperar: 6000 });
    check("sem assinatura: 401", y.status === 401, `${y.status} ${y.body}`);
    const tok = execFileSync("docker", ["exec", "convexa-n8n", "printenv", "WHATSAPP_VERIFY_TOKEN"], { encoding: "utf8" }).trim();
    const g = await fetch(`${WEBHOOK}?hub.mode=subscribe&hub.verify_token=${tok}&hub.challenge=12345`);
    check("GET de verificação devolve o desafio", g.status === 200 && (await g.text()) === "12345");
    const g2 = await fetch(`${WEBHOOK}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=12345`);
    check("GET com token errado: 403", g2.status === 403);
    const z = await cru(c, { type: "text", text: { body: "oi" } }, { pnid: "999999999999999", esperar: 6000 });
    check("número da Meta sem empresa: recusa e não responde", z.status === 401 && z.msgs.length === 0, `${z.status} ${z.body}`);
    await sleep(1500);
    check("alerta WEBHOOK_RECUSADO registrado", Number(n8nSql(`SELECT count(*) FROM {erros} WHERE tipo = 'WEBHOOK_RECUSADO' AND mensagem LIKE '%999999999999999%'`)) >= 1);
    check("token da Meta não aparece nas execuções salvas", n8nSql(`SELECT count(*) FROM execution_data d JOIN execution_entity e ON e.id = d."executionId" JOIN workflow_entity w ON w.id = e."workflowId" WHERE w.name LIKE 'Convexa - %' AND (d.data LIKE '%SIMULADOR-ACCESS-TOKEN%' OR d.data LIKE '%simulador-app-secret%')`) === "0");
  });
}

if (runs("lembrete")) {
  await scenario("lembrete", "Lembrete com botões (janela aberta) e 'Confirmo presença'", async () => {
    const c = novoCliente("Rita Lembrete");
    await agendarPorBotoes(c, { dia: /Amanhã/ });
    await sleep(1500);
    // traz o horário para dentro das próximas 24 h (data na tabela e na API)
    const ag = agendamentosDe(c)[0];
    apiSql(`UPDATE "Appointment" SET "startAt" = now() + interval '3 hours', "endAt" = now() + interval '3 hours 30 minutes' WHERE id = '${ag.id}'`);
    n8nSql(`UPDATE {agendamentos} SET "startAt" = to_char((now() + interval '3 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"') WHERE "appointmentId" = '${ag.id}'`);
    const since = await lastSeq(c.waId);
    check("WF11 roda pelo webhook", (await rodar("lembretes")) === 200);
    let r = await waitBot(c, since, { timeoutMs: 30000, quietMs: 3000 });
    check("lembrete com 3 botões", /Lembrete/.test(text(r)) && options(r).includes("Confirmo presença"), tudo(r));
    r = await talk(c, tap(r, /Confirmo/), opts);
    check("presença confirmada", /Presença confirmada/.test(text(r)), tudo(r));
    const since2 = await lastSeq(c.waId);
    await rodar("lembretes");
    const r2 = await waitBot(c, since2, { timeoutMs: 12000, quietMs: 4000 });
    check("não manda o lembrete de novo", r2.length === 0, tudo(r2));
  });
  await scenario("lembrete", "Janela fechada: lembrete pelo modelo convexa_lembrete; botão 'Remarcar'", async () => {
    const c = novoCliente("Sara Modelo");
    await agendarPorBotoes(c, { dia: /Amanhã/ });
    await sleep(1500);
    const ag = agendamentosDe(c)[0];
    apiSql(`UPDATE "Appointment" SET "startAt" = now() + interval '5 hours', "endAt" = now() + interval '5 hours 30 minutes' WHERE id = '${ag.id}'`);
    n8nSql(`UPDATE {agendamentos} SET "startAt" = to_char((now() + interval '5 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"') WHERE "appointmentId" = '${ag.id}'`);
    n8nSql(`UPDATE {conversas} SET "lastInboundAt" = '2026-01-01T00:00:00.000Z' WHERE phone = '+${c.waId}'`);
    await sim("/api/age", { waId: c.waId, hours: 30 });
    const since = await lastSeq(c.waId);
    await rodar("lembretes");
    let r = await waitBot(c, since, { timeoutMs: 30000, quietMs: 3000 });
    check("chegou como modelo (template)", ultimo(r).kind === "template" && /lembrete/.test(text(r)), JSON.stringify(r).slice(0, 600));
    const rej = await sim("/api/rejections");
    check("a Meta (simulador) aceitou o modelo", !JSON.stringify(rej).includes(c.waId), JSON.stringify(rej).slice(-400));
    r = await talk(c, tap(r, /Remarcar/), opts);
    check("botão do modelo leva à remarcação", /Para qual dia/.test(text(r)), tudo(r));
  });
  await scenario("lembrete", "Agendamento cancelado pelo painel some da tabela (sincronização)", async () => {
    const c = novoCliente("Tais Painel");
    await agendarPorBotoes(c, { dia: /Amanhã/ });
    await sleep(1500);
    const ag = agendamentosDe(c)[0];
    apiSql(`UPDATE "Appointment" SET status = 'CANCELLED' WHERE id = '${ag.id}'`);
    n8nSql(`UPDATE {conversas} SET "sincronizadoEm" = '' WHERE phone = '+${c.waId}'`);
    await rodar("lembretes");
    await sleep(8000);
    check("marcado como CANCELADO na tabela", n8nSql(`SELECT status FROM {agendamentos} WHERE "appointmentId" = '${ag.id}'`) === "CANCELADO");
  });
  await scenario("lembrete", "Pós-atendimento: agradece e oferece agendar de novo", async () => {
    const c = novoCliente("Ugo Depois");
    await agendarPorBotoes(c, { dia: /Amanhã/ });
    await sleep(1500);
    const ag = agendamentosDe(c)[0];
    n8nSql(`UPDATE {agendamentos} SET "endAt" = to_char((now() - interval '2 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"') WHERE "appointmentId" = '${ag.id}'`);
    const since = await lastSeq(c.waId);
    check("WF13 roda pelo webhook", (await rodar("pos-atendimento")) === 200);
    const r = await waitBot(c, since, { timeoutMs: 30000, quietMs: 3000 });
    check("mensagem de agradecimento com 'Agendar próximo'", /Obrigado pela visita/.test(text(r)) && options(r).includes("Agendar próximo"), tudo(r));
    check("marcado CONCLUIDO", n8nSql(`SELECT status FROM {agendamentos} WHERE "appointmentId" = '${ag.id}'`) === "CONCLUIDO");
  });
}

if (runs("cota")) {
  await scenario("cota", "Cota mensal esgotada: não envia e registra alerta", async () => {
    const c = novoCliente("Vera Cota");
    await talk(c, { text: "oi" }, opts);
    const sent = apiSql(`SELECT COALESCE(SUM(sent),0) FROM "MessageUsage" WHERE "businessId" = '${BIZ}' AND month = to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM')`);
    apiSql(`UPDATE "Business" SET "monthlyMessageLimit" = ${Number(sent)} WHERE id = '${BIZ}'`);
    try {
      const r = await talk(c, { text: "quanto custa?" }, { ...opts, timeoutMs: 9000 });
      check("nada é enviado", r.length === 0, tudo(r));
      await sleep(1500);
      check("envio registrado como COTA_ESGOTADA", Number(n8nSql(`SELECT count(*) FROM {envios} WHERE status = 'COTA_ESGOTADA' AND para = '${c.waId}'`)) >= 1);
      check("alerta COTA_ESGOTADA registrado", Number(n8nSql(`SELECT count(*) FROM {erros} WHERE tipo = 'COTA_ESGOTADA'`)) >= 1);
    } finally {
      apiSql(`UPDATE "Business" SET "monthlyMessageLimit" = NULL WHERE id = '${BIZ}'`);
    }
  });
}

// ------------------------------------------------------------------ resultado
const total = results.flatMap((r) => r.checks);
const failed = total.filter((c) => !c.ok);
writeFileSync(process.env.BATERIA_OUT ?? "./bateria-nativo-resultado.json", JSON.stringify({ at: new Date().toISOString(), total: total.length, failed: failed.length, results, transcript }, null, 1));
console.log(`\n${results.length} cenários, ${total.length} verificações, ${failed.length} falharam`);
process.exit(failed.length ? 1 : 0);
