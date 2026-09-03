import { goldEnabled, goldStore, goldTable } from "@/lib/server/goldStore";
import {
  readyCandidate,
  unavailableCandidate,
  type MarketPublishingCandidate,
  type MarketPublishingScoreBreakdown,
} from "@/lib/marketPublishing";

/**
 * Material-change detection over Gold statistics that already exist upstream
 * (zscore, percentile, breadth, stress bucket, inversion flags) — spec006.
 *
 * This module computes no statistics of its own. Every candidate's score
 * traces to a named Gold table/column and a fixed, documented threshold via
 * `scoreBreakdown`. A signal that doesn't cross its threshold produces no
 * candidate at all (not an "unavailable" one) — "unavailable" is reserved
 * for the Gold read itself failing, per spec004's existing convention.
 *
 * Approved tables (docs/specs/spec004/PHASE0_DATA_CONTRACT.md, "Spec006
 * Signal Table Audit", approved 2026-09-02): only the four Phase 1 tables
 * below are read here. The other eight approved tables are Phase 3 scope.
 */

export const runtime = "nodejs";

const CATEGORY_SUMMARY_TABLE = "macro_category_summary";
const CREDIT_SPREAD_TABLE = "credit_spread_daily";
const FUNDING_STRESS_TABLE = "funding_stress_daily";
const CURVE_METRICS_TABLE = "treasury_curve_metrics";

// Fixed, owner-tunable thresholds. Each is cited in the candidate it
// produces via scoreBreakdown — nothing here is a hidden magic number.
const CATEGORY_BREADTH_MIN = 0.8;
const CATEGORY_ZSCORE_MIN = 1.5;
const CREDIT_PERCENTILE_MIN = 0.95;
const FUNDING_STRESS_BUCKETS = ["elevated", "stressed"];

interface CategorySummaryRow {
  econ_category: string;
  as_of_date: string;
  n_series: number | null;
  n_improving: number | null;
  n_deteriorating: number | null;
  breadth_pct: number | null;
  avg_zscore: number | null;
  surprise_index: number | null;
}

interface CreditSpreadRow {
  instrument: string;
  series_id: string;
  category: string;
  observation_date: string;
  oas_bps: number | null;
  change_bps: number | null;
  zscore: number | null;
  percentile: number | null;
  is_stress_episode: number | null;
}

interface FundingStressRow {
  observation_date: string;
  composite_z: number | null;
  stress_score: number | null;
  stress_bucket: string | null;
  n_components: number | null;
}

interface CurveMetricsRow {
  as_of_date: string;
  level: number | null;
  slope_10y2y: number | null;
  slope_10y3m: number | null;
  curve_move: string | null;
  is_inverted_10y2y: number | null;
  is_inverted_10y3m: number | null;
  is_recession: number | null;
}

async function latestRows<T>(table: string): Promise<T[]> {
  const phys = goldTable(table);
  return goldStore().raw<T>(
    `SELECT * FROM ${phys} WHERE observation_date = (SELECT MAX(observation_date) FROM ${phys})`
  );
}

/** `gold_macro_category_summary`/`gold_treasury_curve_metrics` key their snapshot column `as_of_date`, not `observation_date`. */
async function latestRowsByAsOf<T>(table: string): Promise<T[]> {
  const phys = goldTable(table);
  return goldStore().raw<T>(
    `SELECT * FROM ${phys} WHERE as_of_date = (SELECT MAX(as_of_date) FROM ${phys})`
  );
}

function configMissing(templateId: MarketPublishingCandidate["templateId"], title: string, workspace: MarketPublishingCandidate["workspace"]): MarketPublishingCandidate {
  return unavailableCandidate({
    id: `${templateId}-unavailable`,
    templateId,
    title: `${title} unavailable`,
    summary: "MACRO_DB_URL not configured.",
    workspace,
    packageTypes: ["pre_market", "market_close", "weekend_week_in_markets", "monthly_state_of_markets"],
    dataAsOf: null,
    seriesIds: [],
    unavailableReason: "MACRO_DB_URL not configured.",
  });
}

