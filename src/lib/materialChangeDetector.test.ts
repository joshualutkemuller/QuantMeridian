import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  goldEnabled: vi.fn(),
  raw: vi.fn(),
}));

vi.mock("@/lib/server/goldStore", () => ({
  goldEnabled: mocks.goldEnabled,
  goldStore: () => ({ raw: mocks.raw }),
  goldTable: (table: string) => `gold_${table}`,
}));

import {
  detectCategoryBreadthCandidates,
  detectCreditStressCandidates,
  detectFundingStressCandidates,
  detectCurveRegimeCandidates,
  detectIndicatorSurpriseCandidates,
  detectMacroAnomalyCandidates,
  detectRecessionRiskCandidates,
  detectMaterialChangeCandidates,
} from "./materialChangeDetector";

function categorySummaryRows() {
  return [
    { econ_category: "GROWTH", as_of_date: "2026-08-24", n_series: 10, n_improving: 8, n_deteriorating: 0, breadth_pct: 1.0, avg_zscore: 2.1, surprise_index: 2.1 },
    { econ_category: "ACTIVITY", as_of_date: "2026-08-24", n_series: 9, n_improving: 8, n_deteriorating: 0, breadth_pct: 1.0, avg_zscore: 0.5, surprise_index: 1.5 },
    { econ_category: "CONSUMER", as_of_date: "2026-08-24", n_series: 8, n_improving: 4, n_deteriorating: 2, breadth_pct: 0.5, avg_zscore: 1.9, surprise_index: 0.8 },
    { econ_category: "FX", as_of_date: "2026-08-24", n_series: 0, n_improving: null, n_deteriorating: null, breadth_pct: null, avg_zscore: 0.7, surprise_index: null },
  ];
}

function creditSpreadRows() {
  return [
    { instrument: "CCC_OAS", series_id: "CCC_OAS_SERIES", category: "credit", observation_date: "2026-08-20", oas_bps: 1035, change_bps: 5, zscore: 1.75, percentile: 0.98, is_stress_episode: 1 },
    { instrument: "IG_OAS", series_id: "IG_OAS_SERIES", category: "credit", observation_date: "2026-08-20", oas_bps: 82, change_bps: 1, zscore: -0.63, percentile: 0.34, is_stress_episode: 0 },
  ];
}

function fundingStressRow(bucket: string) {
  return [{ observation_date: "2026-08-20", composite_z: 0.55, stress_score: 60.9, stress_bucket: bucket, n_components: 3 }];
}

function curveMetricsRow(overrides: Partial<{ is_inverted_10y2y: number; is_inverted_10y3m: number; is_recession: number }>) {
  return [{
    as_of_date: "2026-08-20",
    level: 4.37,
    slope_10y2y: 0.5,
    slope_10y3m: 0.82,
    curve_move: "bear-steepener",
    is_inverted_10y2y: 0,
    is_inverted_10y3m: 0,
    is_recession: 0,
    ...overrides,
  }];
}

function indicatorDashboardRows() {
  return [
    { series_id: "DEXBZUS", econ_category: "FX", as_of_date: "2026-08-24", latest_date: "2026-08-14", latest_value: 5.4, zscore: 1.62, percentile: 0.89, surprise: 0.3, surprise_z: 3.36, staleness_days: 10 },
    { series_id: "GDI", econ_category: "GROWTH", as_of_date: "2026-08-24", latest_date: "2026-01-01", latest_value: 24000, zscore: 2.89, percentile: 1.0, surprise: 0.1, surprise_z: 0.4, staleness_days: 235 }, // extreme zscore but stale — must not fire
    { series_id: "UNRATE", econ_category: "LABOR", as_of_date: "2026-08-24", latest_date: "2026-07-01", latest_value: 4.1, zscore: -0.2, percentile: 0.4, surprise: null, surprise_z: null, staleness_days: 20 }, // null surprise_z — must skip without crashing
    { series_id: "PCEPI", econ_category: "INFLATION", as_of_date: "2026-08-24", latest_date: "2026-06-01", latest_value: 131.4, zscore: 0.5, percentile: 0.6, surprise: 0.05, surprise_z: 1.1, staleness_days: 15 }, // below surprise_z threshold
  ];
}

