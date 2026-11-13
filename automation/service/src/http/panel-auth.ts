import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";
import { http } from "../convexa/http.js";
import type { BusinessInfo } from "../convexa/types.js";
import { ConvexaError } from "../convexa/types.js";
import { sha256 } from "../lib/crypto.js";
import { HttpError } from "./util.js";

export type PanelUser = { businessId: string; userId: string; role: "OWNER" | "STAFF"; business: BusinessInfo; token: string };

declare module "express-serve-static-core" {
  interface Request {
    panel?: PanelUser;
  }
}

const cache = new Map<string, { user: PanelUser; until: number }>();

function claims(token: string): { userId?: string; businessId?: string; role?: string; exp?: number } {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * O painel manda o próprio accessToken da ConvexaAPI. A autenticidade é
 * provada pela própria API (GET /api/business aceita o token); os dados do
 * usuário vêm do payload, que é assinado e só é lido depois disso.
 */
export async function panelAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Faça login no painel");
    const key = sha256(token);
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) {
      req.panel = hit.user;
      return next();
    }
    let business: BusinessInfo;
    try {
      business = await http<BusinessInfo>(env().CONVEXA_API_URL, "GET", "/api/business", { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      if (error instanceof ConvexaError && error.status === 401) throw new HttpError(401, "Sessão expirada. Faça login novamente");
      throw error;
    }
    const c = claims(token);
    if (c.businessId && c.businessId !== business.id) throw new HttpError(401, "Token inválido");
    const user: PanelUser = { businessId: business.id, userId: c.userId ?? "", role: c.role === "STAFF" ? "STAFF" : "OWNER", business, token };
    const until = Math.min(Date.now() + 5 * 60_000, (c.exp ?? 0) * 1000 || Date.now() + 60_000);
    cache.set(key, { user, until });
    if (cache.size > 2000) for (const [k, v] of cache) if (v.until < Date.now()) cache.delete(k);
    req.panel = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function ownerOnly(req: Request, _res: Response, next: NextFunction) {
  if (req.panel?.role !== "OWNER") return next(new HttpError(403, "Só o dono pode alterar isso"));
  next();
}
