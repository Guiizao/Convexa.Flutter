import { brl } from "../../lib/money.js";
import { formatPhoneBR } from "../../lib/phone.js";
import { capitalize, findByName, norm } from "../../lib/text.js";
import { dayOf, friendlyDay, hhmm, shortDay, wall } from "../../lib/time.js";
import { parseWhen } from "../../nlu/datetime.js";
import * as ops from "../../owner/ops.js";
import { payments } from "../../payments/repo.js";
import { settingsRepo } from "../../settings/settings.js";
import type { Ctx } from "../context.js";
import { conversations } from "../conversations.js";
import { delayMinutes, noticeText, ownerIntent, yesNo, type OwnerIntent } from "../nlu.js";
import { markPaid, reject } from "../customer/payment.js";
import { campaigns } from "./campaigns.js";

const FLOW = "owner";

async function ownerApi(ctx: Ctx) {
  const api = await ctx.owner();
  if (!api) {
    ctx.say(
      "Para eu acessar a agenda completa, conecte a automação no painel: *Automação → Conectar*. " +
        "É só confirmar a sua senha uma vez.",
    );
  }
  return api;
}

export function ownerMenu(ctx: Ctx, intro?: string) {
  ctx.reset();
  ctx.list(
    intro ?? `Olá! Sou o assistente da *${ctx.biz.businessName}*. O que você precisa?\n\nPode tocar numa opção ou escrever do seu jeito, por exemplo: _"amanhã das 12 às 14 vou estar ocupado"_.`,
    "Ver comandos",
    [
      {
        title: "Agenda",
        rows: [
          { id: "o:today", title: "Agenda de hoje" },
          { id: "o:tomorrow", title: "Agenda de amanhã" },
          { id: "o:next", title: "Próximo cliente" },
          { id: "o:free", title: "Horários livres hoje" },
        ],
      },
      {
        title: "Gestão",
        rows: [
          { id: "o:rev:month", title: "Faturamento do mês" },
          { id: "o:block", title: "Bloquear horário", description: "e remarcar quem estiver marcado" },
          { id: "o:notice", title: "Avisar clientes", description: "manda um recado para os clientes do dia" },
          { id: "o:pending", title: "Comprovantes", description: "pagamentos esperando aprovação" },
          { id: ctx.settings.agentEnabled ? "o:pause" : "o:resume", title: ctx.settings.agentEnabled ? "Pausar o bot" : "Ativar o bot" },
          { id: "o:as_customer", title: "Testar como cliente", description: "por 30 minutos" },
        ],
      },
    ],
  );
}

// ------------------------------------------------------------------ agenda
async function agenda(ctx: Ctx, date: string) {
  const api = await ownerApi(ctx);
  if (!api) return;
  const items = await ops.dayAgenda(api, ctx.tz, date);
  const active = items.filter((a) => a.status !== "COMPLETED");
  const label = friendlyDay(date, ctx.tz);
  if (items.length === 0) {
    ctx.buttons(`${capitalize(label)} você não tem nenhum cliente marcado.`, [
      { id: `o:free:${date}`, title: "Ver horários livres" },
      { id: "o:menu", title: "Menu" },
    ]);
    return;
  }
  const total = items.reduce((s, a) => s + a.priceCents, 0);
  const lines = items.map((a) => {
    const mark = a.status === "CONFIRMED" ? "✅" : a.status === "COMPLETED" ? "✔️" : "•";
    return `${mark} *${a.start}* ${a.customer.name.split(" ").slice(0, 2).join(" ")} — ${a.service}${ctx.settings.askProfessional ? ` (${a.employee})` : ""}`;
  });
  ctx.buttons(
    `📅 Agenda de ${label} (${items.length} ${items.length === 1 ? "cliente" : "clientes"}, ${brl(total)}):\n\n${lines.join("\n")}` +
      (active.length < items.length ? `\n\n✔️ = já atendido` : ""),
    [
      { id: `o:free:${date}`, title: "Horários livres" },
      { id: `o:notice:${date}`, title: "Avisar clientes" },
      { id: "o:menu", title: "Menu" },
    ],
  );
}