// Real fired example from the audited database (2021-10-01).
function anomalyScoreRow(overrides: Partial<{ is_anomaly: number; p_value: number }> = {}) {
  return [{ observation_date: "2021-10-01", mahalanobis_d2: 15.17, chi2_df: 5, p_value: 0.00966, is_anomaly: 1, n_factors_used: 5, ...overrides }];
}

function recessionProbabilityRow(overrides: Partial<{ recession_prob: number; prob_recession_12m: number; is_backfilled: number }> = {}) {
  return [{
    observation_date: "2026-07-01",
    recession_prob: 0.02, // real current reading is ~1e-13; use a small non-zero default for clarity in tests
    prob_recession_3m: 0.02,
    prob_recession_6m: 0.02,
    prob_recession_12m: 1.0, // real data: flips 0/1 with no correlation to the other columns — must never gate the trigger
    logit_score: -5.1,
    n_features: 5,
    n_obs_training: 2057,
    model_vintage: "2026-08-24",
    is_backfilled: 0,
    ...overrides,
  }];
}

function mockRawByTable(table: {
  category?: unknown[];
  credit?: unknown[];
  funding?: unknown[];
  curve?: unknown[];
  indicator?: unknown[];
  anomaly?: unknown[];
  recession?: unknown[];
}) {
  mocks.raw.mockImplementation((sql: string) => {
    const s = String(sql);
    if (s.includes("gold_macro_category_summary")) return Promise.resolve(table.category ?? []);
    if (s.includes("gold_credit_spread_daily")) return Promise.resolve(table.credit ?? []);
    if (s.includes("gold_funding_stress_daily")) return Promise.resolve(table.funding ?? []);
    if (s.includes("gold_treasury_curve_metrics")) return Promise.resolve(table.curve ?? []);
    if (s.includes("gold_macro_indicator_dashboard")) return Promise.resolve(table.indicator ?? []);
    if (s.includes("gold_macro_anomaly_scores")) return Promise.resolve(table.anomaly ?? []);
    if (s.includes("gold_recession_probability_daily")) return Promise.resolve(table.recession ?? []);
    return Promise.resolve([]);
  });
}

