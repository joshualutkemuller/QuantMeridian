import { Rng } from "@/lib/rng";
import indexReturnsRaw from "./market/index_returns.json";
import bilelloRaw from "./market/bilello.json";
import marketSnapshotRaw from "./market/market_snapshot.json";
import { getSeriesHistory as econHistory, seriesById as econMeta, resolveFred } from "@/data/econSeries";
import { fredEnabled, fredSeries } from "@/lib/server/fred";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";
import {
  WINDOW_DAYS,
  type Stat,
  summarize,
  fwd,
  fwdStatsAtEvents,
  baselineStats,
  drawdownPct,
  rollingReturns,
  movingAvg,
  pearson,
  dailyReturns,
  pct,
  percentileOf,
} from "@/data/marketLensMath";

/**
 * Market Lens Studio — local analytics engine.
 *
 * This is the deterministic, no-backend fallback for the Market Lens "run"
 * endpoint. It mirrors the pattern used by the other market modules
 * (`/api/market/[view]`): when no external service is configured the terminal
 * still renders meaningful, real-shaped analytics computed in TypeScript from a
 * deterministic synthetic price/level series (seeded per series_id, so output is
 * stable across renders). When `MARKET_LENS_URL` is set the route prefers the
 * live Python engine; this engine is the graceful `SNAPSHOT` tier underneath.
 *
 * All synthetic series are clearly labelled `SNAPSHOT`/synthetic by the caller.
 * ETF proxies are surfaced via `metadata.proxy_notes`.
 */

// ── Public contract (matches the frontend tile renderer) ────────────────────

export interface LensSeriesInput {
  series_id: string;
  ticker?: string;
  source?: string;
  display_name?: string;
  asset_class?: string;
}

export interface LensRunRequest {
  view_id: string;
  series?: LensSeriesInput[];
  forward_windows?: string[];
  selected_tiles?: string[];
  allow_snapshot_fallback?: boolean;
  allow_sim_fallback?: boolean;
}