async function next(ctx: Ctx) {
  const api = await ownerApi(ctx);
  if (!api) return;
  const a = await ops.nextAppointment(api, ctx.tz);
  if (!a) return ctx.say("Não tem mais nenhum cliente marcado nos próximos 7 dias.");
  ctx.say(
    `👤 Próximo: *${a.customer.name}* — ${a.service}\n🕒 ${capitalize(friendlyDay(a.date, ctx.tz))} às ${a.start} com ${a.employee}\n📞 ${formatPhoneBR(a.customer.phone)}\n💰 ${brl(a.priceCents)}${a.status === "CONFIRMED" ? "\n✅ Presença/pagamento confirmado" : ""}`,
  );
}

async function free(ctx: Ctx, date: string) {
  const api = await ownerApi(ctx);
  if (!api) return;
  const result = await ops.freeWindows(api, ctx.tz, date);
  const label = friendlyDay(date, ctx.tz);
  const withGaps = result.filter((r) => r.windows.length > 0);
  if (withGaps.length === 0) return ctx.say(`${capitalize(label)} a agenda está cheia. Nenhum horário livre.`);
  const lines = withGaps.map((r) => `*${r.employee}*: ${r.windows.map((w) => `${w.start}–${w.end}`).join(", ")}`);
  ctx.buttons(`🟢 Horários livres ${label}:\n\n${lines.join("\n")}`, [
    { id: `o:block:${date}`, title: "Bloquear horário" },
    { id: "o:menu", title: "Menu" },
  ]);
}

function periodFrom(text: string): ops.RevenuePeriod {
  const t = norm(text);
  if (/\bhoje\b|\bdo dia\b/.test(t)) return "today";
  if (/\bsemana\b/.test(t)) return "week";
  if (/\bmes passado\b|\bultimo mes\b/.test(t)) return "last_month";
  return "month";
}

async function revenue(ctx: Ctx, period: ops.RevenuePeriod, askedProfit = false) {
  const api = await ownerApi(ctx);
  if (!api) return;
  const r = await ops.revenue(api, ctx.tz, ctx.biz.businessId, period, ctx.settings.costPercent);
  const realized = r.done.cents + r.unclosed.cents;
  const lines = [`💰 Faturamento ${r.label}`, "", `Realizado: *${brl(realized)}* em ${r.done.count + r.unclosed.count} atendimentos`];
  if (r.unclosed.count > 0) lines.push(`  (${r.unclosed.count} ainda sem baixa no painel)`);
  if (r.upcoming.count > 0) lines.push(`A receber: ${brl(r.upcoming.cents)} em ${r.upcoming.count} agendamentos`);
  if (realized + r.upcoming.cents > 0) lines.push(`Previsto no total: ${brl(realized + r.upcoming.cents)}`);
  const count = r.done.count + r.unclosed.count;
  if (count > 0) lines.push(`Ticket médio: ${brl(Math.round(realized / count))}`);
  if (r.discountsCents > 0) lines.push(`Descontos do Pix antecipado: −${brl(r.discountsCents)}`);
  if (r.cancelled > 0) lines.push(`Cancelados: ${r.cancelled}`);
  if (r.topService) lines.push(`Mais pedido: ${r.topService.name} (${r.topService.count}x)`);
  if (r.estimatedProfitCents !== null) {
    lines.push("", `📈 Lucro estimado ${r.label}: *${brl(r.estimatedProfitCents)}*`, `(previsto total, menos descontos, com custo de ${r.costPercent}%)`);
  } else if (askedProfit) {
    lines.push("", "Para calcular o lucro, informe seu custo médio (% do faturamento) no painel, em Automação → Relatórios.");
  }
  ctx.buttons(lines.join("\n"), [
    { id: period === "month" ? "o:rev:week" : "o:rev:month", title: period === "month" ? "Ver a semana" : "Ver o mês" },
    { id: "o:rev:today", title: "Ver hoje" },
    { id: "o:menu", title: "Menu" },
  ]);
}

