/**
 * UTIL — Utilization Analytics Engine.
 *
 * Bridges securities lending utilization data with daily benchmark rates.
 * Provides aggregate utilization time series, custom benchmark blends,
 * rate-utilization correlation, and sensitivity analysis.
 *
 * All analytics are pure functions — no side effects, no data source coupling.
 * Works identically on SIM, FRED, or database-sourced data.
 */
import { Rng } from "@/lib/rng";
import type { SeriesMap, Obs, BenchmarkDef, TrendMetrics } from "@/data/benchmarkRates";
import { computeTrend, BENCHMARK_SERIES, defOf } from "@/data/benchmarkRates";
import type { InventoryRow } from "@/data/securitiesLending";
import type { SqueezeRow, SectorHeat } from "@/data/squeeze";

// ── Types ────────────────────────────────────────────────────────────

export type UtilGroupBy = "sector" | "assetClass" | "classification" | "source" | "all";
export type Classification = "GC" | "WARM" | "SPECIAL" | "HTB";

export interface UtilGroupMetrics {
  utilization: number;
  totalOnLoanMV: number;
  totalAvailableMV: number;
  avgFeeBps: number;
  nameCount: number;
  htbCount: number;
  specialCount: number;
}

export interface UtilizationTimeSeries {
  groupKey: string;
  groupBy: UtilGroupBy;
  history: Obs[];
  feeHistory: Obs[];
  current: UtilGroupMetrics;
  trend: TrendMetrics;
}

export interface BlendComponent {
  seriesId: string;
  weight: number;
  label: string;
}

export interface CustomBlend {
  id: string;
  name: string;
  components: BlendComponent[];
  spreadBps: number;
  description: string;
}

export interface BlendResult {
  blend: CustomBlend;
  history: Obs[];
  current: number | null;
  chg1d: number | null;
  chg20d: number | null;
  percentile: number | null;
  zScore: number | null;
  trend: TrendMetrics;
}

export interface RateUtilCorrelation {
  rateId: string;
  rateLabel: string;
  utilGroup: string;
  correlation: number | null;
  beta: number | null;
  rSquared: number | null;
  window: number;
  interpretation: string;
}

export interface RateSensitivity {
  rateId: string;
  rateLabel: string;
  impact: "positive" | "negative" | "neutral";
  magnitude: "low" | "moderate" | "high";
  beta: number | null;
  description: string;
}

export interface UtilSummary {
  overallUtil: number | null;
  htbUtil: number | null;
  gcUtil: number | null;
  avgFeeBps: number | null;
  utilTrend: "rising" | "falling" | "stable";
  topSensitivity: string;
  blendCount: number;
}

// ── Preset Blends ────────────────────────────────────────────────────

export const PRESET_BLENDS: CustomBlend[] = [
  {
    id: "gc-funding",
    name: "GC Funding Rate",
    components: [
      { seriesId: "SOFR", weight: 0.5, label: "SOFR" },
      { seriesId: "BGCR", weight: 0.3, label: "BGCR" },
      { seriesId: "TGCRRATE", weight: 0.2, label: "TGCR" },
    ],
    spreadBps: 0,
    description: "Weighted average of secured overnight rates — proxy for GC repo funding cost",
  },
  {
    id: "unsecured-short",
    name: "Unsecured Short-Term",
    components: [
      { seriesId: "EFFR", weight: 0.6, label: "EFFR" },
      { seriesId: "OBFR", weight: 0.4, label: "OBFR" },
    ],
    spreadBps: 10,
    description: "Blended unsecured overnight rate with 10bps institutional spread",
  },
  {
    id: "lending-rebate",
    name: "Lending Rebate Benchmark",
    components: [
      { seriesId: "SOFR", weight: 1.0, label: "SOFR" },
    ],
    spreadBps: -15,
    description: "SOFR minus 15bps — typical GC rebate rate for securities lending",
  },
  {
    id: "htb-cost",
    name: "HTB Borrowing Cost",
    components: [
      { seriesId: "SOFR", weight: 1.0, label: "SOFR" },
      { seriesId: "BAMLH0A0HYM2", weight: 0.01, label: "HY OAS (scaled)" },
    ],
    spreadBps: 200,
    description: "Approximated all-in cost of borrowing hard-to-borrow names",
  },
  {
    id: "term-reinvest",
    name: "Term Reinvestment Yield",
    components: [
      { seriesId: "DGS3MO", weight: 0.5, label: "3M T-Bill" },
      { seriesId: "DGS1", weight: 0.3, label: "1Y Treasury" },
      { seriesId: "DGS2", weight: 0.2, label: "2Y Treasury" },
    ],
    spreadBps: 0,
    description: "Blended short-duration reinvestment benchmark for cash collateral",
  },
];

