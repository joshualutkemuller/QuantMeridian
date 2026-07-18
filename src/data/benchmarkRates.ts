/**
 * BMRK — Benchmark Rates Analytics Engine (deterministic SIM + FRED live).
 *
 * Covers daily benchmark rates across asset classes: overnight funding, Treasury
 * yields, credit benchmarks, swap rates, mortgage, and commodity-linked rates.
 * Each series defines a FRED id so the page can upgrade to live data via
 * `useLiveSeriesSet`. All analytics (spreads, z-scores, trend, regime, status)
 * are pure functions over a resolved SeriesMap — identical on live or SIM input.
 *
 * DATABASE HANDOFF: This module is designed to be swapped to a database provider.
 * See docs/BENCHMARK_RATES_DB_HANDOFF.md for the provider interface contract.
 */
import { Rng } from "@/lib/rng";

export type BenchmarkCategory =
  | "Overnight"
  | "Treasury"
  | "Credit"
  | "Swap"
  | "Mortgage"
  | "Commodity"
  | "International";

export type BenchmarkUnit = "%" | "bps" | "index" | "$/bbl" | "$/oz";

export interface BenchmarkDef {
  id: string;
  short: string;
  label: string;
  category: BenchmarkCategory;
  unit: BenchmarkUnit;
  decimals: number;
  hasFred: boolean;
  anchor: number;
  vol: number;
  drift: number;
}

