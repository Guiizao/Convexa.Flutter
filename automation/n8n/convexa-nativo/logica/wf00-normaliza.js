// Transforma o evento (Meta ou formato de teste) em uma mensagem por item.
// Ignora status de entrega/leitura, reações e eventos de sistema.
const req = $("Ler requisição").first().json;
const body = req.body ?? {};
const cfg = req.cfg;
const out = [];

// Telefone no formato da API (+55DDNNNNNNNNN). O WhatsApp às vezes entrega celular do Brasil sem o 9.
const paraE164 = (wa) => {
  let d = String(wa ?? "").replace(/\D/g, "");
  if (/^55\d{10}$/.test(d) && /^[6-9]/.test(d.slice(4))) d = d.slice(0, 4) + "9" + d.slice(4);
  return d ? "+" + d : "";
};
const IGNORAR = new Set(["reaction", "system", "request_welcome", "unsupported", "ephemeral", "errors"]);

if (req.origem === "meta") {
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field && ch.field !== "messages") continue;
      const v = ch.value ?? {};
      const pnid = v.metadata?.phone_number_id;
      const contatos = v.contacts ?? [];
      for (const m of v.messages ?? []) {
        if (IGNORAR.has(m.type)) continue;
        const contato = contatos.find((x) => x.wa_id === m.from) ?? (contatos.length === 1 ? contatos[0] : {});
        // Com "usernames" (2026) a Meta pode mandar só o id do usuário, sem telefone. A agenda
        // identifica o cliente pelo telefone, então essas mensagens não têm como ser atendidas.
        const waId = String(m.from ?? contato.wa_id ?? "").replace(/\D/g, "");
        if (!waId) continue;
        let type = "text", text = "", replyId = "", title = "";
        if (m.type === "text") text = m.text?.body ?? "";
        else if (m.type === "interactive") {
          const r = m.interactive?.button_reply ?? m.interactive?.list_reply ?? {};
          type = "reply";
          replyId = r.id ?? "";
          title = r.title ?? "";
        } else if (m.type === "button") {
          type = "reply";
          replyId = m.button?.payload ?? "";
          title = m.button?.text ?? "";
        } else {
          type = "unsupported";
          text = m[m.type]?.caption ?? "";
        }
        out.push({
          json: {
            cfg,
            origem: "meta",
            requestId: `meta-${m.id}`,
            phoneNumberId: String(pnid ?? ""),
            waId,
            phone: paraE164(waId),
            profileName: contato.profile?.name ?? null,
            message: { id: m.id, type, text: String(text).trim().slice(0, 2000), replyId: String(replyId), title: String(title), timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString() },
          },
        });
      }
    }
  }
  out.sort((a, b) => a.json.message.timestamp.localeCompare(b.json.message.timestamp));
} else {
  // Formato simplificado dos nossos testes:
  // { requestId, phoneNumberId, customer: { phone, name }, message: { id, type, text, replyId } }
  const tel = String(body.customer?.phone ?? "").replace(/\D/g, "");
  if (!body.phoneNumberId) throw new Error("phoneNumberId obrigatório");
  if (!tel) throw new Error("Telefone do cliente obrigatório");
  const m = body.message ?? {};
  const replyId = String(m.replyId ?? "");
  if (!replyId && !String(m.text ?? "").trim()) throw new Error("Texto da mensagem obrigatório");
  out.push({
    json: {
      cfg,
      origem: "teste",
      requestId: body.requestId ?? `teste-${Date.now()}`,
      phoneNumberId: String(body.phoneNumberId),
      waId: tel,
      phone: paraE164(tel),
      profileName: body.customer?.name ?? null,
      message: { id: m.id ?? `teste-${Date.now()}`, type: replyId ? "reply" : "text", text: String(m.text ?? "").trim().slice(0, 2000), replyId, title: String(m.title ?? ""), timestamp: new Date().toISOString() },
    },
  });
}
return out;