function readFailed(templateId: MarketPublishingCandidate["templateId"], title: string, workspace: MarketPublishingCandidate["workspace"], reason: string): MarketPublishingCandidate {
  return unavailableCandidate({
    id: `${templateId}-unavailable`,
    templateId,
    title: `${title} unavailable`,
    summary: reason,
    workspace,
    packageTypes: ["pre_market", "market_close", "weekend_week_in_markets", "monthly_state_of_markets"],
    dataAsOf: null,
    seriesIds: [],
    unavailableReason: reason,
  });
}

/** Category breadth: a broad-based, statistically extreme move across a whole macro category, not one noisy series. */
export async function detectCategoryBreadthCandidates(): Promise<MarketPublishingCandidate[]> {
  if (!goldEnabled()) return [configMissing("category_breadth", "Category breadth", "Today")];

  let rows: CategorySummaryRow[];
  try {
    rows = await latestRowsByAsOf<CategorySummaryRow>(CATEGORY_SUMMARY_TABLE);
  } catch (err) {
    return [readFailed("category_breadth", "Category breadth", "Today", (err as Error).message)];
  }
  if (!rows.length) {
    return [readFailed("category_breadth", "Category breadth", "Today", `No ${CATEGORY_SUMMARY_TABLE} rows found.`)];
  }

  const candidates: MarketPublishingCandidate[] = [];
  for (const row of rows) {
    if (row.breadth_pct == null || row.avg_zscore == null) continue;
    if (row.breadth_pct < CATEGORY_BREADTH_MIN || Math.abs(row.avg_zscore) < CATEGORY_ZSCORE_MIN) continue;

    const direction = row.avg_zscore > 0 ? "improving" : "deteriorating";
    const breakdown: MarketPublishingScoreBreakdown[] = [
      {
        component: "magnitude vs. recent history",
        value: row.avg_zscore,
        goldTable: CATEGORY_SUMMARY_TABLE,
        goldColumn: "avg_zscore",
        threshold: `|avg_zscore| >= ${CATEGORY_ZSCORE_MIN}`,
      },
      {
        component: "category breadth",
        value: row.breadth_pct,
        goldTable: CATEGORY_SUMMARY_TABLE,
        goldColumn: "breadth_pct",
        threshold: `breadth_pct >= ${CATEGORY_BREADTH_MIN}`,
      },
    ];
    candidates.push(readyCandidate({
      id: `category-breadth-${row.econ_category}`,
      templateId: "category_breadth",
      title: `${row.econ_category} category ${direction} broadly`,
      summary: `${row.n_improving ?? "?"}/${row.n_series ?? "?"} ${row.econ_category} series ${direction} (breadth ${(row.breadth_pct * 100).toFixed(0)}%, avg zscore ${row.avg_zscore.toFixed(2)}) as of ${row.as_of_date}.`,
      score: Math.min(99, Math.round(Math.abs(row.avg_zscore) * 20)),
      workspace: "Today",
      packageTypes: ["pre_market", "market_close", "weekend_week_in_markets", "monthly_state_of_markets", "quarterly_market_guide"],
      dataAsOf: row.as_of_date,
      seriesIds: [],
      citation: {
        source: "FRED/Economic Gold SQLite",
        seriesIds: [],
        goldTables: [CATEGORY_SUMMARY_TABLE],
        observationAsOf: row.as_of_date,
        transform: "category breadth and average zscore across constituent series",
        basis: `${row.econ_category} category, n_series=${row.n_series ?? "?"}`,
      },
      scoreBreakdown: breakdown,
    }));
  }
  return candidates;
}

