import type { Gateway } from "../convexa/gateway.js";
import { db } from "../db/pool.js";
import { dayOf, hhmm, nowIn } from "../lib/time.js";
import * as ops from "../owner/ops.js";
import { payments } from "../payments/repo.js";
import { settingsRepo } from "../settings/settings.js";
import { resolveBiz } from "../bot/engine.js";
import { campaigns } from "../bot/owner/campaigns.js";
import { systemCtx } from "../jobs/tick.js";
import type { Out } from "../whatsapp/messages.js";
import { cap, dia, escapeSsml, firstName, hora, list, reais } from "./speech.js";

type AlexaRequest = {
  session?: { attributes?: Record<string, any>; user?: { userId: string } };
  context?: { System?: { user?: { userId: string }; application?: { applicationId: string } } };
  request: {
    type: string;
    timestamp?: string;
    intent?: { name: string; slots?: Record<string, { value?: string }> };
  };
};

export type AlexaResult = { alexa: unknown; phoneNumberId?: string; outbound: Out[] };

function speak(text: string, opts: { end?: boolean; reprompt?: string; attributes?: Record<string, any>; card?: string } = {}) {
  return {
    version: "1.0",
    sessionAttributes: opts.attributes ?? {},
    response: {
      outputSpeech: { type: "SSML", ssml: `<speak>${escapeSsml(text)}</speak>` },
      ...(opts.card ? { card: { type: "Simple", title: "Convexa", content: opts.card } } : {}),
      ...(opts.reprompt ? { reprompt: { outputSpeech: { type: "SSML", ssml: `<speak>${escapeSsml(opts.reprompt)}</speak>` } } } : {}),
      shouldEndSession: opts.end ?? true,
    },
  };
}

const slot = (req: AlexaRequest, name: string) => req.request.intent?.slots?.[name]?.value;

