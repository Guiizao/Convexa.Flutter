import { DateTime } from "luxon";
import { norm } from "../lib/text.js";
import { MONTHS, dayOf, nowIn, weekdayIndex } from "../lib/time.js";

export type Period = "manha" | "tarde" | "noite";

export type ParsedWhen = {
  date?: string; // YYYY-MM-DD
  dateText?: string;
  time?: number; // minutos do dia
  period?: Period;
  range?: { start: number; end?: number }; // "das 12 às 14", "a partir das 15"
  allDay?: boolean; // "o dia todo", "não vou trabalhar"
};

const WEEKDAY_WORDS: Array<[RegExp, number]> = [
  [/\bdomingo\b/, 0],
  [/\bsegunda(-feira| feira)?\b/, 1],
  [/\bterca(-feira| feira)?\b/, 2],
  [/\bquarta(-feira| feira)?\b/, 3],
  [/\bquinta(-feira| feira)?\b/, 4],
  [/\bsexta(-feira| feira)?\b/, 5],
  [/\bsabado\b/, 6],
];

const MONTH_NORM = MONTHS.map((m) => norm(m));

const NUMBER_WORDS: Record<string, number> = {
  uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10, onze: 11, doze: 12,
};

/** Converte hora ambígua: "às 2" numa agenda comercial é 14h. */
function resolveHour(h: number, text: string, explicitMorning: boolean): number {
  if (h === 12 || h >= 13) return h;
  if (/\b(da|de|a) (tarde|noite)\b/.test(text) && h < 12) return h + 12;
  if (explicitMorning) return h;
  if (h >= 1 && h <= 7) return h + 12;
  return h;
}

function parseClock(raw: string, text: string): number | undefined {
  const t = raw.trim();
  if (/^meio dia$|^meio-dia$|^meiodia$/.test(t)) return 12 * 60;
  if (/^meia noite$|^meia-noite$/.test(t)) return 0;
  const m = t.match(/^(\d{1,2})(?:\s*(?:h|:|hs|horas?)\s*(\d{2})?)?(?:\s*(?:e meia))?$/);
  const word = t.match(/^(uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)( e meia)?$/);
  let h: number | undefined;
  let min = 0;
  if (m) {
    h = Number(m[1]);
    min = m[2] ? Number(m[2]) : /e meia/.test(t) ? 30 : 0;
  } else if (word) {
    h = NUMBER_WORDS[word[1]!];
    min = word[2] ? 30 : 0;
  }
  if (h === undefined || h > 23 || min > 59) return undefined;
  const morning = /\b(da|de) manha\b/.test(text);
  return resolveHour(h, text, morning) * 60 + min;
}

const CLOCK = String.raw`(meio[ -]?dia|meia[ -]noite|\d{1,2}(?:\s*(?:h|:|hs|horas?)\s*\d{0,2})?(?: e meia)?|(?:uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?: e meia)?)`;

