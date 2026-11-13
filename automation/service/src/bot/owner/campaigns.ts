import { db } from "../../db/pool.js";
import { formatPhoneBR } from "../../lib/phone.js";
import { capitalize } from "../../lib/text.js";
import { shortDay } from "../../lib/time.js";
import type { AgendaItem } from "../../owner/ops.js";
import * as wa from "../../whatsapp/messages.js";
import type { Ctx } from "../context.js";
import { conversations } from "../conversations.js";

/**
 * Campanha = o dono pediu para falar com vários clientes de uma vez:
 * - reschedule: "vou estar ocupado, reajusta" -> cada cliente escolhe novo horário
 * - notice: "avisa meus clientes que..." -> só aviso
 */
export const campaigns = {
  async create(ctx: Ctx, kind: "reschedule" | "notice", items: AgendaItem[], opts: { reason?: string; message?: string; createdBy: string }) {
    const r = await db().query<{ id: string }>(
      "INSERT INTO campaign (business_id, kind, reason, message, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [ctx.biz.businessId, kind, opts.reason ?? null, opts.message ?? null, opts.createdBy],
    );
    const id = r.rows[0]!.id;
    for (const a of items) {
      await db().query(
        `INSERT INTO campaign_target (campaign_id, appointment_id, customer_phone, customer_name) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [id, a.id, a.customer.phone, a.customer.name],
      );
      await conversations.ensure(ctx.biz.businessId, a.customer.phone, a.customer.name);
      if (kind === "reschedule") await sendReschedule(ctx, a, opts.reason);
      else await sendNotice(ctx, a, opts.message ?? "");
    }
    return id;
  },

  /** Cliente respondeu (remarcou/cancelou). Atualiza e avisa o dono. */
  async resolveTarget(ctx: Ctx, appointmentId: string, status: string, detail: string): Promise<boolean> {
    const r = await db().query<{ campaign_id: string; customer_name: string | null; customer_phone: string }>(
      `UPDATE campaign_target t SET status = $2, detail = $3, updated_at = now()
       FROM campaign c
       WHERE t.campaign_id = c.id AND c.status = 'open' AND c.kind = 'reschedule'
         AND t.appointment_id = $1 AND t.status = 'notified'
       RETURNING t.campaign_id, t.customer_name, t.customer_phone`,
      [appointmentId, status, detail],
    );
    const hit = r.rows[0];
    if (!hit) return false;
    const left = await db().query<{ n: string }>(
      "SELECT count(*) AS n FROM campaign_target WHERE campaign_id = $1 AND status = 'notified'",
      [hit.campaign_id],
    );
    const pending = Number(left.rows[0]?.n ?? 0);
    const icon = status === "rescheduled" ? "✅" : status === "cancelled" ? "❌" : "ℹ️";
    let body = `${icon} ${hit.customer_name ?? formatPhoneBR(hit.customer_phone)} ${detail}.`;
    if (pending === 0) {
      await db().query("UPDATE campaign SET status = 'done' WHERE id = $1", [hit.campaign_id]);
      body += "\nTodos os clientes afetados já responderam 👌";
    } else body += `\nFaltam ${pending} responder.`;
    await ctx.notifyOwner(body);
    return true;
  },

  async status(businessId: string, campaignId: string) {
    const r = await db().query(
      "SELECT customer_name, customer_phone, status, detail FROM campaign_target WHERE campaign_id = $1 ORDER BY notified_at",
      [campaignId],
    );
    return r.rows;
  },

  /** Quem não respondeu depois de X horas (o job avisa o dono uma vez). */
  async stale(hours: number) {
    const r = await db().query<{ business_id: string; campaign_id: string; names: string[] }>(
      `SELECT c.business_id, c.id AS campaign_id, array_agg(coalesce(t.customer_name, t.customer_phone)) AS names
       FROM campaign c JOIN campaign_target t ON t.campaign_id = c.id
       WHERE c.status = 'open' AND c.kind = 'reschedule' AND t.status = 'notified'
         AND t.notified_at < now() - make_interval(hours => $1)
       GROUP BY c.business_id, c.id`,
      [hours],
    );
    return r.rows;
  },

  async markNoResponse(campaignId: string) {
    await db().query("UPDATE campaign_target SET status = 'no_response', updated_at = now() WHERE campaign_id = $1 AND status = 'notified'", [
      campaignId,
    ]);
    await db().query("UPDATE campaign SET status = 'done' WHERE id = $1", [campaignId]);
  },
};

async function sendReschedule(ctx: Ctx, a: AgendaItem, reason?: string) {
  const when = `${shortDay(a.date, ctx.tz)} às ${a.start}`;
  const first = a.customer.name.split(" ")[0] ?? "";
  const body =
    `Olá${first ? `, ${first}` : ""}! Aqui é da *${ctx.biz.businessName}*. ` +
    `Precisamos ajustar a agenda${reason ? ` (${reason})` : ""} e o seu horário de ${a.service} (${capitalize(when)}) não vai poder ser mantido. ` +
    "Desculpe o transtorno 🙏 Escolha um novo horário:";
  await ctx.to(
    a.customer.phone,
    wa.buttons(a.customer.phone, body, [
      { id: `cp:resch:${a.id}`, title: "Escolher horário" },
      { id: `cp:cancel:${a.id}`, title: "Cancelar" },
    ]),
    wa.template(a.customer.phone, "convexa_remarcacao", [first || "cliente", ctx.biz.businessName, shortDay(a.date, ctx.tz), a.start], [
      `cp:resch:${a.id}`,
      `cp:cancel:${a.id}`,
    ], `[template remarcação] ${body}`),
  );
}

async function sendNotice(ctx: Ctx, a: AgendaItem, message: string) {
  const first = a.customer.name.split(" ")[0] ?? "";
  const body = `Olá${first ? `, ${first}` : ""}! Aviso da *${ctx.biz.businessName}* sobre seu horário de ${shortDay(a.date, ctx.tz)} às ${a.start}:\n\n${message}`;
  await ctx.to(
    a.customer.phone,
    wa.buttons(a.customer.phone, body, [
      { id: `cp:ok:${a.id}`, title: "Ok, entendi" },
      { id: `cp:resch:${a.id}`, title: "Remarcar" },
    ]),
    wa.template(a.customer.phone, "convexa_aviso", [first || "cliente", ctx.biz.businessName, `${shortDay(a.date, ctx.tz)} ${a.start}`, message], [
      `cp:ok:${a.id}`,
      `cp:resch:${a.id}`,
    ], `[template aviso] ${body}`),
  );
}
