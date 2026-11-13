import { DateTime } from "luxon";
import type { ConvAppointment } from "../../convexa/types.js";
import { brl } from "../../lib/money.js";
import { formatPhoneBR } from "../../lib/phone.js";
import { capitalize, norm } from "../../lib/text.js";
import { WEEKDAYS_FULL, hhmm, wall } from "../../lib/time.js";
import { payments } from "../../payments/repo.js";
import { dayLabel, dayShort } from "../agenda.js";
import type { Ctx } from "../context.js";
import { conversations } from "../conversations.js";
import { yesNo } from "../nlu.js";
import { startBooking, startReschedule } from "./booking.js";

// ------------------------------------------------------------------ menu
export async function greet(ctx: Ctx, opts: { withMenu?: boolean } = {}) {
  const hello = ctx.settings.greeting.trim() || `Olá${ctx.firstName ? `, ${ctx.firstName}` : ""}! 👋 Aqui é o atendimento automático da *${ctx.biz.businessName}*.`;
  let upcoming: ConvAppointment[] = [];
  try {
    upcoming = await (await ctx.customer()).appointments();
  } catch {
    // segue sem
  }
  const next = upcoming[0];
  const lines = [hello];
  if (next) {
    const w = wall(next.startAt, ctx.tz);
    lines.push("", `Você tem horário ${dayLabel(ctx, w.date)} às ${w.time} (${next.service.name}).`);
  }
  lines.push("", "Como posso ajudar?");
  if (opts.withMenu === false) return ctx.say(lines.join("\n"));
  menu(ctx, lines.join("\n"), !!next);
}

export function menu(ctx: Ctx, body = "Como posso ajudar?", hasAppointment = true) {
  ctx.reset();
  const rows = [
    { id: "m:book", title: "Agendar horário", description: `Escolha ${ctx.v.service}, dia e horário` },
    { id: "m:mine", title: "Meus horários", description: "Ver o que está marcado" },
  ];
  if (hasAppointment) {
    rows.push({ id: "m:resch", title: "Remarcar", description: "Mudar dia ou horário" });
    rows.push({ id: "m:cancel", title: "Cancelar horário", description: "Desmarcar um agendamento" });
  }
  rows.push({ id: "m:prices", title: "Serviços e preços", description: "Tabela de valores" });
  rows.push({ id: "m:info", title: "Endereço e horários", description: "Onde fica e quando abre" });
  rows.push({ id: "m:human", title: "Falar com atendente", description: "Chamar uma pessoa" });
  ctx.list(body, "Ver opções", [{ rows }]);
}

// ------------------------------------------------------------------ meus horários
export async function myAppointments(ctx: Ctx) {
  const list = await (await ctx.customer()).appointments();
  if (list.length === 0) {
    ctx.buttons("Você não tem nenhum horário marcado no momento.", [
      { id: "m:book", title: "Agendar" },
      { id: "m:menu", title: "Menu" },
    ]);
    return;
  }
  const lines = list.slice(0, 8).map((a) => {
    const w = wall(a.startAt, ctx.tz);
    const status = a.status === "CONFIRMED" ? " ✅" : "";
    return `• ${capitalize(dayShort(ctx, w.date))} às ${w.time} — ${a.service.name} com ${a.employee.name}${status}`;
  });
  ctx.buttons(`${list.length === 1 ? "Seu horário marcado" : "Seus horários marcados"}:\n\n${lines.join("\n")}`, [
    { id: "m:resch", title: "Remarcar" },
    { id: "m:cancel", title: "Cancelar" },
    { id: "m:book", title: "Agendar outro" },
  ]);
}

/** Se houver mais de um, pergunta qual. Devolve o escolhido ou undefined (pergunta enviada). */
async function pickAppointment(ctx: Ctx, flow: "cancel" | "resched", text?: string): Promise<ConvAppointment | undefined> {
  const list = await (await ctx.customer()).appointments();
  if (list.length === 0) {
    ctx.buttons("Não achei nenhum horário marcado no seu número.", [
      { id: "m:book", title: "Agendar" },
      { id: "m:human", title: "Atendente" },
    ]);
    ctx.reset();
    return undefined;
  }
  if (list.length === 1) return list[0];
  // tenta achar pelo texto ("o de sexta", "o das 15h")
  if (text) {
    const t = norm(text);
    const hit = list.filter((a) => {
      const w = wall(a.startAt, ctx.tz);
      const wd = norm(WEEKDAYS_FULL[w.dt.weekday % 7]!).split("-")[0]!;
      return t.includes(w.time.slice(0, 2) + "h") || t.includes(w.time) || t.includes(wd) || t.includes(norm(a.service.name));
    });
    if (hit.length === 1) return hit[0];
  }
  ctx.set(flow === "cancel" ? "cancel" : "resched", "pick");
  ctx.list(
    flow === "cancel" ? "Qual horário você quer cancelar?" : "Qual horário você quer remarcar?",
    "Escolher",
    [
      {
        rows: list.slice(0, 10).map((a) => {
          const w = wall(a.startAt, ctx.tz);
          return { id: `a:${flow}:${a.id}`, title: `${capitalize(dayShort(ctx, w.date))} ${w.time}`, description: `${a.service.name} com ${a.employee.name}` };
        }),
      },
    ],
  );
  return undefined;
}

