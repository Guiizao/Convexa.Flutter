import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, db } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));
// Em dist/ os .sql não são copiados pelo tsc: procura em src/ também
const candidates = [join(here, "migrations"), join(here, "..", "..", "src", "db", "migrations")];

export async function migrate(): Promise<string[]> {
  const dir = candidates.find((d) => {
    try {
      return readdirSync(d).some((f) => f.endsWith(".sql"));
    } catch {
      return false;
    }
  });
  if (!dir) throw new Error("Pasta de migrations não encontrada");

  const pool = db();
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} falhou: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then((applied) => {
      console.log(applied.length ? `Aplicadas: ${applied.join(", ")}` : "Banco já está atualizado");
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
