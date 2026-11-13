import type { Gateway } from "../convexa/gateway.js";
import { ConvexaError } from "../convexa/types.js";
import { errorInfo, log } from "../lib/log.js";
import { canonicalPhone, samePhone, waIdToE164, formatPhoneBR } from "../lib/phone.js";
import { dayOf, WEEKDAYS_FULL, weekdayIndex } from "../lib/time.js";
import { llmEnabled, rewrite } from "../nlu/llm.js";
import { payments } from "../payments/repo.js";
import { links } from "../settings/links.js";
import { settingsRepo } from "../settings/settings.js";
import type { InboundMessage } from "../whatsapp/inbound.js";
import * as wa from "../whatsapp/messages.js";
import type { Out } from "../whatsapp/messages.js";
import { Ctx, type Biz } from "./context.js";
import { conversations, messageLog } from "./conversations.js";
import * as booking from "./customer/booking.js";
import * as flows from "./customer/flows.js";
import { onPaymentReply, onReceipt } from "./customer/payment.js";
import { customerIntent, type CustomerIntent } from "./nlu.js";
import { onOwnerReply, onOwnerText, ownerMenu } from "./owner/commands.js";
import { ownerIntent } from "./nlu.js";

// ---------------------------------------------------------------- empresa
type Tenant = { businessId: string; name: string; timezone: string };
const tenantCache = new Map<string, { t: Tenant; at: number }>();

export async function resolveBiz(gw: Gateway, phoneNumberId: string): Promise<Biz> {
  let cached = tenantCache.get(phoneNumberId);
  if (!cached || Date.now() - cached.at > 5 * 60_000) {
    cached = { t: await gw.tenant(phoneNumberId), at: Date.now() };
    tenantCache.set(phoneNumberId, cached);
  }
  const t = cached.t;
  await links.ensure({ businessId: t.businessId, name: t.name, timezone: t.timezone, metaPhoneNumberId: phoneNumberId });
  let settings = await settingsRepo.get(t.businessId);
  if (settings.ownerPhones.length === 0) {
    // primeira vez: usa o telefone do dono cadastrado na empresa
    const owner = await gw.owner(t.businessId).catch(() => undefined);
    const phone = owner ? (await owner.business().catch(() => undefined))?.phone : undefined;
    if (phone) settings = await settingsRepo.update(t.businessId, { ownerPhones: [canonicalPhone(phone)] });
  }
  return {
    businessId: t.businessId,
    businessName: t.name,
    timezone: t.timezone,
    phoneNumberId,
    settings,
    ownerPhones: settings.ownerPhones.map(canonicalPhone),
  };
}

// ---------------------------------------------------------------- fila por conversa
const locks = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

// ---------------------------------------------------------------- entrada
export type Media = { mimeType: string; data: Buffer };

export async function handleInbound(gw: Gateway, msg: InboundMessage, media?: Media): Promise<Out[]> {
  const biz = await resolveBiz(gw, msg.phoneNumberId);
  const phone = waIdToE164(msg.waId);
  return serial(`${biz.businessId}:${phone}`, () => process(gw, biz, msg, phone, media));
}

