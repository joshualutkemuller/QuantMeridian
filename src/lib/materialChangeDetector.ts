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
 * Signal Table Audit", approved 2026-09-02): Phase 1 read four of the
 * twelve, Phase 3 added `gold_macro_indicator_dashboard` (per-series
 * surprise) plus the two monthly sources below. Deliberately still unread:
 * `gold_zscore_heatmap` (much larger/more generic, needs its own
 * id-namespacing design), `gold_credit_spread_rolling`,
 * `gold_curve_spread_daily`, `gold_spread_inversion_episode` — approved,
 * next in line.
 *
 * `gold_series_structural_breaks` is approved but INTENTIONALLY has no
 * detector here, not an oversight: its own `break_date` is frequently years
 * older than the `as_of_date` that re-confirms it (a historical break being
 * re-tested, not new news), which this module's own Risks section already
 * named as unsafe to treat as a same-day trigger. It stays context/caveat
 * data for a future narrative-authoring feature, not a candidate source.
 */

export const runtime = "nodejs";

const CATEGORY_SUMMARY_TABLE = "macro_category_summary";
const CREDIT_SPREAD_TABLE = "credit_spread_daily";
const FUNDING_STRESS_TABLE = "funding_stress_daily";
const CURVE_METRICS_TABLE = "treasury_curve_metrics";
const INDICATOR_DASHBOARD_TABLE = "macro_indicator_dashboard";
const ANOMALY_SCORES_TABLE = "macro_anomaly_scores";
const RECESSION_PROBABILITY_TABLE = "recession_probability_daily";

/** Both anomaly_scores and recession_probability_daily are monthly, not daily, despite the latter's table name. Attached to every ready candidate from either. */
const MONTHLY_CADENCE_WARNING = "Monthly-frequency signal — may be several weeks old relative to the daily signals above.";

// Fixed, owner-tunable thresholds. Each is cited in the candidate it
// produces via scoreBreakdown — nothing here is a hidden magic number.
const CATEGORY_BREADTH_MIN = 0.8;
const CATEGORY_ZSCORE_MIN = 1.5;
const CREDIT_PERCENTILE_MIN = 0.95;
const FUNDING_STRESS_BUCKETS = ["elevated", "stressed"];
// Calibrated against real data while writing this detector: raw |zscore|
// alone at any reasonable cutoff mostly caught STALE rows (some over 200
// days old — a quarterly GDP print looking "extreme" isn't material today,
// it's just old; staleness_days ranged as high as 13,499 in this table).
// surprise_z plus a tight staleness gate is what actually stays selective
// and current: 2.5/45 produced exactly 8 fresh, diverse candidates.
const INDICATOR_SURPRISE_Z_MIN = 2.5;
const INDICATOR_MAX_STALENESS_DAYS = 45;
// Calibrated against real data: `prob_recession_12m` flips between exactly
// 0.0 and 1.0 with no correlation to the near-zero near-term probabilities
// in the same row (77% of all history reads 1.0) — an unreliable/bimodal
// column, deliberately excluded from this detector rather than trusted.
// `recession_prob` alone at >= 0.5 is genuinely selective: 20.6% of all
// history crosses it, and the real current environment (last 24 months,
// all ~1e-13 to 1e-19) correctly produces zero candidates.
const RECESSION_PROB_MIN = 0.5;

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

interface IndicatorDashboardRow {
  series_id: string;
  econ_category: string;
  as_of_date: string;
  latest_date: string;
  latest_value: number | null;
  zscore: number | null;
  percentile: number | null;
  surprise: number | null;
  surprise_z: number | null;
  staleness_days: number | null;
}

interface AnomalyScoreRow {
  observation_date: string;
  mahalanobis_d2: number | null;
  chi2_df: number | null;
  p_value: number | null;
  is_anomaly: number | null;
  n_factors_used: number | null;
}

