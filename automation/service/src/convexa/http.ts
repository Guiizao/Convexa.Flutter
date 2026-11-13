import { randomUUID } from "node:crypto";
import { ConvexaError } from "./types.js";

export type HttpOptions = {
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
};

export async function http<T>(base: string, method: string, path: string, opts: HttpOptions = {}): Promise<T> {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      headers: {
        Accept: "application/json",
        "X-Request-Id": `automacao-${randomUUID()}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (error) {
    throw new ConvexaError(`ConvexaAPI fora do ar (${(error as Error).name})`, 503, "UNREACHABLE");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const body = data as { message?: string; code?: string } | undefined;
    throw new ConvexaError(body?.message ?? `HTTP ${res.status}`, res.status, body?.code, data);
  }
  return data as T;
}
