import { DateTime } from "luxon";
import type { ConvAppointment } from "../../convexa/types.js";
import { env } from "../../env.js";
import { errorInfo, log } from "../../lib/log.js";
import { brl, percentOf } from "../../lib/money.js";
import { e164ToWaId, formatPhoneBR } from "../../lib/phone.js";
import { signedUrl } from "../../lib/signed.js";
import { capitalize } from "../../lib/text.js";
import { shortDay, wall } from "../../lib/time.js";
import { analyzeReceipt } from "../../nlu/llm.js";
import { createPixCharge } from "../../payments/mercadopago.js";
import { brCode, randomTxid } from "../../payments/pix.js";
import { payments, type Payment } from "../../payments/repo.js";
import { settingsRepo, type BotSettings } from "../../settings/settings.js";
import * as wa from "../../whatsapp/messages.js";
import type { Ctx } from "../context.js";

export function paymentOptions(settings: BotSettings, priceCents: number) {
  const p = settings.prepayment;
  const deposit = p.depositType === "percent" ? Math.max(100, percentOf(priceCents, p.depositPercent)) : Math.min(p.depositFixedCents, priceCents);
  const discount = percentOf(priceCents, p.fullPaymentDiscountPercent);
  return { deposit: Math.min(deposit, priceCents), full: priceCents - discount, discount };
}

function paymentReady(settings: BotSettings, hasMpToken: boolean): string | undefined {
  const p = settings.prepayment;
  if (p.provider === "mercadopago") return hasMpToken ? undefined : "o token do Mercado Pago não está configurado";
  if (!p.pixKey) return "a chave Pix não está configurada";
  if (!p.merchantName || !p.merchantCity) return "o nome e a cidade do recebedor do Pix não estão configurados";
  return undefined;
}

/** Depois de agendar: oferece sinal / pagamento antecipado, conforme a configuração. */
export async function offerPayment(ctx: Ctx, appt: ConvAppointment) {
  const p = ctx.settings.prepayment;
  if (p.mode === "off" || appt.priceCents <= 0) return;
  const secrets = await settingsRepo.secrets(ctx.biz.businessId);
  const problem = paymentReady(ctx.settings, !!secrets.mercadoPagoAccessToken);
  if (problem) {
    log.warn("sinal ligado mas sem configuração", { businessId: ctx.biz.businessId, problem });
    await ctx.notifyOwner(`⚠️ O sinal está ligado, mas ${problem}. O cliente ${ctx.conv.name ?? formatPhoneBR(ctx.phone)} agendou sem pagar. Ajuste em Automação → Sinal e Pix.`);
    return;
  }
  const o = paymentOptions(ctx.settings, appt.priceCents);
  const w = wall(appt.startAt, ctx.tz);
  ctx.set("pay", "choose", {
    appointmentId: appt.id,
    summary: { service: appt.service.name, date: w.date, time: w.time, employee: appt.employee?.name, priceCents: appt.priceCents },
  });
  const btns: wa.Button[] = [{ id: "pay:dep", title: `Sinal ${brl(o.deposit)}` }];
  if (o.full > o.deposit) btns.push({ id: "pay:full", title: o.discount > 0 ? `Tudo ${brl(o.full)}` : `Total ${brl(o.full)}` });
  if (p.mode === "optional") btns.push({ id: "pay:local", title: "Pagar no local" });
  const discountLine = o.discount > 0 ? `\nPagando tudo agora você ganha ${p.fullPaymentDiscountPercent}% de desconto (${brl(o.full)} em vez de ${brl(appt.priceCents)}).` : "";
  ctx.buttons(
    p.mode === "required"
      ? `Para garantir o horário, falta só o sinal de ${brl(o.deposit)} por Pix, em até ${p.expiresMinutes} minutos. Depois disso o horário é liberado.${discountLine}`
      : `Quer adiantar o pagamento? O sinal de ${brl(o.deposit)} garante seu horário.${discountLine}`,
    btns,
  );
}

