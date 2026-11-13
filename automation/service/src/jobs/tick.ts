import { DateTime } from "luxon";
import { db } from "../db/pool.js";
import type { Gateway } from "../convexa/gateway.js";
import { errorInfo, log } from "../lib/log.js";
import { brl } from "../lib/money.js";
import { dayOf, friendlyDay, nowIn } from "../lib/time.js";
import * as ops from "../owner/ops.js";
import { payments } from "../payments/repo.js";
import { links } from "../settings/links.js";
import * as wa from "../whatsapp/messages.js";
import type { Out } from "../whatsapp/messages.js";
import { Ctx, type Biz } from "../bot/context.js";
import { conversations, messageLog } from "../bot/conversations.js";
import { expire } from "../bot/customer/payment.js";
import { campaigns } from "../bot/owner/campaigns.js";
import { resolveBiz } from "../bot/engine.js";
import { syncGoogle } from "../google/sync.js";

export type Batch = { phoneNumberId: string; messages: Out[] };

/** Só um tick por vez, mesmo com mais de uma instância. */
async function lock(name: string, seconds: number): Promise<boolean> {
  const r = await db().query(
    `INSERT INTO job_lock (name, locked_until) VALUES ($1, now() + make_interval(secs => $2))
     ON CONFLICT (name) DO UPDATE SET locked_until = EXCLUDED.locked_until
       WHERE job_lock.locked_until < now()
     RETURNING name`,
    [name, seconds],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Marca uma tarefa como feita uma única vez (ex.: resumo do dia). */
async function once(key: string, ttlSeconds: number): Promise<boolean> {
  return lock(`once:${key}`, ttlSeconds);
}

export function systemCtx(biz: Biz, gw: Gateway): Ctx {
  return new Ctx(biz, gw, "system", { businessId: biz.businessId, phone: "system", waId: null, name: null, role: "owner", state: {}, pausedUntil: null, lastInboundAt: null }, {});
}

export async function tick(gw: Gateway): Promise<Batch[]> {
  if (!(await lock("tick", 240))) return [];
  const batches: Batch[] = [];
  try {
    for (const link of await links.active()) {
      if (!link.metaPhoneNumberId) continue;
      try {
        const biz = await resolveBiz(gw, link.metaPhoneNumberId);
        const ctx = systemCtx(biz, gw);
        await reminders(ctx);
        await expiredDeposits(ctx);
        await staleCampaigns(ctx);
        await dailySummary(ctx);
        if (biz.settings.google.enabled) await syncGoogle(ctx).catch((e) => log.warn("sync Google falhou", errorInfo(e)));
        if (ctx.out.length) {
          for (const o of ctx.out) await messageLog.outbound({ businessId: biz.businessId, phone: o.to, kind: o.body.type, body: o.preview, payload: o.body });
          batches.push({ phoneNumberId: link.metaPhoneNumberId, messages: ctx.out });
        }
      } catch (error) {
        log.error("tick falhou para empresa", { businessId: link.businessId, ...errorInfo(error) });
      }
    }
  } finally {
    await db().query("UPDATE job_lock SET locked_until = now() WHERE name = 'tick'");
  }
  return batches;
}

async function reminders(ctx: Ctx) {
  const s = ctx.settings.reminders;
  if (!s.enabled || s.hoursBefore.length === 0) return;
  const owner = await ctx.owner();
  if (!owner) return;
  const now = nowIn(ctx.tz);
  const maxH = Math.max(...s.hoursBefore);
  const list = (await owner.appointments({ from: now.toUTC().toISO()!, to: now.plus({ hours: maxH + 1 }).toUTC().toISO()! })).filter(
    (a) => a.status === "SCHEDULED" || a.status === "CONFIRMED",
  );
  for (const a of list) {
    const hoursAhead = DateTime.fromISO(a.startAt).diff(now, "hours").hours;
    // a janela de cada lembrete é [h-1, h] horas antes, para não lembrar quem marcou agora
    const kind = s.hoursBefore.filter((h) => hoursAhead <= h && hoursAhead > h - 1).sort((x, y) => x - y)[0];
    if (kind === undefined) continue;
    const ins = await db().query(
      "INSERT INTO reminder_sent (appointment_id, kind, start_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1",
      [a.id, `${kind}h`, a.startAt],
    );
    if (!ins.rowCount) continue;
    const start = DateTime.fromISO(a.startAt).setZone(ctx.tz);
    const date = dayOf(start);
    const time = start.toFormat("HH:mm");
    const first = a.customer.name.split(" ")[0] ?? "";
    const body =
      `Oi${first ? `, ${first}` : ""}! Lembrete do seu horário na *${ctx.biz.businessName}*:\n\n` +
      `✂️ ${a.service.name}\n📅 ${friendlyDay(date, ctx.tz)} às ${time}\n👤 com ${a.employee.name}` +
      (ctx.settings.address ? `\n📍 ${ctx.settings.address}` : "") +
      "\n\nVocê confirma?";
    await conversations.ensure(ctx.biz.businessId, a.customer.phone, a.customer.name);
    await ctx.to(
      a.customer.phone,
      wa.buttons(a.customer.phone, body, [
        { id: `rem:ok:${a.id}`, title: "Confirmo" },
        { id: `rem:resch:${a.id}`, title: "Remarcar" },
        { id: `rem:cancel:${a.id}`, title: "Cancelar" },
      ]),
      wa.template(
        a.customer.phone,
        "convexa_lembrete",
        [first || "cliente", ctx.biz.businessName, a.service.name, friendlyDay(date, ctx.tz), time, a.employee.name],
        [`rem:ok:${a.id}`, `rem:resch:${a.id}`, `rem:cancel:${a.id}`],
        `[template lembrete] ${body}`,
      ),
    );
  }
}

async function expiredDeposits(ctx: Ctx) {
  for (const p of await payments.list(ctx.biz.businessId, ["pending"], 50)) {
    if (p.expiresAt && p.expiresAt.getTime() < Date.now()) await expire(ctx, p);
  }
}

async function staleCampaigns(ctx: Ctx) {
  for (const c of await campaigns.stale(3)) {
    if (c.business_id !== ctx.biz.businessId) continue;
    await ctx.notifyOwner(
      `⏰ Ainda não responderam ao pedido de remarcação: ${c.names.join(", ")}. Vale ligar para ${c.names.length === 1 ? "esse cliente" : "eles"}.`,
    );
    await campaigns.markNoResponse(c.campaign_id);
  }
}

async function dailySummary(ctx: Ctx) {
  const s = ctx.settings.dailySummary;
  if (!s.enabled) return;
  const now = nowIn(ctx.tz);
  const [h, m] = s.time.split(":").map(Number);
  const at = now.startOf("day").set({ hour: h, minute: m });
  if (now < at || now > at.plus({ hours: 2 })) return;
  if (!(await once(`summary:${ctx.biz.businessId}:${dayOf(now)}`, 26 * 3600))) return;
  const owner = await ctx.owner();
  if (!owner) return;
  const items = (await ops.dayAgenda(owner, ctx.tz, dayOf(now))).filter((a) => a.status !== "CANCELLED");
  const pend = await payments.list(ctx.biz.businessId, ["under_review"], 20);
  const total = items.reduce((sum, a) => sum + a.priceCents, 0);
  const lines = [
    `☀️ Bom dia! Resumo de hoje na *${ctx.biz.businessName}*:`,
    "",
    items.length ? `${items.length} ${items.length === 1 ? "cliente marcado" : "clientes marcados"}, ${brl(total)} previstos.` : "Nenhum cliente marcado ainda.",
    ...items.slice(0, 12).map((a) => `• ${a.start} ${a.customer.name.split(" ")[0]} — ${a.service}`),
  ];
  if (pend.length) lines.push("", `🧾 ${pend.length} comprovante(s) esperando aprovação.`);
  await ctx.notifyOwner(lines.join("\n"), [
    { id: "o:free", title: "Horários livres" },
    { id: "o:menu", title: "Menu" },
  ]);
}