export const BENCHMARK_SERIES: BenchmarkDef[] = [
  // Overnight / money market
  { id: "SOFR", short: "SOFR", label: "Secured Overnight Financing Rate", category: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.82, vol: 0.02, drift: 0 },
  { id: "EFFR", short: "EFFR", label: "Effective Federal Funds Rate", category: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.83, vol: 0.006, drift: 0 },
  { id: "OBFR", short: "OBFR", label: "Overnight Bank Funding Rate", category: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.84, vol: 0.006, drift: 0 },
  { id: "IORB", short: "IORB", label: "Interest on Reserve Balances", category: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.9, vol: 0.004, drift: 0 },
  { id: "BGCR", short: "BGCR", label: "Broad General Collateral Rate", category: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.80, vol: 0.018, drift: 0 },
  { id: "TGCR", short: "TGCR", label: "Tri-Party General Collateral Rate", category: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.79, vol: 0.018, drift: 0 },
  { id: "DPRIME", short: "Prime", label: "Bank Prime Loan Rate", category: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 7.5, vol: 0.005, drift: 0 },

  // Treasury yields
  { id: "DGS1MO", short: "1M", label: "1-Month Treasury Yield", category: "Treasury", unit: "%", decimals: 2, hasFred: true, anchor: 4.78, vol: 0.015, drift: 0 },
  { id: "DGS3MO", short: "3M", label: "3-Month Treasury Yield", category: "Treasury", unit: "%", decimals: 2, hasFred: true, anchor: 4.70, vol: 0.012, drift: 0 },
  { id: "DGS6MO", short: "6M", label: "6-Month Treasury Yield", category: "Treasury", unit: "%", decimals: 2, hasFred: true, anchor: 4.58, vol: 0.014, drift: 0 },
  { id: "DGS1", short: "1Y", label: "1-Year Treasury Yield", category: "Treasury", unit: "%", decimals: 2, hasFred: true, anchor: 4.42, vol: 0.018, drift: 0 },
  { id: "DGS2", short: "2Y", label: "2-Year Treasury Yield", category: "Treasury", unit: "%", decimals: 2, hasFred: true, anchor: 4.25, vol: 0.025, drift: 0 },
  { id: "DGS5", short: "5Y", label: "5-Year Treasury Yield", category: "Treasury", unit: "%", decimals: 2, hasFred: true, anchor: 4.18, vol: 0.030, drift: 0 },
  { id: "DGS10", short: "10Y", label: "10-Year Treasury Yield", category: "Treasury", unit: "%", decimals: 2, hasFred: true, anchor: 4.38, vol: 0.032, drift: 0 },
  { id: "DGS20", short: "20Y", label: "20-Year Treasury Yield", category: "Treasury", unit: "%", decimals: 2, hasFred: true, anchor: 4.62, vol: 0.030, drift: 0 },
  { id: "DGS30", short: "30Y", label: "30-Year Treasury Yield", category: "Treasury", unit: "%", decimals: 2, hasFred: true, anchor: 4.55, vol: 0.028, drift: 0 },
  { id: "DFII10", short: "10Y TIPS", label: "10-Year TIPS Real Yield", category: "Treasury", unit: "%", decimals: 2, hasFred: true, anchor: 2.05, vol: 0.025, drift: 0 },

  // Credit benchmarks
  { id: "BAMLC0A0CM", short: "IG OAS", label: "ICE BofA US Corp IG OAS", category: "Credit", unit: "bps", decimals: 0, hasFred: true, anchor: 92, vol: 3.5, drift: 0 },
  { id: "BAMLH0A0HYM2", short: "HY OAS", label: "ICE BofA US HY Master II OAS", category: "Credit", unit: "bps", decimals: 0, hasFred: true, anchor: 320, vol: 12, drift: 0 },
  { id: "BAMLC0A1CAAA", short: "AAA OAS", label: "ICE BofA AAA Corp OAS", category: "Credit", unit: "bps", decimals: 0, hasFred: true, anchor: 52, vol: 2.0, drift: 0 },
  { id: "BAMLC0A4CBBB", short: "BBB OAS", label: "ICE BofA BBB Corp OAS", category: "Credit", unit: "bps", decimals: 0, hasFred: true, anchor: 135, vol: 5.0, drift: 0 },
  { id: "TEDRATE", short: "TED", label: "TED Spread (3M Libor − 3M T-Bill)", category: "Credit", unit: "%", decimals: 2, hasFred: true, anchor: 0.18, vol: 0.02, drift: 0 },

  // Swap / term rates
  { id: "ICERATES1100USD2Y", short: "2Y Swap", label: "ICE 2-Year USD Swap Rate", category: "Swap", unit: "%", decimals: 3, hasFred: true, anchor: 4.28, vol: 0.028, drift: 0 },
  { id: "ICERATES1100USD5Y", short: "5Y Swap", label: "ICE 5-Year USD Swap Rate", category: "Swap", unit: "%", decimals: 3, hasFred: true, anchor: 4.15, vol: 0.032, drift: 0 },
  { id: "ICERATES1100USD10Y", short: "10Y Swap", label: "ICE 10-Year USD Swap Rate", category: "Swap", unit: "%", decimals: 3, hasFred: true, anchor: 4.30, vol: 0.030, drift: 0 },

  // Mortgage
  { id: "MORTGAGE30US", short: "30Y Mtg", label: "30-Year Fixed Mortgage Rate", category: "Mortgage", unit: "%", decimals: 2, hasFred: true, anchor: 6.85, vol: 0.04, drift: 0 },
  { id: "MORTGAGE15US", short: "15Y Mtg", label: "15-Year Fixed Mortgage Rate", category: "Mortgage", unit: "%", decimals: 2, hasFred: true, anchor: 6.10, vol: 0.035, drift: 0 },

  // Commodity-linked reference rates
  { id: "DCOILWTICO", short: "WTI", label: "WTI Crude Oil Spot", category: "Commodity", unit: "$/bbl", decimals: 2, hasFred: true, anchor: 72.5, vol: 1.2, drift: 0 },
  { id: "GOLDPMGBD228NLBM", short: "Gold PM", label: "Gold London PM Fix", category: "Commodity", unit: "$/oz", decimals: 2, hasFred: true, anchor: 2420, vol: 18, drift: 0 },

  // International policy rates
  { id: "ECBDFR", short: "ECB DFR", label: "ECB Deposit Facility Rate", category: "International", unit: "%", decimals: 2, hasFred: true, anchor: 3.25, vol: 0.003, drift: 0 },
  { id: "BOERUKM", short: "BoE Rate", label: "Bank of England Bank Rate", category: "International", unit: "%", decimals: 2, hasFred: true, anchor: 4.50, vol: 0.003, drift: 0 },
  { id: "INTDSRJPM193N", short: "BoJ Rate", label: "Bank of Japan Policy Rate", category: "International", unit: "%", decimals: 3, hasFred: true, anchor: 0.25, vol: 0.001, drift: 0 },
];

export const BENCHMARK_FRED_IDS = BENCHMARK_SERIES.filter((s) => s.hasFred).map((s) => s.id);
const BY_ID = new Map(BENCHMARK_SERIES.map((s) => [s.id, s]));
export const CATEGORIES: BenchmarkCategory[] = ["Overnight", "Treasury", "Credit", "Swap", "Mortgage", "Commodity", "International"];