function tooLate(ctx: Ctx, a: ConvAppointment): boolean {
  const min = ctx.settings.cancellation.minHoursBefore;
  if (!min) return false;
  return DateTime.fromISO(a.startAt).diffNow("hours").hours < min;
}

// ------------------------------------------------------------------ cancelar
export async function startCancel(ctx: Ctx, text?: string) {
  const a = await pickAppointment(ctx, "cancel", text);
  if (a) await askCancel(ctx, a);
}

async function askCancel(ctx: Ctx, a: ConvAppointment) {
  const w = wall(a.startAt, ctx.tz);
  if (tooLate(ctx, a)) {
    ctx.reset();
    ctx.buttons(
      `Seu horário é ${dayLabel(ctx, w.date)} às ${w.time}, daqui a menos de ${ctx.settings.cancellation.minHoursBefore}h. ` +
        "Para cancelar em cima da hora, fale direto com o estabelecimento.",
      [{ id: "m:human", title: "Falar com atendente" }],
    );
    return;
  }
  const paid = (await payments.forAppointment(a.id)).find((p) => p.status === "paid");
  const refundNote = paid
    ? ctx.settings.cancellation.depositRefundable
      ? `\n\nO valor que você pagou (${brl(paid.amountCents)}) será devolvido pelo estabelecimento.`
      : `\n\nAtenção: o ${paid.kind === "deposit" ? "sinal" : "pagamento"} de ${brl(paid.amountCents)} não é devolvido no cancelamento.`
    : "";
  ctx.set("cancel", "confirm", { appointmentId: a.id });
  ctx.buttons(`Cancelar ${a.service.name} de ${dayLabel(ctx, w.date)} às ${w.time}?${refundNote}`, [
    { id: `x:yes:${a.id}`, title: "Sim, cancelar" },
    { id: "x:no", title: "Não, manter" },
    { id: `a:resched:${a.id}`, title: "Prefiro remarcar" },
  ]);
}

async function doCancel(ctx: Ctx, id: string) {
  const api = await ctx.customer();
  const a = await api.cancel(id);
  const w = wall(a.startAt, ctx.tz);
  ctx.reset();
  ctx.buttons(`Cancelado. Seu horário de ${dayLabel(ctx, w.date)} às ${w.time} foi liberado.`, [
    { id: "m:book", title: "Agendar outro" },
    { id: "m:menu", title: "Menu" },
  ]);
  for (const p of await payments.forAppointment(id)) {
    if (p.status === "pending") await payments.transition(p.id, ["pending"], "cancelled");
  }
  const { campaigns } = await import("../owner/campaigns.js");
  const fromCampaign = await campaigns.resolveTarget(ctx, id, "cancelled", "cancelou");
  if (!fromCampaign && ctx.settings.notifyOwner.cancellation) {
    await ctx.notifyOwner(`❌ ${await ctx.displayName()} (${formatPhoneBR(ctx.phone)}) cancelou ${a.service.name} de ${dayShort(ctx, w.date)} às ${w.time}.`);
  }
}

// ------------------------------------------------------------------ remarcar
export async function startResched(ctx: Ctx, text?: string) {
  const a = await pickAppointment(ctx, "resched", text);
  if (a) await askResched(ctx, a);
}

async function askResched(ctx: Ctx, a: ConvAppointment) {
  if (tooLate(ctx, a)) {
    const w = wall(a.startAt, ctx.tz);
    ctx.reset();
    ctx.buttons(
      `Seu horário é ${dayLabel(ctx, w.date)} às ${w.time}, daqui a menos de ${ctx.settings.cancellation.minHoursBefore}h. Para mudar em cima da hora, fale com o estabelecimento.`,
      [{ id: "m:human", title: "Falar com atendente" }],
    );
    return;
  }
  ctx.set("resched", "what", { appointmentId: a.id });
  ctx.buttons(`O que você quer mudar em ${a.service.name} (${dayShort(ctx, wall(a.startAt, ctx.tz).date)} às ${wall(a.startAt, ctx.tz).time})?`, [
    { id: `r:time:${a.id}`, title: "Dia ou horário" },
    { id: `r:svc:${a.id}`, title: `Trocar ${ctx.v.service}`.slice(0, 20) },
    { id: "x:no", title: "Deixa como está" },
  ]);
}

async function findMine(ctx: Ctx, id: string) {
  return (await (await ctx.customer()).appointments()).find((a) => a.id === id);
}

// ------------------------------------------------------------------ informações
export async function prices(ctx: Ctx) {
  const list = await (await ctx.customer()).services();
  if (list.length === 0) return ctx.say("Ainda não temos serviços cadastrados.");
  const lines = list.map((s) => `• *${s.name}* — ${brl(s.priceCents)} (${s.durationMinutes} min)`);
  ctx.buttons(`Nossos ${ctx.v.service === "serviço" ? "serviços" : `${ctx.v.service}s`}:\n\n${lines.join("\n")}\n\nFormas de pagamento: ${ctx.settings.paymentMethodsText}.`, [
    { id: "m:book", title: "Agendar" },
    { id: "m:menu", title: "Menu" },
  ]);
}

