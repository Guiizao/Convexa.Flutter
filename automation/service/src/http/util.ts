import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ConvexaError } from "../convexa/types.js";
import { env } from "../env.js";
import { safeEqual } from "../lib/crypto.js";
import { errorInfo, log } from "../lib/log.js";
import { e164ToWaId } from "../lib/phone.js";
import type { Out } from "../whatsapp/messages.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** Rotas chamadas pelo n8n: header x-automacao-key */
export function requireAutomacaoKey(req: Request, _res: Response, next: NextFunction) {
  const key = req.header("x-automacao-key") ?? "";
  if (!safeEqual(key, env().AUTOMACAO_KEY)) return next(new HttpError(401, "Chave da automação inválida"));
  next();
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
  if (error instanceof ZodError) {
    return res.status(400).json({ message: "Dados inválidos", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  if (error instanceof ConvexaError) {
    const status = error.status >= 500 ? 502 : error.status;
    return res.status(status).json({ message: error.message, code: error.code });
  }
  log.error("erro não tratado", errorInfo(error));
  res.status(500).json({ message: "Erro interno" });
}

/** Formato único que o n8n envia para a Graph API: /{phoneNumberId}/messages */
export function toGraph(phoneNumberId: string, outs: Out[]) {
  return {
    phoneNumberId,
    messages: outs.map((o) => ({
      to: e164ToWaId(o.to),
      session: o.session,
      preview: o.preview,
      graph: { messaging_product: "whatsapp", recipient_type: "individual", to: e164ToWaId(o.to), ...o.body },
    })),
  };
}
