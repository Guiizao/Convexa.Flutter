import { X509Certificate, createVerify } from "node:crypto";
import { rootCertificates } from "node:tls";

/**
 * Verificação obrigatória de requisições da Alexa:
 * https://developer.amazon.com/docs/custom-skills/host-a-custom-skill-as-a-web-service.html
 */
const certCache = new Map<string, { chain: X509Certificate[]; until: number }>();

export function validCertUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const path = u.pathname.replace(/\/+/g, "/");
  return (
    u.protocol === "https:" &&
    u.hostname.toLowerCase() === "s3.amazonaws.com" &&
    (u.port === "" || u.port === "443") &&
    // a Amazon exige que o caminho normalizado comece com /echo.api/
    new URL(path, "https://s3.amazonaws.com").pathname.startsWith("/echo.api/")
  );
}

function splitPem(pem: string): X509Certificate[] {
  return (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map((c) => new X509Certificate(c));
}

export async function fetchChain(url: string): Promise<X509Certificate[]> {
  const hit = certCache.get(url);
  if (hit && hit.until > Date.now()) return hit.chain;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error("certificado da Alexa indisponível");
  const chain = splitPem(await res.text());
  certCache.set(url, { chain, until: Date.now() + 6 * 3600_000 });
  return chain;
}

export function verifyChain(chain: X509Certificate[], roots: string[] = rootCertificates as unknown as string[], now = new Date()): boolean {
  const leaf = chain[0];
  if (!leaf) return false;
  const inDate = (c: X509Certificate) => new Date(c.validFrom) <= now && now <= new Date(c.validTo);
  if (!chain.every(inDate)) return false;
  if (!(leaf.subjectAltName ?? "").split(",").some((s) => s.trim() === "DNS:echo-api.amazon.com")) return false;
  for (let i = 0; i < chain.length - 1; i++) {
    if (!chain[i]!.verify(chain[i + 1]!.publicKey)) return false;
  }
  const top = chain[chain.length - 1]!;
  const trusted = roots.map((r) => new X509Certificate(r));
  return trusted.some((root) => top.verify(root.publicKey) || top.fingerprint256 === root.fingerprint256);
}

export function verifyBodySignature(leaf: X509Certificate, rawBody: string, signatureB64: string): boolean {
  const v = createVerify("RSA-SHA256");
  v.update(rawBody, "utf8");
  return v.verify(leaf.publicKey, Buffer.from(signatureB64, "base64"));
}

export function freshTimestamp(timestamp: string | undefined, now = Date.now()): boolean {
  if (!timestamp) return false;
  return Math.abs(now - Date.parse(timestamp)) <= 150_000;
}

export async function verifyAlexaRequest(input: { rawBody: string; signature?: string | null; certUrl?: string | null }): Promise<boolean> {
  if (!input.signature || !validCertUrl(input.certUrl)) return false;
  const chain = await fetchChain(input.certUrl!);
  if (!verifyChain(chain)) return false;
  return verifyBodySignature(chain[0]!, input.rawBody, input.signature);
}