/** Credit stress: a tier trading at a statistically extreme spread, not just a wide absolute level. */
export async function detectCreditStressCandidates(): Promise<MarketPublishingCandidate[]> {
  if (!goldEnabled()) return [configMissing("credit_stress", "Credit stress", "Today")];

  let rows: CreditSpreadRow[];
  try {
    rows = await latestRows<CreditSpreadRow>(CREDIT_SPREAD_TABLE);
  } catch (err) {
    return [readFailed("credit_stress", "Credit stress", "Today", (err as Error).message)];
  }
  if (!rows.length) {
    return [readFailed("credit_stress", "Credit stress", "Today", `No ${CREDIT_SPREAD_TABLE} rows found.`)];
  }

  const candidates: MarketPublishingCandidate[] = [];
  for (const row of rows) {
    if (row.percentile == null) continue;
    const stressed = row.is_stress_episode === 1 || row.percentile >= CREDIT_PERCENTILE_MIN;
    if (!stressed) continue;

    const breakdown: MarketPublishingScoreBreakdown[] = [
      {
        component: "historical percentile / record proximity",
        value: row.percentile,
        goldTable: CREDIT_SPREAD_TABLE,
        goldColumn: "percentile",
        threshold: `is_stress_episode = 1 OR percentile >= ${CREDIT_PERCENTILE_MIN}`,
      },
    ];
    candidates.push(readyCandidate({
      id: `credit-stress-${row.instrument}`,
      templateId: "credit_stress",
      title: `${row.instrument} credit spread stressed`,
      summary: `${row.instrument} OAS ${row.oas_bps ?? "n/a"}bps (${row.change_bps != null ? (row.change_bps >= 0 ? "+" : "") + row.change_bps.toFixed(0) : "n/a"}bps), ${(row.percentile * 100).toFixed(0)}th percentile as of ${row.observation_date}.`,
      score: Math.min(99, Math.round(row.percentile * 100)),
      workspace: "Today",
      packageTypes: ["pre_market", "market_close", "weekend_week_in_markets", "monthly_state_of_markets", "quarterly_market_guide"],
      dataAsOf: row.observation_date,
      seriesIds: [row.series_id],
      citation: {
        source: "FRED/Economic Gold SQLite",
        seriesIds: [row.series_id],
        goldTables: [CREDIT_SPREAD_TABLE],
        observationAsOf: row.observation_date,
        transform: "option-adjusted spread, rolling percentile and stress-episode flag",
        basis: `${row.instrument} (${row.category})`,
      },
      scoreBreakdown: breakdown,
      warnings: row.is_stress_episode === 1 ? ["is_stress_episode flag is set for this instrument"] : [],
    }));
  }
  return candidates;
}

/** Funding stress: the Gold-computed composite bucket, not a level threshold invented here. */
export async function detectFundingStressCandidates(): Promise<MarketPublishingCandidate[]> {
  if (!goldEnabled()) return [configMissing("funding_stress", "Funding stress", "Today")];

  let rows: FundingStressRow[];
  try {
    rows = await latestRows<FundingStressRow>(FUNDING_STRESS_TABLE);
  } catch (err) {
    return [readFailed("funding_stress", "Funding stress", "Today", (err as Error).message)];
  }
  if (!rows.length) {
    return [readFailed("funding_stress", "Funding stress", "Today", `No ${FUNDING_STRESS_TABLE} rows found.`)];
  }

  const row = rows[0];
  if (row.stress_bucket == null || !FUNDING_STRESS_BUCKETS.includes(row.stress_bucket)) return [];

  const breakdown: MarketPublishingScoreBreakdown[] = [
    {
      component: "magnitude vs. recent history",
      value: row.composite_z ?? 0,
      goldTable: FUNDING_STRESS_TABLE,
      goldColumn: "stress_bucket",
      threshold: `stress_bucket IN (${FUNDING_STRESS_BUCKETS.map((b) => `'${b}'`).join(", ")})`,
    },
  ];
  return [readyCandidate({
    id: "funding-stress",
    templateId: "funding_stress",
    title: `Funding stress reads "${row.stress_bucket}"`,
    summary: `Composite funding stress score ${row.stress_score?.toFixed(1) ?? "n/a"} (${row.n_components ?? "?"} components), bucket "${row.stress_bucket}" as of ${row.observation_date}.`,
    score: row.stress_bucket === "stressed" ? 90 : 70,
    workspace: "Today",
    packageTypes: ["pre_market", "market_close", "weekend_week_in_markets", "monthly_state_of_markets", "quarterly_market_guide"],
    dataAsOf: row.observation_date,
    seriesIds: [],
    citation: {
      source: "FRED/Economic Gold SQLite",
      seriesIds: [],
      goldTables: [FUNDING_STRESS_TABLE],
      observationAsOf: row.observation_date,
      transform: "composite funding-stress z-score bucketed by the upstream pipeline",
      basis: `n_components=${row.n_components ?? "?"}`,
    },
    scoreBreakdown: breakdown,
  })];
}