// ------------------------------------------------------------------ bloquear e reajustar
type BlockData = { date?: string; start?: number; end?: number; employeeId?: string | null; reason?: string };

async function startBlock(ctx: Ctx, text: string, intent: OwnerIntent) {
  const when = parseWhen(text, ctx.tz);
  const data: BlockData = { date: when.date ?? (intent === "leave_early" ? dayOf(ctx.now()) : undefined) };
  if (when.allDay || intent === "day_off") {
    data.start = 0;
    data.end = 24 * 60 - 1;
  } else if (when.range) {
    data.start = when.range.start >= 0 ? when.range.start : 0;
    data.end = when.range.end ?? (intent === "arrive_late" ? when.range.start : 24 * 60 - 1);
  } else if (when.time !== undefined) {
    if (intent === "leave_early") {
      data.start = when.time;
      data.end = 24 * 60 - 1;
    } else if (intent === "arrive_late") {
      data.start = 0;
      data.end = when.time;
    } else {
      data.start = when.time;
    }
  }
  if (intent === "arrive_late" && data.end !== undefined && data.start === undefined) data.start = 0;
  ctx.set(FLOW, "block", data);
  await advanceBlock(ctx);
}

async function advanceBlock(ctx: Ctx) {
  const data = ctx.data as BlockData;
  if (!data.date) {
    ctx.set(FLOW, "block_when");
    return ctx.say("Qual dia e horário você quer bloquear? Ex.: _amanhã das 12 às 14_, _sexta o dia todo_, _hoje a partir das 17h_.");
  }
  if (data.start === undefined) {
    ctx.set(FLOW, "block_when");
    return ctx.say(`Qual horário de ${friendlyDay(data.date, ctx.tz)}? Ex.: _das 12 às 14_, _a partir das 17h_, _o dia todo_.`);
  }
  if (data.end === undefined) {
    ctx.set(FLOW, "block_until");
    return ctx.say(`Até que horas a partir das ${hhmm(data.start)}?`);
  }
  if (data.employeeId === undefined) {
    const api = await ownerApi(ctx);
    if (!api) return;
    const emps = (await api.employees()).filter((e) => e.active);
    if (ctx.settings.ownerEmployeeId && emps.some((e) => e.id === ctx.settings.ownerEmployeeId)) data.employeeId = ctx.settings.ownerEmployeeId;
    else if (emps.length <= 1) data.employeeId = emps[0]?.id ?? null;
    else {
      ctx.set(FLOW, "block_who");
      ctx.list("Bloquear a agenda de quem?", "Escolher", [
        { rows: [{ id: "ob:who:all", title: "De todos", description: "o estabelecimento inteiro" }, ...emps.slice(0, 9).map((e) => ({ id: `ob:who:${e.id}`, title: e.name }))] },
      ]);
      return;
    }
  }
  await doBlock(ctx);
}

async function doBlock(ctx: Ctx) {
  const data = ctx.data as BlockData;
  const api = await ownerApi(ctx);
  if (!api) return;
  const res = await ops.blockTime(api, ctx.tz, {
    date: data.date!,
    startMin: data.start!,
    endMin: data.end!,
    employeeId: data.employeeId ?? undefined,
    reason: data.reason ?? "Compromisso do dono",
  });
  const range = data.start === 0 && data.end! >= 24 * 60 - 1 ? "o dia todo" : data.end! >= 24 * 60 - 1 ? `a partir das ${hhmm(data.start!)}` : data.start === 0 ? `até as ${hhmm(data.end!)}` : `das ${hhmm(data.start!)} às ${hhmm(data.end!)}`;
  const label = `${friendlyDay(data.date!, ctx.tz)} ${range}`;
  if (res.conflicts.length === 0) {
    ctx.reset();
    ctx.buttons(`🔒 Pronto, bloqueei ${label}. Não tinha nenhum cliente marcado nesse intervalo, e ninguém mais consegue agendar ali.`, [
      { id: `o:undo:${res.blockId}`, title: "Desfazer" },
      { id: "o:menu", title: "Menu" },
    ]);
    return;
  }
  ctx.set(FLOW, "block_conflicts", { blockId: res.blockId, conflicts: res.conflicts, label });
  const lines = res.conflicts.map((a) => `• ${a.start} ${a.customer.name} — ${a.service}`);
  ctx.buttons(
    `🔒 Bloqueei ${label}. Mas ${res.conflicts.length === 1 ? "tem 1 cliente marcado" : `tem ${res.conflicts.length} clientes marcados`} nesse intervalo:\n\n${lines.join("\n")}\n\nO que eu faço com ${res.conflicts.length === 1 ? "ele" : "eles"}?`,
    [
      { id: "ob:resched", title: "Pedir p/ remarcar" },
      { id: "ob:cancel", title: "Cancelar e avisar" },
      { id: "ob:keep", title: "Deixar como está" },
    ],
  );
}

