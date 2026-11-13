import { describe, expect, it } from "vitest";
import { customerIntent, delayMinutes, menuNumber, noticeText, ownerIntent, yesNo } from "../src/bot/nlu.js";

describe("intenção do cliente", () => {
  it.each([
    ["Oi, bom dia!", "greeting"],
    ["tem horário amanhã de tarde?", "book"],
    ["quero marcar um corte", "book"],
    ["queria fazer a barba sexta", "book"],
    ["consigo um encaixe hoje?", "book"],
    ["quero remarcar", "reschedule"],
    ["preciso mudar meu horário", "reschedule"],
    ["não vou poder ir, quero cancelar", "cancel"],
    ["desmarca pra mim", "cancel"],
    ["qual é o meu horário?", "my_appointments"],
    ["tenho horário marcado?", "my_appointments"],
    ["quanto custa o corte?", "prices"],
    ["qual o endereço?", "info"],
    ["vocês abrem domingo?", "info"],
    ["quero falar com um atendente", "human"],
    ["já paguei, segue o comprovante", "payment"],
    ["valeu!", "thanks"],
    ["confirmo", "yes"],
    ["sim", "yes"],
    ["não", "no"],
    ["menu", "menu"],
    ["asdfgh", "unknown"],
  ])("%s -> %s", (text, intent) => {
    expect(customerIntent(text)).toBe(intent);
  });
});

describe("intenção do dono", () => {
  it.each([
    ["agenda de hoje", "agenda"],
    ["o que eu tenho amanhã?", "agenda"],
    ["quantos clientes tenho sexta", "agenda"],
    ["quem é o próximo cliente?", "next"],
    ["quais horários livres hoje?", "free"],
    ["quanto faturei esse mês", "revenue"],
    ["qual o lucro do mês?", "revenue"],
    ["amanhã ao meio dia vou estar ocupado até as 14h, reajuste minha agenda", "block"],
    ["bloqueia sexta das 15 às 17", "block"],
    ["hoje vou sair mais cedo, às 17h", "leave_early"],
    ["amanhã só chego às 10", "arrive_late"],
    ["sábado não vou trabalhar", "day_off"],
    ["avisa meus clientes de hoje que a máquina de cartão quebrou", "notice"],
    ["vou me atrasar 20 minutos", "delay"],
    ["cancela o horário do João das 15h", "cancel_appointment"],
    ["tem comprovante pendente?", "pending_payments"],
    ["pausar o bot", "pause_bot"],
    ["ativar o bot", "resume_bot"],
    ["modo cliente", "act_as_customer"],
    ["menu", "menu"],
  ])("%s -> %s", (text, intent) => {
    expect(ownerIntent(text)).toBe(intent);
  });
});

describe("auxiliares", () => {
  it("sim e não", () => {
    expect(yesNo("pode ser")).toBe("yes");
    expect(yesNo("agora não")).toBe("no");
    expect(yesNo("talvez")).toBeUndefined();
  });
  it("número de menu", () => {
    expect(menuNumber("2")).toBe(2);
    expect(menuNumber("opção 3")).toBe(3);
    expect(menuNumber("2 cortes")).toBeUndefined();
  });
  it("texto do aviso", () => {
    expect(noticeText("avisa meus clientes de hoje que a máquina de cartão quebrou")).toBe("A máquina de cartão quebrou");
  });
  it("minutos de atraso", () => {
    expect(delayMinutes("vou atrasar 20 minutos")).toBe(20);
    expect(delayMinutes("atraso de meia hora")).toBe(30);
  });
});

import { findByName } from "../src/lib/text.js";
describe("serviço pelo nome", () => {
  const svcs = ["Corte", "Barba", "Corte + Barba", "Sobrancelha", "Pigmentação"].map((name) => ({ name }));
  it.each([
    ["quero cortar o cabelo", "Corte"],
    ["corte e barba", "Corte + Barba"],
    ["fazer a barba", "Barba"],
    ["tirar a sobrancelha", "Sobrancelha"],
    ["pigmentacao", "Pigmentação"],
  ])("%s -> %s", (text, name) => {
    expect(findByName(text, svcs, (s) => s.name)?.name).toBe(name);
  });
});