async function issue(ctx: Ctx, kind: "deposit" | "full") {
  const data = ctx.data as { appointmentId: string; summary: Payment["summary"] };
  if (!data.appointmentId) return false;
  const existing = (await payments.forAppointment(data.appointmentId)).find((x) => ["pending", "under_review", "paid"].includes(x.status));
  if (existing) {
    await sendPix(ctx, existing);
    return true;
  }
  const o = paymentOptions(ctx.settings, data.summary.priceCents);
  const amount = kind === "deposit" ? o.deposit : o.full;
  const discount = kind === "full" ? o.discount : 0;
  const expiresAt = DateTime.now().plus({ minutes: ctx.settings.prepayment.expiresMinutes }).toJSDate();
  const txid = randomTxid();
  const description = `${kind === "deposit" ? "Sinal" : "Pagamento"} ${data.summary.service} ${shortDay(data.summary.date, ctx.tz)} ${data.summary.time}`;

  let pixCode: string;
  let providerRef: string | undefined;
  if (ctx.settings.prepayment.provider === "mercadopago") {
    const secrets = await settingsRepo.secrets(ctx.biz.businessId);
    try {
      const charge = await createPixCharge({
        accessToken: secrets.mercadoPagoAccessToken!,
        amountCents: amount,
        description: `${ctx.biz.businessName} - ${description}`,
        externalReference: txid,
        payerEmail: `cliente.${e164ToWaId(ctx.phone)}@convexa.app`,
        // O aviso entra pelo n8n (workflow "Mercado Pago"), que repassa ao serviço com a chave.
        notificationUrl: mercadoPagoNotificationUrl(ctx.biz.businessId),
        expiresAt,
      });
      pixCode = charge.qrCode;
      providerRef = charge.id;
    } catch (error) {
      log.error("falha ao criar cobrança no Mercado Pago", errorInfo(error));
      ctx.say("Não consegui gerar o Pix agora 😕 Seu horário continua marcado e o estabelecimento vai falar com você sobre o pagamento.");
      await ctx.notifyOwner(`⚠️ Falha ao gerar Pix no Mercado Pago para ${ctx.conv.name ?? formatPhoneBR(ctx.phone)}: ${(error as Error).message}`);
      ctx.reset();
      return true;
    }
  } else {
    const p = ctx.settings.prepayment;
    pixCode = brCode({ key: p.pixKey, merchantName: p.merchantName, merchantCity: p.merchantCity, amountCents: amount, txid, description });
  }

  const payment = await payments.create({
    businessId: ctx.biz.businessId,
    appointmentId: data.appointmentId,
    customerPhone: ctx.phone,
    customerName: ctx.conv.name,
    kind,
    amountCents: amount,
    discountCents: discount,
    provider: ctx.settings.prepayment.provider,
    providerRef,
    txid,
    pixCode,
    summary: data.summary,
    expiresAt: ctx.settings.prepayment.mode === "required" || kind === "full" ? expiresAt : null,
  });
  await sendPix(ctx, payment);
  return true;
}

async function sendPix(ctx: Ctx, payment: Payment) {
  const s = payment.summary;
  const what = payment.kind === "deposit" ? "Sinal" : "Pagamento";
  ctx.say(
    `${what} de *${brl(payment.amountCents)}* — ${s.service}, ${shortDay(s.date, ctx.tz)} às ${s.time}.\n\n` +
      "Copie o código da próxima mensagem e cole no app do seu banco, em *Pix Copia e Cola*:",
  );
  ctx.say(payment.pixCode);
  ctx.push(
    wa.image(
      ctx.phone,
      signedUrl(`/v1/pix/${payment.id}.png`),
      payment.provider === "mercadopago"
        ? "Ou leia este QR Code. Assim que o pagamento cair eu confirmo aqui ✅"
        : "Ou leia este QR Code. Depois de pagar, me envie a *foto do comprovante* aqui 📎",
    ),
  );
  ctx.set("pay", "await", { paymentId: payment.id });
}

export async function onPaymentReply(ctx: Ctx, id: string): Promise<boolean> {
  if (id === "pay:dep") return issue(ctx, "deposit");
  if (id === "pay:full") return issue(ctx, "full");
  if (id === "pay:local") {
    ctx.reset();
    ctx.say("Combinado! Você paga no dia. Até lá 👋");
    return true;
  }
  return false;
}

/** Cliente mandou imagem/PDF: se houver pagamento em aberto, é comprovante. */
export async function onReceipt(ctx: Ctx, media: { mimeType: string; data: Buffer }): Promise<boolean> {
  const payment = await payments.openFor(ctx.biz.businessId, ctx.phone);
  if (!payment) return false;
  if (payment.provider === "mercadopago" && payment.status === "pending") {
    ctx.say("Obrigado! Assim que o Mercado Pago confirmar o Pix eu te aviso aqui. Costuma levar poucos segundos.");
    return true;
  }
  const analysis = await analyzeReceipt(media, { amountCents: payment.amountCents, merchantName: ctx.settings.prepayment.merchantName }).catch(
    () => undefined,
  );
  await payments.saveReceipt(payment.id, media, analysis);
  const updated = await payments.transition(payment.id, ["pending", "rejected", "under_review"], "under_review");
  if (!updated) return false;
  ctx.reset();
  ctx.say("Recebi seu comprovante! 🙌 Assim que for conferido eu confirmo seu horário aqui.");

  const s = payment.summary;
  const caption =
    `🧾 Comprovante de ${payment.customerName ?? "cliente"} (${formatPhoneBR(payment.customerPhone)})\n` +
    `${payment.kind === "deposit" ? "Sinal" : "Pagamento total"} de ${brl(payment.amountCents)} — ${s.service}, ${shortDay(s.date, ctx.tz)} às ${s.time}.` +
    (analysis?.summary ? `\n\n🔎 ${analysis.summary}` : "") +
    "\n\nConfira se o valor caiu na sua conta antes de aprovar.";
  for (const owner of ctx.biz.ownerPhones) {
    const open = await (await import("../conversations.js")).conversations.windowOpen(ctx.biz.businessId, owner);
    if (open) {
      ctx.push(wa.image(owner, signedUrl(`/v1/receipts/${payment.id}`), caption.slice(0, 1000)));
      ctx.push(
        wa.buttons(owner, `Aprovar o pagamento de ${payment.customerName ?? "cliente"}?`, [
          { id: `pv:ok:${payment.id}`, title: "Aprovar" },
          { id: `pv:no:${payment.id}`, title: "Recusar" },
        ]),
      );
    } else {
      ctx.push(
        wa.template(owner, "convexa_comprovante", [payment.customerName ?? "Cliente", brl(payment.amountCents), `${s.service} ${shortDay(s.date, ctx.tz)} ${s.time}`],
          [`pv:ok:${payment.id}`, `pv:no:${payment.id}`], `[template comprovante] ${caption}`),
      );
    }
  }
  return true;
}