export async function info(ctx: Ctx) {
  const lines: string[] = [`*${ctx.biz.businessName}*`];
  if (ctx.settings.address) lines.push(`📍 ${ctx.settings.address}`);
  if (ctx.settings.mapsUrl) lines.push(`🗺️ ${ctx.settings.mapsUrl}`);
  const owner = await ctx.owner();
  if (owner) {
    try {
      const b = await owner.business();
      if (b.hours?.length) {
        const byDay = new Map<number, string[]>();
        for (const h of b.hours) byDay.set(h.dayOfWeek, [...(byDay.get(h.dayOfWeek) ?? []), `${hhmm(h.opensAt)} às ${hhmm(h.closesAt)}`]);
        lines.push("", "🕒 Horário de funcionamento:");
        for (let d = 1; d <= 7; d++) {
          const day = d % 7;
          lines.push(`${capitalize(WEEKDAYS_FULL[day]!.replace("-feira", ""))}: ${byDay.get(day)?.join(", ") ?? "fechado"}`);
        }
      }
    } catch {
      // sem horário
    }
  }
  lines.push("", `💳 ${ctx.settings.paymentMethodsText}`);
  ctx.buttons(lines.join("\n"), [
    { id: "m:book", title: "Agendar" },
    { id: "m:menu", title: "Menu" },
  ]);
}

// ------------------------------------------------------------------ atendimento humano
export async function handoff(ctx: Ctx, lastText?: string) {
  const hours = ctx.settings.handoffHours;
  await conversations.pause(ctx.biz.businessId, ctx.phone, new Date(Date.now() + hours * 3600_000));
  ctx.reset();
  ctx.say("Certo! Já chamei alguém da equipe para falar com você. Enquanto isso, pode ir escrevendo sua dúvida por aqui 🙂");
  if (ctx.settings.notifyOwner.handoff) {
    await ctx.notifyOwner(
      `🙋 ${await ctx.displayName()} (${formatPhoneBR(ctx.phone)}) pediu para falar com uma pessoa.${lastText ? `\nÚltima mensagem: "${lastText.slice(0, 200)}"` : ""}\n\n` +
        `O bot ficou pausado para esse contato por ${hours}h. Responda pelo painel (Automação → Conversas).`,
      [{ id: `hb:${ctx.phone}`, title: "Reativar bot" }],
    );
  }
}

// ------------------------------------------------------------------ respostas
export async function onFlowReply(ctx: Ctx, id: string): Promise<boolean> {
  if (id === "m:menu") return (menu(ctx), true);
  if (id === "m:book") return startBooking(ctx).then(() => true);
  if (id === "m:mine") return myAppointments(ctx).then(() => true);
  if (id === "m:cancel") return startCancel(ctx).then(() => true);
  if (id === "m:resch") return startResched(ctx).then(() => true);
  if (id === "m:prices") return prices(ctx).then(() => true);
  if (id === "m:info") return info(ctx).then(() => true);
  if (id === "m:human") return handoff(ctx).then(() => true);

  let m = id.match(/^a:(cancel|resched):(.+)$/);
  if (m) {
    const a = await findMine(ctx, m[2]!);
    if (!a) return (ctx.say("Esse horário não está mais ativo."), true);
    if (m[1] === "cancel") await askCancel(ctx, a);
    else await askResched(ctx, a);
    return true;
  }
  m = id.match(/^x:yes:(.+)$/);
  if (m) return doCancel(ctx, m[1]!).then(() => true);
  if (id === "x:no") {
    ctx.reset();
    ctx.buttons("Combinado, nada mudou 👍", [{ id: "m:menu", title: "Menu" }]);
    return true;
  }
  m = id.match(/^r:(time|svc):(.+)$/);
  if (m) {
    const a = await findMine(ctx, m[2]!);
    if (!a) return (ctx.say("Esse horário não está mais ativo."), true);
    if (m[1] === "time") await startReschedule(ctx, a);
    else await startBooking(ctx, undefined, { replaceId: a.id });
    return true;
  }
  return false;
}

export async function onFlowText(ctx: Ctx, text: string): Promise<boolean> {
  const flow = ctx.state.flow;
  if (flow === "cancel" && ctx.state.step === "confirm") {
    const yn = yesNo(text);
    if (yn === "yes") return doCancel(ctx, ctx.data.appointmentId).then(() => true);
    if (yn === "no") return onFlowReply(ctx, "x:no");
  }
  if ((flow === "cancel" || flow === "resched") && ctx.state.step === "pick") {
    const kind = flow === "cancel" ? "cancel" : "resched";
    const a = await pickAppointment(ctx, kind, text);
    if (a) {
      if (kind === "cancel") await askCancel(ctx, a);
      else await askResched(ctx, a);
    }
    return true;
  }
  return false;
}
