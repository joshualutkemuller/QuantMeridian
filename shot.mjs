/**
 * Module screenshot capture for the terminal.
 *
 * NOTE: this file is a RECONSTRUCTION. The original `shot.mjs` was untracked and
 * was overwritten on 2026-07-30; it could not be recovered from git. The target
 * list, capture geometry and output paths below were reverse-engineered from the
 * 30 committed PNGs in `screenshots/` (all 3840x2160 => 1920x1080 @ dsf 2, not
 * full-page) and from `src/lib/nav.ts`. Behaviour should match; the code will
 * not be line-for-line what was there before.
 *
 * Usage:
 *   node shot.mjs                         # capture every target
 *   node shot.mjs asset-quilt yield-curve # capture only these slugs
 *   node shot.mjs --list                  # print targets and exit
 *   node shot.mjs --sim                   # capture with SIM mode on
 *   node shot.mjs --snapshot              # capture with snapshot fallback on
 *   node shot.mjs --full                  # full-page instead of one viewport
 *   node shot.mjs --base http://localhost:3001
 *   node shot.mjs --out docs/img --wait 12000
 *
 * Requires the dev server to be running (`npm run dev`).
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * [slug, route] — slug is the PNG basename, matching the existing screenshots.
 * Slugs are hand-picked rather than derived from nav labels, so this list is
 * explicit. Covers 30 of the 45 NAV entries; add rows here to capture more.
 */
const TARGETS = [
  ["home-dashboard", "/"],
  ["markets-overview", "/markets"],
  ["market-snapshot", "/market-snapshot"],
  ["asset-quilt", "/asset-quilt"],
  ["macro-chart", "/macro-chart"],
  ["securities-lending", "/securities-lending"],
  ["prime-finance", "/prime-finance"],
  ["collateral-mgmt", "/collateral"],
  ["cash-optimizer", "/cash-optimizer"],
  ["cash-reinvestment", "/reinvestment"],
  ["liquidity-stress", "/liquidity"],
  ["sources-uses", "/sources-uses"],
  ["optimization-center", "/optimization"],
  ["trading-desk", "/trading-desk"],
  ["sentiment-analysis", "/sentiment"],
  // `economics-dashboard` and `macro-dashboard` are the same view (ECON / Macro
  // Dashboard) captured in two different runs — a stale duplicate left by a
  // rename. Both are kept so neither committed file goes orphaned.
  ["economics-dashboard", "/economics"],
  ["macro-dashboard", "/economics"],
  ["inflation-explorer", "/economics/inflation"],
  ["global-inflation", "/economics/global-cpi"],
  ["global-policy-rates", "/economics/policy-rates"],
  ["credit-spreads", "/economics/credit"],
  ["rate-probabilities", "/economics/rates"],
  ["sec-finance-econ", "/economics/sec-finance"],
  ["funding-liquidity", "/economics/funding"],
  ["benchmark-rates", "/economics/benchmark"],
  ["rate-analysis", "/economics/rate-analysis"],
  ["utilization-analytics", "/economics/utilization"],
  ["yield-curve", "/economics/yield-curve"],
  ["rate-volatility", "/economics/rate-vol"],
  ["funding-cost", "/economics/funding-cost"],
];

function parseArgs(argv) {
  const opts = {
    base: process.env.BASE_URL ?? "http://localhost:3000",
    out: "screenshots",
    wait: 9000,
    sim: false,
    snapshot: false,
    full: false,
    list: false,
    only: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sim") opts.sim = true;
    else if (a === "--snapshot") opts.snapshot = true;
    else if (a === "--full") opts.full = true;
    else if (a === "--list") opts.list = true;
    else if (a === "--base") opts.base = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--wait") opts.wait = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else opts.only.push(a);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.list) {
  for (const [slug, route] of TARGETS) console.log(`${slug.padEnd(24)} ${route}`);
  process.exit(0);
}

const targets = opts.only.length
  ? TARGETS.filter(([slug]) => opts.only.includes(slug))
  : TARGETS;

if (!targets.length) {
  console.error(`No targets matched: ${opts.only.join(", ")}\nRun with --list to see valid slugs.`);
  process.exit(1);
}

// Fail fast with one clear message rather than N navigation timeouts.
try {
  const probe = await fetch(opts.base, { signal: AbortSignal.timeout(5000) });
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
} catch (err) {
  console.error(
    `Dev server not reachable at ${opts.base} (${err.message}).\n` +
      "Start it with `npm run dev`, or pass --base.",
  );
  process.exit(1);
}

await mkdir(opts.out, { recursive: true });

const browser = await chromium.launch();
// 1920x1080 at dsf 2 reproduces the committed 3840x2160 PNGs.
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});

// Ribbon toggles are read from localStorage on mount (src/lib/simMode.tsx), so
// they must be seeded before the app's first render.
await ctx.addInitScript(
  ([sim, snapshot]) => {
    localStorage.setItem("qit-sim-mode", sim ? "1" : "0");
    localStorage.setItem("qit-snapshot-fallback", snapshot ? "1" : "0");
  },
  [opts.sim, opts.snapshot],
);

console.log(
  `Capturing ${targets.length} view(s) from ${opts.base} -> ${opts.out}/ ` +
    `[sim=${opts.sim ? "on" : "off"} snapshot=${opts.snapshot ? "on" : "off"}]`,
);

let failed = 0;

for (const [slug, route] of targets) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const file = path.join(opts.out, `${slug}.png`);
  try {
    // `networkidle` never settles — the shell polls a live ticker — so wait on
    // DOM ready and then give the async panels a fixed budget to resolve.
    await page.goto(opts.base + route, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(opts.wait);
    await page.screenshot({ path: file, fullPage: opts.full });
    console.log(`  ok   ${slug.padEnd(24)} ${route}${errors.length ? `  (${errors.length} error(s))` : ""}`);
    for (const e of errors.slice(0, 3)) console.log(`         ! ${e}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${slug.padEnd(24)} ${route} — ${err.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();
console.log(failed ? `\nDone with ${failed} failure(s).` : "\nDone.");
process.exit(failed ? 1 : 0);
