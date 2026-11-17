// Eventos da conversa → linhas da tabela convexa_agendamentos; alertas → WF14.
const j = $input.first().json ?? {};
const chave = `${j.phoneNumberId}:${j.phone}`;
const out = [];
const iso = (v) => (v ? new Date(v).toISOString() : "");
for (const ev of j.events ?? []) {
  if ((ev.tipo === "agendado" || ev.tipo === "remarcado") && ev.appointment?.id) {
    const a = ev.appointment;
    out.push({
      json: {
        tipo: "agendamento",
        linha: { appointmentId: a.id, chave, phoneNumberId: String(j.phoneNumberId), waId: String(j.waId), phone: String(j.phone), nome: String(j.nome ?? ""), servico: a.service?.name ?? "", profissional: a.employee?.name ?? "", startAt: iso(a.startAt), endAt: iso(a.endAt), data: a.date ?? "", hora: a.time ?? "", status: "ATIVO", lembreteEnviado: "", confirmado: "", posEnviado: "" },
      },
    });
  } else if (ev.tipo === "cancelado" && ev.appointmentId) out.push({ json: { tipo: "agendamento", linha: { appointmentId: ev.appointmentId, chave, status: "CANCELADO" } } });
  else if (ev.tipo === "confirmado" && ev.appointmentId) out.push({ json: { tipo: "agendamento", linha: { appointmentId: ev.appointmentId, chave, confirmado: new Date().toISOString() } } });
}
for (const a of j.alerts ?? []) out.push({ json: { tipo: "alerta", alerta: { origem: "WF00", ...a } } });
return out;