export interface Obs {
  date: string;
  value: number;
}
export type SeriesMap = Record<string, Obs[]>;

const END_DATE = new Date("2026-06-23T00:00:00Z");

function businessDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date(END_DATE);
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

export function simSeries(id: string, n = 520): Obs[] {
  const def = BY_ID.get(id);
  const dates = businessDates(n);
  if (!def) return dates.map((date) => ({ date, value: 0 }));
  const rng = new Rng(`bmrk-${id}`);
  const vals: number[] = new Array(n);
  vals[n - 1] = def.anchor;
  for (let i = n - 2; i >= 0; i--) {
    const meanRevert = (def.anchor - vals[i + 1]) * 0.04;
    vals[i] = vals[i + 1] - def.drift + meanRevert + rng.normal(0, def.vol);
  }
  return dates.map((date, i) => ({ date, value: Number(vals[i].toFixed(def.decimals + 2)) }));
}

export function buildFallback(n = 520): SeriesMap {
  const map: SeriesMap = {};
  for (const s of BENCHMARK_SERIES) map[s.id] = simSeries(s.id, n);
  return map;
}

/**
 * Same as buildFallback but anchors each series to a Gold DB value where available.
 * Tier C pages call this with benchmarks/curve from getMacroInputs() so their SIM
 * time-series are centered on real current rates rather than hardcoded defaults.
 *
 * `overrides` keys are BENCHMARK_SERIES ids or curve tenors mapped to series ids
 * (e.g. { SOFR: 5.31, DGS10: 4.28 }). Unknown keys are silently ignored.
 */
export function buildFallbackWithAnchors(overrides: Record<string, number>, n = 520): SeriesMap {
  const map: SeriesMap = {};
  for (const s of BENCHMARK_SERIES) {
    const anchor = overrides[s.id];
    if (anchor != null) {
      const def = { ...s, anchor };
      const rng = new Rng(`bmrk-${s.id}`);
      const dates = businessDates(n);
      const vals: number[] = new Array(n);
      vals[n - 1] = def.anchor;
      for (let i = n - 2; i >= 0; i--) {
        const meanRevert = (def.anchor - vals[i + 1]) * 0.04;
        vals[i] = vals[i + 1] - def.drift + meanRevert + rng.normal(0, def.vol);
      }
      map[s.id] = dates.map((date, i) => ({ date, value: Number(vals[i].toFixed(def.decimals + 2)) }));
    } else {
      map[s.id] = simSeries(s.id, n);
    }
  }
  return map;
}

export function defOf(id: string): BenchmarkDef | undefined {
  return BY_ID.get(id);
}

const latest = (obs: Obs[] | undefined): number | null => (obs && obs.length ? obs[obs.length - 1].value : null);
const prior = (obs: Obs[] | undefined, offset = 1): number | null => (obs && obs.length > offset ? obs[obs.length - 1 - offset].value : null);

// ── Trend analytics ────────────────────────────────────────────────────────────

export interface TrendMetrics {
  current: number | null;
  chg1d: number | null;
  chg5d: number | null;
  chg20d: number | null;
  chg60d: number | null;
  chg120d: number | null;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  percentile: number | null;
  min52w: number | null;
  max52w: number | null;
  rangePosition: number | null;
  direction: "rising" | "falling" | "flat";
  momentum: "strong" | "moderate" | "weak" | "neutral";
}

function movingAvg(obs: Obs[], window: number): number | null {
  if (obs.length < window) return null;
  const slice = obs.slice(-window);
  return slice.reduce((a, o) => a + o.value, 0) / window;
}

function percentileOf(obs: Obs[], v: number): number | null {
  if (obs.length < 10) return null;
  const below = obs.filter((o) => o.value <= v).length;
  return Math.round((below / obs.length) * 100);
}

