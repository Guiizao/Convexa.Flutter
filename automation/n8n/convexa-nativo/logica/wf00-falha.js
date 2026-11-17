// Um subworkflow falhou: pede desculpas ao cliente, recomeça a conversa e avisa a equipe (WF14).
const base = $("Montar contexto").first().json;
const erro = $input.first().json ?? {};
const mensagem = String(erro.error?.message ?? erro.error ?? erro.message ?? "erro desconhecido").slice(0, 500);
let sessao = null;
try { sessao = $("Call 'Convexa - 10 Dados do Cliente'").first().json?.session ?? null; } catch (e) { sessao = null; }
return [
  {
    json: {
      ...base,
      session: sessao,
      conversation: { ...base.conversation, step: "IDLE", flow: null, data: {} },
      replies: [{ kind: "text", text: "Desculpe, tive um problema aqui 😕 Pode repetir, por favor? Se preferir, digite *atendente*." }],
      events: [],
      alerts: [{ tipo: "FALHA_NO_FLUXO", mensagem, detalhe: { passo: base.conversation?.step, texto: base.message?.text?.slice(0, 200) }, chave: `FALHA:${base.phoneNumberId}:${new Date().toISOString().slice(0, 13)}`, origem: "WF00" }],
    },
  },
];