export function parseWhen(input: string, zone: string): ParsedWhen {
  const text = norm(input);
  const now = nowIn(zone).startOf("day");
  const out: ParsedWhen = {};

  // ---------- data ----------
  let date: DateTime | undefined;
  if (/\bdepois de amanha\b/.test(text)) {
    date = now.plus({ days: 2 });
    out.dateText = "depois de amanhã";
  } else if (/\bamanha\b/.test(text) && !/\bde manha\b|\bda manha\b|\bpela manha\b/.test(text.replace(/\bamanha de manha\b/, "amanha"))) {
    date = now.plus({ days: 1 });
    out.dateText = "amanhã";
  } else if (/\bhoje\b|\bagora\b|\bmais tarde\b|\bhj\b/.test(text)) {
    date = now;
    out.dateText = "hoje";
  }

  if (!date) {
    // 15/11, 15/11/2026, 15-11
    const dm = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
    if (dm) {
      const day = Number(dm[1]);
      const month = Number(dm[2]);
      let year = dm[3] ? Number(dm[3]) : now.year;
      if (year < 100) year += 2000;
      let candidate = DateTime.fromObject({ year, month, day }, { zone });
      if (candidate.isValid && !dm[3] && candidate < now) candidate = candidate.plus({ years: 1 });
      if (candidate.isValid) date = candidate;
    }
  }
  if (!date) {
    // 15 de novembro
    const dn = text.match(/\b(\d{1,2}) de ([a-z]+)\b/);
    const monthIdx = dn ? MONTH_NORM.indexOf(dn[2]!) : -1;
    if (dn && monthIdx >= 0) {
      let candidate = DateTime.fromObject({ year: now.year, month: monthIdx + 1, day: Number(dn[1]) }, { zone });
      if (candidate.isValid && candidate < now) candidate = candidate.plus({ years: 1 });
      if (candidate.isValid) date = candidate;
    }
  }
  if (!date) {
    // dia 15
    const d = text.match(/\bdia (\d{1,2})\b/);
    if (d) {
      const day = Number(d[1]);
      let candidate = now.set({ day });
      if (!candidate.isValid || candidate.day !== day || candidate < now) {
        candidate = now.plus({ months: 1 }).set({ day });
      }
      if (candidate.isValid) date = candidate;
    }
  }
  if (!date) {
    for (const [re, wd] of WEEKDAY_WORDS) {
      if (re.test(text)) {
        const today = weekdayIndex(now);
        let diff = (wd - today + 7) % 7;
        const nextWeek = /\b(que vem|proxima|proximo)\b/.test(text);
        if (diff === 0) diff = /\b(essa|esta|hoje)\b/.test(text) && !nextWeek ? 0 : 7;
        else if (nextWeek && diff < 3 && /\bsemana que vem\b/.test(text)) diff += 7;
        date = now.plus({ days: diff });
        break;
      }
    }
  }
  if (date) out.date = dayOf(date);

  // ---------- horário ----------
  const range = text.match(new RegExp(String.raw`\b(?:das|de|do|da)\s+${CLOCK}\s*(?:as|a|ate as|ate|ao|aos|-)\s*${CLOCK}`));
  if (range) {
    const start = parseClock(range[1]!, text);
    let end = parseClock(range[2]!, text);
    if (start !== undefined && end !== undefined) {
      if (end <= start && end + 12 * 60 < 24 * 60) end += 12 * 60;
      out.range = { start, end };
    }
  }
  if (!out.range) {
    const until = text.match(new RegExp(String.raw`\bate (?:as |a |o )?${CLOCK}`));
    const from = text.match(new RegExp(String.raw`\b(?:a partir d[ao]s?|depois d[ao]s?|apos as|apos o)\s+${CLOCK}`));
    let at = text.match(new RegExp(String.raw`\b(?:as|a|ao|pelas?|por volta d[ao]s?|lá pelas)\s+${CLOCK}`));
    // "até as 10": o "as 10" faz parte do "até", não é um horário de início
    if (at && until && at.index! >= until.index! && at.index! < until.index! + until[0].length) at = null;
    const bare = text.match(/\b(\d{1,2})\s*(?:h|:|hs)\s*(\d{2})?\b/);
    if (from) {
      const s = parseClock(from[1]!, text);
      const u = until ? parseClock(until[1]!, text) : undefined;
      if (s !== undefined) out.range = { start: s, end: u };
    } else if (until && at && at.index! < until.index!) {
      const s = parseClock(at[1]!, text);
      const u = parseClock(until[1]!, text);
      if (s !== undefined && u !== undefined) out.range = { start: s, end: u > s ? u : u + 12 * 60 };
    } else if (at) {
      out.time = parseClock(at[1]!, text);
      if (until) {
        const u = parseClock(until[1]!, text);
        if (out.time !== undefined && u !== undefined) out.range = { start: out.time, end: u > out.time ? u : u + 12 * 60 };
      }
    } else if (bare) {
      out.time = parseClock(`${bare[1]}h${bare[2] ?? ""}`, text);
    } else if (/\bmeio[ -]?dia\b/.test(text)) {
      out.time = 12 * 60;
    } else if (until) {
      const u = parseClock(until[1]!, text);
      if (u !== undefined) out.range = { start: -1, end: u };
    }
  }

  // ---------- período ----------
  if (/\b(de|da|pela|na|a) manha\b|\bcedo\b|\bcedinho\b/.test(text) || /\bamanha de manha\b/.test(text)) out.period = "manha";
  else if (/\b(de|da|a|na|pela) tarde\b|\bdepois do almoco\b|\bfim da tarde\b|\btardinha\b/.test(text)) out.period = "tarde";
  else if (/\b(de|da|a|na|pela) noite\b|\bnoitinha\b/.test(text)) out.period = "noite";

  if (/\b(o dia (todo|inteiro)|dia inteiro|nao vou (trabalhar|abrir|atender)|vou fechar|fechado)\b/.test(text)) out.allDay = true;

  if (out.time !== undefined && Number.isNaN(out.time)) delete out.time;
  return out;
}
