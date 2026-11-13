import { createHmac } from "node:crypto";
import { env } from "../env.js";
import { safeEqual } from "./crypto.js";

/** URL assinada e com validade, para a Meta buscar imagens (QR do Pix, comprovante). */
export function signedUrl(path: string, ttlSeconds = 3 * 24 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", env().ENCRYPTION_KEY).update(`${path}:${exp}`).digest("base64url").slice(0, 32);
  return `${env().PUBLIC_URL}${path}?e=${exp}&s=${sig}`;
}

export function checkSignature(path: string, e: unknown, s: unknown): boolean {
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000 || typeof s !== "string") return false;
  const sig = createHmac("sha256", env().ENCRYPTION_KEY).update(`${path}:${exp}`).digest("base64url").slice(0, 32);
  return safeEqual(sig, s);
}
