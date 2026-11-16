import { describe, expect, it } from "vitest";
import { customerIntent, menuNumber } from "../src/bot/nlu.js";
import { optionFromNumber } from "../src/bot/options.js";
import { parseWebhook } from "../src/whatsapp/inbound.js";
import * as wa from "../src/whatsapp/messages.js";

describe("resposta por número", () => {
  const menu = ["m:book", "m:mine", "m:prices"];

  it("entende 1, opção 2, 3. e n 2", () => {
    expect(menuNumber("1")).toBe(1);
    expect(menuNumber("opção 2")).toBe(2);
    expect(menuNumber("3.")).toBe(3);
    expect(menuNumber("a 2")).toBe(2);
    expect(menuNumber("quero o 2")).toBeUndefined();
  });

  it("devolve o id da opção na ordem mostrada", () => {
    expect(optionFromNumber("2", menu)).toBe("m:mine");
    expect(optionFromNumber("opção 3", menu)).toBe("m:prices");
  });

  it("ignora número fora da lista, texto comum e falta de opções", () => {
    expect(optionFromNumber("4", menu)).toBeUndefined();
    expect(optionFromNumber("0", menu)).toBeUndefined();
    expect(optionFromNumber("quero cortar", menu)).toBeUndefined();
    expect(optionFromNumber("1", null)).toBeUndefined();
  });

  it("numa lista de horários, 10 é 10h e não a 10ª linha", () => {
    const slots = ["t:09:00:a", "t:09:30:a", "t:10:00:a", "t:10:30:a", "t:11:00:a", "t:11:30:a", "t:13:00:a", "t:13:30:a", "t:14:00:a", "t:14:30:a"];
    expect(optionFromNumber("10", slots)).toBeUndefined();
    expect(optionFromNumber("2", slots)).toBe("t:09:30:a");
  });

  it("lê as opções de botões, listas e modelos", () => {
    expect(wa.optionIds(wa.buttons("+5514999990000", "oi", [{ id: "a", title: "A" }, { id: "b", title: "B" }]))).toEqual(["a", "b"]);
    expect(wa.optionIds(wa.list("+5514999990000", "oi", "Ver", [{ title: "X", rows: [{ id: "r1", title: "1" }] }, { title: "Y", rows: [{ id: "r2", title: "2" }] }]))).toEqual(["r1", "r2"]);
    expect(wa.optionIds(wa.template("+5514999990000", "convexa_lembrete", ["a"], ["rem:ok:1", "rem:resch:1"]))).toEqual(["rem:ok:1", "rem:resch:1"]);
    expect(wa.optionIds(wa.text("+5514999990000", "oi"))).toEqual([]);
  });
});

describe("modelos da Meta", () => {
  it("variável nunca sai vazia, com quebra de linha, tab ou muitos espaços", () => {
    const out = wa.template("+5514999990000", "convexa_aviso", ["", "Barbearia\nNavalha", "a\t\tb", "x      y"]);
    const params = (out.body as any).template.components[0].parameters.map((p: any) => p.text);
    expect(params).toEqual(["-", "Barbearia Navalha", "a b", "x y"]);
  });
});

describe("intenções novas", () => {
  it("entende pedidos de endereço e horário de funcionamento", () => {
    for (const t of ["onde vocês ficam?", "fica onde?", "qual o endereço", "até que horas vocês atendem?", "que horas abre amanhã?", "aceitam cartão?"]) {
      expect(customerIntent(t), t).toBe("info");
    }
  });
});

describe("webhook da Meta", () => {
  const wrap = (value: object) => ({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "100" }, ...value } }] }] });

  it("usa o wa_id do contato quando falta o from", () => {
    const r = parseWebhook(wrap({ contacts: [{ wa_id: "5514988887777", profile: { name: "Ana" } }], messages: [{ id: "wamid.1", type: "text", text: { body: "oi" } }] }));
    expect(r.messages[0]).toMatchObject({ waId: "5514988887777", name: "Ana", text: "oi" });
  });

  it("sem telefone nenhum (username/BSUID): não inventa número e registra como não atendida", () => {
    const r = parseWebhook(wrap({ contacts: [{ user_id: "BR.abc123", profile: { name: "Ana" } }], messages: [{ id: "wamid.2", from_user_id: "BR.abc123", type: "text", text: { body: "oi" } }] }));
    expect(r.messages).toHaveLength(0);
    expect(r.unreachable[0]).toMatchObject({ userId: "BR.abc123", name: "Ana" });
  });

  it("lê botão de modelo, botão e lista como resposta", () => {
    const r = parseWebhook(
      wrap({
        contacts: [{ wa_id: "5514988887777" }],
        messages: [
          { from: "5514988887777", id: "w1", type: "button", button: { payload: "rem:ok:1", text: "Confirmo" } },
          { from: "5514988887777", id: "w2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "c:yes", title: "Confirmar" } } },
          { from: "5514988887777", id: "w3", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "s:1", title: "Corte" } } },
        ],
      }),
    );
    expect(r.messages.map((m) => [m.type, m.replyId])).toEqual([["reply", "rem:ok:1"], ["reply", "c:yes"], ["reply", "s:1"]]);
  });
});
