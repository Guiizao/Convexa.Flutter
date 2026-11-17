// Junta a mensagem com o estado salvo da conversa (tabela convexa_conversas).
const m = $("Uma mensagem por vez").first().json;
const linha = $input.first().json ?? {};
let conv = {};
try { conv = linha.conversa ? JSON.parse(linha.conversa) : {}; } catch (e) { conv = {}; }
conv = { mode: "AI", flow: null, step: "IDLE", data: {}, ...conv };

// A Meta reenvia o mesmo evento se não recebeu 200 a tempo: não responde duas vezes
if (linha.lastMessageId && linha.lastMessageId === m.message.id) return [{ json: { ...m, duplicada: true } }];

const agora = Date.now();
const N = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const t = N(m.message.text);
const rid = m.message.replyId ?? "";
const parado = (h) => conv.stepAt && agora - Date.parse(conv.stepAt) > h * 3600e3;
const zerar = () => Object.assign(conv, { step: "IDLE", flow: null, data: {} });

// atendimento humano vence sozinho
if (conv.mode === "HUMAN" && conv.humanUntil && Date.parse(conv.humanUntil) < agora) Object.assign(conv, { mode: "AI", humanUntil: null });

if (conv.mode !== "HUMAN") {
  // conversa abandonada no meio: depois de 2 h recomeça (a resposta ao lembrete vale por 30 h)
  if (conv.step !== "IDLE" && parado(conv.step === "WAITING_APPOINTMENT_CONFIRMATION_REPLY" ? 30 : 2)) zerar();
  // "menu", "sair"... ou um botão do menu: recomeça de qualquer ponto
  if (/^(menu|inicio|voltar|sair|parar|reiniciar|comecar|recomecar|cancelar tudo)$/.test(t) || rid.startsWith("menu:")) zerar();
  // botão de um lembrete antigo: vai para a confirmação mesmo que a conversa tenha mudado
  if (rid.startsWith("lem:") && conv.step !== "WAITING_APPOINTMENT_CONFIRMATION_REPLY") Object.assign(conv, { step: "WAITING_APPOINTMENT_CONFIRMATION_REPLY", flow: "lembrete", data: { appointmentId: rid.split(":")[2] ?? null } });
}

return [{ json: { ...m, duplicada: false, conversation: conv, ultimaEntradaAnterior: linha.lastInboundAt ?? null, replies: [], events: [], alerts: [] } }];
