// WF09 — Transferência para Atendente.
// acao "transferir": passa a conversa para modo HUMAN (o bot fica quieto) e avisa a equipe.
// sem acao (conversa já em modo HUMAN): fica em silêncio, a não ser que o cliente peça o menu.
// O modo HUMAN expira sozinho depois de cfg.humanHours horas (ou quando o cliente manda "menu").
const e = ctx.empresa ?? {};
const VOLTAR = /^(menu|robo|bot|voltar|assistente|inicio|reiniciar|#bot)$/;

if (entrada.acao === "transferir") {
  const ate = new Date(Date.now() + cfg.humanHours * 3600e3).toISOString();
  ocioso();
  conv.mode = "HUMAN";
  conv.humanUntil = ate;
  const cliente = ctx.session?.customer?.name || ctx.profileName || "Cliente";
  const fone = String(ctx.phone ?? "").replace(/\D/g, "");
  const aviso = `🙋 *Pedido de atendimento*\n\n${cliente} (+${fone}) pediu para falar com uma pessoa.${entrada.motivo ? `\n\nÚltima mensagem: "${String(entrada.motivo).slice(0, 300)}"` : ""}\n\nResponder: https://wa.me/${fone}`;
  const atendente = String(e.telefoneAtendente ?? "").replace(/\D/g, "");
  // aviso pelo WhatsApp da empresa (só chega se o atendente falou com o número nas últimas 24h)
  if (atendente) ctx.replies.push({ kind: "text", to: atendente, text: aviso, interno: true });
  ctx.alerts.push({ tipo: "ATENDIMENTO_SOLICITADO", mensagem: aviso, detalhe: { telefone: fone, nome: cliente }, chave: `ATENDIMENTO:${fone}:${new Date().toISOString().slice(0, 13)}`, aviso: true });
  return responder(`Certo${nomeCliente() ? ", " + nomeCliente() : ""}! Já avisei a equipe da *${nomeEmpresa()}* e uma pessoa vai falar com você em breve 🙋\n\nSe quiser voltar a falar comigo, é só mandar *menu*.`);
}

if (VOLTAR.test(nt) || RID === "menu:inicio") {
  conv.mode = "AI";
  conv.humanUntil = null;
  ocioso();
  return menu("Voltei! 🤖 Como posso ajudar?");
}
ctx.result = { silencio: true };
