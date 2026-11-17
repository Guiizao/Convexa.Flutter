// WF03 — Verificando Disponibilidade: horários livres de um serviço num dia (a API decide:
// jornada, folgas, feriados, férias, bloqueios e conflitos). Se o dia não tem vaga e
// buscarProximos = true, procura nos dias seguintes. Devolve em ctx.result.
const servicoId = entrada.serviceId;
const dia = entrada.date;
const dias = Math.min(Math.max(+entrada.dias || 7, 0), 14);
if (!servicoId || !dia) {
  ctx.result = { erro: "serviceId e date são obrigatórios", status: 400 };
  return;
}
const consultar = (data) =>
  api("d:" + data, "GET", "/internal/conversation/availability", { query: { serviceId: servicoId, date: data, limit: 10, ...(entrada.employeeId ? { employeeId: entrada.employeeId } : {}) } });

const limite = entrada.buscarProximos ? dias : 0;
for (let i = 0; i <= limite; i++) {
  const data = somarDias(dia, i);
  const r = consultar(data);
  if (r.status === 0 || r.status >= 500 || r.status === 401) {
    ctx.result = { erro: r.erro ?? msgApi(r) ?? "falha ao consultar", status: r.status };
    return;
  }
  // 4xx (ex.: dia fechado) conta como "sem vaga nesse dia"
  if (ok(r) && r.body?.slots?.length) {
    ctx.result = { date: r.body.date, weekday: r.body.weekday, durationMinutes: r.body.durationMinutes, totalSlots: r.body.totalSlots, slots: r.body.slots, pedido: dia };
    return;
  }
}
ctx.result = { date: dia, slots: [], totalSlots: 0, semVagas: true, pedido: dia };