async function process(gw: Gateway, biz: Biz, msg: InboundMessage, phone: string, media?: Media): Promise<Out[]> {
  const isOwner = biz.ownerPhones.some((p) => samePhone(p, phone));
  const conv = await conversations.touchInbound({
    businessId: biz.businessId,
    phone,
    waId: msg.waId,
    name: msg.name,
    role: isOwner ? "owner" : "customer",
  });
  const fresh = await messageLog.inbound({
    businessId: biz.businessId,
    phone,
    kind: msg.type,
    body: msg.text ?? (msg.media ? `[${msg.type}]` : undefined),
    payload: msg.replyId ? { replyId: msg.replyId } : undefined,
    wamid: msg.wamid,
  });
  if (!fresh) return []; // a Meta reenviou o mesmo webhook

  const ctx = new Ctx(biz, gw, phone, conv, { ...conv.state });
  try {
    const asCustomer = isOwner && ctx.state.actAsCustomerUntil && Date.parse(ctx.state.actAsCustomerUntil) > Date.now();
    if (isOwner && !asCustomer) await ownerTurn(ctx, msg);
    else if (isOwner && asCustomer && /\bmodo dono\b/i.test(msg.text ?? "")) {
      ctx.state.actAsCustomerUntil = undefined;
      ownerMenu(ctx, "👔 De volta ao modo dono.");
    } else await customerTurn(ctx, msg, media);
  } catch (error) {
    log.error("falha ao processar mensagem", { businessId: biz.businessId, ...errorInfo(error) });
    ctx.out.length = 0;
    if (error instanceof ConvexaError && error.status === 503) {
      ctx.say("Estou com uma instabilidade agora 😕 Tenta de novo em alguns minutos, por favor.");
    } else {
      ctx.reset();
      ctx.say("Desculpe, algo deu errado do meu lado 😕 Vamos de novo?");
      if (isOwner) ownerMenu(ctx);
      else flows.menu(ctx);
    }
  }

  await conversations.saveState(biz.businessId, phone, ctx.state);
  for (const o of ctx.out) {
    await messageLog.outbound({ businessId: biz.businessId, phone: o.to, kind: o.body.type, body: o.preview, payload: o.body });
  }
  return ctx.out;
}

// ---------------------------------------------------------------- dono
async function ownerTurn(ctx: Ctx, msg: InboundMessage) {
  if (msg.type === "reply" && msg.replyId) {
    if (await onOwnerReply(ctx, msg.replyId)) return;
    return ownerMenu(ctx);
  }
  if (msg.type !== "text" || !msg.text?.trim()) {
    return ownerMenu(ctx, "Por enquanto eu entendo texto e os botões. Escolha uma opção:");
  }
  if (await onOwnerText(ctx, msg.text)) return;
  if (llmEnabled() && ownerIntent(msg.text) === "unknown") {
    const r = await rewrite(msg.text, "owner", context(ctx, []));
    if (r && r.intent !== "unknown" && (await onOwnerText(ctx, r.canonical))) return;
  }
  ownerMenu(ctx, "Não entendi 🤔 Escolha uma opção ou escreva de outro jeito:");
}

function context(ctx: Ctx, services: string[]) {
  const now = ctx.now();
  return { today: dayOf(now), weekday: WEEKDAYS_FULL[weekdayIndex(now)]!, services };
}

// ---------------------------------------------------------------- cliente
async function customerTurn(ctx: Ctx, msg: InboundMessage, media?: Media) {
  // Atendimento humano em andamento: o bot fica quieto e repassa ao dono
  if (ctx.conv.pausedUntil && ctx.conv.pausedUntil.getTime() > Date.now()) {
    const body = `💬 ${ctx.conv.name ?? formatPhoneBR(ctx.phone)}: ${msg.text ?? `[${msg.type}]`}`;
    for (const owner of ctx.biz.ownerPhones) {
      if (await conversations.windowOpen(ctx.biz.businessId, owner)) ctx.push(wa.text(owner, body.slice(0, 1000)));
    }
    return;
  }
  if (!ctx.settings.agentEnabled) {
    const last = ctx.state.data?.awayAt as string | undefined;
    if (!last || Date.now() - Date.parse(last) > 6 * 3600_000) {
      ctx.say(`Olá! Recebemos sua mensagem na *${ctx.biz.businessName}* e vamos responder assim que possível 🙂`);
      ctx.state = { ...ctx.state, data: { ...(ctx.state.data ?? {}), awayAt: new Date().toISOString() } };
    }
    return;
  }

  if (msg.type === "reply" && msg.replyId) return customerReply(ctx, msg.replyId);

  if (msg.type === "image" || msg.type === "document") {
    if (media && (await onReceipt(ctx, media))) return;
    if (!media && (await payments.openFor(ctx.biz.businessId, ctx.phone))) {
      return ctx.say("Recebi o arquivo, mas não consegui abrir 😕 Pode mandar o comprovante de novo como foto?");
    }
    return flows.menu(ctx, "Recebi seu arquivo! Como posso ajudar?");
  }
  if (msg.type === "audio") return ctx.say("Ainda não consigo ouvir áudios 🙉 Pode escrever, por favor?");
  if (msg.type !== "text" || !msg.text?.trim()) return flows.menu(ctx);

  await customerText(ctx, msg.text);
}