describe("materialChangeDetector", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.goldEnabled.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("category breadth: flags only the category crossing both thresholds, skips null breadth without crashing", async () => {
    mockRawByTable({ category: categorySummaryRows() });

    const candidates = await detectCategoryBreadthCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("category-breadth-GROWTH");
    expect(candidates[0].status).toBe("ready");
    expect(candidates[0].source).toBe("DB");
    expect(candidates[0].dataAsOf).toBe("2026-08-24");
    expect(candidates[0].score).toBe(42); // round(|2.1| * 20)
    expect(candidates[0].scoreBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ goldTable: "macro_category_summary", goldColumn: "avg_zscore", threshold: "|avg_zscore| >= 1.5" }),
      expect.objectContaining({ goldTable: "macro_category_summary", goldColumn: "breadth_pct", threshold: "breadth_pct >= 0.8" }),
    ]));
  });

  test("credit stress: flags only the stressed instrument, records the stress-episode warning", async () => {
    mockRawByTable({ credit: creditSpreadRows() });

    const candidates = await detectCreditStressCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("credit-stress-CCC_OAS");
    expect(candidates[0].score).toBe(98);
    expect(candidates[0].warnings).toContain("is_stress_episode flag is set for this instrument");
    expect(candidates[0].seriesIds).toEqual(["CCC_OAS_SERIES"]);
  });

  test("funding stress: fires on an elevated/stressed bucket", async () => {
    mockRawByTable({ funding: fundingStressRow("elevated") });

    const candidates = await detectFundingStressCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toContain("elevated");
    expect(candidates[0].score).toBe(70);
  });

  test("funding stress: a calm bucket produces zero candidates, not an unavailable one", async () => {
    mockRawByTable({ funding: fundingStressRow("calm") });

    const candidates = await detectFundingStressCandidates();

    expect(candidates).toHaveLength(0);
  });

  test("curve regime: no inversion/recession flag produces zero candidates (condition not met, not a data failure)", async () => {
    mockRawByTable({ curve: curveMetricsRow({}) });

    const candidates = await detectCurveRegimeCandidates();

    expect(candidates).toHaveLength(0);
  });

  test("curve regime: an inversion flag fires a ready candidate", async () => {
    mockRawByTable({ curve: curveMetricsRow({ is_inverted_10y2y: 1 }) });

    const candidates = await detectCurveRegimeCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].summary).toContain("10Y-2Y inverted");
    expect(candidates[0].score).toBe(85);
  });

  test("indicator surprise: fires only on |surprise_z| >= threshold AND fresh enough, skipping stale extremes and null surprise_z", async () => {
    mockRawByTable({ indicator: indicatorDashboardRows() });

    const candidates = await detectIndicatorSurpriseCandidates();

    // DEXBZUS: surprise_z 3.36, staleness 10 -> fires.
    // GDI: zscore 2.89 (would fire under a naive zscore-only rule) but staleness 235 -> must NOT fire.
    // UNRATE: surprise_z null -> must be skipped without crashing.
    // PCEPI: surprise_z 1.1, below the 2.5 threshold -> must NOT fire.
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("indicator-surprise-DEXBZUS");
    expect(candidates[0].score).toBe(67); // round(3.36 * 20), capped at 99
    expect(candidates[0].dataAsOf).toBe("2026-08-14");
    expect(candidates[0].scoreBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ goldTable: "macro_indicator_dashboard", goldColumn: "surprise_z" }),
      expect.objectContaining({ goldTable: "macro_indicator_dashboard", goldColumn: "zscore" }),
    ]));
  });

  test("indicator surprise: an empty result set is unavailable, distinct from zero candidates crossing the threshold", async () => {
    mockRawByTable({ indicator: [] });

    const candidates = await detectIndicatorSurpriseCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("unavailable");
    expect(candidates[0].unavailableReason).toContain("No macro_indicator_dashboard rows found");
  });

  test("macro anomaly: trusts is_anomaly directly, carries a monthly-cadence warning, scores from p_value", async () => {
    mockRawByTable({ anomaly: anomalyScoreRow() });

    const candidates = await detectMacroAnomalyCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("macro-anomaly");
    expect(candidates[0].score).toBe(99); // round((1 - 0.00966) * 100), capped
    expect(candidates[0].warnings).toContain("Monthly-frequency signal — may be several weeks old relative to the daily signals above.");
    expect(candidates[0].scoreBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ goldTable: "macro_anomaly_scores", goldColumn: "is_anomaly", threshold: "is_anomaly = 1" }),
    ]));
  });

  test("macro anomaly: is_anomaly = 0 produces zero candidates, not an unavailable one", async () => {
    mockRawByTable({ anomaly: anomalyScoreRow({ is_anomaly: 0 }) });

    const candidates = await detectMacroAnomalyCandidates();

    expect(candidates).toHaveLength(0);
  });

  test("recession risk: fires on recession_prob alone, ignores prob_recession_12m entirely even when it reads 1.0", async () => {
    mockRawByTable({ recession: recessionProbabilityRow({ recession_prob: 0.6, prob_recession_12m: 1.0 }) });

    const candidates = await detectRecessionRiskCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].score).toBe(60);
    expect(candidates[0].scoreBreakdown?.[0].goldColumn).toBe("recession_prob");
    expect(candidates[0].scoreBreakdown?.some((b) => b.goldColumn === "prob_recession_12m")).toBe(false);
  });

  test("recession risk: prob_recession_12m = 1.0 alone (recession_prob low) does NOT fire — the unreliable column is never a trigger", async () => {
    mockRawByTable({ recession: recessionProbabilityRow({ recession_prob: 0.02, prob_recession_12m: 1.0 }) });

    const candidates = await detectRecessionRiskCandidates();

    expect(candidates).toHaveLength(0);
  });

  test("recession risk: a backfilled observation gets an extra caveat warning alongside the monthly-cadence one", async () => {
    mockRawByTable({ recession: recessionProbabilityRow({ recession_prob: 0.55, is_backfilled: 1 }) });

    const candidates = await detectRecessionRiskCandidates();

    expect(candidates[0].warnings).toEqual(expect.arrayContaining([
      "Monthly-frequency signal — may be several weeks old relative to the daily signals above.",
      "This observation is backfilled, not a same-day model run.",
    ]));
  });

  test("fails closed when Gold is not configured: no query attempted, all seven detectors return unavailable", async () => {
    mocks.goldEnabled.mockReturnValue(false);

    const candidates = await detectMaterialChangeCandidates();

    expect(candidates).toHaveLength(7);
    expect(candidates.every((c) => c.status === "unavailable" && c.source === "ERR")).toBe(true);
    expect(mocks.raw).not.toHaveBeenCalled();
  });

  test("a failed Gold read produces an explicit unavailable candidate, not a thrown error or silent empty state", async () => {
    mocks.raw.mockImplementation((sql: string) => {
      if (String(sql).includes("gold_macro_category_summary")) return Promise.reject(new Error("db locked"));
      return Promise.resolve([]);
    });

    const candidates = await detectCategoryBreadthCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("unavailable");
    expect(candidates[0].unavailableReason).toBe("db locked");
  });

  test("an empty result set is unavailable, distinct from a real zero-candidate outcome", async () => {
    mockRawByTable({ funding: [] });

    const candidates = await detectFundingStressCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("unavailable");
    expect(candidates[0].unavailableReason).toContain("No funding_stress_daily rows found");
  });

  test("every ready candidate's scoreBreakdown cites one of the seven approved tables read so far, never a free-form value", async () => {
    mockRawByTable({
      category: categorySummaryRows(),
      credit: creditSpreadRows(),
      funding: fundingStressRow("stressed"),
      curve: curveMetricsRow({ is_inverted_10y3m: 1 }),
      indicator: indicatorDashboardRows(),
      anomaly: anomalyScoreRow(),
      recession: recessionProbabilityRow({ recession_prob: 0.6 }),
    });

    const candidates = await detectMaterialChangeCandidates();
    const ready = candidates.filter((c) => c.status === "ready");
    const approvedTables = ["macro_category_summary", "credit_spread_daily", "funding_stress_daily", "treasury_curve_metrics", "macro_indicator_dashboard", "macro_anomaly_scores", "recession_probability_daily"];

    expect(ready.length).toBeGreaterThanOrEqual(6);
    for (const candidate of ready) {
      expect(candidate.scoreBreakdown && candidate.scoreBreakdown.length).toBeGreaterThan(0);
      for (const entry of candidate.scoreBreakdown ?? []) {
        expect(approvedTables).toContain(entry.goldTable);
        expect(entry.goldColumn.length).toBeGreaterThan(0);
        expect(entry.threshold.length).toBeGreaterThan(0);
      }
    }
  });

  test("queries only the seven approved tables read so far, no forbidden fallback references", async () => {
    mockRawByTable({
      category: categorySummaryRows(),
      credit: creditSpreadRows(),
      funding: fundingStressRow("elevated"),
      curve: curveMetricsRow({ is_recession: 1 }),
      indicator: indicatorDashboardRows(),
      anomaly: anomalyScoreRow(),
      recession: recessionProbabilityRow({ recession_prob: 0.6 }),
    });

    await detectMaterialChangeCandidates();

    const sql = mocks.raw.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain("gold_macro_category_summary");
    expect(sql).toContain("gold_credit_spread_daily");
    expect(sql).toContain("gold_funding_stress_daily");
    expect(sql).toContain("gold_treasury_curve_metrics");
    expect(sql).toContain("gold_macro_indicator_dashboard");
    expect(sql).toContain("gold_macro_anomaly_scores");
    expect(sql).toContain("gold_recession_probability_daily");
    expect(sql).not.toContain("bilello");
    expect(sql).not.toContain("snapshot");
    expect(sql).not.toContain("src/data/market");
  });
});
