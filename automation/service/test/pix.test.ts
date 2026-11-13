import { describe, expect, it } from "vitest";
import { brCode, crc16, parseBrCode } from "../src/payments/pix.js";

describe("Pix copia e cola", () => {
  it("CRC16 confere com o exemplo do manual do Banco Central", () => {
    const example =
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
    expect(crc16(example)).toBe("1D3D");
  });

  it("gera um código válido com valor, nome, cidade e txid", () => {
    const code = brCode({
      key: "123e4567-e12b-12d1-a456-426655440000",
      merchantName: "Barbearia Navalha",
      merchantCity: "Marília",
      amountCents: 1350,
      txid: "CVXABC123",
    });
    const f = parseBrCode(code);
    expect(f["54"]).toBe("13.50");
    expect(f["58"]).toBe("BR");
    expect(f["59"]).toBe("Barbearia Navalha");
    expect(f["60"]).toBe("Marilia");
    expect(f["26"]).toContain("br.gov.bcb.pix");
    expect(f["62"]).toBe("0509CVXABC123");
    // o CRC final bate com o resto do código
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)));
  });

  it("normaliza chave de e-mail e telefone", () => {
    expect(parseBrCode(brCode({ key: "Dono@Navalha.com.br", merchantName: "X", merchantCity: "Y" }))["26"]).toContain("dono@navalha.com.br");
    expect(parseBrCode(brCode({ key: "+55 (14) 99999-0000", merchantName: "X", merchantCity: "Y" }))["26"]).toContain("+5514999990000");
  });
});

describe("descrição do Pix", () => {
  it("remove pontuação da descrição", () => {
    const f = parseBrCode(brCode({ key: "a@b.co", merchantName: "X", merchantCity: "Y", description: "Sinal Barba sáb, 14/11 09:30" }));
    const inner = parseBrCode(f["26"]!);
    expect(inner["02"]).toBe("Sinal Barba sab 14 11 0930");
  });
});
