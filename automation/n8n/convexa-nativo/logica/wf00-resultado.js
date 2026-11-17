// Estado final da conversa: vira a linha da tabela convexa_conversas.
const ctx = $input.first().json;
const conv = ctx.conversation ?? { mode: "AI", step: "IDLE", flow: null, data: {} };
const linha = {
  chave: `${ctx.phoneNumberId}:${ctx.phone}`,
  phoneNumberId: String(ctx.phoneNumberId ?? ""),
  waId: String(ctx.waId ?? ""),
  phone: String(ctx.phone ?? ""),
  nome: String(ctx.session?.customer?.name ?? ctx.profileName ?? ""),
  mode: conv.mode ?? "AI",
  step: conv.step ?? "IDLE",
  conversa: JSON.stringify(conv),
  lastMessageId: String(ctx.message?.id ?? ""),
  lastInboundAt: new Date().toISOString(),
};
return [{ json: linha }];
