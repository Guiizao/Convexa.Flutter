import { beforeAll, describe, expect, it } from "vitest";
import { parseWhen } from "../src/nlu/datetime.js";
import { setClock } from "../src/lib/time.js";

const Z = "America/Sao_Paulo";
// quarta-feira, 11/11/2026, 10:00 em São Paulo
beforeAll(() => setClock(() => new Date("2026-11-11T13:00:00Z")));

const h = (hh: number, mm = 0) => hh * 60 + mm;

describe("parseWhen: datas", () => {
  it.each([
    ["hoje", "2026-11-11"],
    ["amanhã", "2026-11-12"],
    ["amanha de tarde", "2026-11-12"],
    ["depois de amanhã", "2026-11-13"],
    ["sexta", "2026-11-13"],
    ["sexta-feira que vem", "2026-11-13"],
    ["quarta", "2026-11-18"],
    ["essa quarta", "2026-11-11"],
    ["segunda", "2026-11-16"],
    ["sábado", "2026-11-14"],
    ["dia 20", "2026-11-20"],
    ["dia 5", "2026-12-05"],
    ["20/11", "2026-11-20"],
    ["02/01", "2027-01-02"],
    ["15 de dezembro", "2026-12-15"],
  ])("%s -> %s", (text, date) => {
    expect(parseWhen(text, Z).date).toBe(date);
  });

  it("de manhã não vira amanhã", () => {
    const r = parseWhen("tem horário de manhã?", Z);
    expect(r.date).toBeUndefined();
    expect(r.period).toBe("manha");
  });
});

describe("parseWhen: horários", () => {
  it.each([
    ["às 14h", h(14)],
    ["as 14:30", h(14, 30)],
    ["14h30", h(14, 30)],
    ["às 2", h(14)],
    ["as 9 da manhã", h(9)],
    ["às 7 da noite", h(19)],
    ["meio dia", h(12)],
    ["ao meio-dia", h(12)],
    ["às 10 e meia", h(10, 30)],
    ["às duas e meia", h(14, 30)],
  ])("%s -> %i", (text, minutes) => {
    expect(parseWhen(text, Z).time).toBe(minutes);
  });

  it("intervalo das 12 às 14", () => {
    expect(parseWhen("bloqueia amanhã das 12 às 14", Z)).toMatchObject({ date: "2026-11-12", range: { start: h(12), end: h(14) } });
  });

  it("intervalo do meio dia até as 14h", () => {
    expect(parseWhen("amanhã ao meio dia vou estar ocupado até as 14h", Z)).toMatchObject({
      date: "2026-11-12",
      range: { start: h(12), end: h(14) },
    });
  });

  it("das 1 às 3 vira tarde", () => {
    expect(parseWhen("das 1 às 3", Z).range).toEqual({ start: h(13), end: h(15) });
  });

  it("a partir das 17h", () => {
    expect(parseWhen("hoje a partir das 17h", Z)).toMatchObject({ date: "2026-11-11", range: { start: h(17) } });
  });

  it("até as 10 (chegar mais tarde)", () => {
    expect(parseWhen("amanhã só chego até as 10", Z).range).toEqual({ start: -1, end: h(10) });
  });

  it("dia todo", () => {
    expect(parseWhen("sexta não vou trabalhar", Z)).toMatchObject({ date: "2026-11-13", allDay: true });
  });

  it("períodos", () => {
    expect(parseWhen("amanhã à tarde", Z).period).toBe("tarde");
    expect(parseWhen("depois do almoço", Z).period).toBe("tarde");
    expect(parseWhen("sábado cedo", Z).period).toBe("manha");
    expect(parseWhen("hoje à noite", Z).period).toBe("noite");
  });
});