// ── Utilization Aggregation ──────────────────────────────────────────

function groupKey(row: InventoryRow | SqueezeRow, groupBy: UtilGroupBy): string {
  if (groupBy === "all") return "ALL";
  if (groupBy === "sector") return "sector" in row ? row.sector : (row as InventoryRow).assetClass;
  if (groupBy === "assetClass") return row.assetClass;
  if (groupBy === "classification") return row.classification;
  if (groupBy === "source") return "source" in row ? (row as InventoryRow).source : "UNKNOWN";
  return "ALL";
}

export function computeUtilizationSnapshot(
  inventory: InventoryRow[],
  groupBy: UtilGroupBy,
): Record<string, UtilGroupMetrics> {
  const groups = new Map<string, { totalMV: number; onLoanMV: number; feeSum: number; n: number; htb: number; spec: number }>();

  for (const row of inventory) {
    const key = groupBy === "all" ? "ALL" : groupKey(row, groupBy);
    const g = groups.get(key) ?? { totalMV: 0, onLoanMV: 0, feeSum: 0, n: 0, htb: 0, spec: 0 };
    g.totalMV += row.marketValue;
    g.onLoanMV += row.marketValue * (row.utilization / 100);
    g.feeSum += row.feeBps;
    g.n += 1;
    if (row.classification === "HTB") g.htb += 1;
    if (row.classification === "SPECIAL") g.spec += 1;
    groups.set(key, g);
  }

  const result: Record<string, UtilGroupMetrics> = {};
  for (const [key, g] of groups) {
    result[key] = {
      utilization: g.totalMV > 0 ? (g.onLoanMV / g.totalMV) * 100 : 0,
      totalOnLoanMV: g.onLoanMV,
      totalAvailableMV: g.totalMV - g.onLoanMV,
      avgFeeBps: g.n > 0 ? g.feeSum / g.n : 0,
      nameCount: g.n,
      htbCount: g.htb,
      specialCount: g.spec,
    };
  }
  return result;
}

export function buildUtilizationTimeSeries(
  inventory: InventoryRow[],
  squeezeBoard: SqueezeRow[],
  groupBy: UtilGroupBy,
): UtilizationTimeSeries[] {
  const snapshot = computeUtilizationSnapshot(inventory, groupBy);
  const n = 260;

  return Object.entries(snapshot).map(([key, metrics]) => {
    const rng = new Rng(`util-ts-${key}`);
    const baseUtil = metrics.utilization;
    const baseFee = metrics.avgFeeBps;

    const utilWalk = rng.walk(n, baseUtil, 1.2, 0);
    const feeWalk = rng.walk(n, baseFee, baseFee * 0.015, 0);

    const today = new Date();
    const history: Obs[] = utilWalk.map((v, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (n - 1 - i));
      return { date: d.toISOString().slice(0, 10), value: Math.max(0, Math.min(100, v)) };
    });

    const feeHistory: Obs[] = feeWalk.map((v, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (n - 1 - i));
      return { date: d.toISOString().slice(0, 10), value: Math.max(1, v) };
    });

    return {
      groupKey: key,
      groupBy,
      history,
      feeHistory,
      current: metrics,
      trend: computeTrend(history),
    };
  }).sort((a, b) => b.current.utilization - a.current.utilization);
}

// ── Custom Benchmark Blends ──────────────────────────────────────────