export interface TilePayload {
  tile_id: string;
  chart_type: "table" | "boxplot" | "bar" | "heatmap" | "line" | "gauge" | "text";
  title: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AnalysisResult {
  view_id: string;
  tiles: TilePayload[];
  series_used: string[];
  warnings: string[];
  narrative: string;
  metadata: Record<string, unknown>;
  sample_size: number;
}

// ── Series generation ───────────────────────────────────────────────────────

const HISTORY_YEARS = 12;
const TRADING_DAYS = 252;
const N = HISTORY_YEARS * TRADING_DAYS; // ~3024 points

type DataSource = "gold-db" | "index-monthly" | "bilello-yearly" | "fred" | "econ-sim" | "synthetic" | "unavailable";

interface LensRunOptions {
  allowSnapshotFallback: boolean;
  allowSimFallback: boolean;
}

const DEFAULT_RUN_OPTIONS: LensRunOptions = { allowSnapshotFallback: true, allowSimFallback: true };

interface Series {
  id: string;
  name: string;
  assetClass: string;
  dates: string[];
  values: number[]; // price/index level, or yield/spread level for RATE/CREDIT
  kind: "price" | "level"; // "level" = yields/spreads where forward "return" is meaningless
  dataSource: DataSource;
}

const PROXY_FOR: Record<string, string> = {
  SPY: "S&P 500 Index", QQQ: "Nasdaq 100", IWM: "Russell 2000", DIA: "Dow Jones Industrial Average",
  EFA: "MSCI EAFE", EEM: "MSCI Emerging Markets", AGG: "US Aggregate Bond", HYG: "US High Yield Credit",
  LQD: "US Investment Grade Credit", GLD: "Gold", VNQ: "US Real Estate",
};

const ANNUAL: Record<string, { drift: number; vol: number; start: number }> = {
  EQUITY: { drift: 0.085, vol: 0.17, start: 100 },
  BOND: { drift: 0.028, vol: 0.06, start: 100 },
  COMMODITY: { drift: 0.04, vol: 0.20, start: 100 },
  REIT: { drift: 0.065, vol: 0.21, start: 100 },
  CURRENCY: { drift: 0.0, vol: 0.08, start: 100 },
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Business-day date axis of length n ending at `anchor` (weekends skipped). */
function businessDates(n: number, anchor: Date): string[] {
  const out: string[] = [];
  const d = new Date(anchor);
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(isoDate(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

function vixSeries(rng: Rng, dates: string[]): number[] {
  const mu = 18;
  let x = mu;
  return dates.map(() => {
    const jump = rng.bool(0.012) ? rng.float(8, 32) : 0; // occasional panic spike
    x = mu + (x - mu) * 0.94 + rng.normal(0, 2.0) + jump;
    x = Math.max(9, Math.min(85, x));
    return Number(x.toFixed(2));
  });
}

function levelSeries(rng: Rng, dates: string[], base: number, sd: number, lo: number, hi: number): number[] {
  let x = base;
  return dates.map(() => {
    x = base + (x - base) * 0.985 + rng.normal(0, sd);
    x = Math.max(lo, Math.min(hi, x));
    return Number(x.toFixed(3));
  });
}

function macroIndex(rng: Rng, dates: string[]): number[] {
  let x = 250;
  const daily = 0.025 / TRADING_DAYS;
  return dates.map(() => {
    x = x * (1 + daily + rng.normal(0, 0.0006));
    return Number(x.toFixed(3));
  });
}

function priceSeries(rng: Rng, dates: string[], assetClass: string): number[] {
  const p = ANNUAL[assetClass] ?? ANNUAL.EQUITY;
  const mu = p.drift / TRADING_DAYS;
  const sd = p.vol / Math.sqrt(TRADING_DAYS);
  let x = p.start;
  let vol = sd;
  return dates.map(() => {
    // light vol clustering for realistic drawdowns
    vol = 0.94 * vol + 0.06 * sd * (1 + Math.abs(rng.normal(0, 1)));
    x = x * (1 + rng.normal(mu, vol));
    return Number(x.toFixed(4));
  });
}

// ── Real committed-snapshot data (preferred over synthetic) ─────────────────
// Reuses the same gold JSON the other market modules ship (`src/data/market/*`):
//   • index_returns.json — monthly total returns for the 6 index proxies
//   • bilello.json       — yearly total returns for ~48 ETFs/asset classes
//   • market_snapshot.json — current price levels (for realistic anchoring)
// A daily series is reconstructed so its segment returns match the committed
// data exactly, with seeded intra-segment fill for daily-granularity analytics.

const IDX = indexReturnsRaw as unknown as { matrices?: Record<string, any> };
const BIL = bilelloRaw as unknown as { asset_class_returns_by_year?: any[] };
const SNAP = marketSnapshotRaw as unknown as { cards?: any[] };

const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MATRIX_BY_PROXY: Record<string, any> = {};
for (const sym of Object.keys(IDX.matrices ?? {})) {
  const mtx = IDX.matrices![sym];
  const proxy = mtx?.index?.proxy;
  if (proxy) MATRIX_BY_PROXY[proxy] = mtx;
}

const SNAP_PRICE: Record<string, number> = {};
for (const c of SNAP.cards ?? []) if (typeof c.price === "number") SNAP_PRICE[c.series_id] = c.price;

interface Anchor { date: Date; ret: number; }

function lastBusinessDay(year: number, monthIdx0: number): Date {
  const d = new Date(Date.UTC(year, monthIdx0 + 1, 0)); // last calendar day of month
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** Chronological monthly return anchors for an index proxy (index_returns.json). */
function indexMonthlyAnchors(seriesId: string): Anchor[] | null {
  const m = MATRIX_BY_PROXY[seriesId];
  if (!m) return null;
  const cols: number[] = [...(m.years ?? []), m.ytdYear].filter((y: any) => y != null);
  const valsByMonth: Record<string, any> = {};
  for (const row of m.rows ?? []) valsByMonth[row.month] = row.values;
  const anchors: Anchor[] = [];
  for (const year of cols) {
    for (let mi = 0; mi < 12; mi++) {
      const v = valsByMonth[MONTHS3[mi]]?.[String(year)];
      if (v == null) continue;
      anchors.push({ date: lastBusinessDay(year, mi), ret: v / 100 });
    }
  }
  return anchors.length >= 24 ? anchors : null;
}

/** Chronological yearly return anchors for an ETF (bilello.json). */
function bilelloYearlyAnchors(seriesId: string): Anchor[] | null {
  const rows = (BIL.asset_class_returns_by_year ?? []).filter((r: any) => r.series_id === seriesId);
  if (rows.length < 4) return null;
  rows.sort((a: any, b: any) => a.year - b.year);
  return rows.map((r: any) => ({ date: lastBusinessDay(r.year, 11), ret: r.total_return }));
}

function businessDaysBetween(d0: Date, d1: Date): string[] {
  const out: string[] = [];
  const d = new Date(d0);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d <= d1) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(isoDate(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Reconstruct a daily price series whose per-segment compounded return matches
 * the committed anchors exactly (endpoints forced), with deterministic seeded
 * intra-segment fill so daily-granularity views (drawdowns, event studies)
 * have realistic texture. Optionally scaled to end at the snapshot price.
 */
function realDailySeries(seriesId: string, anchors: Anchor[], endPrice: number | null): { dates: string[]; values: number[] } {
  const aPrice: number[] = [];
  let p = 100;
  for (const a of anchors) { p = p * (1 + a.ret); aPrice.push(p); }

  const dates: string[] = [isoDate(anchors[0].date)];
  const values: number[] = [Number(aPrice[0].toFixed(4))];

  for (let i = 1; i < anchors.length; i++) {
    const segDates = businessDaysBetween(anchors[i - 1].date, anchors[i].date);
    if (!segDates.length) { dates.push(isoDate(anchors[i].date)); values.push(Number(aPrice[i].toFixed(4))); continue; }
    const k = segDates.length;
    const R = aPrice[i - 1] !== 0 ? aPrice[i] / aPrice[i - 1] - 1 : 0;
    const L = Math.log(1 + R);
    const rng = new Rng(`lens:${seriesId}:seg${i}`);
    const noise = Array.from({ length: k }, () => rng.normal(0, 0.008));
    const mean = noise.reduce((a, b) => a + b, 0) / k;
    let prev = aPrice[i - 1];
    for (let j = 0; j < k; j++) {
      prev = j === k - 1 ? aPrice[i] : prev * Math.exp(L / k + (noise[j] - mean));
      dates.push(segDates[j]);
      values.push(Number(prev.toFixed(4)));
    }
  }

  if (endPrice && values[values.length - 1] > 0) {
    const scale = endPrice / values[values.length - 1];
    for (let i = 0; i < values.length; i++) values[i] = Number((values[i] * scale).toFixed(4));
  }
  return { dates, values };
}

const SERIES_CACHE = new Map<string, Series>();

interface GoldObsRow { series_id?: string; date?: string; observation_date?: string; value?: number | string | null }
interface GoldEquityRow {
  ticker?: string;
  date?: string;
  observation_date?: string;
  close?: number | string | null;
  total_return_index?: number | string | null;
  price_return_index?: number | string | null;
}

function finiteNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isLevelInput(input: LensSeriesInput): boolean {
  const id = input.series_id;
  const assetClass = (input.asset_class ?? "").toUpperCase();
  return MACRO_LEVEL_IDS.includes(id) || ["VOLATILITY", "RATE", "CREDIT", "MACRO"].includes(assetClass);
}

function unavailableSeries(input: LensSeriesInput): Series {
  const assetClass = (input.asset_class ?? "EQUITY").toUpperCase();
  return {
    id: input.series_id,
    name: input.display_name ?? input.series_id,
    assetClass,
    dates: [],
    values: [],
    kind: isLevelInput(input) ? "level" : "price",
    dataSource: "unavailable",
  };
}

async function resolveGoldDbSeries(input: LensSeriesInput): Promise<boolean> {
  if (!goldEnabled()) return false;
  const id = input.series_id;
  if (SERIES_CACHE.has(id)) return true;
  const store = goldStore();

  if (isLevelInput(input)) {
    const econId = ECON_ID[id] ?? id;
    const rows = await store.history<GoldObsRow>("fred_latest_observation", { series_id: econId }, nForFreq(econMeta(econId)?.freq ?? "D"));
    const clean = rows
      .map((r) => {
        const value = finiteNumber(r.value);
        return { date: r.date ?? r.observation_date, value: SPREAD_BPS.has(id) && value !== null ? value / 100 : value };
      })
      .filter((r): r is { date: string; value: number } => Boolean(r.date) && r.value !== null);
    if (!clean.length) return false;
    SERIES_CACHE.set(id, {
      id,
      name: input.display_name ?? econMeta(econId)?.label ?? id,
      assetClass: (input.asset_class ?? "").toUpperCase(),
      dates: clean.map((r) => r.date),
      values: clean.map((r) => r.value),
      kind: "level",
      dataSource: "gold-db",
    });
    return true;
  }

  const rows = await store.history<GoldEquityRow>("equity_total_return_index", { ticker: id });
  const clean = rows
    .map((r) => ({ date: r.date ?? r.observation_date, value: finiteNumber(r.close ?? r.total_return_index ?? r.price_return_index) }))
    .filter((r): r is { date: string; value: number } => Boolean(r.date) && r.value !== null);
  if (!clean.length) return false;
  SERIES_CACHE.set(id, {
    id,
    name: input.display_name ?? id,
    assetClass: (input.asset_class ?? "EQUITY").toUpperCase(),
    dates: clean.map((r) => r.date),
    values: clean.map((r) => r.value),
    kind: "price",
    dataSource: "gold-db",
  });
  return true;
}

function buildSeries(input: LensSeriesInput, options: LensRunOptions = DEFAULT_RUN_OPTIONS): Series {
  const id = input.series_id;
  const cached = SERIES_CACHE.get(id);
  if (cached) return cached;

  const anchor = new Date();
  const dates = businessDates(N, anchor);
  const rng = new Rng(`lens:${id}`);
  const assetClass = (input.asset_class ?? "EQUITY").toUpperCase();
  const name = input.display_name ?? id;

  let values: number[];
  let outDates = dates;
  let kind: Series["kind"] = "price";
  let dataSource: DataSource = "synthetic";

  if (id === "^VIX") {
    values = vixSeries(rng, dates);
    kind = "level";
  } else if (id === "DGS2") {
    values = levelSeries(rng, dates, 3.6, 0.04, 0.05, 8);
    kind = "level";
  } else if (id === "DGS10") {
    values = levelSeries(rng, dates, 4.1, 0.035, 0.4, 8);
    kind = "level";
  } else if (id === "FEDFUNDS") {
    values = levelSeries(rng, dates, 4.0, 0.02, 0, 7);
    kind = "level";
  } else if (id === "BAMLH0A0HYM2") {
    values = levelSeries(rng, dates, 4.2, 0.05, 2.2, 12);
    kind = "level";
  } else if (id === "BAMLC0A0CM") {
    values = levelSeries(rng, dates, 1.3, 0.02, 0.6, 4);
    kind = "level";
  } else if (id === "CPIAUCSL") {
    values = macroIndex(rng, dates);
    kind = "level";
  } else if (assetClass === "VOLATILITY") {
    values = vixSeries(rng, dates);
    kind = "level";
  } else if (assetClass === "RATE" || assetClass === "CREDIT" || assetClass === "MACRO") {
    values = levelSeries(rng, dates, 4, 0.04, 0.1, 10);
    kind = "level";
  } else {
    // Price series — prefer committed return snapshots only when explicitly allowed, else synthesize only when SIM is enabled.
    const monthly = indexMonthlyAnchors(id);
    const anchors = monthly ?? bilelloYearlyAnchors(id);
    if (options.allowSnapshotFallback && anchors) {
      const real = realDailySeries(id, anchors, SNAP_PRICE[id] ?? null);
      values = real.values;
      outDates = real.dates;
      dataSource = monthly ? "index-monthly" : "bilello-yearly";
    } else if (options.allowSimFallback) {
      values = priceSeries(rng, dates, assetClass);
    } else {
      return unavailableSeries(input);
    }
    kind = "price";
  }

  const s: Series = { id, name, assetClass, dates: outDates, values, kind, dataSource };
  SERIES_CACHE.set(id, s);
  return s;
}

// ── Macro level series from the existing econ/FRED layer ────────────────────
// VIX, rates, credit spreads and CPI are sourced from the same catalog the
// econ pages use: live FRED when FRED_API_KEY is set, otherwise the terminal's
// deterministic econ model (getSeriesHistory) — never bespoke synthetic noise.
// These are resolved (async) into SERIES_CACHE before the sync builders run.

const ECON_ID: Record<string, string> = { "^VIX": "VIXCLS" };
const SPREAD_BPS = new Set(["BAMLH0A0HYM2", "BAMLC0A0CM"]); // catalog bps -> percent for builders
const MACRO_LEVEL_IDS = ["^VIX", "DGS2", "DGS10", "FEDFUNDS", "BAMLH0A0HYM2", "BAMLC0A0CM", "CPIAUCSL"];

function nForFreq(freq: "D" | "W" | "M" | "Q"): number {
  return freq === "D" ? 2600 : freq === "W" ? 520 : freq === "M" ? 130 : 44;
}

async function resolveLevelSeries(input: LensSeriesInput, options: LensRunOptions = DEFAULT_RUN_OPTIONS): Promise<void> {
  const id = input.series_id;
  if (SERIES_CACHE.has(id)) return;
  try {
    if (await resolveGoldDbSeries(input)) return;
  } catch {
    // Gold DB miss/error falls through to live FRED or explicit fallback tiers.
  }
  const econId = ECON_ID[id] ?? id;
  const meta = econMeta(econId);
  if (!meta) return; // unknown macro id — leave to synthetic buildSeries when SIM is allowed
  const n = nForFreq(meta.freq);

  let obs: { date: string; value: number }[] = [];
  let dataSource: DataSource = "econ-sim";
  if (fredEnabled()) {
    try {
      const r = resolveFred(econId);
      if (!r.simOnly) {
        const f = await fredSeries(econId, { limit: n, units: "lin", scale: SPREAD_BPS.has(id) ? 1 : r.scale });
        const clean = f.filter((o) => o.value !== null) as { date: string; value: number }[];
        if (clean.length) { obs = clean; dataSource = "fred"; }
      }
    } catch { /* fall through to the deterministic econ model */ }
  }
  if (!obs.length && options.allowSimFallback) obs = econHistory(econId, n);
  if (!obs.length) {
    return;
  }

  let dates = obs.map((o) => o.date);
  let values = obs.map((o) => o.value);
  if (SPREAD_BPS.has(id)) values = values.map((v) => v / 100); // bps -> percent

  // CPI: the builders need an index level. FRED `lin` returns the index; the
  // econ model returns YoY %, so synthesize a deterministic index in that case.
  if (id === "CPIAUCSL" && dataSource !== "fred" && options.allowSimFallback) {
    dates = businessDates(N, new Date());
    values = macroIndex(new Rng(`lens:${id}`), dates);
    dataSource = "synthetic";
  }

  SERIES_CACHE.set(id, {
    id, name: input.display_name ?? meta.label ?? id,
    assetClass: (input.asset_class ?? "").toUpperCase(),
    dates, values, kind: "level", dataSource,
  });
}

/** Level value as-of each target date (last-observation-carried-forward). */
function alignLevel(level: Series, dates: string[]): number[] {
  const out: number[] = [];
  let li = 0;
  let last = level.values[0] ?? 0;
  for (const d of dates) {
    while (li < level.dates.length && level.dates[li] <= d) { last = level.values[li]; li++; }
    out.push(last);
  }
  return out;
}

// ── Math helpers ─────────────────────────────────────────────────────────────
// Pure statistical primitives live in ./marketLensMath (imported above).

// ── Tile assembly helpers ───────────────────────────────────────────────────

function boxTile(tile_id: string, title: string, stats: Record<string, Stat>): TilePayload {
  return { tile_id, chart_type: "boxplot", title, payload: { statistics: stats } };
}

function eventTableTile(tile_id: string, title: string, events: Record<string, unknown>[]): TilePayload {
  return { tile_id, chart_type: "table", title, payload: { events } };
}

/** Object-mode table: rows keyed by label, columns = inner keys (percent units). */
function returnTableTile(tile_id: string, title: string, returns: Record<string, Record<string, number | null>>): TilePayload {
  return { tile_id, chart_type: "table", title, payload: { returns } };
}

function lineTile(tile_id: string, title: string, values: (number | null)[]): TilePayload {
  return { tile_id, chart_type: "line", title, payload: { values } };
}

function barTile(tile_id: string, title: string, returns: Record<string, { mean: number }>): TilePayload {
  return { tile_id, chart_type: "bar", title, payload: { returns } };
}

function heatTile(tile_id: string, title: string, months: Record<string, Stat | { latest: number }>): TilePayload {
  return { tile_id, chart_type: "heatmap", title, payload: { months } };
}

function gaugeTile(tile_id: string, title: string, regime: string, composite: number): TilePayload {
  return { tile_id, chart_type: "gauge", title, payload: { stress: { regime, composite_percentile: composite } } };
}

function regimeFromPercentile(p: number): string {
  if (p >= 0.85) return "STRESS";
  if (p >= 0.6) return "ELEVATED";
  if (p <= 0.2) return "BENIGN";
  return "NORMAL";
}

// ── Event detectors ─────────────────────────────────────────────────────────

function detectATH(values: number[], cooldown = 21): number[] {
  const idx: number[] = [];
  let peak = -Infinity;
  let last = -Infinity;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
      if (i - last >= cooldown) { idx.push(i); last = i; }
    }
  }
  return idx;
}

function detectThresholdCross(values: number[], threshold: number, cooldown = 21): number[] {
  const idx: number[] = [];
  let last = -Infinity;
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] < threshold && values[i] >= threshold && i - last >= cooldown) {
      idx.push(i); last = i;
    }
  }
  return idx;
}

interface DrawdownEvent { peakDate: string; troughDate: string; depthPct: number; lengthDays: number; recoveryDays: number | null; }

function drawdownEvents(s: Series, thresholdPct: number): DrawdownEvent[] {
  const { values, dates } = s;
  const events: DrawdownEvent[] = [];
  let peak = values[0], peakIdx = 0, inDD = false, troughIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] >= peak) {
      if (inDD) {
        const depth = (values[troughIdx] / values[peakIdx] - 1) * 100;
        if (depth <= thresholdPct) {
          events.push({
            peakDate: dates[peakIdx], troughDate: dates[troughIdx],
            depthPct: Number(depth.toFixed(2)),
            lengthDays: troughIdx - peakIdx,
            recoveryDays: i - troughIdx,
          });
        }
      }
      peak = values[i]; peakIdx = i; inDD = false;
    } else {
      if (!inDD || values[i] < values[troughIdx]) troughIdx = i;
      inDD = true;
    }
  }
  // open drawdown not yet recovered
  if (inDD) {
    const depth = (values[troughIdx] / values[peakIdx] - 1) * 100;
    if (depth <= thresholdPct) {
      events.push({
        peakDate: dates[peakIdx], troughDate: dates[troughIdx],
        depthPct: Number(depth.toFixed(2)), lengthDays: troughIdx - peakIdx, recoveryDays: null,
      });
    }
  }
  return events.sort((a, b) => a.depthPct - b.depthPct);
}