interface RecessionProbabilityRow {
  observation_date: string;
  recession_prob: number | null;
  prob_recession_3m: number | null;
  prob_recession_6m: number | null;
  prob_recession_12m: number | null;
  logit_score: number | null;
  n_features: number | null;
  n_obs_training: number | null;
  model_vintage: string | null;
  is_backfilled: number | null;
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
 * Indicator surprise: any single series (of the ~290 covered) whose latest
 * print surprised meaningfully against trend AND is still fresh. Raw
 * `zscore` alone is deliberately NOT the trigger here — calibrated against
 * real data, its most extreme rows were mostly stale (some 200+ days old;
 * a quarterly GDP print that hasn't updated in months isn't "material
 * today" just because it once looked unusual). `surprise_z` combined with
 * a tight staleness gate stays selective and current; `zscore`/`percentile`
 * are carried as supporting context, not additional triggers.
 */
export async function detectIndicatorSurpriseCandidates(): Promise<MarketPublishingCandidate[]> {
  if (!goldEnabled()) return [configMissing("indicator_surprise", "Indicator surprise", "Today")];

  let rows: IndicatorDashboardRow[];
  try {
    rows = await latestRowsByAsOf<IndicatorDashboardRow>(INDICATOR_DASHBOARD_TABLE);
  } catch (err) {
    return [readFailed("indicator_surprise", "Indicator surprise", "Today", (err as Error).message)];
  }
  if (!rows.length) {
    return [readFailed("indicator_surprise", "Indicator surprise", "Today", `No ${INDICATOR_DASHBOARD_TABLE} rows found.`)];
  }

  const candidates: MarketPublishingCandidate[] = [];
  for (const row of rows) {
    if (row.surprise_z == null || row.staleness_days == null) continue;
    if (row.staleness_days > INDICATOR_MAX_STALENESS_DAYS) continue;
    if (Math.abs(row.surprise_z) < INDICATOR_SURPRISE_Z_MIN) continue;

    const direction = row.surprise_z > 0 ? "above" : "below";
    const breakdown: MarketPublishingScoreBreakdown[] = [
      {
        component: "surprise vs. trend",
        value: row.surprise_z,
        goldTable: INDICATOR_DASHBOARD_TABLE,
        goldColumn: "surprise_z",
        threshold: `|surprise_z| >= ${INDICATOR_SURPRISE_Z_MIN} AND staleness_days <= ${INDICATOR_MAX_STALENESS_DAYS}`,
      },
    ];
    if (row.zscore != null) {
      breakdown.push({
        component: "magnitude vs. recent history",
        value: row.zscore,
        goldTable: INDICATOR_DASHBOARD_TABLE,
        goldColumn: "zscore",
        threshold: "supporting context only — not a trigger (see detector docstring: raw zscore extremity here often reflects stale data)",
      });
    }

    candidates.push(readyCandidate({
      id: `indicator-surprise-${row.series_id}`,
      templateId: "indicator_surprise",
      title: `${row.series_id} surprised ${direction} trend`,
      summary: `${row.series_id} (${row.econ_category}) printed ${row.latest_value ?? "n/a"} on ${row.latest_date}, surprise z ${row.surprise_z.toFixed(2)}${row.zscore != null ? `, zscore ${row.zscore.toFixed(2)}` : ""} — ${row.staleness_days}d since release.`,
      score: Math.min(99, Math.round(Math.abs(row.surprise_z) * 20)),
      workspace: "Today",
      packageTypes: ["pre_market", "post_release", "market_close", "weekend_week_in_markets", "monthly_state_of_markets"],
      dataAsOf: row.latest_date,
      seriesIds: [row.series_id],
      citation: {
        source: "FRED/Economic Gold SQLite",
        seriesIds: [row.series_id],
        goldTables: [INDICATOR_DASHBOARD_TABLE],
        observationAsOf: row.latest_date,
        transform: "surprise z-score (actual vs. trend-implied) computed by the upstream pipeline",
        basis: row.econ_category,
      },
      scoreBreakdown: breakdown,
    }));
  }
  return candidates;
}

/**
 * Macro anomaly: a joint, multi-factor statistical anomaly across the macro
 * system as a whole (not one series in isolation) — `is_anomaly` is already
 * a significance-tested boolean flag from the upstream pipeline, so this
 * trusts it directly rather than re-deriving a threshold from `p_value`.
 * Monthly cadence; every ready candidate carries an explicit staleness
 * caveat rather than presenting as same-day news.
 */
export async function detectMacroAnomalyCandidates(): Promise<MarketPublishingCandidate[]> {
  if (!goldEnabled()) return [configMissing("macro_anomaly", "Macro anomaly", "Today")];

  let rows: AnomalyScoreRow[];
  try {
    rows = await latestRows<AnomalyScoreRow>(ANOMALY_SCORES_TABLE);
  } catch (err) {
    return [readFailed("macro_anomaly", "Macro anomaly", "Today", (err as Error).message)];
  }
  if (!rows.length) {
    return [readFailed("macro_anomaly", "Macro anomaly", "Today", `No ${ANOMALY_SCORES_TABLE} rows found.`)];
  }

  const row = rows[0];
  if (row.is_anomaly !== 1) return [];

  const pValue = row.p_value ?? 1;
  const breakdown: MarketPublishingScoreBreakdown[] = [
    {
      component: "historical percentile / record proximity",
      value: pValue,
      goldTable: ANOMALY_SCORES_TABLE,
      goldColumn: "is_anomaly",
      threshold: "is_anomaly = 1",
    },
  ];
  return [readyCandidate({
    id: "macro-anomaly",
    templateId: "macro_anomaly",
    title: "Macro system reads as a joint statistical anomaly",
    summary: `Mahalanobis d2 ${row.mahalanobis_d2?.toFixed(2) ?? "n/a"} across ${row.n_factors_used ?? "?"} factors, p=${pValue.toExponential(2)}, observation ${row.observation_date}.`,
    score: Math.min(99, Math.round((1 - pValue) * 100)),
    workspace: "Today",
    packageTypes: ["monthly_state_of_markets", "quarterly_market_guide"],
    dataAsOf: row.observation_date,
    seriesIds: [],
    citation: {
      source: "FRED/Economic Gold SQLite",
      seriesIds: [],
      goldTables: [ANOMALY_SCORES_TABLE],
      observationAsOf: row.observation_date,
      transform: "multi-factor Mahalanobis-distance joint anomaly test computed by the upstream pipeline",
      basis: `n_factors_used=${row.n_factors_used ?? "?"}, chi2_df=${row.chi2_df ?? "?"}`,
    },
    scoreBreakdown: breakdown,
    warnings: [MONTHLY_CADENCE_WARNING],
  })];
}

/**
 * Recession risk: `recession_prob` only — `prob_recession_12m` is
 * deliberately excluded as a trigger input (see the constant's comment:
 * calibrated against real data as an unreliable, near-binary column
 * uncorrelated with the near-term probabilities in the same row). Monthly
 * cadence; every ready candidate carries an explicit staleness caveat.
 */
export async function detectRecessionRiskCandidates(): Promise<MarketPublishingCandidate[]> {
  if (!goldEnabled()) return [configMissing("recession_risk", "Recession risk", "Today")];

  let rows: RecessionProbabilityRow[];
  try {
    rows = await latestRows<RecessionProbabilityRow>(RECESSION_PROBABILITY_TABLE);
  } catch (err) {
    return [readFailed("recession_risk", "Recession risk", "Today", (err as Error).message)];
  }
  if (!rows.length) {
    return [readFailed("recession_risk", "Recession risk", "Today", `No ${RECESSION_PROBABILITY_TABLE} rows found.`)];
  }

  const row = rows[0];
  if (row.recession_prob == null || row.recession_prob < RECESSION_PROB_MIN) return [];

  const breakdown: MarketPublishingScoreBreakdown[] = [
    {
      component: "magnitude vs. recent history",
      value: row.recession_prob,
      goldTable: RECESSION_PROBABILITY_TABLE,
      goldColumn: "recession_prob",
      threshold: `recession_prob >= ${RECESSION_PROB_MIN}`,
    },
  ];
  const warnings = [MONTHLY_CADENCE_WARNING];
  if (row.is_backfilled === 1) warnings.push("This observation is backfilled, not a same-day model run.");

  return [readyCandidate({
    id: "recession-risk",
    templateId: "recession_risk",
    title: "Recession probability model reads elevated",
    summary: `Recession probability ${(row.recession_prob * 100).toFixed(0)}% as of ${row.observation_date} (model vintage ${row.model_vintage ?? "n/a"}).`,
    score: Math.min(99, Math.round(row.recession_prob * 100)),
    workspace: "Today",
    packageTypes: ["monthly_state_of_markets", "quarterly_market_guide"],
    dataAsOf: row.observation_date,
    seriesIds: [],
    citation: {
      source: "FRED/Economic Gold SQLite",
      seriesIds: [],
      goldTables: [RECESSION_PROBABILITY_TABLE],
      observationAsOf: row.observation_date,
      transform: "recession-probability model computed by the upstream pipeline (recession_prob only — prob_recession_12m deliberately excluded)",
      basis: `n_features=${row.n_features ?? "?"}, n_obs_training=${row.n_obs_training ?? "?"}`,
    },
    scoreBreakdown: breakdown,
    warnings,
  })];
}

export type DetectorTemplateId = "category_breadth" | "credit_stress" | "funding_stress" | "curve_regime" | "indicator_surprise" | "macro_anomaly" | "recession_risk";

export interface DetectorGroupResult {
  templateId: DetectorTemplateId;
  /** false when this run's Gold read for this signal failed (an `unavailable` candidate) — spec006 Phase 2 uses this to avoid marking that signal's prior candidates "resolved" on missing information rather than a genuine change. */
  ok: boolean;
  candidates: MarketPublishingCandidate[];
}

/** Runs all detectors, grouped per signal so Phase 2's transition tracking can scope resolution per detector rather than guessing across all of them at once. */
export async function detectMaterialChangeCandidateGroups(): Promise<DetectorGroupResult[]> {
  const [category, credit, funding, curve, indicator, anomaly, recession] = await Promise.all([
    detectCategoryBreadthCandidates(),
    detectCreditStressCandidates(),
    detectFundingStressCandidates(),
    detectCurveRegimeCandidates(),
    detectIndicatorSurpriseCandidates(),
    detectMacroAnomalyCandidates(),
    detectRecessionRiskCandidates(),
  ]);
  const groups: [DetectorTemplateId, MarketPublishingCandidate[]][] = [
    ["category_breadth", category],
    ["credit_stress", credit],
    ["funding_stress", funding],
    ["curve_regime", curve],
    ["indicator_surprise", indicator],
    ["macro_anomaly", anomaly],
    ["recession_risk", recession],
  ];
  return groups.map(([templateId, candidates]) => ({
    templateId,
    ok: !candidates.some((c) => c.status === "unavailable"),
    candidates,
  }));
}

/** Flat, ungrouped view used by the live `candidates` route (Phase 1's original wiring — unchanged shape/behavior). */
export async function detectMaterialChangeCandidates(): Promise<MarketPublishingCandidate[]> {
  const groups = await detectMaterialChangeCandidateGroups();
  return groups.flatMap((group) => group.candidates);
}