export function computeBlend(map: SeriesMap, blend: CustomBlend): BlendResult {
  const componentSeries = blend.components
    .map((c) => ({ obs: map[c.seriesId] ?? [], weight: c.weight }))
    .filter((c) => c.obs.length > 0);

  if (componentSeries.length === 0) {
    return {
      blend,
      history: [],
      current: null,
      chg1d: null,
      chg20d: null,
      percentile: null,
      zScore: null,
      trend: computeTrend([]),
    };
  }

  const minLen = Math.min(...componentSeries.map((c) => c.obs.length));
  const history: Obs[] = [];

  for (let i = 0; i < minLen; i++) {
    let weighted = 0;
    let totalWeight = 0;
    const date = componentSeries[0].obs[componentSeries[0].obs.length - minLen + i].date;

    for (const c of componentSeries) {
      const obs = c.obs[c.obs.length - minLen + i];
      weighted += obs.value * c.weight;
      totalWeight += c.weight;
    }

    const blendedValue = totalWeight > 0 ? weighted / totalWeight : 0;
    history.push({ date, value: blendedValue + blend.spreadBps / 100 });
  }

  const trend = computeTrend(history);
  const values = history.map((o) => o.value);
  const current = values.length > 0 ? values[values.length - 1] : null;
  const prev1d = values.length > 1 ? values[values.length - 2] : null;
  const prev20d = values.length > 20 ? values[values.length - 21] : null;

  let percentile: number | null = null;
  let zScore: number | null = null;
  if (values.length >= 20 && current != null) {
    const sorted = [...values].sort((a, b) => a - b);
    percentile = Math.round((sorted.filter((v) => v <= current).length / sorted.length) * 100);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
    zScore = std > 0 ? (current - mean) / std : 0;
  }

  return {
    blend,
    history,
    current,
    chg1d: current != null && prev1d != null ? current - prev1d : null,
    chg20d: current != null && prev20d != null ? current - prev20d : null,
    percentile,
    zScore,
    trend,
  };
}

export function computeAllBlends(
  map: SeriesMap,
  presets: CustomBlend[] = PRESET_BLENDS,
  userBlends: CustomBlend[] = [],
): BlendResult[] {
  return [...presets, ...userBlends].map((b) => computeBlend(map, b));
}

export function validateBlend(blend: CustomBlend, availableIds: string[]): string[] {
  const errors: string[] = [];
  if (!blend.name.trim()) errors.push("Blend name is required");
  if (blend.components.length === 0) errors.push("At least one component is required");
  const totalWeight = blend.components.reduce((a, c) => a + c.weight, 0);
  if (Math.abs(totalWeight - 1) > 0.01) errors.push(`Weights sum to ${(totalWeight * 100).toFixed(0)}%, expected 100%`);
  for (const c of blend.components) {
    if (!availableIds.includes(c.seriesId)) errors.push(`Series ${c.seriesId} not found`);
    if (c.weight <= 0) errors.push(`Weight for ${c.seriesId} must be positive`);
  }
  return errors;
}

// ── Rate-Utilization Correlation ─────────────────────────────────────

function dailyChanges(obs: Obs[]): number[] {
  const changes: number[] = [];
  for (let i = 1; i < obs.length; i++) {
    changes.push(obs[i].value - obs[i - 1].value);
  }
  return changes;
}

function pearson(x: number[], y: number[]): { r: number; beta: number; rSq: number } | null {
  const n = Math.min(x.length, y.length);
  if (n < 10) return null;
  const xs = x.slice(-n);
  const ys = y.slice(-n);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  const beta = sxy / sxx;
  return { r, beta, rSq: r * r };
}

function interpretCorrelation(r: number | null): string {
  if (r == null) return "Insufficient data";
  const abs = Math.abs(r);
  const dir = r > 0 ? "positive" : "negative";
  if (abs > 0.7) return `Strong ${dir}`;
  if (abs > 0.4) return `Moderate ${dir}`;
  if (abs > 0.2) return `Weak ${dir}`;
  return "No meaningful correlation";
}

export function computeRateUtilCorrelation(
  map: SeriesMap,
  utilSeries: UtilizationTimeSeries[],
  rateIds: string[],
  window = 60,
): RateUtilCorrelation[] {
  const results: RateUtilCorrelation[] = [];

  for (const utilTs of utilSeries) {
    const utilChanges = dailyChanges(utilTs.history.slice(-window));

    for (const rateId of rateIds) {
      const rateObs = map[rateId];
      if (!rateObs || rateObs.length < window) continue;
      const rateChanges = dailyChanges(rateObs.slice(-window));
      const p = pearson(rateChanges, utilChanges);
      const def = defOf(rateId);

      results.push({
        rateId,
        rateLabel: def?.short ?? rateId,
        utilGroup: utilTs.groupKey,
        correlation: p ? Number(p.r.toFixed(3)) : null,
        beta: p ? Number(p.beta.toFixed(4)) : null,
        rSquared: p ? Number(p.rSq.toFixed(3)) : null,
        window,
        interpretation: interpretCorrelation(p?.r ?? null),
      });
    }
  }

  return results.sort((a, b) => Math.abs(b.correlation ?? 0) - Math.abs(a.correlation ?? 0));
}

