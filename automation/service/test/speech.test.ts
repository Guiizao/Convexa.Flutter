import { describe, expect, it } from "vitest";
import { aPartir, as, ate, faixa, hora } from "../src/alexa/speech.js";

describe("hora falada pela Alexa", () => {
  it("lê horas cheias, meia e minutos", () => {
    expect(hora("14:00")).toBe("14 horas");
    expect(hora("12:00")).toBe("meio-dia");
    expect(hora("00:00")).toBe("meia-noite");
    expect(hora("01:00")).toBe("1 hora");
    expect(hora("09:30")).toBe("9 e meia");
    expect(hora("16:15")).toBe("16 e 15");
  });

  it("usa a preposição certa", () => {
    expect(faixa("12:00", "13:00")).toBe("do meio-dia às 13 horas");
    expect(faixa("14:00", "16:30")).toBe("das 14 horas às 16 e meia");
    expect(faixa("11:00", "12:00")).toBe("das 11 horas ao meio-dia");
    expect(as("01:00")).toBe("à 1 hora");
    expect(ate("12:00")).toBe("até o meio-dia");
    expect(ate("10:00")).toBe("até as 10 horas");
    expect(aPartir("17:00")).toBe("a partir das 17 horas");
    expect(aPartir("12:00")).toBe("a partir do meio-dia");
  });
});