// ── View builders ───────────────────────────────────────────────────────────

type Builder = (ctx: { series: Series[]; windows: string[]; vix: Series; options: LensRunOptions }) => Omit<AnalysisResult, "view_id" | "series_used" | "warnings" | "metadata">;

function statsRow(st: Record<string, Stat>, windows: string[]): Record<string, number | null> {
  const row: Record<string, number | null> = {};
  for (const w of windows) row[w] = pct(st[w]?.mean ?? null);
  return row;
}

const BUILDERS: Record<string, Builder> = {
  ath_forward_returns: ({ series, windows }) => {
    const s = series[0];
    const idx = detectATH(s.values);
    const ev = fwdStatsAtEvents(s.values, idx, windows);
    const base = baselineStats(s.values, windows);
    const events = idx.slice(-40).map((i) => {
      const row: Record<string, unknown> = { date: s.dates[i], level: Number(s.values[i].toFixed(2)) };
      for (const w of windows) row[`${w} %`] = pct(fwd(s.values, i, WINDOW_DAYS[w] ?? 21));
      return row;
    });
    return {
      sample_size: idx.length,
      narrative:
        `All-time-high event study on ${s.name}.\n` +
        `• Detected ${idx.length} fresh all-time highs (21-day cooldown) over ${HISTORY_YEARS}y of history.\n` +
        `• 1Y forward median after an ATH: ${pct(ev["1Y"]?.median ?? null) ?? "—"}% vs baseline ${pct(base["1Y"]?.median ?? null) ?? "—"}%.\n` +
        `Caveats:\nNew highs are not a sell signal on their own — forward returns are conditional and noisy.`,
      tiles: [
        eventTableTile("event_table", "All-Time High Events", events),
        boxTile("forward_return_box", "Forward Returns After ATH", ev),
        lineTile("cumulative_chart", `${s.id} Price`, s.values.slice(-120)),
        returnTableTile("baseline_comparison", "Post-ATH vs Baseline (mean %)", {
          "Post-ATH": statsRow(ev, windows), Baseline: statsRow(base, windows),
        }),
      ],
    };
  },

  drawdown_analysis: ({ series }) => {
    const s = series[0];
    const events = drawdownEvents(s, -5);
    const dd = drawdownPct(s.values);
    const recov = summarize(events.filter((e) => e.recoveryDays !== null).map((e) => e.recoveryDays as number));
    return {
      sample_size: events.length,
      narrative:
        `Drawdown analysis on ${s.name} (threshold ≤ -5%).\n` +
        `• ${events.length} drawdowns exceeded -5%; worst was ${events[0]?.depthPct ?? "—"}%.\n` +
        `• Median recovery time: ${recov.median?.toFixed(0) ?? "—"} trading days.\n` +
        `Caveats:\nSynthetic series — magnitudes are illustrative.`,
      tiles: [
        eventTableTile("drawdown_table", "Drawdowns ≤ -5%", events.slice(0, 40) as unknown as Record<string, unknown>[]),
        lineTile("drawdown_chart", "Drawdown from Peak (%)", dd.slice(-250)),
        eventTableTile("recovery_histogram", "Recovery Profile", events.slice(0, 40) as unknown as Record<string, unknown>[]),
      ],
    };
  },

  vix_spike_study: ({ series, windows, vix }) => {
    const s = series.find((x) => x.assetClass !== "VOLATILITY") ?? series[0];
    const v = alignLevel(vix, s.dates);
    const idx = detectThresholdCross(v, 30);
    const ev = fwdStatsAtEvents(s.values, idx, windows);
    const events = idx.slice(-40).map((i) => {
      const row: Record<string, unknown> = { date: s.dates[i], vix: Number(v[i].toFixed(1)) };
      for (const w of windows) row[`${w} %`] = pct(fwd(s.values, i, WINDOW_DAYS[w] ?? 21));
      return row;
    });
    return {
      sample_size: idx.length,
      narrative:
        `VIX spike event study — ${s.name} forward returns after VIX crosses above 30.\n` +
        `• ${idx.length} spike events detected.\n` +
        `• 3M forward median: ${pct(ev["3M"]?.median ?? null) ?? "—"}% (panic often precedes recovery).\n` +
        `Caveats:\nVIX from FRED/econ layer; events aligned by date.`,
      tiles: [
        eventTableTile("event_table", "VIX > 30 Events", events),
        boxTile("forward_return_box", "Forward Returns After VIX Spike", ev),
        lineTile("vix_overlay", "VIX", vix.values.slice(-250)),
      ],
    };
  },

  largest_vix_increases: ({ series, windows, vix }) => buildVixChange(series, windows, vix, true),
  largest_vix_decreases: ({ series, windows, vix }) => buildVixChange(series, windows, vix, false),

  rolling_returns: ({ series, windows }) => {
    const s = series[0];
    const stats: Record<string, Stat> = {};
    const tableRows: Record<string, number | null> = {};
    for (const w of windows) {
      const rr = rollingReturns(s.values, WINDOW_DAYS[w] ?? 21).map((x) => x / 100);
      stats[w] = summarize(rr);
      tableRows[`${w} mean %`] = pct(stats[w].mean);
    }
    const oneY = rollingReturns(s.values, 252);
    const cur = oneY[oneY.length - 1] ?? 0;
    const p = percentileOf(oneY, cur);
    return {
      sample_size: oneY.length,
      narrative:
        `Rolling-return distribution for ${s.name}.\n` +
        `• Current 1Y rolling return sits at the ${(p * 100).toFixed(0)}th percentile of its own history.\n` +
        `Caveats:\nDistributions are backward-looking.`,
      tiles: [
        boxTile("histogram", "Rolling Return Distribution", stats),
        gaugeTile("percentile_gauge", "1Y Rolling Return Percentile", regimeFromPercentile(p), p),
        lineTile("rolling_chart", "1Y Rolling Return (%)", oneY.slice(-250)),
        returnTableTile("statistics_table", "Rolling Return Stats", { [s.id]: tableRows }),
      ],
    };
  },

  monthly_seasonality: ({ series }) => {
    const s = series[0];
    const byMonth: Record<number, number[]> = {};
    const dr = dailyReturns(s.values);
    // monthly returns
    const monthMap = new Map<string, number[]>();
    for (let i = 1; i < s.values.length; i++) {
      const key = s.dates[i].slice(0, 7);
      const arr = monthMap.get(key) ?? [];
      arr.push(dr[i - 1]);
      monthMap.set(key, arr);
    }
    for (const [key, rets] of monthMap) {
      const m = Number(key.slice(5, 7));
      const compounded = rets.reduce((a, r) => a * (1 + r), 1) - 1;
      (byMonth[m] ??= []).push(compounded);
    }
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const months: Record<string, Stat> = {};
    const bar: Record<string, { mean: number }> = {};
    MONTHS.forEach((label, i) => {
      const st = summarize(byMonth[i + 1] ?? []);
      months[label] = st;
      bar[label] = { mean: st.mean ?? 0 };
    });
    const mayOct = [4, 5, 6, 7, 8, 9].flatMap((m) => byMonth[m + 1] ?? []);
    const novApr = [10, 11, 0, 1, 2, 3].flatMap((m) => byMonth[m + 1] ?? []);
    // day-of-week
    const dow: Record<string, number[]> = {};
    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 1; i < s.values.length; i++) {
      const d = new Date(`${s.dates[i]}T00:00:00Z`).getUTCDay();
      (dow[DOW[d]] ??= []).push(dr[i - 1]);
    }
    const dowBar: Record<string, { mean: number }> = {};
    ["Mon", "Tue", "Wed", "Thu", "Fri"].forEach((d) => { dowBar[d] = { mean: summarize(dow[d] ?? []).mean ?? 0 }; });
    return {
      sample_size: monthMap.size,
      narrative:
        `Monthly seasonality for ${s.name}.\n` +
        `• "Sell in May" check: May–Oct mean ${pct(summarize(mayOct).mean) ?? "—"}% vs Nov–Apr ${pct(summarize(novApr).mean) ?? "—"}% per month.\n` +
        `Caveats:\nSeasonality is a weak, regime-dependent effect.`,
      tiles: [
        heatTile("seasonality_heatmap", "Average Return by Month", months),
        barTile("monthly_bar", "Mean Monthly Return", bar),
        barTile("sell_in_may", "Sell in May? (mean monthly)", { "May–Oct": { mean: summarize(mayOct).mean ?? 0 }, "Nov–Apr": { mean: summarize(novApr).mean ?? 0 } }),
        barTile("day_of_week", "Mean Return by Weekday", dowBar),
      ],
    };
  },

  cross_asset_correlation: ({ series }) => {
    const list = series.length >= 2 ? series : series;
    const rets = list.map((s) => dailyReturns(s.values));
    const correlations: Record<string, { latest: number }> = {};
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        correlations[`${list[i].id}/${list[j].id}`] = { latest: Number(pearson(rets[i], rets[j]).toFixed(2)) };
    // rolling 63d corr of first pair
    const rollCorr: (number | null)[] = [];
    if (list.length >= 2) {
      const a = rets[0], b = rets[1], win = 63;
      for (let k = win; k < Math.min(a.length, b.length); k += 2)
        rollCorr.push(Number((pearson(a.slice(k - win, k), b.slice(k - win, k)) * 100).toFixed(1)));
    }
    return {
      sample_size: list[0]?.values.length ?? 0,
      narrative:
        `Cross-asset correlation across ${list.map((s) => s.id).join(", ")}.\n` +
        `• ${Object.keys(correlations).length} pairwise correlations computed on daily returns.\n` +
        `Caveats:\nCorrelations are regime-dependent and rise in stress.`,
      tiles: [
        heatTile("correlation_matrix", "Pairwise Correlation (latest)", correlations),
        lineTile("rolling_corr_chart", "Rolling 63d Correlation (%)", rollCorr.slice(-120)),
      ],
    };
  },

  relative_strength: ({ series, windows }) => {
    const a = series[0];
    const b = series[1] ?? series[0];
    const n = Math.min(a.values.length, b.values.length);
    const ratio = a.values.slice(-n).map((v, i) => Number(((v / a.values[a.values.length - n]) / (b.values.slice(-n)[i] / b.values[b.values.length - n]) * 100).toFixed(2)));
    const excess: Record<string, number | null> = {};
    for (const w of windows) {
      const h = WINDOW_DAYS[w] ?? 21;
      const ra = fwd(a.values, a.values.length - 1 - h, h);
      const rb = fwd(b.values, b.values.length - 1 - h, h);
      excess[w] = ra !== null && rb !== null ? Number(((ra - rb) * 100).toFixed(2)) : null;
    }
    return {
      sample_size: n,
      narrative:
        `Relative strength: ${a.name} vs ${b.name}.\n` +
        `• Ratio rebased to 100 at window start; rising = ${a.id} outperforming.\n` +
        `Caveats:\nLeadership rotates across regimes.`,
      tiles: [
        lineTile("relative_strength_chart", `${a.id} / ${b.id} (rebased)`, ratio.slice(-250)),
        returnTableTile("excess_return_table", `Excess Return (${a.id} − ${b.id})`, { [`${a.id}−${b.id}`]: excess }),
      ],
    };
  },

  yield_curve_analysis: ({ series, options }) => {
    const two = buildSeries({ series_id: "DGS2", asset_class: "RATE" }, options);
    const ten = buildSeries({ series_id: "DGS10", asset_class: "RATE" }, options);
    const tenA = alignLevel(ten, two.dates);
    const slope = two.values.map((v, i) => Number(((tenA[i] - v) * 100).toFixed(1)));
    const lastTwo = two.values[two.values.length - 1], lastTen = tenA[tenA.length - 1];
    const curCurve = [lastTwo, (lastTwo + lastTen) / 2, lastTen, lastTen + 0.2];
    const invEvents: Record<string, unknown>[] = [];
    for (let i = 1; i < slope.length; i++)
      if (slope[i - 1] >= 0 && slope[i] < 0) invEvents.push({ date: two.dates[i], "2s10s bps": slope[i] });
    return {
      sample_size: slope.length,
      narrative:
        `Treasury curve deep dive (2s10s).\n` +
        `• Current 2s10s slope: ${slope[slope.length - 1]} bps.\n` +
        `• ${invEvents.length} inversion onsets in history.\n` +
        `Caveats:\nTreasury rates from FRED/econ layer.`,
      tiles: [
        lineTile("curve_chart", "Current Curve (2Y·5Y·10Y·30Y, %)", curCurve.map((v) => Number(v.toFixed(2)))),
        lineTile("slope_history", "2s10s Slope (bps)", slope.slice(-250)),
        eventTableTile("inversion_events", "Inversion Onsets", invEvents.slice(-30)),
      ],
    };
  },

  credit_spread_stress: ({ series, options }) => {
    const hy = buildSeries({ series_id: "BAMLH0A0HYM2", asset_class: "CREDIT" }, options);
    const ig = buildSeries({ series_id: "BAMLC0A0CM", asset_class: "CREDIT" }, options);
    const cur = hy.values[hy.values.length - 1];
    const p = percentileOf(hy.values, cur);
    const mean = hy.values.reduce((a, b) => a + b, 0) / hy.values.length;
    const sd = Math.sqrt(hy.values.reduce((a, b) => a + (b - mean) ** 2, 0) / hy.values.length);
    const z = hy.values.map((v) => Number(((v - mean) / (sd || 1)).toFixed(2)));
    return {
      sample_size: hy.values.length,
      narrative:
        `Credit-spread stress monitor (HY & IG OAS).\n` +
        `• HY OAS at ${cur.toFixed(2)}% — ${(p * 100).toFixed(0)}th percentile of history.\n` +
        `• Current HY z-score: ${z[z.length - 1]}.\n` +
        `Caveats:\nOAS from FRED/econ layer (live when FRED_API_KEY set).`,
      tiles: [
        gaugeTile("spread_gauge", "HY OAS Stress", regimeFromPercentile(p), p),
        lineTile("spread_history", "HY vs IG OAS (HY %)", hy.values.slice(-250)),
        lineTile("zscore_chart", "HY OAS Z-Score", z.slice(-250)),
      ],
    };
  },

  purchasing_power: ({ series, options }) => {
    const asset = series.find((s) => s.kind === "price") ?? series[0];
    const cpi = buildSeries({ series_id: "CPIAUCSL", asset_class: "MACRO" }, options);
    const c = alignLevel(cpi, asset.dates);
    const a0 = asset.values[0], c0 = c[0] || 1;
    const real = asset.values.map((v, i) => Number((v / a0 / ((c[i] || c0) / c0) * 100).toFixed(2)));
    const nominalTotal = asset.values[asset.values.length - 1] / a0 - 1;
    const cpiTotal = (c[c.length - 1] || c0) / c0 - 1;
    return {
      sample_size: asset.values.length,
      narrative:
        `Purchasing-power erosion: ${asset.name} real vs nominal.\n` +
        `• Nominal total return ${(nominalTotal * 100).toFixed(0)}% vs CPI ${(cpiTotal * 100).toFixed(0)}% over the sample.\n` +
        `Caveats:\nCPI from FRED when available, else modeled.`,
      tiles: [
        lineTile("purchasing_power_chart", "Real Value (CPI-adjusted, rebased)", real.slice(-250)),
        returnTableTile("real_vs_nominal", "Nominal vs Real (total %)", {
          Nominal: { Total: Number((nominalTotal * 100).toFixed(1)) },
          Real: { Total: Number(((nominalTotal - cpiTotal) * 100).toFixed(1)) },
        }),
      ],
    };
  },

  volatility_regime: ({ series, vix }) => {
    const s = series.find((x) => x.assetClass !== "VOLATILITY") ?? series[0];
    const dr = dailyReturns(s.values);
    const vAligned = alignLevel(vix, s.dates);
    const buckets: Record<string, number[]> = { "Low (<15)": [], "Normal (15-25)": [], "Elevated (25-35)": [], "High (>35)": [] };
    for (let i = 1; i < s.values.length; i++) {
      const v = vAligned[i];
      const r = dr[i - 1];
      if (v < 15) buckets["Low (<15)"].push(r);
      else if (v < 25) buckets["Normal (15-25)"].push(r);
      else if (v < 35) buckets["Elevated (25-35)"].push(r);
      else buckets["High (>35)"].push(r);
    }
    const regimeReturns: Record<string, Record<string, number | null>> = {};
    for (const [k, arr] of Object.entries(buckets)) {
      const st = summarize(arr);
      regimeReturns[k] = { "Mean daily %": pct(st.mean), "% positive": st.pct_positive !== null ? Number((st.pct_positive * 100).toFixed(0)) : null, Days: st.count };
    }
    // rolling 21d realized vol annualized
    const rv: (number | null)[] = [];
    for (let i = 21; i < dr.length; i += 2) {
      const w = dr.slice(i - 21, i);
      const m = w.reduce((a, b) => a + b, 0) / w.length;
      const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
      rv.push(Number((sd * Math.sqrt(252) * 100).toFixed(1)));
    }
    return {
      sample_size: s.values.length,
      narrative:
        `Volatility-regime analysis of ${s.name} vs VIX buckets.\n` +
        `• Mean daily return in high-vol (>35) regime: ${regimeReturns["High (>35)"]?.["Mean daily %"] ?? "—"}%.\n` +
        `Caveats:\nVIX from FRED/econ layer, aligned by date.`,
      tiles: [
        lineTile("regime_chart", "VIX", vix.values.slice(-250)),
        returnTableTile("regime_return_table", "Returns by VIX Regime", regimeReturns),
        lineTile("rolling_vol", "21d Realized Vol (annualized %)", rv.slice(-150)),
      ],
    };
  },

  rate_cycle_analysis: ({ series, options }) => {
    const asset = series.find((s) => s.kind === "price") ?? series[0];
    const ff = buildSeries({ series_id: "FEDFUNDS", asset_class: "RATE" }, options);
    const fV = alignLevel(ff, asset.dates);
    const aV = asset.values;
    const n = aV.length;
    const hiking: number[] = [], cutting: number[] = [];
    const ar = dailyReturns(aV);
    for (let i = 22; i < n; i++) {
      const slope = fV[i] - fV[i - 21];
      if (slope > 0.02) hiking.push(ar[i - 1]);
      else if (slope < -0.02) cutting.push(ar[i - 1]);
    }
    return {
      sample_size: n,
      narrative:
        `Rate-cycle impact on ${asset.name} (Fed funds path).\n` +
        `• Mean daily return while hiking: ${pct(summarize(hiking).mean) ?? "—"}% vs cutting: ${pct(summarize(cutting).mean) ?? "—"}%.\n` +
        `Caveats:\nFed funds from FRED/econ layer, aligned by date.`,
      tiles: [
        lineTile("cycle_timeline", "Fed Funds (%)", fV.slice(-250)),
        boxTile("hiking_returns", "Daily Returns — Hiking", { Hiking: summarize(hiking) }),
        boxTile("cutting_returns", "Daily Returns — Cutting", { Cutting: summarize(cutting) }),
      ],
    };
  },

  asset_class_returns: ({ series, windows }) => {
    const ws = windows.length ? windows : ["1M", "3M", "1Y"];
    const table: Record<string, Record<string, number | null>> = {};
    const bar: Record<string, { mean: number }> = {};
    for (const s of series) {
      const row: Record<string, number | null> = {};
      for (const w of ws) {
        const h = WINDOW_DAYS[w] ?? 21;
        row[w] = pct(fwd(s.values, s.values.length - 1 - h, h));
      }
      table[s.id] = row;
      const oneY = fwd(s.values, s.values.length - 1 - 252, 252);
      bar[s.id] = { mean: oneY ?? 0 };
    }
    return {
      sample_size: series.length,
      narrative:
        `Cross-asset return comparison across ${series.length} series (Bilello-style).\n` +
        `• Trailing returns computed over ${ws.join(", ")}.\n` +
        `Caveats:\nSynthetic series; ETF proxies labelled.`,
      tiles: [
        returnTableTile("return_table", "Trailing Returns (%)", table),
        barTile("bar_chart", "Trailing 1Y Return", bar),
        barTile("ranking_quilt", "1Y Ranking", bar),
      ],
    };
  },

  ma_crossover_study: ({ series, windows }) => {
    const s = series[0];
    const maS = movingAvg(s.values, 50);
    const maL = movingAvg(s.values, 200);
    const idx: number[] = [];
    for (let i = 1; i < s.values.length; i++) {
      const prev = (maS[i - 1] ?? 0) - (maL[i - 1] ?? 0);
      const cur = (maS[i] ?? 0) - (maL[i] ?? 0);
      if (maS[i] !== null && maL[i] !== null && prev <= 0 && cur > 0) idx.push(i);
    }
    const ev = fwdStatsAtEvents(s.values, idx, windows);
    const events = idx.slice(-40).map((i) => {
      const row: Record<string, unknown> = { date: s.dates[i], level: Number(s.values[i].toFixed(2)) };
      for (const w of windows) row[`${w} %`] = pct(fwd(s.values, i, WINDOW_DAYS[w] ?? 21));
      return row;
    });
    return {
      sample_size: idx.length,
      narrative:
        `Golden-cross study on ${s.name} (50d over 200d).\n` +
        `• ${idx.length} golden crosses detected.\n` +
        `Caveats:\nTrend signals lag.`,
      tiles: [
        lineTile("crossover_chart", `${s.id} Price`, s.values.slice(-200)),
        eventTableTile("event_table", "Golden Cross Events", events),
        boxTile("forward_return_box", "Forward Returns After Cross", ev),
      ],
    };
  },

  drawdown_recovery: ({ series }) => {
    const s = series[0];
    const events = drawdownEvents(s, -10);
    const dd = drawdownPct(s.values);
    return {
      sample_size: events.length,
      narrative:
        `Drawdown-recovery patterns for ${s.name} (≤ -10%).\n` +
        `• ${events.length} major drawdowns; median recovery ${summarize(events.filter((e) => e.recoveryDays !== null).map((e) => e.recoveryDays as number)).median?.toFixed(0) ?? "—"} days.\n` +
        `Caveats:\nRecovery time varies with regime.`,
      tiles: [
        eventTableTile("recovery_table", "Major Drawdowns & Recovery", events.slice(0, 40) as unknown as Record<string, unknown>[]),
        lineTile("recovery_chart", "Drawdown from Peak (%)", dd.slice(-250)),
      ],
    };
  },

  inflation_surprise: ({ series, windows, options }) => {
    const asset = series.find((s) => s.kind === "price") ?? series[0];
    const cpi = buildSeries({ series_id: "CPIAUCSL", asset_class: "MACRO" }, options);
    // "surprises" = months where CPI MoM deviates strongly from trailing average
    const idx: number[] = [];
    for (let i = 252; i < cpi.values.length; i++) {
      const mom = cpi.values[i] / cpi.values[i - 21] - 1;
      const trail = cpi.values[i - 21] / cpi.values[i - 42] - 1;
      if (Math.abs(mom - trail) > 0.004 && i - (idx[idx.length - 1] ?? -999) >= 21) idx.push(i);
    }
    const ev = fwdStatsAtEvents(asset.values, idx, windows);
    const events = idx.slice(-30).map((i) => {
      const row: Record<string, unknown> = { date: cpi.dates[i], "cpi mom %": Number(((cpi.values[i] / cpi.values[i - 21] - 1) * 100).toFixed(2)) };
      for (const w of windows) row[`${w} %`] = pct(fwd(asset.values, i, WINDOW_DAYS[w] ?? 21));
      return row;
    });
    return {
      sample_size: idx.length,
      narrative:
        `Inflation-surprise study — ${asset.name} after CPI surprises.\n` +
        `• ${idx.length} surprise months flagged.\n` +
        `Caveats:\nCPI from FRED when available; surprises are heuristic.`,
      tiles: [
        eventTableTile("surprise_table", "CPI Surprise Events", events),
        boxTile("forward_return_box", "Forward Returns After Surprise", ev),
      ],
    };
  },

  zscore_extremes: ({ series, windows }) => {
    const s = series[0];
    const win = 63;
    const z: number[] = new Array(s.values.length).fill(0);
    const dr = dailyReturns(s.values);
    for (let i = win; i < dr.length; i++) {
      const w = dr.slice(i - win, i);
      const m = w.reduce((a, b) => a + b, 0) / w.length;
      const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
      z[i] = sd ? (dr[i] - m) / sd : 0;
    }
    const idx: number[] = [];
    for (let i = win; i < z.length; i++) if (z[i] <= -2 && i - (idx[idx.length - 1] ?? -999) >= 10) idx.push(i);
    const ev = fwdStatsAtEvents(s.values, idx, windows);
    const events = idx.slice(-40).map((i) => {
      const row: Record<string, unknown> = { date: s.dates[i], zscore: Number(z[i].toFixed(2)) };
      for (const w of windows) row[`${w} %`] = pct(fwd(s.values, i, WINDOW_DAYS[w] ?? 21));
      return row;
    });
    return {
      sample_size: idx.length,
      narrative:
        `Z-score extreme study on ${s.name} (daily return ≤ -2σ).\n` +
        `• ${idx.length} extreme down-days flagged.\n` +
        `Caveats:\nMean-reversion is not guaranteed.`,
      tiles: [
        lineTile("zscore_chart", "Rolling Return Z-Score", z.slice(-250).map((x) => Number(x.toFixed(2)))),
        eventTableTile("extreme_events", "Extreme Down-Days (≤ -2σ)", events),
        boxTile("forward_return_box", "Forward Returns After Extreme", ev),
      ],
    };
  },
};