export function computeRateSensitivity(
  map: SeriesMap,
  utilSeries: UtilizationTimeSeries[],
): RateSensitivity[] {
  const overallUtil = utilSeries.find((u) => u.groupKey === "ALL") ?? utilSeries[0];
  if (!overallUtil) return [];

  const rateIds = BENCHMARK_SERIES.filter((s) => s.unit === "%" || s.unit === "bps").map((s) => s.id);
  const correlations = computeRateUtilCorrelation(map, [overallUtil], rateIds, 120);

  return correlations.map((c) => {
    const abs = Math.abs(c.correlation ?? 0);
    const magnitude: "low" | "moderate" | "high" = abs > 0.5 ? "high" : abs > 0.25 ? "moderate" : "low";
    const impact: "positive" | "negative" | "neutral" =
      c.correlation == null ? "neutral" :
      c.correlation > 0.15 ? "positive" :
      c.correlation < -0.15 ? "negative" : "neutral";

    const def = defOf(c.rateId);
    const dir = impact === "positive" ? "higher" : impact === "negative" ? "lower" : "unchanged";

    return {
      rateId: c.rateId,
      rateLabel: def?.short ?? c.rateId,
      impact,
      magnitude,
      beta: c.beta,
      description: `Rising ${def?.short ?? c.rateId} → ${dir} utilization`,
    };
  }).sort((a, b) => {
    const order = { high: 3, moderate: 2, low: 1 };
    return order[b.magnitude] - order[a.magnitude];
  });
}

// ── Overlay Helpers ──────────────────────────────────────────────────

export function normalizeForOverlay(
  rateObs: Obs[],
  utilObs: Obs[],
  rangeDays: number,
): { ratePct: number[]; utilPct: number[]; dates: string[] } {
  const rSlice = rateObs.slice(-rangeDays);
  const uSlice = utilObs.slice(-rangeDays);
  const len = Math.min(rSlice.length, uSlice.length);

  const rData = rSlice.slice(-len);
  const uData = uSlice.slice(-len);

  const normalize = (arr: Obs[]): number[] => {
    const vals = arr.map((o) => o.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    return vals.map((v) => ((v - min) / range) * 100);
  };

  return {
    ratePct: normalize(rData),
    utilPct: normalize(uData),
    dates: rData.map((o) => o.date),
  };
}

// ── Summary ──────────────────────────────────────────────────────────

export function computeUtilSummary(
  inventory: InventoryRow[],
  blends: BlendResult[],
  sensitivity: RateSensitivity[],
): UtilSummary {
  const all = computeUtilizationSnapshot(inventory, "all");
  const byCls = computeUtilizationSnapshot(inventory, "classification");
  const overall = all["ALL"];

  const htbMetrics = byCls["HTB"];
  const gcMetrics = byCls["GC"];

  const topSens = sensitivity.length > 0 ? sensitivity[0].rateLabel : "—";

  return {
    overallUtil: overall?.utilization ?? null,
    htbUtil: htbMetrics?.utilization ?? null,
    gcUtil: gcMetrics?.utilization ?? null,
    avgFeeBps: overall?.avgFeeBps ?? null,
    utilTrend: "stable",
    topSensitivity: topSens,
    blendCount: blends.length,
  };
}

// ── localStorage Blend Persistence ───────────────────────────────────

const BLEND_STORAGE_KEY = "bmrk-custom-blends";

export function loadUserBlends(): CustomBlend[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(BLEND_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveUserBlends(blends: CustomBlend[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(BLEND_STORAGE_KEY, JSON.stringify(blends));
}

export function deleteUserBlend(id: string): void {
  const blends = loadUserBlends().filter((b) => b.id !== id);
  saveUserBlends(blends);
}

export const DATA_SOURCE = "SIM" as const;