async function customerReply(ctx: Ctx, id: string) {
  if (await booking.onReply(ctx, id)) return;
  if (await onPaymentReply(ctx, id)) return;
  if (await flows.onFlowReply(ctx, id)) return;

  let m = id.match(/^(cp|rem):(resch|cancel|ok):(.+)$/);
  if (m) {
    const [, , action, apptId] = m;
    const mine = (await (await ctx.customer()).appointments()).find((a) => a.id === apptId);
    if (action === "ok") {
      if (m[1] === "rem" && mine) {
        const owner = await ctx.owner();
        if (owner) await owner.confirm(mine.id).catch(() => undefined);
        return ctx.say("Presença confirmada! Obrigado, até lá 👋");
      }
      return ctx.say("Obrigado! 👍");
    }
    if (!mine) return flows.menu(ctx, "Esse horário não está mais ativo. Como posso ajudar?");
    if (action === "resch") return booking.startReschedule(ctx, mine, { fromCampaign: m[1] === "cp" ? apptId : undefined });
    return flows.onFlowReply(ctx, `a:cancel:${apptId}`).then(() => undefined);
  }
  m = id.match(/^o:menu$/);
  if (m) return flows.menu(ctx);
  flows.menu(ctx);
}

async function customerText(ctx: Ctx, text: string) {
  if (await booking.onText(ctx, text)) return;
  if (await flows.onFlowText(ctx, text)) return;

  let intent: CustomerIntent = customerIntent(text);
  let canonical = text;
  if (intent === "unknown" && llmEnabled()) {
    const services = (await (await ctx.customer()).services().catch(() => [])).map((s) => s.name);
    const r = await rewrite(text, "customer", context(ctx, services));
    if (r && r.intent !== "unknown") {
      intent = r.intent as CustomerIntent;
      canonical = r.canonical;
    }
  }

  switch (intent) {
    case "greeting":
    case "menu": {
      // "oi, tem horário amanhã?" já vira agendamento
      if (/\b(amanha|hoje|sexta|sabado|segunda|terca|quarta|quinta|\d{1,2}h)\b/i.test(text.normalize("NFD").replace(/[̀-ͯ]/g, ""))) {
        return booking.startBooking(ctx, canonical);
      }
      return flows.greet(ctx);
    }
    case "book":
      return booking.startBooking(ctx, canonical);
    case "my_appointments":
      return flows.myAppointments(ctx);
    case "reschedule":
      return flows.startResched(ctx, canonical);
    case "cancel":
      return flows.startCancel(ctx, canonical);
    case "confirm_presence": {
      const next = (await (await ctx.customer()).appointments())[0];
      if (next) {
        const owner = await ctx.owner();
        if (owner) await owner.confirm(next.id).catch(() => undefined);
        return ctx.say("Presença confirmada! Obrigado 👋");
      }
      return flows.myAppointments(ctx);
    }
    case "prices":
      return flows.prices(ctx);
    case "info":
      return flows.info(ctx);
    case "payment": {
      const open = await payments.openFor(ctx.biz.businessId, ctx.phone);
      if (open) {
        return ctx.say(
          open.status === "under_review"
            ? "Seu comprovante já está com a gente, em conferência. Assim que aprovar eu te aviso 🙂"
            : "Para enviar o comprovante, é só mandar a *foto* dele aqui nesta conversa 📎",
        );
      }
      return ctx.say(`Aceitamos ${ctx.settings.paymentMethodsText}.`);
    }
    case "human":
      return flows.handoff(ctx, text);
    case "thanks":
      return ctx.say("Por nada! Qualquer coisa é só chamar 😊");
    case "yes":
    case "no":
      return flows.menu(ctx);
    default:
      if (ctx.state.flow === "book") return booking.reprompt(ctx);
      return flows.menu(ctx, "Não entendi 🤔 Escolha uma das opções abaixo:");
  }
}
