import { describe, expect, it } from "vitest";
import { setEnvForTests } from "../src/env.js";
import { mercadoPagoNotificationUrl } from "../src/bot/customer/payment.js";

describe("URL de aviso do Mercado Pago", () => {
  const id = "5f0c7f2e-2a51-4a63-9d43-0d6f1f3a9b10";

  it("aponta para o webhook público do n8n, com a empresa no caminho", () => {
    setEnvForTests({ N8N_PUBLIC_WEBHOOK_URL: "https://n8n.exemplo.com.br/webhook/" });
    expect(mercadoPagoNotificationUrl(id)).toBe(`https://n8n.exemplo.com.br/webhook/mercadopago/${id}`);
  });

  it("sem n8n público, não manda URL (o dono confirma à mão)", () => {
    setEnvForTests({ N8N_PUBLIC_WEBHOOK_URL: undefined });
    expect(mercadoPagoNotificationUrl(id)).toBeUndefined();
  });
});
