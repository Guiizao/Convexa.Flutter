import { execFileSync } from "node:child_process";
import { createSign, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { freshTimestamp, validCertUrl, verifyBodySignature, verifyChain } from "../src/alexa/verify.js";

describe("URL do certificado da Alexa", () => {
  it.each([
    ["https://s3.amazonaws.com/echo.api/echo-api-cert.pem", true],
    ["https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem", true],
    ["https://S3.AMAZONAWS.COM/echo.api/../echo.api/echo-api-cert.pem", true],
    ["http://s3.amazonaws.com/echo.api/echo-api-cert.pem", false],
    ["https://notamazon.com/echo.api/echo-api-cert.pem", false],
    ["https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem", false],
    ["https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem", false],
    ["https://s3.amazonaws.com/invalid.path/echo-api-cert.pem", false],
  ])("%s -> %s", (url, ok) => expect(validCertUrl(url)).toBe(ok));
});

describe("assinatura e cadeia", () => {
  const dir = mkdtempSync(join(tmpdir(), "alexa-"));
  const sh = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  sh("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=Raiz de Teste");
  sh("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=echo-api.amazon.com");
  writeFileSync(join(dir, "ext.cnf"), "subjectAltName=DNS:echo-api.amazon.com\n");
  sh("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "1", "-extfile", "ext.cnf");
  const leafPem = readFileSync(join(dir, "leaf.pem"), "utf8");
  const caPem = readFileSync(join(dir, "ca.pem"), "utf8");
  const chain = [new X509Certificate(leafPem), new X509Certificate(caPem)];
  const body = JSON.stringify({ request: { type: "LaunchRequest" } });
  const sign = (data: string) => createSign("RSA-SHA256").update(data).sign(readFileSync(join(dir, "leaf.key")), "base64");

  it("aceita cadeia válida assinada por raiz confiável", () => {
    expect(verifyChain(chain, [caPem])).toBe(true);
  });
  it("recusa cadeia que não chega numa raiz confiável", () => {
    expect(verifyChain(chain, [])).toBe(false);
  });
  it("recusa certificado vencido", () => {
    expect(verifyChain(chain, [caPem], new Date(Date.now() + 10 * 24 * 3600_000))).toBe(false);
  });
  it("confere a assinatura do corpo", () => {
    expect(verifyBodySignature(chain[0]!, body, sign(body))).toBe(true);
    expect(verifyBodySignature(chain[0]!, body + " ", sign(body))).toBe(false);
  });
  it("timestamp tem que estar a até 150s", () => {
    expect(freshTimestamp(new Date().toISOString())).toBe(true);
    expect(freshTimestamp(new Date(Date.now() - 200_000).toISOString())).toBe(false);
  });
});