async function onConflictChoice(ctx: Ctx, choice: "resched" | "cancel" | "keep") {
  const data = ctx.data as { conflicts: ops.AgendaItem[]; label: string };
  if (!data.conflicts?.length) return ownerMenu(ctx);
  if (choice === "keep") {
    ctx.reset();
    return ctx.say("Ok, os agendamentos continuam como estão. O bloqueio só impede novos agendamentos nesse intervalo.");
  }
  if (choice === "resched") {
    await campaigns.create(ctx, "reschedule", data.conflicts, { reason: undefined, createdBy: "whatsapp" });
    ctx.reset();
    ctx.say(
      `📨 Mandei mensagem para ${data.conflicts.length === 1 ? "o cliente" : `os ${data.conflicts.length} clientes`} pedindo para escolher outro horário. ` +
        "Te aviso aqui conforme cada um responder.",
    );
    return;
  }
  // cancelar e avisar
  const api = await ownerApi(ctx);
  if (!api) return;
  for (const a of data.conflicts) {
    await api.cancel(a.id).catch(() => undefined);
  }
  await campaigns.create(ctx, "notice", data.conflicts, {
    message: "Infelizmente precisamos cancelar este horário. Pedimos desculpas! Se quiser, toque em *Remarcar* para escolher outro.",
    createdBy: "whatsapp",
  });
  ctx.reset();
  ctx.say(`❌ Cancelei ${data.conflicts.length === 1 ? "o agendamento" : `os ${data.conflicts.length} agendamentos`} e avisei ${data.conflicts.length === 1 ? "o cliente" : "os clientes"}.`);
}

// ------------------------------------------------------------------ avisos
async function startNotice(ctx: Ctx, text: string, date?: string) {
  const when = parseWhen(text, ctx.tz);
  const day = date ?? when.date ?? dayOf(ctx.now());
  const message = noticeText(text);
  ctx.set(FLOW, "notice", { date: day, message });
  if (!message) {
    ctx.set(FLOW, "notice_text");
    return ctx.say(`O que você quer avisar para os clientes de ${friendlyDay(day, ctx.tz)}? Escreva a mensagem do jeito que eles vão receber.`);
  }
  await previewNotice(ctx);
}

async function previewNotice(ctx: Ctx) {
  const api = await ownerApi(ctx);
  if (!api) return;
  const { date, message } = ctx.data as { date: string; message: string };
  const targets = await ops.remainingToday(api, ctx.tz, date);
  if (targets.length === 0) {
    ctx.reset();
    return ctx.say(`Não tem cliente marcado ${friendlyDay(date, ctx.tz)} para avisar.`);
  }
  ctx.set(FLOW, "notice_confirm", { targets });
  ctx.buttons(
    `Vou mandar para ${targets.length} ${targets.length === 1 ? "cliente" : "clientes"} de ${friendlyDay(date, ctx.tz)} (${targets.map((t) => t.customer.name.split(" ")[0]).join(", ")}):\n\n"${message}"`,
    [
      { id: "on:send", title: "Enviar" },
      { id: "on:cancel", title: "Cancelar" },
    ],
  );
}

