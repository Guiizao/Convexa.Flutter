// WF08 — Informações do Estabelecimento: endereço, horário de funcionamento, pagamento e contatos.
// A API não guarda esses textos, então eles ficam na tabela "convexa_empresas" do n8n (uma linha
// por número da Meta, coluna phoneNumberId). Sem linha, responde só com o nome da empresa.
const e = ctx.empresa ?? {};
ocioso();
const partesInfo = [
  e.endereco && `📍 *Endereço:* ${e.endereco}${e.mapsUrl ? `\n${e.mapsUrl}` : ""}`,
  e.horarios && `🕒 *Funcionamento:* ${e.horarios}`,
  e.pagamento && `💳 *Pagamento:* ${e.pagamento}`,
  e.telefone && `📞 *Telefone:* ${e.telefone}`,
  e.instagram && `📸 *Instagram:* ${e.instagram}`,
  e.site && `🌐 ${e.site}`,
  e.observacoes && `ℹ️ ${e.observacoes}`,
].filter(Boolean);
if (!partesInfo.length) {
  return botoes(`Aqui é o assistente da *${nomeEmpresa()}* 😊 Ainda não tenho o endereço e os horários cadastrados por aqui. Uma pessoa da equipe pode te passar:`, [["menu:atendente", "Falar com atendente"], ["menu:inicio", "Ver o menu"]]);
}
responder(`🏠 *${e.nome || nomeEmpresa()}*\n\n${partesInfo.join("\n\n")}`);
botoes("Posso ajudar em mais alguma coisa?", [["menu:agendar", "Agendar horário"], ["menu:inicio", "Ver o menu"]]);