export function computeTrend(obs: Obs[]): TrendMetrics {
  const cur = latest(obs);
  const p1 = prior(obs, 1);
  const p5 = prior(obs, 5);
  const p20 = prior(obs, 20);
  const p60 = prior(obs, 60);
  const p120 = prior(obs, 120);
  const w260 = obs.slice(-260);
  const values = w260.map((o) => o.value);
  const min52w = values.length ? Math.min(...values) : null;
  const max52w = values.length ? Math.max(...values) : null;
  const rangePosition = cur != null && min52w != null && max52w != null && max52w !== min52w
    ? Math.round(((cur - min52w) / (max52w - min52w)) * 100)
    : null;

  const chg1d = cur != null && p1 != null ? cur - p1 : null;
  const chg20d = cur != null && p20 != null ? cur - p20 : null;
  const ma5 = movingAvg(obs, 5);
  const ma20 = movingAvg(obs, 20);

  const direction: TrendMetrics["direction"] =
    chg20d != null ? (chg20d > 0.02 ? "rising" : chg20d < -0.02 ? "falling" : "flat") : "flat";
  const momentum: TrendMetrics["momentum"] =
    cur != null && ma5 != null && ma20 != null
      ? cur > ma5 && ma5 > ma20 ? "strong" : cur > ma20 ? "moderate" : cur < ma5 && ma5 < ma20 ? "weak" : "neutral"
      : "neutral";

  return {
    current: cur,
    chg1d,
    chg5d: cur != null && p5 != null ? cur - p5 : null,
    chg20d,
    chg60d: cur != null && p60 != null ? cur - p60 : null,
    chg120d: cur != null && p120 != null ? cur - p120 : null,
    ma5,
    ma20,
    ma60: movingAvg(obs, 60),
    percentile: cur != null ? percentileOf(obs, cur) : null,
    min52w,
    max52w,
    rangePosition,
    direction,
    momentum,
  };
}

// ── Spread / comparison analytics ──────────────────────────────────────────────

export interface SpreadPair {
  id: string;
  label: string;
  seriesA: string;
  seriesB: string;
  desc: string;
}

export const SPREAD_PAIRS: SpreadPair[] = [
  { id: "sofr_effr", label: "SOFR − EFFR", seriesA: "SOFR", seriesB: "EFFR", desc: "Secured vs unsecured overnight" },
  { id: "sofr_iorb", label: "SOFR − IORB", seriesA: "SOFR", seriesB: "IORB", desc: "Repo rate vs administered floor" },
  { id: "t2s10s", label: "10Y − 2Y", seriesA: "DGS10", seriesB: "DGS2", desc: "Yield curve slope" },
  { id: "t3m10y", label: "10Y − 3M", seriesA: "DGS10", seriesB: "DGS3MO", desc: "Recession indicator spread" },
  { id: "t2s5s", label: "5Y − 2Y", seriesA: "DGS5", seriesB: "DGS2", desc: "Belly of the curve" },
  { id: "t5s30s", label: "30Y − 5Y", seriesA: "DGS30", seriesB: "DGS5", desc: "Long end steepness" },
  { id: "ig_hy", label: "HY − IG OAS", seriesA: "BAMLH0A0HYM2", seriesB: "BAMLC0A0CM", desc: "Credit quality spread" },
  { id: "mtg_10y", label: "30Y Mtg − 10Y", seriesA: "MORTGAGE30US", seriesB: "DGS10", desc: "Mortgage spread over Treasury" },
  { id: "swap_tsy_2y", label: "2Y Swap − 2Y Tsy", seriesA: "ICERATES1100USD2Y", seriesB: "DGS2", desc: "2Y swap spread" },
  { id: "swap_tsy_10y", label: "10Y Swap − 10Y Tsy", seriesA: "ICERATES1100USD10Y", seriesB: "DGS10", desc: "10Y swap spread" },
  { id: "tips_nominal", label: "10Y Nom − 10Y TIPS", seriesA: "DGS10", seriesB: "DFII10", desc: "Breakeven inflation" },
];

export interface SpreadResult {
  pair: SpreadPair;
  current: number | null;
  hist: number[];
  dates: string[];
  chg1d: number | null;
  chg20d: number | null;
  percentile: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  zScore: number | null;
}

