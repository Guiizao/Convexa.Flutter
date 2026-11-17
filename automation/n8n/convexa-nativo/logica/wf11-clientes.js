// Quem precisa ser verificado nesta rodada:
// 1) clientes com horário ativo nas próximas (lembrete + 1) horas que ainda não receberam lembrete;
// 2) clientes que conversaram nos últimos 30 dias e não são sincronizados há 12 h (no máximo 30 por
//    rodada), para descobrir horários marcados pelo painel e cancelamentos.
// A API só lista agendamentos por cliente (token da conversa), por isso a verificação é por cliente.
const cfg = $("Config").first().json.cfg;
const convs = $("Conversas").all().map((i) => i.json).filter((r) => r.chave && r.phone && r.phoneNumberId);
const ags = $("Agendamentos").all().map((i) => i.json).filter((r) => r.appointmentId);
const agora = Date.now();
const H = 3600e3;
const alvo = new Map();
const porChave = new Map(convs.map((c) => [c.chave, c]));
const incluir = (chave, motivo) => {
  const c = porChave.get(chave);
  if (!c || alvo.has(chave)) return;
  alvo.set(chave, { cfg, chave, phoneNumberId: c.phoneNumberId, phone: c.phone, waId: c.waId, nome: c.nome, lastInboundAt: c.lastInboundAt, conversa: c.conversa, motivo });
};
for (const a of ags) {
  const ini = Date.parse(a.startAt);
  if (a.status === "ATIVO" && !a.lembreteEnviado && ini > agora && ini - agora <= (cfg.reminderHours + 1) * H) incluir(a.chave, "lembrete");
}
const parados = convs
  .filter((c) => Date.parse(c.lastInboundAt || 0) > agora - 30 * 24 * H && (!c.sincronizadoEm || Date.parse(c.sincronizadoEm) < agora - 12 * H))
  .sort((a, b) => String(a.sincronizadoEm || "").localeCompare(String(b.sincronizadoEm || "")))
  .slice(0, 30);
for (const c of parados) incluir(c.chave, "sincronizar");
return [...alvo.values()].map((json) => ({ json }));
