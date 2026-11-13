// Teste ponta a ponta: simulador de WhatsApp -> n8n -> convexa-automacao -> ConvexaAPI -> n8n -> simulador.
// Pré-requisito: tudo no ar (ver automation/README.md). Uso: node e2e.mjs
const SIM = process.env.SIM_URL ?? "http://localhost:3200";
const OWNER = { waId: "5514999990000", name: "Rafael (dono)" };
const rnd = () => String(Math.floor(1000 + Math.random() * 8999));
let failures = 0;

async function api(path, body) {
  const r = await fetch(SIM + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return r.json();
}
async function lastSeq(waId) {
  const all = await api(`/api/messages?waId=${waId}`);
  return all.at(-1)?.seq ?? 0;
}
/** Manda e espera o bot ficar quieto por 2s. Devolve só as mensagens do bot. */
async function talk(who, body, { quietMs = 2500, timeoutMs = 25000 } = {}) {
  const since = await lastSeq(who.waId);
  await api("/api/send", { waId: who.waId, name: who.name, ...body });
  const start = Date.now();
  let last = [];
  let lastChange = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 400));
    const msgs = (await api(`/api/messages?waId=${who.waId}&since=${since}`)).filter((m) => m.from === "bot");
    if (msgs.length !== last.length) {
      last = msgs;
      lastChange = Date.now();
    } else if (msgs.length > 0 && Date.now() - lastChange > quietMs) break;
  }
  return last;
}
async function inbox(waId, since) {
  return (await api(`/api/messages?waId=${waId}&since=${since}`)).filter((m) => m.from === "bot");
}
const text = (msgs) => msgs.map((m) => m.text).join("\n---\n");
const button = (msgs, re) => {
  for (const m of [...msgs].reverse()) {
    for (const b of m.buttons ?? []) if (re.test(b.title)) return { replyId: b.id, title: b.title, kind: m.kind === "template" ? "template" : "button" };
    for (const s of m.sections ?? []) for (const r of s.rows) if (re.test(r.title)) return { replyId: r.id, title: r.title, kind: "list" };
  }
  throw new Error(`opção ${re} não encontrada em:\n${text(msgs)}`);
};
function check(name, cond, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}\n${detail.split("\n").map((l) => "      " + l).join("\n")}`);
  }
}
async function step(title, fn) {
  console.log(`\n▶ ${title}`);
  try {
    await fn();
  } catch (error) {
    failures++;
    console.log(`  ✗ erro: ${error.message}`);
  }
}

const cliente = { waId: `55149${rnd()}${rnd()}`, name: "Paula Teste" };

await step("Cliente agenda por texto livre (serviço + dia + hora numa frase)", async () => {
  let r = await talk(cliente, { text: "oi! queria marcar barba quinta às 16h" });
  if (/preferência/i.test(text(r))) r = await talk(cliente, button(r, /Sem preferência/));
  check("bot monta a confirmação", /Confere|Novo horário/.test(text(r)), text(r));
  r = await talk(cliente, button(r, /Confirmar/));
  check("agendamento confirmado", /Seu horário está marcado/.test(text(r)), text(r));
  check("oferece sinal por Pix", /sinal/i.test(text(r)), text(r));
  const ownerSince = await lastSeq(OWNER.waId);
  r = await talk(cliente, button(r, /^Sinal/));
  check("envia o código Pix copia e cola", r.some((m) => /^000201/.test(m.text)), text(r));
  check("envia o QR Code", r.some((m) => m.kind === "image"), text(r));
  // comprovante: PNG 1x1
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  r = await talk(cliente, { image: png });
  check("recebe o comprovante (mídia baixada pelo n8n)", /Recebi seu comprovante/.test(text(r)), text(r));
  const toOwner = await inbox(OWNER.waId, ownerSince);
  check("dono recebe a foto e os botões Aprovar/Recusar", toOwner.some((m) => m.buttons?.some((b) => b.title === "Aprovar")), text(toOwner));
  const approve = await talk(OWNER, button(toOwner, /Aprovar/));
  check("dono aprova", /Aprovado/.test(text(approve)), text(approve));
  const confirmed = await inbox(cliente.waId, 0);
  check("cliente recebe a confirmação do pagamento", confirmed.some((m) => /Pagamento de .* confirmado/.test(m.text)), text(confirmed.slice(-3)));
});

await step("Dono consulta agenda, horários livres e faturamento", async () => {
  let r = await talk(OWNER, { text: "o que eu tenho quinta?" });
  check("agenda de quinta lista a cliente", /Paula/.test(text(r)), text(r));
  r = await talk(OWNER, { text: "horários livres quinta" });
  check("mostra janelas livres", /Horários livres/.test(text(r)), text(r));
  r = await talk(OWNER, { text: "quanto faturei esse mês?" });
  check("faturamento do mês", /Faturamento/.test(text(r)) && /Lucro estimado/.test(text(r)), text(r));
});

await step("Dono bloqueia horário e pede para a cliente remarcar", async () => {
  let r = await talk(OWNER, { text: "quinta das 15h30 às 17h vou estar ocupado, reajusta minha agenda" });
  if (/de quem/i.test(text(r))) r = await talk(OWNER, button(r, /De todos/));
  check("bloqueia e acha a cliente afetada", /Bloqueei/.test(text(r)) && /Paula/.test(text(r)), text(r));
  const since = await lastSeq(cliente.waId);
  r = await talk(OWNER, button(r, /remarcar/i));
  check("confirma o envio aos clientes", /Mandei mensagem/.test(text(r)), text(r));
  const ask = await inbox(cliente.waId, since);
  check("cliente recebe o pedido de remarcação", ask.some((m) => /não vai poder ser mantido/.test(m.text)), text(ask));
  let c = await talk(cliente, button(ask, /Escolher horário/));
  c = await talk(cliente, { text: "sexta às 11h" });
  if (/preferência/i.test(text(c))) c = await talk(cliente, button(c, /Sem preferência/));
  check("cliente escolhe novo horário por texto", /Novo horário/.test(text(c)), text(c));
  const ownerSince = await lastSeq(OWNER.waId);
  c = await talk(cliente, button(c, /Confirmar/));
  check("remarcado", /Remarquei/.test(text(c)), text(c));
  const done = await inbox(OWNER.waId, ownerSince);
  check("dono é avisado (uma vez) que a cliente remarcou", done.filter((m) => /remarcou/.test(m.text)).length === 1, text(done));
});

await step("Cliente consulta e cancela", async () => {
  let r = await talk(cliente, { text: "quais são meus horários?" });
  check("lista o horário", /Seu horário marcado|Seus horários/.test(text(r)), text(r));
  r = await talk(cliente, { text: "quero cancelar" });
  check("pede confirmação e avisa que o sinal não volta", /Cancelar/.test(text(r)) && /não é devolvido/.test(text(r)), text(r));
  r = await talk(cliente, button(r, /Sim, cancelar/));
  check("cancelado", /Cancelado/.test(text(r)), text(r));
});

await step("Atendimento humano", async () => {
  const ownerSince = await lastSeq(OWNER.waId);
  const r = await talk(cliente, { text: "quero falar com um atendente" });
  check("cliente é avisado", /chamei alguém/.test(text(r)), text(r));
  const n = await inbox(OWNER.waId, ownerSince);
  check("dono é chamado", n.some((m) => /pediu para falar com uma pessoa/.test(m.text)), text(n));
  const quiet = await talk(cliente, { text: "oi?" }, { timeoutMs: 6000 });
  check("bot fica quieto enquanto o humano atende", quiet.length === 0, text(quiet));
  await talk(OWNER, button(n, /Reativar bot/));
});

console.log(failures ? `\n${failures} verificação(ões) falharam` : "\nTudo certo ✅");
process.exitCode = failures ? 1 : 0;