/** Curve regime: only a real inversion or recession flag fires here — curve_move is a directional label present most days and would flood the queue if used as the trigger by itself. */
export async function detectCurveRegimeCandidates(): Promise<MarketPublishingCandidate[]> {
  if (!goldEnabled()) return [configMissing("curve_regime", "Curve regime", "Today")];

  let rows: CurveMetricsRow[];
  try {
    rows = await latestRowsByAsOf<CurveMetricsRow>(CURVE_METRICS_TABLE);
  } catch (err) {
    return [readFailed("curve_regime", "Curve regime", "Today", (err as Error).message)];
  }
  if (!rows.length) {
    return [readFailed("curve_regime", "Curve regime", "Today", `No ${CURVE_METRICS_TABLE} rows found.`)];
  }

  const row = rows[0];
  const inverted2y = row.is_inverted_10y2y === 1;
  const inverted3m = row.is_inverted_10y3m === 1;
  const recession = row.is_recession === 1;
  if (!inverted2y && !inverted3m && !recession) return [];

  const flags = [
    inverted2y ? "10Y-2Y inverted" : null,
    inverted3m ? "10Y-3M inverted" : null,
    recession ? "recession flag set" : null,
  ].filter((f): f is string => f != null);

  const breakdown: MarketPublishingScoreBreakdown[] = [
    {
      component: "historical percentile / record proximity",
      value: (inverted2y ? 1 : 0) + (inverted3m ? 1 : 0) + (recession ? 1 : 0),
      goldTable: CURVE_METRICS_TABLE,
      goldColumn: "is_inverted_10y2y, is_inverted_10y3m, is_recession",
      threshold: "is_inverted_10y2y = 1 OR is_inverted_10y3m = 1 OR is_recession = 1",
    },
  ];
  return [readyCandidate({
    id: "curve-regime",
    templateId: "curve_regime",
    title: "Treasury curve regime flag",
    summary: `${flags.join(", ")} (${row.curve_move ?? "n/a"}) as of ${row.as_of_date}.`,
    score: 85,
    workspace: "Today",
    packageTypes: ["pre_market", "market_close", "weekend_week_in_markets", "monthly_state_of_markets", "quarterly_market_guide"],
    dataAsOf: row.as_of_date,
    seriesIds: [],
    citation: {
      source: "FRED/Economic Gold SQLite",
      seriesIds: [],
      goldTables: [CURVE_METRICS_TABLE],
      observationAsOf: row.as_of_date,
      transform: "curve-metric inversion and recession flags computed by the upstream pipeline",
      basis: `curve_move=${row.curve_move ?? "n/a"}`,
    },
    scoreBreakdown: breakdown,
  })];
}

/**
 * Runs all Phase 1 detectors and concatenates their output. Not wired into
 * `buildMarketPublishingCandidates`/the existing `/api/market-publishing/
 * candidates` route yet — that route's own test asserts an exact, fixed set
 * of Gold reads (spec004 Phase 0's no-fallback guardrail), and wiring this
 * in is a deliberate follow-up, not an implicit side effect of Phase 1.
 */
export async function detectMaterialChangeCandidates(): Promise<MarketPublishingCandidate[]> {
  const [category, credit, funding, curve] = await Promise.all([
    detectCategoryBreadthCandidates(),
    detectCreditStressCandidates(),
    detectFundingStressCandidates(),
    detectCurveRegimeCandidates(),
  ]);
  return [...category, ...credit, ...funding, ...curve];
}
