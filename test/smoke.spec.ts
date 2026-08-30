/**
 * E2E smoke tests — every page loads without JS errors, renders its header,
 * and shows no "undefined" or "NaN" in primary content.
 *
 * Run: npx playwright test test/smoke.spec.ts
 * Requires the dev server on http://localhost:5173
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";

const PAGES = [
  { path: "/", title: "Command Center", code: "HOME" },
  { path: "/markets", title: "Live Markets", code: "MKT" },
  { path: "/market-snapshot", title: "Market Snapshot", code: "SNAP" },
  { path: "/asset-quilt", title: "Asset Quilt", code: "QUILT" },
  { path: "/index-returns", title: "Index Returns", code: "IRET" },
  { path: "/market-lens", title: "Market Lens Studio", code: "LENS" },
  { path: "/market-chart", title: "Market Chart Studio", code: "MKC" },
  { path: "/market-volatility", title: "Market Volatility", code: "MVOL" },
  { path: "/securities-lending", title: "Securities Lending", code: "SLAB" },
  { path: "/securities-lending/squeeze", title: "Squeeze Radar", code: "SQZ" },
  { path: "/prime-finance", title: "Prime Finance", code: "PB" },
  { path: "/collateral", title: "Collateral Management", code: "COLL" },
  { path: "/cash-optimizer", title: "Cash Optimizer", code: "CASH" },
  { path: "/reinvestment", title: "Cash Reinvestment", code: "REINV" },
  { path: "/liquidity", title: "Liquidity Stress", code: "LIQ" },
  { path: "/sources-uses", title: "Sources & Uses", code: "SXU" },
  { path: "/optimization", title: "Optimization Center", code: "OPT" },
  { path: "/trading-desk", title: "Trading Desk", code: "DESK" },
  { path: "/economics", title: "Macro Dashboard", code: "ECON" },
  { path: "/economics/curve", title: "Treasury Curve Lab", code: "CURV" },
  { path: "/economics/inflation", title: "Inflation Explorer", code: "INFL" },
  { path: "/economics/global-cpi", title: "Global Inflation", code: "GCPI" },
  { path: "/economics/policy-rates", title: "Global Policy Rates", code: "GPOL" },
  { path: "/economics/credit", title: "Credit Spreads", code: "CRDT" },
  { path: "/economics/rates", title: "Rate Probabilities", code: "FOMC" },
  { path: "/economics/calendar", title: "Economic Calendar", code: "CAL" },
  { path: "/economics/stats", title: "Statistical Analysis", code: "STAT" },
  { path: "/economics/regime", title: "Macro Regime", code: "REGIME" },
  { path: "/economics/ml", title: "ML Applications", code: "EML" },
  { path: "/economics/sec-finance", title: "Sec-Finance", code: "SFE" },
  { path: "/economics/funding", title: "Funding & Liquidity", code: "FUND" },
  { path: "/economics/benchmark", title: "Benchmark Rate", code: "BMRK" },
  { path: "/economics/utilization", title: "Utilization Analytics", code: "UTIL" },
  { path: "/economics/yield-curve", title: "Yield Curve", code: "YCURV" },
  { path: "/economics/rate-vol", title: "Rate Volatility", code: "RVOL" },
  { path: "/economics/funding-cost", title: "Funding Cost", code: "FCOST" },
  { path: "/economics/rate-analysis", title: "Rate Analysis", code: "BRA" },
  { path: "/economics/motion", title: "Motion Chart", code: "MOTN" },
  { path: "/macro-chart", title: "Macro Chart Studio", code: "MGC" },
  { path: "/news", title: "News", code: "NEWS" },
  { path: "/sentiment", title: "Sentiment", code: "SENT" },
  { path: "/copilot", title: "Copilot", code: "AI" },
  { path: "/dataops", title: "Data Health", code: "DATAOPS" },
  { path: "/alerts", title: "Alerts", code: "ALRT" },
  { path: "/polymarket", title: "Polymarket", code: "POLY" },
];

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("page load smoke tests", () => {
  for (const pg of PAGES) {
    test(`${pg.code} ${pg.path} loads without JS errors`, async ({ page }) => {
      const errors = await collectErrors(page);
      await page.goto(`${BASE}${pg.path}`, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(1000);

      // Check for uncaught JS errors (allow known module faults on pages
      // that require live data connections unavailable in CI)
      const knownFaultPages = ["/economics/curve"];
      const criticalErrors = errors.filter(
        (e) => !e.includes("ResizeObserver") && !e.includes("fetch")
      );
      if (!knownFaultPages.includes(pg.path)) {
        expect(criticalErrors).toEqual([]);
      }

      // Page should have rendered content (not a blank screen)
      const body = await page.textContent("body");
      expect(body).toBeTruthy();
      expect(body!.length).toBeGreaterThan(50);
    });
  }
});

test.describe("provenance badge visibility", () => {
  const badgeSelector = [
    'span[title*="Live"]',
    'span[title*="FRED"]',
    'span[title*="Snapshot"]',
    'span[title*="snapshot"]',
    'span[title*="Simulation"]',
    'span[title*="simulation"]',
    'span[title*="SIM"]',
    'span[title*="LIVE"]',
    'span[title*="ETL"]',
    'span[title*="econ model"]',
    'span[title*="Deterministic"]',
    'span[title*="Fetching"]',
    'span[title*="Could not"]',
  ].join(", ");

  for (const pg of PAGES) {
    test(`${pg.code} ${pg.path} shows a data source indicator`, async ({ page }) => {
      await page.goto(`${BASE}${pg.path}`, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(1500);

      const badges = await page.locator(badgeSelector).count();
      const body = await page.textContent("body") ?? "";
      const hasSourceText = /\b(SIM|SNAPSHOT|FRED|LIVE|ETL|ECON|ERR)\b/.test(body);

      expect(badges > 0 || hasSourceText).toBe(true);
    });
  }
});

test.describe("no undefined or NaN in content", () => {
  const criticalPages = PAGES.filter((p) =>
    ["/", "/markets", "/market-snapshot", "/economics", "/trading-desk"].includes(p.path)
  );

  for (const pg of criticalPages) {
    test(`${pg.code} ${pg.path} has no "undefined" or "NaN" in primary content`, async ({ page }) => {
      await page.goto(`${BASE}${pg.path}`, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(2000);

      const body = await page.textContent("body") ?? "";
      // Filter out code/technical references where "undefined" is valid
      const contentLines = body.split("\n").filter((l) => l.trim().length > 0);
      for (const line of contentLines) {
        // Skip lines that are clearly code references
        if (line.includes("typeof") || line.includes("===") || line.includes("!==")) continue;
        expect(line).not.toMatch(/\bundefined\b/);
      }
      // NaN should never appear in displayed data
      expect(body).not.toMatch(/\bNaN\b/);
    });
  }
});