/** AMAZON.DATE: "2026-11-14", "2026-W46", "2026-11", "PRESENT_REF" */
function dateSlot(value: string | undefined, zone: string): string {
  const now = nowIn(zone);
  if (!value || value === "PRESENT_REF") return dayOf(now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dayOf(now);
}

function periodSlot(value: string | undefined, zone: string): ops.RevenuePeriod {
  const now = nowIn(zone);
  if (!value) return "month";
  if (/^\d{4}-W\d{2}/.test(value)) return "week";
  if (/^\d{4}-\d{2}$/.test(value)) {
    if (value === now.toFormat("yyyy-MM")) return "month";
    if (value === now.minus({ months: 1 }).toFormat("yyyy-MM")) return "last_month";
    return "month";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value === dayOf(now) ? "today" : "month";
  return "month";
}

/** AMAZON.TIME: "14:30", "MO" (manhã), "AF" (tarde), "EV" (noite), "NI" */
function timeSlot(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

const HELP =
  "Você pode perguntar: qual é a minha agenda de hoje, quem é o próximo cliente, quais horários estão livres amanhã, ou quanto eu faturei este mês. " +
  "Também pode dizer: bloqueia amanhã das duas às quatro, hoje vou sair às cinco, ou avisa meus clientes de hoje que vou atrasar.";

export async function handleAlexa(gw: Gateway, req: AlexaRequest): Promise<AlexaResult> {
  const userId = req.context?.System?.user?.userId ?? req.session?.user?.userId ?? "";
  const type = req.request.type;
  const intent = req.request.intent?.name ?? "";
  const attrs = req.session?.attributes ?? {};
  if (type === "SessionEndedRequest") return { alexa: { version: "1.0", response: {} }, outbound: [] };

  // ---------- vínculo
  const linked = await db().query<{ business_id: string; meta_phone_number_id: string | null }>(
    `SELECT a.business_id, l.meta_phone_number_id FROM alexa_link a
     LEFT JOIN business_link l ON l.business_id = a.business_id WHERE a.alexa_user_id = $1`,
    [userId],
  );
  if (intent === "VincularIntent") {
    const code = (slot(req, "codigo") ?? "").replace(/\D/g, "");
    const r = await db().query<{ business_id: string; business_name: string }>(
      `DELETE FROM link_code c USING business_link l
       WHERE c.code = $1 AND c.purpose = 'alexa' AND c.expires_at > now() AND l.business_id = c.business_id
       RETURNING c.business_id, l.business_name`,
      [code],
    );
    const hit = r.rows[0];
    if (!hit) return { alexa: speak("Esse código não é válido ou já expirou. Gere um novo no painel do Convexa, em Automação, Alexa.", { end: false }), outbound: [] };
    await db().query(
      "INSERT INTO alexa_link (alexa_user_id, business_id) VALUES ($1, $2) ON CONFLICT (alexa_user_id) DO UPDATE SET business_id = EXCLUDED.business_id, linked_at = now()",
      [userId, hit.business_id],
    );
    await settingsRepo.update(hit.business_id, { alexa: { enabled: true } });
    return { alexa: speak(`Pronto! Vinculei esta Alexa à ${hit.business_name}. ${HELP}`, { end: false, reprompt: "O que você quer saber?" }), outbound: [] };
  }
  const link = linked.rows[0];
  if (!link?.meta_phone_number_id) {
    return {
      alexa: speak(
        "Para começar, abra o painel do Convexa, vá em Automação, Alexa, e gere um código. Depois diga: vincular código, e os seis números.",
        { end: false, reprompt: "Diga: vincular código, e os seis números." },
      ),
      outbound: [],
    };
  }

  const biz = await resolveBiz(gw, link.meta_phone_number_id);
  const ctx = systemCtx(biz, gw);
  const owner = await gw.owner(biz.businessId);
  const tz = biz.timezone;
  const done = (text: string, card?: string) => ({ alexa: speak(text, { card }), phoneNumberId: biz.phoneNumberId, outbound: ctx.out });
  const ask = (text: string, attributes: Record<string, any>) => ({
    alexa: speak(text, { end: false, reprompt: "Posso fazer isso?", attributes }),
    phoneNumberId: biz.phoneNumberId,
    outbound: ctx.out,
  });

  if (type === "LaunchRequest" || intent === "AMAZON.NavigateHomeIntent") {
    return { alexa: speak(`Oi! Aqui é a agenda da ${biz.businessName}. O que você quer saber?`, { end: false, reprompt: HELP }), outbound: [] };
  }
  if (intent === "AMAZON.HelpIntent") return { alexa: speak(HELP, { end: false, reprompt: "O que você quer saber?" }), outbound: [] };
  if (intent === "AMAZON.StopIntent" || intent === "AMAZON.CancelIntent") return done("Até mais!");
  if (!owner) return done("A automação ainda não foi conectada à sua conta. Conecte no painel do Convexa, em Automação.");

  // ---------- confirmações pendentes (sim / não)
  if (intent === "AMAZON.YesIntent" && attrs.pending) {
    const p = attrs.pending as { kind: string; items?: ops.AgendaItem[]; message?: string };
    if (p.kind === "reschedule" && p.items?.length) {
      await campaigns.create(ctx, "reschedule", p.items, { createdBy: "alexa" });
      return done(`Feito. Mandei mensagem no WhatsApp ${p.items.length === 1 ? "para o cliente escolher" : `para os ${p.items.length} clientes escolherem`} outro horário. Te aviso por lá.`);
    }
    if (p.kind === "notice" && p.items?.length && p.message) {
      await campaigns.create(ctx, "notice", p.items, { message: p.message, createdBy: "alexa" });
      return done(`Pronto, avisei ${p.items.length === 1 ? "o cliente" : `os ${p.items.length} clientes`} pelo WhatsApp.`);
    }
  }
  if (intent === "AMAZON.NoIntent" && attrs.pending) return done("Tudo bem, não mandei nada.");

  switch (intent) {
    case "AgendaIntent": {
      const date = dateSlot(slot(req, "dia"), tz);
      const items = (await ops.dayAgenda(owner, tz, date)).filter((a) => a.status !== "COMPLETED");
      const label = cap(dia(date, tz));
      if (items.length === 0) return done(`${label} você não tem nenhum cliente marcado.`);
      const total = items.reduce((s, a) => s + a.priceCents, 0);
      const said = items.slice(0, 8).map((a) => `${hora(a.start)}, ${firstName(a.customer.name)}, ${a.service}`);
      return done(
        `${label} você tem ${items.length} ${items.length === 1 ? "cliente" : "clientes"}, somando ${reais(total)}. ${said.join(". ")}${items.length > 8 ? `. E mais ${items.length - 8}.` : "."}`,
        items.map((a) => `${a.start} ${a.customer.name} — ${a.service}`).join("\n"),
      );
    }
    case "ProximoClienteIntent": {
      const a = await ops.nextAppointment(owner, tz);
      if (!a) return done("Não tem mais nenhum cliente marcado nos próximos dias.");
      return done(`O próximo é ${a.customer.name}, ${dia(a.date, tz)} às ${hora(a.start)}, para ${a.service} com ${a.employee}.`);
    }
    case "HorariosLivresIntent": {
      const date = dateSlot(slot(req, "dia"), tz);
      const r = (await ops.freeWindows(owner, tz, date)).filter((e) => e.windows.length);
      if (r.length === 0) return done(`${cap(dia(date, tz))} a agenda está cheia.`);
      const parts = r.map((e) => `${e.employee}: ${list(e.windows.slice(0, 4).map((w) => `das ${hora(w.start)} às ${hora(w.end)}`))}`);
      return done(`Horários livres ${dia(date, tz)}. ${parts.join(". ")}.`);
    }
    case "FaturamentoIntent":
    case "LucroIntent": {
      const period = periodSlot(slot(req, "periodo"), tz);
      const r = await ops.revenue(owner, tz, biz.businessId, period, biz.settings.costPercent);
      const realized = r.done.cents + r.unclosed.cents;
      let text = `${cap(r.label)} você faturou ${reais(realized)} em ${r.done.count + r.unclosed.count} atendimentos`;
      if (r.upcoming.count) text += `, e tem mais ${reais(r.upcoming.cents)} marcados`;
      text += ".";
      if (r.estimatedProfitCents !== null) text += ` O lucro estimado é de ${reais(r.estimatedProfitCents)}.`;
      else if (intent === "LucroIntent") text += " Para eu calcular o lucro, informe o seu custo médio no painel.";
      return done(text);
    }
    case "BloquearIntent":
    case "SairMaisCedoIntent":
    case "ChegarMaisTardeIntent": {
      const date = dateSlot(slot(req, "dia"), tz);
      let start = timeSlot(slot(req, "inicio") ?? slot(req, "hora"));
      let end = timeSlot(slot(req, "fim"));
      if (intent === "SairMaisCedoIntent") end = 24 * 60 - 1;
      if (intent === "ChegarMaisTardeIntent") {
        end = start;
        start = 0;
      }
      if (start === undefined || end === undefined || end <= start) {
        return { alexa: speak("Não entendi o horário. Diga por exemplo: bloqueia amanhã das duas às quatro da tarde.", { end: false }), outbound: [] };
      }
      const res = await ops.blockTime(owner, tz, { date, startMin: start, endMin: end, employeeId: biz.settings.ownerEmployeeId ?? undefined, reason: "Bloqueado pela Alexa" });
      const what = end >= 24 * 60 - 1 ? `a partir das ${hora(hhmm(start))}` : start === 0 ? `até as ${hora(hhmm(end))}` : `das ${hora(hhmm(start))} às ${hora(hhmm(end))}`;
      if (res.conflicts.length === 0) return done(`Bloqueei ${dia(date, tz)} ${what}. Não tinha ninguém marcado nesse intervalo.`);
      const names = list(res.conflicts.map((a) => `${firstName(a.customer.name)} às ${hora(a.start)}`));
      return ask(`Bloqueei ${dia(date, tz)} ${what}. Mas ${res.conflicts.length === 1 ? "tem um cliente marcado" : `tem ${res.conflicts.length} clientes marcados`}: ${names}. Quer que eu peça pelo WhatsApp para remarcarem?`, {
        pending: { kind: "reschedule", items: res.conflicts },
      });
    }
    case "AvisarClientesIntent":
    case "AvisarClientesAmanhaIntent": {
      const message = slot(req, "mensagem");
      const date = intent === "AvisarClientesAmanhaIntent" ? dayOf(nowIn(tz).plus({ days: 1 })) : dayOf(nowIn(tz));
      if (!message) return { alexa: speak("Qual é o aviso? Diga por exemplo: avisa meus clientes de hoje que vou atrasar meia hora.", { end: false }), outbound: [] };
      const items = await ops.remainingToday(owner, tz, date);
      if (items.length === 0) return done(`Não tem cliente marcado ${dia(date, tz)} para avisar.`);
      const text = message.charAt(0).toUpperCase() + message.slice(1);
      return ask(`Vou mandar para ${items.length} ${items.length === 1 ? "cliente" : "clientes"} de ${dia(date, tz)}: ${text}. Posso enviar?`, {
        pending: { kind: "notice", items, message: text },
      });
    }
    case "AtrasoIntent": {
      const minutes = Number(slot(req, "minutos") ?? 0) || undefined;
      const items = (await ops.remainingToday(owner, tz)).filter((a) => Date.parse(a.startAt) < Date.now() + 3 * 3600_000);
      if (items.length === 0) return done("Não tem cliente nas próximas três horas para avisar.");
      const message = minutes
        ? `Estamos com um atraso de cerca de ${minutes} minutos. Se puder, chegue um pouco depois do seu horário. Obrigado pela paciência!`
        : "Estamos com um pequeno atraso hoje. Obrigado pela paciência!";
      return ask(`Vou avisar ${items.length} ${items.length === 1 ? "cliente" : "clientes"} das próximas três horas sobre o atraso${minutes ? ` de ${minutes} minutos` : ""}. Posso enviar?`, {
        pending: { kind: "notice", items, message },
      });
    }
    case "ComprovantesIntent": {
      const list_ = await payments.list(biz.businessId, ["under_review"], 50);
      if (list_.length === 0) return done("Nenhum comprovante esperando aprovação.");
      return done(`Você tem ${list_.length} ${list_.length === 1 ? "comprovante" : "comprovantes"} esperando aprovação. Aprove pelo WhatsApp ou pelo painel, conferindo antes se o Pix caiu na conta.`);
    }
    case "PausarBotIntent":
    case "AtivarBotIntent": {
      const enabled = intent === "AtivarBotIntent";
      await settingsRepo.update(biz.businessId, { agentEnabled: enabled });
      return done(enabled ? "Pronto, o atendimento automático do WhatsApp voltou a funcionar." : "Pronto, pausei o atendimento automático do WhatsApp.");
    }
    default:
      return { alexa: speak(`Não entendi. ${HELP}`, { end: false, reprompt: "O que você quer saber?" }), outbound: [] };
  }
}

