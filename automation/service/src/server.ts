import { buildApp } from "./app.js";
import { migrate } from "./db/migrate.js";
import { env } from "./env.js";
import { log } from "./lib/log.js";

async function main() {
  const applied = await migrate();
  if (applied.length) log.info("migrations aplicadas", { applied });
  const app = buildApp();
  app.listen(env().PORT, env().HOST, () => log.info("convexa-automacao no ar", { port: env().PORT }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