async function startDelay(ctx: Ctx, text: string) {
  const minutes = delayMinutes(text);
  const api = await ownerApi(ctx);
  if (!api) return;
  const targets = (await ops.remainingToday(api, ctx.tz)).filter((a) => Date.parse(a.startAt) < Date.now() + 3 * 3600_000);
  if (targets.length === 0) return ctx.say("Não tem cliente nas próximas 3 horas para avisar.");
  const message = minutes
    ? `Estamos com um atraso de cerca de ${minutes} minutos. Se puder, chegue um pouco depois do seu horário. Obrigado pela paciência!`
    : "Estamos com um pequeno atraso hoje. Obrigado pela paciência!";
  ctx.set(FLOW, "notice_confirm", { date: dayOf(ctx.now()), message, targets });
  ctx.buttons(`Aviso de atraso para ${targets.length} ${targets.length === 1 ? "cliente" : "clientes"} das próximas 3h:\n\n"${message}"`, [
    { id: "on:send", title: "Enviar" },
    { id: "on:cancel", title: "Cancelar" },
  ]);
}

// ------------------------------------------------------------------ cancelar um agendamento
async function cancelOne(ctx: Ctx, text: string) {
  const api = await ownerApi(ctx);
  if (!api) return;
  const when = parseWhen(text, ctx.tz);
  const date = when.date ?? dayOf(ctx.now());
  const items = (await ops.dayAgenda(api, ctx.tz, date)).filter((a) => a.status !== "COMPLETED");
  let hits = items;
  const byName = findByName(text.replace(/.*\b(do|da|de)\b/i, ""), items, (a) => a.customer.name);
  if (byName) hits = items.filter((a) => a.customer.name === byName.customer.name);
  if (when.time !== undefined) hits = hits.filter((a) => a.start === hhmm(when.time!));
  if (hits.length === 0) return ctx.say(`Não achei esse agendamento ${friendlyDay(date, ctx.tz)}. Confira o nome e o horário.`);
  if (hits.length > 1) {
    ctx.set(FLOW, "cancel_pick");
    ctx.list("Qual destes?", "Escolher", [{ rows: hits.slice(0, 10).map((a) => ({ id: `oc:${a.id}`, title: `${a.start} ${a.customer.name}`.slice(0, 24), description: a.service })) }]);
    return;
  }
  confirmCancel(ctx, hits[0]!);
}

function confirmCancel(ctx: Ctx, a: ops.AgendaItem) {
  ctx.set(FLOW, "cancel_confirm", { item: a });
  ctx.buttons(`Cancelar ${a.service} de *${a.customer.name}* (${shortDay(a.date, ctx.tz)} às ${a.start})? O cliente vai receber um aviso.`, [
    { id: `oc:yes:${a.id}`, title: "Cancelar e avisar" },
    { id: "oc:no", title: "Não" },
  ]);
}

// ------------------------------------------------------------------ comprovantes
async function pending(ctx: Ctx) {
  const list = await payments.list(ctx.biz.businessId, ["under_review"], 10);
  if (list.length === 0) return ctx.say("Nenhum comprovante esperando aprovação 👍");
  for (const p of list) {
    ctx.buttons(
      `🧾 ${p.customerName ?? formatPhoneBR(p.customerPhone)} — ${p.kind === "deposit" ? "sinal" : "pagamento"} de ${brl(p.amountCents)}\n${p.summary.service}, ${shortDay(p.summary.date, ctx.tz)} às ${p.summary.time}` +
        (p.receiptAnalysis?.summary ? `\n🔎 ${p.receiptAnalysis.summary}` : ""),
      [
        { id: `pv:ok:${p.id}`, title: "Aprovar" },
        { id: `pv:no:${p.id}`, title: "Recusar" },
      ],
    );
  }
}

