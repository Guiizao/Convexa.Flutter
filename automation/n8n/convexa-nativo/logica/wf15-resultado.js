// Resultado de cada envio para a Meta (um item por mensagem). Nunca inclui o token.
const m = $("Montar mensagens").item.json;
const r = $input.item.json ?? {};
const st = Number(r.statusCode ?? 0);
const ok = st >= 200 && st < 300;
const e = r.body?.error ?? {};
const codigo = e.code ?? (r.error ? "rede" : "");
const linha = {
  em: new Date().toISOString(),
  phoneNumberId: m.phoneNumberId,
  para: m.to,
  tipo: m.tipo,
  status: ok ? "ENVIADO" : "ERRO",
  metaId: ok ? String(r.body?.messages?.[0]?.id ?? "") : "",
  erro: ok ? "" : `${codigo} ${e.message ?? r.error?.message ?? "HTTP " + st}`.trim().slice(0, 300),
  resumo: m.resumo,
  origem: m.origem,
};
// Erros que exigem ação da equipe (token vencido, número bloqueado, modelo inexistente...)
// 131047 = fora da janela de 24 h; 131026 = número sem WhatsApp; esses não viram alerta.
let alerta = null;
if (!ok && ![131047, 131026, 131049].includes(Number(codigo))) {
  const tipo = [190, 0].includes(Number(codigo)) || st === 401 ? "META_TOKEN_INVALIDO" : Number(codigo) === 132001 ? "MODELO_META_INEXISTENTE" : "ENVIO_META_FALHOU";
  alerta = { tipo, mensagem: `Falha ao enviar para a Meta: ${linha.erro}`, detalhe: { phoneNumberId: m.phoneNumberId, codigo, status: st, tipoMensagem: m.tipo }, chave: `${tipo}:${m.phoneNumberId}:${new Date().toISOString().slice(0, 13)}`, origem: "WF15" };
}
return { json: { linha, ...(alerta ? { alerta } : {}) } };