function computeSpreadHistory(map: SeriesMap, pair: SpreadPair): SpreadResult {
  const a = map[pair.seriesA];
  const b = map[pair.seriesB];
  if (!a || !b) return { pair, current: null, hist: [], dates: [], chg1d: null, chg20d: null, percentile: null, min: null, max: null, mean: null, zScore: null };
  const bMap = new Map(b.map((o) => [o.date, o.value]));
  const hist: number[] = [];
  const dates: string[] = [];
  const unitA = BY_ID.get(pair.seriesA)?.unit;
  const unitB = BY_ID.get(pair.seriesB)?.unit;
  const scale = unitA === "bps" || unitB === "bps" ? 1 : 100; // bps output when both are %

  for (const o of a) {
    const bv = bMap.get(o.date);
    if (bv != null) {
      const diff = unitA === "bps" && unitB === "bps" ? o.value - bv : (o.value - bv) * scale;
      hist.push(diff);
      dates.push(o.date);
    }
  }
  const cur = hist.length ? hist[hist.length - 1] : null;
  const p1 = hist.length > 1 ? hist[hist.length - 2] : null;
  const p20 = hist.length > 20 ? hist[hist.length - 21] : null;
  const mean = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
  const std = hist.length > 1 && mean != null
    ? Math.sqrt(hist.reduce((a, v) => a + (v - mean) ** 2, 0) / (hist.length - 1))
    : null;

  return {
    pair,
    current: cur != null ? Number(cur.toFixed(1)) : null,
    hist,
    dates,
    chg1d: cur != null && p1 != null ? Number((cur - p1).toFixed(1)) : null,
    chg20d: cur != null && p20 != null ? Number((cur - p20).toFixed(1)) : null,
    percentile: cur != null && hist.length >= 10 ? Math.round(hist.filter((v) => v <= cur).length / hist.length * 100) : null,
    min: hist.length ? Number(Math.min(...hist).toFixed(1)) : null,
    max: hist.length ? Number(Math.max(...hist).toFixed(1)) : null,
    mean: mean != null ? Number(mean.toFixed(1)) : null,
    zScore: cur != null && mean != null && std != null && std > 0 ? Number(((cur - mean) / std).toFixed(2)) : null,
  };
}

export function computeAllSpreads(map: SeriesMap): SpreadResult[] {
  return SPREAD_PAIRS.map((p) => computeSpreadHistory(map, p));
}

export function computeSpread(map: SeriesMap, pairId: string): SpreadResult | undefined {
  const pair = SPREAD_PAIRS.find((p) => p.id === pairId);
  if (!pair) return undefined;
  return computeSpreadHistory(map, pair);
}

// ── Status dashboard ───────────────────────────────────────────────────────────

export type StatusLevel = "elevated" | "normal" | "depressed";

export interface BenchmarkStatus {
  def: BenchmarkDef;
  current: number | null;
  chg1d: number | null;
  chg1dBps: number | null;
  percentile: number | null;
  rangePosition: number | null;
  direction: TrendMetrics["direction"];
  status: StatusLevel;
  sparkHist: number[];
}

export function computeStatusBoard(map: SeriesMap): BenchmarkStatus[] {
  return BENCHMARK_SERIES.map((def) => {
    const obs = map[def.id] ?? [];
    const trend = computeTrend(obs);
    const status: StatusLevel =
      trend.percentile != null
        ? trend.percentile >= 75 ? "elevated" : trend.percentile <= 25 ? "depressed" : "normal"
        : "normal";
    const chg1dBps = trend.chg1d != null && def.unit === "%" ? Number((trend.chg1d * 100).toFixed(1)) : trend.chg1d;
    return {
      def,
      current: trend.current,
      chg1d: trend.chg1d,
      chg1dBps,
      percentile: trend.percentile,
      rangePosition: trend.rangePosition,
      direction: trend.direction,
      status,
      sparkHist: obs.slice(-60).map((o) => o.value),
    };
  });
}

// ── Correlation matrix ─────────────────────────────────────────────────────────

export interface CorrelationResult {
  labels: string[];
  ids: string[];
  matrix: number[][];
}

export function computeCorrelation(map: SeriesMap, ids: string[], window = 60): CorrelationResult {
  const labels = ids.map((id) => BY_ID.get(id)?.short ?? id);
  const aligned = alignReturns(map, ids, window);
  const n = ids.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const c = corr(aligned[i], aligned[j]);
      matrix[i][j] = c;
      matrix[j][i] = c;
    }
  }
  return { labels, ids, matrix };
}

function alignReturns(map: SeriesMap, ids: string[], window: number): number[][] {
  const seriesObs = ids.map((id) => {
    const obs = map[id] ?? [];
    return obs.slice(-window - 1);
  });
  const returns: number[][] = ids.map(() => []);
  const minLen = Math.min(...seriesObs.map((s) => s.length));
  for (let t = 1; t < minLen; t++) {
    for (let i = 0; i < ids.length; i++) {
      const prev = seriesObs[i][t - 1].value;
      const cur = seriesObs[i][t].value;
      returns[i].push(prev !== 0 ? (cur - prev) / Math.abs(prev) : 0);
    }
  }
  return returns;
}