// ------------------------------------------------------------------ roteamento
export async function onOwnerReply(ctx: Ctx, id: string): Promise<boolean> {
  const today = dayOf(ctx.now());
  const tomorrow = dayOf(ctx.now().plus({ days: 1 }));
  let m: RegExpMatchArray | null;
  if (id === "o:menu") return (ownerMenu(ctx), true);
  if (id === "o:today") return agenda(ctx, today).then(() => true);
  if (id === "o:tomorrow") return agenda(ctx, tomorrow).then(() => true);
  if (id === "o:next") return next(ctx).then(() => true);
  if ((m = id.match(/^o:free(?::(\d{4}-\d{2}-\d{2}))?$/))) return free(ctx, m[1] ?? today).then(() => true);
  if ((m = id.match(/^o:rev:(today|week|month|last_month)$/))) return revenue(ctx, m[1] as ops.RevenuePeriod).then(() => true);
  if ((m = id.match(/^o:block(?::(\d{4}-\d{2}-\d{2}))?$/))) {
    ctx.set(FLOW, "block", { date: m[1] });
    await advanceBlock(ctx);
    return true;
  }
  if ((m = id.match(/^o:notice(?::(\d{4}-\d{2}-\d{2}))?$/))) return startNotice(ctx, "", m[1]).then(() => true);
  if (id === "o:pending") return pending(ctx).then(() => true);
  if (id === "o:pause" || id === "o:resume") {
    const enabled = id === "o:resume";
    await settingsRepo.update(ctx.biz.businessId, { agentEnabled: enabled });
    ctx.biz.settings.agentEnabled = enabled;
    ctx.say(enabled ? "▶️ Bot ativado. Ele volta a responder os clientes." : "⏸️ Bot pausado. Os clientes não recebem resposta automática até você ativar de novo (seus comandos continuam funcionando).");
    return true;
  }
  if (id === "o:as_customer") {
    ctx.reset();
    ctx.state.actAsCustomerUntil = new Date(Date.now() + 30 * 60_000).toISOString();
    ctx.say("🧪 Modo cliente por 30 minutos: agora eu respondo você como se fosse um cliente. Escreva *modo dono* para voltar.");
    return true;
  }
  if ((m = id.match(/^o:undo:(.+)$/))) {
    const api = await ownerApi(ctx);
    if (api) await api.deleteTimeBlock(m[1]!);
    ctx.say("Bloqueio desfeito.");
    return true;
  }
  if ((m = id.match(/^ob:who:(.+)$/))) {
    (ctx.data as BlockData).employeeId = m[1] === "all" ? null : m[1]!;
    await doBlock(ctx);
    return true;
  }
  if ((m = id.match(/^ob:(resched|cancel|keep)$/))) return onConflictChoice(ctx, m[1] as "resched").then(() => true);
  if (id === "on:send") {
    const { targets, message } = ctx.data as { targets: ops.AgendaItem[]; message: string };
    if (!targets?.length) return (ownerMenu(ctx), true);
    await campaigns.create(ctx, "notice", targets, { message, createdBy: "whatsapp" });
    ctx.reset();
    ctx.say(`📨 Aviso enviado para ${targets.length} ${targets.length === 1 ? "cliente" : "clientes"}.`);
    return true;
  }
  if (id === "on:cancel" || id === "oc:no") {
    ctx.reset();
    ctx.say("Ok, não enviei nada.");
    return true;
  }
  if ((m = id.match(/^oc:yes:(.+)$/))) {
    const api = await ownerApi(ctx);
    if (!api) return true;
    const a = (ctx.data as { item?: ops.AgendaItem }).item;
    await api.cancel(m[1]!);
    if (a) {
      await campaigns.create(ctx, "notice", [a], {
        message: "Este horário precisou ser cancelado pelo estabelecimento. Desculpe! Toque em *Remarcar* para escolher outro.",
        createdBy: "whatsapp",
      });
    }
    ctx.reset();
    ctx.say("Cancelado e cliente avisado.");
    return true;
  }
  if ((m = id.match(/^oc:(.+)$/))) {
    const api = await ownerApi(ctx);
    if (!api) return true;
    const appt = await api.appointment(m[1]!);
    const w = wall(appt.startAt, ctx.tz);
    confirmCancel(ctx, {
      id: appt.id, start: w.time, end: wall(appt.endAt, ctx.tz).time, date: w.date, status: appt.status,
      customer: appt.customer, service: appt.service.name, employee: appt.employee.name, employeeId: appt.employee.id,
      priceCents: appt.priceCents, startAt: appt.startAt,
    });
    return true;
  }
  if ((m = id.match(/^pv:(ok|no):(.+)$/))) {
    const p = await payments.get(m[2]!);
    if (!p || p.businessId !== ctx.biz.businessId) return (ctx.say("Pagamento não encontrado."), true);
    if (m[1] === "ok") {
      const done = await markPaid(ctx, p, `whatsapp:${ctx.phone}`);
      ctx.say(done ? `✅ Aprovado. Avisei ${p.customerName ?? "o cliente"} que o horário está confirmado.` : "Esse pagamento já tinha sido resolvido.");
    } else {
      const done = await reject(ctx, p, `whatsapp:${ctx.phone}`);
      ctx.say(done ? `Recusado. Pedi para ${p.customerName ?? "o cliente"} conferir o Pix e mandar de novo.` : "Esse pagamento já tinha sido resolvido.");
    }
    return true;
  }
  if ((m = id.match(/^hb:(.+)$/))) {
    await conversations.pause(ctx.biz.businessId, m[1]!, null);
    ctx.say("▶️ Bot reativado para esse cliente.");
    return true;
  }
  return false;
}

