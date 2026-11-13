import pg from "pg";
import { env } from "../env.js";

let pool: pg.Pool | undefined;

export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env().DATABASE_URL,
      max: 10,
      options: "-c timezone=UTC",
    });
  }
  return pool;
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