function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const denom = Math.sqrt(va * vb);
  return denom > 0 ? Number((cov / denom).toFixed(3)) : 0;
}

// ── Regime classification ──────────────────────────────────────────────────────

export type RateRegime = "Tightening" | "Restrictive" | "Easing" | "Accommodative" | "Neutral";

export interface RegimeResult {
  regime: RateRegime;
  score: number;
  drivers: string[];
}

export function classifyRegime(map: SeriesMap): RegimeResult {
  const effr = latest(map["EFFR"]);
  const dgs10 = latest(map["DGS10"]);
  const dgs2 = latest(map["DGS2"]);
  const hyOas = latest(map["BAMLH0A0HYM2"]);
  const slope = dgs10 != null && dgs2 != null ? (dgs10 - dgs2) * 100 : null;

  const drivers: string[] = [];
  let score = 50;

  if (effr != null) {
    if (effr > 4.5) { score += 15; drivers.push(`EFFR ${effr.toFixed(2)}% — restrictive territory`); }
    else if (effr > 3.0) { score += 5; drivers.push(`EFFR ${effr.toFixed(2)}% — above neutral`); }
    else if (effr < 1.5) { score -= 15; drivers.push(`EFFR ${effr.toFixed(2)}% — accommodative`); }
  }

  if (slope != null) {
    if (slope < -40) { score += 10; drivers.push(`Curve inverted ${slope.toFixed(0)}bps — tightening signal`); }
    else if (slope > 100) { score -= 10; drivers.push(`Curve steep +${slope.toFixed(0)}bps — easing stance`); }
  }

  if (hyOas != null) {
    if (hyOas > 450) { score += 10; drivers.push(`HY OAS ${hyOas.toFixed(0)}bps — credit stress`); }
    else if (hyOas < 250) { score -= 5; drivers.push(`HY OAS ${hyOas.toFixed(0)}bps — risk-on`); }
  }

  const effrChg60 = latest(map["EFFR"]) != null && prior(map["EFFR"] ?? [], 60) != null
    ? latest(map["EFFR"])! - prior(map["EFFR"] ?? [], 60)!
    : null;
  if (effrChg60 != null) {
    if (effrChg60 > 0.25) { score += 10; drivers.push("EFFR rising over 60d — active tightening"); }
    else if (effrChg60 < -0.25) { score -= 10; drivers.push("EFFR falling over 60d — active easing"); }
  }

  const regime: RateRegime =
    score >= 70 ? "Tightening" : score >= 55 ? "Restrictive" : score <= 30 ? "Accommodative" : score <= 45 ? "Easing" : "Neutral";

  return { regime, score: Math.max(0, Math.min(100, score)), drivers };
}

// ── Summary headline metrics ───────────────────────────────────────────────────

export interface BenchmarkSummary {
  sofr: number | null;
  sofrChgBps: number | null;
  effr: number | null;
  tenY: number | null;
  tenYChgBps: number | null;
  twoTenSlope: number | null;
  igOas: number | null;
  hyOas: number | null;
  mtg30: number | null;
  regime: RateRegime;
  regimeScore: number;
}

export function computeSummary(map: SeriesMap): BenchmarkSummary {
  const sofr = latest(map["SOFR"]);
  const sofrP = prior(map["SOFR"]);
  const tenY = latest(map["DGS10"]);
  const tenYP = prior(map["DGS10"]);
  const twoY = latest(map["DGS2"]);
  const regimeResult = classifyRegime(map);

  return {
    sofr,
    sofrChgBps: sofr != null && sofrP != null ? Number(((sofr - sofrP) * 100).toFixed(1)) : null,
    effr: latest(map["EFFR"]),
    tenY,
    tenYChgBps: tenY != null && tenYP != null ? Number(((tenY - tenYP) * 100).toFixed(1)) : null,
    twoTenSlope: tenY != null && twoY != null ? Number(((tenY - twoY) * 100).toFixed(0)) : null,
    igOas: latest(map["BAMLC0A0CM"]),
    hyOas: latest(map["BAMLH0A0HYM2"]),
    mtg30: latest(map["MORTGAGE30US"]),
    regime: regimeResult.regime,
    regimeScore: regimeResult.score,
  };
}

export const DATA_SOURCE = "SIM" as const;
