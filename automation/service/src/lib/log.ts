type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level) ?? "info";
  return order[lvl] ?? 20;
}

function write(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS) return;
  if (order[level] < threshold()) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => write("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => write("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write("error", msg, extra),
};

export function errorInfo(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { error: error.message, stack: error.stack?.split("\n").slice(0, 4).join(" | ") };
  return { error: String(error) };
}