export async function onOwnerText(ctx: Ctx, text: string): Promise<boolean> {
  const step = ctx.state.flow === FLOW ? ctx.state.step : undefined;
  if (step === "block_when" || step === "block_until") {
    const data = ctx.data as BlockData;
    const when = parseWhen(text, ctx.tz);
    if (when.date) data.date = when.date;
    if (when.allDay) Object.assign(data, { start: 0, end: 24 * 60 - 1 });
    else if (when.range) Object.assign(data, { start: when.range.start >= 0 ? when.range.start : data.start ?? 0, end: when.range.end ?? 24 * 60 - 1 });
    else if (when.time !== undefined) {
      if (step === "block_until") data.end = when.time;
      else data.start = when.time;
    }
    await advanceBlock(ctx);
    return true;
  }
  if (step === "notice_text") {
    (ctx.data as any).message = text.trim();
    await previewNotice(ctx);
    return true;
  }
  if (step === "notice_confirm" || step === "cancel_confirm") {
    const yn = yesNo(text);
    if (yn === "yes") return onOwnerReply(ctx, step === "notice_confirm" ? "on:send" : `oc:yes:${(ctx.data as any).item?.id}`);
    if (yn === "no") return onOwnerReply(ctx, "on:cancel");
  }
  if (step === "block_conflicts") {
    const t = norm(text);
    if (/remarc/.test(t)) return onOwnerReply(ctx, "ob:resched");
    if (/cancel/.test(t)) return onOwnerReply(ctx, "ob:cancel");
    if (/deix|mant|nada/.test(t)) return onOwnerReply(ctx, "ob:keep");
  }

  const intent = ownerIntent(text);
  const when = parseWhen(text, ctx.tz);
  const date = when.date ?? dayOf(ctx.now());
  switch (intent) {
    case "menu":
      ownerMenu(ctx);
      return true;
    case "agenda":
      await agenda(ctx, date);
      return true;
    case "next":
      await next(ctx);
      return true;
    case "free":
      await free(ctx, date);
      return true;
    case "revenue":
      await revenue(ctx, periodFrom(text), /lucr/.test(norm(text)));
      return true;
    case "block":
    case "leave_early":
    case "arrive_late":
    case "day_off":
      await startBlock(ctx, text, intent);
      return true;
    case "notice":
      await startNotice(ctx, text);
      return true;
    case "delay":
      await startDelay(ctx, text);
      return true;
    case "cancel_appointment":
      await cancelOne(ctx, text);
      return true;
    case "pending_payments":
      await pending(ctx);
      return true;
    case "pause_bot":
      return onOwnerReply(ctx, "o:pause");
    case "resume_bot":
      return onOwnerReply(ctx, "o:resume");
    case "act_as_customer":
      return onOwnerReply(ctx, "o:as_customer");
    default:
      return false;
  }
}

export { agenda as ownerAgenda, free as ownerFree, revenue as ownerRevenue, next as ownerNext };
