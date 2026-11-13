import type { ConvAppointment, Service, Slot } from "../../convexa/types.js";
import { ConvexaError } from "../../convexa/types.js";
import { brl } from "../../lib/money.js";
import { formatPhoneBR } from "../../lib/phone.js";
import { capitalize, findByName, norm } from "../../lib/text.js";
import { PERIOD_LABEL, hhmm, wall } from "../../lib/time.js";
import { parseWhen, type Period } from "../../nlu/datetime.js";
import { byPeriod, dayCount, dayLabel, dayShort, daySlots, nearest, nextOpenDays, spread, toMinutes, uniqueTimes } from "../agenda.js";
import type { Ctx } from "../context.js";
import { yesNo } from "../nlu.js";
import { offerPayment } from "./payment.js";

const FLOW = "book";

type BookData = {
  serviceId?: string;
  serviceName?: string;
  price?: number;
  duration?: number;
  employeeId?: string; // uuid ou "any"
  employeeName?: string;
  date?: string;
  period?: Period;
  time?: number;
  slot?: { employeeId: string; employeeName: string | null; startAt: string; time: string };
  rescheduleId?: string;
  replaceId?: string;
  fromCampaign?: string;
};

const d = (ctx: Ctx) => ctx.data as BookData;

async function services(ctx: Ctx): Promise<Service[]> {
  const list = await (await ctx.customer()).services();
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Lê serviço, profissional, dia, hora e período de qualquer frase. */
async function absorb(ctx: Ctx, text: string): Promise<boolean> {
  let changed = false;
  const data = d(ctx);
  const list = await services(ctx);
  const svc = findByName(text, list, (s) => s.name);
  if (svc && svc.id !== data.serviceId) {
    Object.assign(data, { serviceId: svc.id, serviceName: svc.name, price: svc.priceCents, duration: svc.durationMinutes });
    delete data.slot;
    changed = true;
  }
  const owner = await ctx.owner();
  if (owner && /\bcom (o |a )?[a-z]/.test(norm(text))) {
    const emps = (await owner.employees()).filter((e) => e.active);
    const emp = findByName(text.replace(/.*\bcom\b/i, ""), emps, (e) => e.name);
    if (emp) {
      Object.assign(data, { employeeId: emp.id, employeeName: emp.name });
      delete data.slot;
      changed = true;
    }
  }
  if (/\b(qualquer|tanto faz|sem preferencia|qualquer um)\b/.test(norm(text))) {
    Object.assign(data, { employeeId: "any", employeeName: undefined });
    changed = true;
  }
  const when = parseWhen(text, ctx.tz);
  if (when.date && when.date !== data.date) {
    data.date = when.date;
    delete data.slot;
    changed = true;
  }
  const time = when.time ?? (when.range && when.range.start >= 0 ? when.range.start : undefined);
  if (time !== undefined) {
    data.time = time;
    delete data.slot;
    changed = true;
  }
  if (when.period) {
    data.period = when.period;
    changed = true;
  }
  return changed;
}

export async function startBooking(ctx: Ctx, text?: string, extra: Partial<BookData> = {}) {
  ctx.set(FLOW, "service", {});
  ctx.state.data = { ...extra };
  if (text) await absorb(ctx, text);
  await advance(ctx);
}

async function askService(ctx: Ctx) {
  const list = await services(ctx);
  if (list.length === 0) {
    ctx.say("No momento não há serviços disponíveis para agendar pelo WhatsApp. Já avisei o estabelecimento.");
    ctx.reset();
    return;
  }
  if (list.length === 1) {
    const s = list[0]!;
    Object.assign(d(ctx), { serviceId: s.id, serviceName: s.name, price: s.priceCents, duration: s.durationMinutes });
    return advance(ctx);
  }
  ctx.set(FLOW, "service");
  ctx.list(
    `${d(ctx).rescheduleId ? "" : "Vamos agendar! "}Qual ${ctx.v.service} você quer?`,
    "Ver opções",
    [{ rows: list.slice(0, 10).map((s) => ({ id: `s:${s.id}`, title: s.name, description: `${s.durationMinutes} min · ${brl(s.priceCents)}` })) }],
  );
}

async function askProfessional(ctx: Ctx): Promise<boolean> {
  const data = d(ctx);
  if (data.employeeId || !ctx.settings.askProfessional) return false;
  const owner = await ctx.owner();
  if (!owner) return false;
  const emps = (await owner.employees()).filter(
    (e) => e.active && (e.services ?? []).some((s) => ("serviceId" in s ? s.serviceId : s.id) === data.serviceId),
  );
  if (emps.length <= 1) {
    if (emps[0]) Object.assign(data, { employeeId: emps[0].id, employeeName: emps[0].name });
    return false;
  }
  ctx.set(FLOW, "professional");
  ctx.list(`Tem preferência de ${ctx.v.professional}?`, "Escolher", [
    {
      rows: [
        { id: "p:any", title: "Sem preferência", description: "O primeiro horário livre" },
        ...emps.slice(0, 9).map((e) => ({ id: `p:${e.id}`, title: e.name })),
      ],
    },
  ]);
  return true;
}

function employeeFilter(data: BookData) {
  return data.employeeId && data.employeeId !== "any" ? data.employeeId : undefined;
}

async function askDay(ctx: Ctx, note?: string) {
  const data = d(ctx);
  const days = await nextOpenDays(ctx, data.serviceId!, { employeeId: employeeFilter(data), from: data.date, count: 7 });
  if (days.length === 0) {
    ctx.say(`${note ? note + "\n\n" : ""}Não encontrei horário livre nas próximas semanas${data.employeeName ? ` com ${data.employeeName}` : ""}. Já avisei o estabelecimento para falar com você.`);
    await ctx.notifyOwner(`⚠️ ${await ctx.displayName()} (${formatPhoneBR(ctx.phone)}) queria ${data.serviceName} e não achou horário livre nas próximas semanas.`);
    ctx.reset();
    return;
  }
  delete data.date;
  ctx.set(FLOW, "day");
  ctx.list(
    `${note ? note + "\n\n" : ""}Qual dia fica melhor para ${data.serviceName}${data.employeeName ? ` com ${data.employeeName}` : ""}?`,
    "Ver dias",
    [
      {
        rows: [
          ...days.slice(0, 9).map((x) => ({
            id: `d:${x.date}`,
            title: capitalize(dayLabel(ctx, x.date).replace(/-feira/, "")),
            description: employeeFilter(data)
              ? `${x.total} ${x.total === 1 ? "horário livre" : "horários livres"}`
              : x.total <= 3 ? "Poucos horários" : "Horários disponíveis",
          })),
          { id: "d:other", title: "Outra data", description: "Digite o dia que você quer" },
        ],
      },
    ],
  );
}

function slotRow(ctx: Ctx, s: Slot, showName: boolean) {
  return {
    id: `t:${s.time}:${s.employeeId}`,
    title: s.time,
    description: showName && s.employeeName ? `com ${s.employeeName}` : undefined,
  };
}

async function askTime(ctx: Ctx) {
  const data = d(ctx);
  let slots = await daySlots(ctx, data.serviceId!, data.date!, employeeFilter(data));
  const showName = data.employeeId === "any" || !data.employeeId;
  if (showName) slots = uniqueTimes(slots);
  if (slots.length === 0) {
    return askDay(ctx, `${capitalize(dayLabel(ctx, data.date!))} não tem mais horário livre.`);
  }

  // Cliente pediu uma hora específica
  if (data.time !== undefined) {
    const wanted = data.time;
    delete data.time;
    const exact = slots.find((s) => toMinutes(s.time) === wanted);
    if (exact) return chooseSlot(ctx, exact);
    const options = nearest(slots, wanted);
    ctx.set(FLOW, "time");
    ctx.buttons(`Às ${hhmm(wanted)} não tenho. Os horários mais próximos ${dayLabel(ctx, data.date!)} são:`, [
      ...options.slice(0, 2).map((s) => ({ id: `t:${s.time}:${s.employeeId}`, title: s.time })),
      { id: "t:all", title: "Ver todos" },
    ]);
    return;
  }

  const groups = byPeriod(slots);
  if (data.period) {
    const inPeriod = groups[data.period];
    if (inPeriod.length > 0) slots = inPeriod;
    else {
      ctx.say(`${capitalize(dayLabel(ctx, data.date!))} de ${PERIOD_LABEL[data.period].toLowerCase()} não tenho, mas tenho nestes horários:`);
      delete data.period;
    }
  }

  if (slots.length > 10 && !data.period) {
    const periods = (Object.keys(groups) as Period[]).filter((p) => groups[p].length > 0);
    if (periods.length > 1) {
      ctx.set(FLOW, "period");
      ctx.buttons(
        `${capitalize(dayLabel(ctx, data.date!))} tenho ${slots.length} horários livres. Prefere qual período?`,
        periods.map((p) => ({ id: `pr:${p}`, title: `${PERIOD_LABEL[p]} (${groups[p].length})` })),
      );
      return;
    }
  }

  const shown = spread(slots, 10);
  ctx.set(FLOW, "time");
  ctx.list(
    `Horários ${dayLabel(ctx, data.date!)}${data.period ? ` de ${PERIOD_LABEL[data.period].toLowerCase()}` : ""} para ${data.serviceName}:` +
      (shown.length < slots.length ? `\n\nSe quiser outro horário, é só escrever (ex.: ${slots[1]?.time ?? "15:30"}).` : ""),
    "Ver horários",
    [{ rows: shown.map((s) => slotRow(ctx, s, showName && !employeeFilter(data))) }],
  );
}

function chooseSlot(ctx: Ctx, s: Slot) {
  const data = d(ctx);
  data.slot = { employeeId: s.employeeId, employeeName: s.employeeName, startAt: s.startAt, time: s.time };
  return askConfirm(ctx);
}

function summary(ctx: Ctx, data: BookData) {
  const lines = [
    `✂️ ${data.serviceName}`,
    `📅 ${capitalize(dayLabel(ctx, data.date!))}`,
    `🕒 ${data.slot!.time}`,
  ];
  if (data.slot!.employeeName) lines.push(`👤 com ${data.slot!.employeeName}`);
  if (data.price !== undefined) lines.push(`💰 ${brl(data.price)}`);
  return lines.join("\n");
}

function askConfirm(ctx: Ctx) {
  const data = d(ctx);
  ctx.set(FLOW, "confirm");
  ctx.buttons(`${data.rescheduleId ? "Novo horário" : "Confere para mim"}:\n\n${summary(ctx, data)}`, [
    { id: "c:yes", title: "Confirmar" },
    { id: "c:change", title: "Outro horário" },
    { id: "c:no", title: "Cancelar" },
  ]);
}

export async function advance(ctx: Ctx): Promise<void> {
  const data = d(ctx);
  if (!data.serviceId) return askService(ctx);
  if (await askProfessional(ctx)) return;
  if (!data.date) return askDay(ctx);
  if (!data.slot) {
    const total = await dayCount(ctx, data.serviceId, data.date, employeeFilter(data));
    if (total === 0) return askDay(ctx, `${capitalize(dayLabel(ctx, data.date))} não tenho horário livre${data.employeeName ? ` com ${data.employeeName}` : ""}.`);
    return askTime(ctx);
  }
  return askConfirm(ctx);
}

async function book(ctx: Ctx) {
  const data = d(ctx);
  const api = await ctx.customer();
  let appt: ConvAppointment;
  try {
    if (data.rescheduleId) {
      appt = await api.reschedule(data.rescheduleId, { startAt: data.slot!.startAt, employeeId: data.slot!.employeeId });
    } else {
      appt = await api.book({ serviceId: data.serviceId!, employeeId: data.slot!.employeeId, startAt: data.slot!.startAt });
      if (data.replaceId) await api.cancel(data.replaceId).catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof ConvexaError && (error.status === 409 || error.status === 422 || error.status === 400)) {
      delete data.slot;
      ctx.say("Esse horário acabou de ser ocupado 😕 Escolhe outro?");
      return askTime(ctx);
    }
    throw error;
  }

  const w = wall(appt.startAt, ctx.tz);
  const who = await ctx.displayName();
  const when = `${dayShort(ctx, w.date)} às ${w.time}`;

  if (data.rescheduleId) {
    ctx.say(`Pronto${ctx.firstName ? `, ${ctx.firstName}` : ""}! Remarquei para ${dayLabel(ctx, w.date)} às ${w.time}${appt.employee?.name ? ` com ${appt.employee.name}` : ""}. ✅`);
    const fromCampaign = await afterCampaign(ctx, appt.id, "rescheduled", `remarcou para ${when}`);
    if (!fromCampaign && ctx.settings.notifyOwner.reschedule) {
      await ctx.notifyOwner(`🔁 ${who} (${formatPhoneBR(ctx.phone)}) remarcou ${appt.service.name} para ${when} com ${appt.employee.name}.`);
    }
    ctx.reset();
    return;
  }

  const lines = [
    `Pronto${ctx.firstName ? `, ${ctx.firstName}` : ""}! Seu horário está marcado ✅`,
    "",
    summary(ctx, { ...data, slot: { ...data.slot!, employeeName: appt.employee?.name ?? data.slot!.employeeName } }),
  ];
  if (ctx.settings.address) lines.push("", `📍 ${ctx.settings.address}`);
  if (ctx.settings.prepayment.mode === "off") lines.push("", "Se precisar remarcar ou cancelar, é só me chamar.");
  ctx.say(lines.join("\n"));

  if (ctx.settings.notifyOwner.newBooking) {
    await ctx.notifyOwner(`📅 Novo agendamento: ${who} (${formatPhoneBR(ctx.phone)}) — ${appt.service.name}, ${when} com ${appt.employee.name}.`);
  }
  if (data.replaceId) await afterCampaign(ctx, data.replaceId, "rescheduled", `trocou para ${appt.service.name} ${when}`);
  ctx.reset();
  await offerPayment(ctx, appt);
}

async function afterCampaign(ctx: Ctx, appointmentId: string, status: string, detail: string): Promise<boolean> {
  const { campaigns } = await import("../owner/campaigns.js");
  return campaigns.resolveTarget(ctx, appointmentId, status, detail);
}

/** Respostas de botão/lista do fluxo de agendamento. */
export async function onReply(ctx: Ctx, id: string): Promise<boolean> {
  const data = d(ctx);
  if (id.startsWith("s:")) {
    const s = (await services(ctx)).find((x) => x.id === id.slice(2));
    if (!s) return false;
    if (ctx.state.flow !== FLOW) ctx.set(FLOW, "service", {});
    Object.assign(d(ctx), { serviceId: s.id, serviceName: s.name, price: s.priceCents, duration: s.durationMinutes });
    delete d(ctx).slot;
    await advance(ctx);
    return true;
  }
  if (ctx.state.flow !== FLOW) return false;
  if (id.startsWith("p:")) {
    const emp = id.slice(2);
    if (emp === "any") Object.assign(data, { employeeId: "any", employeeName: undefined });
    else {
      const owner = await ctx.owner();
      const e = owner ? (await owner.employees()).find((x) => x.id === emp) : undefined;
      Object.assign(data, { employeeId: emp, employeeName: e?.name });
    }
    delete data.slot;
    await advance(ctx);
    return true;
  }
  if (id === "d:other") {
    ctx.set(FLOW, "day_text");
    ctx.say("Qual dia? Pode escrever do seu jeito: *sexta*, *dia 20*, *20/11*…");
    return true;
  }
  if (id.startsWith("d:")) {
    data.date = id.slice(2);
    delete data.slot;
    delete data.period;
    await advance(ctx);
    return true;
  }
  if (id.startsWith("pr:")) {
    data.period = id.slice(3) as Period;
    await askTime(ctx);
    return true;
  }
  if (id === "t:all") {
    delete data.period;
    delete data.time;
    await askTime(ctx);
    return true;
  }
  if (id.startsWith("t:")) {
    const [, time, empId] = id.match(/^t:(\d{2}:\d{2}):(.+)$/) ?? [];
    if (!time || !empId) return false;
    // Confere se ainda está livre
    const slots = await daySlots(ctx, data.serviceId!, data.date!, empId);
    const s = slots.find((x) => x.time === time && x.employeeId === empId);
    if (!s) {
      ctx.say(`O horário das ${time} acabou de ser ocupado 😕`);
      await askTime(ctx);
      return true;
    }
    chooseSlot(ctx, s);
    return true;
  }
  if (id === "c:yes") {
    if (!data.slot) return advance(ctx).then(() => true);
    await book(ctx);
    return true;
  }
  if (id === "c:change") {
    delete data.slot;
    delete data.date;
    delete data.period;
    await advance(ctx);
    return true;
  }
  if (id === "c:no") {
    const resched = data.rescheduleId;
    ctx.reset();
    ctx.buttons(resched ? "Tudo bem, mantive seu horário como estava." : "Tudo bem, não marquei nada.", [
      { id: "m:book", title: "Agendar" },
      { id: "m:menu", title: "Menu" },
    ]);
    return true;
  }
  return false;
}

/** Texto livre enquanto o fluxo de agendamento está aberto. */
export async function onText(ctx: Ctx, text: string): Promise<boolean> {
  if (ctx.state.flow !== FLOW) return false;
  const data = d(ctx);
  const step = ctx.state.step;
  const t = norm(text);

  if (step === "confirm") {
    const yn = yesNo(text);
    if (yn === "yes") return onReply(ctx, "c:yes");
    if (yn === "no") return onReply(ctx, "c:no");
  }
  if (/\b(outro dia|outra data|outro horario|mudar|trocar)\b/.test(t)) {
    await onReply(ctx, /\bhorario\b/.test(t) && data.date ? "t:all" : "c:change");
    return true;
  }
  if (step === "day_text") {
    const when = parseWhen(text, ctx.tz);
    if (!when.date) {
      ctx.say("Não consegui entender o dia 🤔 Tenta assim: *sexta*, *amanhã*, *dia 20* ou *20/11*.");
      return true;
    }
  }
  if (step === "time") {
    const when = parseWhen(text, ctx.tz);
    const time = when.time ?? when.range?.start;
    if (time !== undefined && time >= 0 && !when.date) {
      data.time = time;
      await askTime(ctx);
      return true;
    }
  }
  const changed = await absorb(ctx, text);
  if (changed) {
    await advance(ctx);
    return true;
  }
  return false;
}

export async function reprompt(ctx: Ctx) {
  ctx.say("Não entendi 🤔 Escolhe uma das opções abaixo ou escreve de outro jeito.");
  const data = d(ctx);
  if (ctx.state.step === "confirm" && data.slot) return askConfirm(ctx);
  delete data.slot;
  await advance(ctx);
}

/** Usado pelo remarcar e pela campanha do dono. */
export async function startReschedule(ctx: Ctx, appt: ConvAppointment, extra: Partial<BookData> = {}) {
  ctx.set(FLOW, "day", {});
  ctx.state.data = {
    serviceId: appt.service.id,
    serviceName: appt.service.name,
    price: appt.priceCents,
    duration: appt.durationMinutes,
    employeeId: extra.employeeId ?? "any",
    rescheduleId: appt.id,
    ...extra,
  } satisfies BookData;
  await advance(ctx);
}

export { summary as bookingSummary };