function buildVixChange(series: Series[], windows: string[], vix: Series, increases: boolean): ReturnType<Builder> {
  const s = series.find((x) => x.assetClass !== "VOLATILITY") ?? series[0];
  const v = alignLevel(vix, s.dates);
  const changes: { i: number; chg: number }[] = [];
  const period = 5;
  for (let i = period; i < v.length; i++)
    changes.push({ i, chg: v[i - period] !== 0 ? v[i] / v[i - period] - 1 : 0 });
  changes.sort((a, b) => (increases ? b.chg - a.chg : a.chg - b.chg));
  const top = changes.slice(0, 30);
  const idx = top.map((c) => c.i);
  const ev = fwdStatsAtEvents(s.values, idx, windows);
  const events = top.map((c) => {
    const row: Record<string, unknown> = { date: s.dates[c.i], "vix chg %": Number((c.chg * 100).toFixed(1)) };
    for (const w of windows) row[`${w} %`] = pct(fwd(s.values, c.i, WINDOW_DAYS[w] ?? 21));
    return row;
  });
  return {
    sample_size: idx.length,
    narrative:
      `Largest VIX ${increases ? "increases" : "decreases"} (5d) and ${s.name} forward returns.\n` +
      `• Top ${top.length} ${increases ? "spikes" : "collapses"} ranked by 5-day VIX change.\n` +
      `Caveats:\nVIX from FRED/econ layer, aligned by date.`,
    tiles: [
      eventTableTile("event_table", `Largest VIX ${increases ? "Increases" : "Decreases"}`, events),
      boxTile("forward_return_box", "Forward Returns", ev),
      eventTableTile("vix_change_scatter", "VIX Change vs Forward Return", events),
    ],
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function runMarketLens(req: LensRunRequest): Promise<AnalysisResult> {
  const inputs = (req.series ?? []).length ? req.series! : [{ series_id: "SPY", asset_class: "EQUITY" }];
  const options: LensRunOptions = {
    allowSnapshotFallback: req.allow_snapshot_fallback === true,
    allowSimFallback: req.allow_sim_fallback === true,
  };

  // Resolve all selected series plus macro helper levels before the sync
  // builders read them from the cache. Gold DB is always attempted first;
  // snapshots/SIM are used only when the caller explicitly allows them.
  const LEVEL_ASSET_CLASSES = ["VOLATILITY", "RATE", "CREDIT", "MACRO"];
  const userLevels = inputs.filter(
    (i) => MACRO_LEVEL_IDS.includes(i.series_id) || LEVEL_ASSET_CLASSES.includes((i.asset_class ?? "").toUpperCase())
  );
  await Promise.all([
    ...inputs.map(async (input) => {
      try {
        await resolveGoldDbSeries(input);
      } catch {
        // The fallback decision is handled by buildSeries/resolveLevelSeries below.
      }
    }),
    ...MACRO_LEVEL_IDS.map((id) => resolveLevelSeries({ series_id: id }, options)),
    ...userLevels.map((input) => resolveLevelSeries(input, options)),
  ]);

  const series = inputs.map((input) => buildSeries(input, options));
  const windows = (req.forward_windows ?? ["1W", "1M", "3M", "6M", "1Y"]).filter((w) => w in WINDOW_DAYS);
  const vix = buildSeries({ series_id: "^VIX", asset_class: "VOLATILITY" }, options);

  const builder = BUILDERS[req.view_id];
  const proxyNotes = inputs
    .map((s) => (PROXY_FOR[s.series_id] ? `${s.series_id} = ${PROXY_FOR[s.series_id]} (ETF proxy)` : null))
    .filter((x): x is string => x !== null);

  const SOURCE_LABEL: Record<DataSource, string> = {
    "gold-db": "Gold DB",
    "index-monthly": "committed monthly returns (index_returns)",
    "bilello-yearly": "committed yearly returns (bilello)",
    fred: "FRED (live)",
    "econ-sim": "econ model (deterministic)",
    synthetic: "synthetic",
    unavailable: "unavailable",
  };
  const provenance = series.map((s) => ({ series_id: s.id, basis: SOURCE_LABEL[s.dataSource], source: s.dataSource, points: s.values.length }));
  const macroBasis = goldEnabled() ? "Gold DB" : fredEnabled() ? "live FRED" : options.allowSimFallback ? "the deterministic econ model" : "unavailable";
  const warnings = [
    `Computed by the local Market Lens engine. Gold DB is preferred; snapshot fallback is ${options.allowSnapshotFallback ? "ON" : "OFF"} and SIM fallback is ${options.allowSimFallback ? "ON" : "OFF"}. Macro series use ${macroBasis}.`,
  ];
  const meta = { proxy_notes: proxyNotes, engine: "local-ts", series_provenance: provenance };

  const unavailable = series.filter((s) => s.dataSource === "unavailable" || s.values.length === 0);
  if (unavailable.length) {
    return {
      view_id: req.view_id,
      series_used: series.map((x) => x.id),
      warnings: [
        ...warnings,
        `Unavailable series: ${unavailable.map((s) => s.id).join(", ")}. Enable Snapshot Fallback or SIM from the top ribbon only if you want non-Gold fallback data.`,
      ],
      sample_size: 0,
      narrative: `Market Lens could not run ${req.view_id} because one or more selected series have no Gold DB/live data and fallback tiers are disabled.`,
      metadata: meta,
      tiles: [],
    };
  }

  if (!builder) {
    // Generic fallback: forward-return study on the first series.
    const s = series[0];
    const idx = Array.from({ length: Math.floor((s.values.length - 252) / 21) }, (_, k) => k * 21);
    const ev = fwdStatsAtEvents(s.values, idx, windows);
    return {
      view_id: req.view_id,
      series_used: series.map((x) => x.id),
      warnings,
      sample_size: idx.length,
      narrative: `Generic forward-return study on ${s.name} (view "${req.view_id}" not specialised locally).`,
      metadata: meta,
      tiles: [
        boxTile("forward_return_box", "Forward Returns", ev),
        lineTile("cumulative_chart", `${s.id} Price`, s.values.slice(-120)),
      ],
    };
  }

  const built = builder({ series, windows, vix, options });
  return {
    view_id: req.view_id,
    series_used: series.map((x) => x.id),
    warnings,
    metadata: meta,
    ...built,
  };
}

/**
 * Single resolved series for the charting layer (`MGC`/`MKC`). Returns a price
 * series (committed snapshots) or a macro level series (FRED/econ) with its
 * provenance, reusing the same resolution the Market Lens views rely on.
 */
export async function getMarketLensSeries(
  id: string,
  assetClass?: string
): Promise<{ id: string; dates: string[]; values: number[]; source: DataSource }> {
  await resolveLevelSeries({ series_id: id, asset_class: assetClass });
  const s = buildSeries({ series_id: id, asset_class: assetClass });
  return { id: s.id, dates: s.dates, values: s.values, source: s.dataSource };
}