/** Confirma o agendamento e avisa o cliente. Usado pelo dono e pelo webhook do Mercado Pago. */
export async function markPaid(ctx: Ctx, payment: Payment, decidedBy: string) {
  const paid = await payments.transition(payment.id, ["pending", "under_review", "rejected", "expired"], "paid", { decidedBy });
  if (!paid) return false;
  const owner = await ctx.owner();
  if (owner) {
    await owner.confirm(payment.appointmentId).catch((error) => log.warn("não confirmou o agendamento após pagamento", errorInfo(error)));
  }
  const s = payment.summary;
  const body =
    `Pagamento de ${brl(payment.amountCents)} confirmado! ✅\n\nSeu horário de ${s.service} está garantido: ` +
    `${capitalize(shortDay(s.date, ctx.tz))} às ${s.time}${s.employee ? ` com ${s.employee}` : ""}. Até lá!`;
  await ctx.to(
    payment.customerPhone,
    wa.text(payment.customerPhone, body),
    wa.template(payment.customerPhone, "convexa_pagamento_confirmado", [s.service, shortDay(s.date, ctx.tz), s.time, ctx.biz.businessName], [], `[template] ${body}`),
  );
  return true;
}

export async function reject(ctx: Ctx, payment: Payment, decidedBy: string) {
  const r = await payments.transition(payment.id, ["under_review", "pending"], "rejected", { decidedBy });
  if (!r) return false;
  const body =
    "Não consegui confirmar o seu pagamento 😕 Pode conferir se o Pix foi concluído e me mandar o comprovante de novo? " +
    "Se preferir, responda *atendente* para falar com a gente.";
  await ctx.to(
    payment.customerPhone,
    wa.text(payment.customerPhone, body),
    wa.template(payment.customerPhone, "convexa_aviso", [payment.customerName ?? "", ctx.biz.businessName, `${shortDay(payment.summary.date, ctx.tz)} ${payment.summary.time}`, "não conseguimos confirmar o seu pagamento, responda esta mensagem"], ["m:menu"], `[template] ${body}`),
  );
  return true;
}

/** Sinal não pago a tempo (modo obrigatório): libera o horário. */
export async function expire(ctx: Ctx, payment: Payment) {
  const r = await payments.transition(payment.id, ["pending"], "expired");
  if (!r) return false;
  if (ctx.settings.prepayment.mode !== "required" && payment.kind !== "deposit") return true;
  if (ctx.settings.prepayment.mode !== "required") return true;
  try {
    const api = await ctx.gw.customer(ctx.biz.phoneNumberId, payment.customerPhone);
    await api.cancel(payment.appointmentId);
  } catch (error) {
    log.warn("não cancelou agendamento de sinal vencido", errorInfo(error));
  }
  const s = payment.summary;
  const body = `O prazo do sinal acabou e o horário de ${s.service} (${shortDay(s.date, ctx.tz)} às ${s.time}) foi liberado. Se ainda quiser, é só responder *agendar* 🙂`;
  await ctx.to(
    payment.customerPhone,
    wa.buttons(payment.customerPhone, body, [{ id: "m:book", title: "Agendar de novo" }]),
    wa.template(payment.customerPhone, "convexa_sinal_expirado", [s.service, `${shortDay(s.date, ctx.tz)} ${s.time}`, ctx.biz.businessName], ["m:book"], `[template] ${body}`),
  );
  await ctx.notifyOwner(`⌛ Sinal não pago: liberei o horário de ${payment.customerName ?? formatPhoneBR(payment.customerPhone)} (${s.service}, ${shortDay(s.date, ctx.tz)} ${s.time}).`);
  return true;
}

/** URL que o Mercado Pago chama quando o Pix é pago. Sem o n8n público, não manda (o dono confirma à mão). */
export function mercadoPagoNotificationUrl(businessId: string): string | undefined {
  const base = env().N8N_PUBLIC_WEBHOOK_URL;
  return base ? `${base.replace(/\/+$/, "")}/mercadopago/${businessId}` : undefined;
}
