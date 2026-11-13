// Varredura de layout do painel: várias resoluções x todas as telas.
// Requer um build web em modo DEBUG servido (só no debug o Flutter acusa estouro de layout).
// Uso: node layout-sweep.mjs http://localhost:8090 ./saida [telas...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:8090";
const OUT = process.argv[3] ?? "./layout";
const ONLY = process.argv.slice(4);
mkdirSync(OUT, { recursive: true });

export const VIEWPORTS = [
  ["iPhone SE (1ª)", 320, 568], ["Android pequeno", 360, 740], ["iPhone SE", 375, 667], ["iPhone 14", 390, 844],
  ["Pixel 7", 412, 915], ["iPhone Pro Max", 430, 932], ["iPad retrato", 768, 1024], ["iPad Air", 820, 1180],
  ["iPad paisagem", 1024, 768], ["Tablet paisagem", 1180, 820], ["Notebook HD", 1280, 720], ["Notebook comum", 1366, 768],
  ["MacBook Air", 1440, 900], ["Notebook FHD 125%", 1536, 864], ["Monitor Full HD", 1920, 1080], ["Monitor 2K", 2560, 1440],
];
const SCREENS = [
  ["login", ""],
  ["expediente", "?demo=1&tab=expediente"],
  ["agenda", "?demo=1&tab=agenda"],
  ["servicos", "?demo=1&tab=servicos"],
  ["resultados", "?demo=1&tab=resultados"],
  ["encerrar", "?demo=1&tab=encerrar"],
  ["equipe", "?demo=1&tab=equipe"],
  ["automacao", "?demo=1&tab=automacao"],
  ["configuracoes", "?demo=1&tab=configuracoes"],
].filter(([n]) => ONLY.length === 0 || ONLY.includes(n));

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const browser = await chromium.launch({ proxy, executablePath: process.env.CHROME_PATH ?? ((await import("node:fs")).existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined) });
const jobs = [];
for (const [screen, query] of SCREENS) for (const [device, w, h] of VIEWPORTS) jobs.push({ screen, query, device, w, h });

const results = [];
async function run(job) {
  const ctx = await browser.newContext({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const problems = [];
  let buf = "";
  page.on("console", (m) => {
    const t = m.text();
    buf += t + "\n";
    if (/overflowed by|EXCEPTION CAUGHT|Another exception was thrown|RenderBox was not laid out|has no size/i.test(t)) problems.push(t.split("\n").slice(0, 3).join(" | ").slice(0, 300));
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  await page.goto(`${BASE}/${job.query}`, { waitUntil: "load" });
  await page.waitForSelector("flutter-view, flt-glass-pane", { timeout: 30000 }).catch(() => problems.push("flutter não renderizou"));
  await page.waitForTimeout(job.screen === "login" ? 3500 : 4500);
  const file = `${job.screen}__${job.w}x${job.h}.png`;
  await page.screenshot({ path: join(OUT, file) });
  await ctx.close();
  const overflow = problems.filter((p) => /overflowed/.test(p));
  results.push({ ...job, file, problems: [...new Set(problems)], overflow: overflow.length });
  process.stdout.write(problems.length ? "✗" : "·");
}
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) await run(queue.shift());
}));
await browser.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.problems.length);
console.log(`\n\n${results.length} combinações, ${bad.length} com problema`);
for (const r of bad) console.log(`- ${r.screen} @ ${r.device} ${r.w}x${r.h}: ${r.problems.slice(0, 2).join(" || ")}`);
