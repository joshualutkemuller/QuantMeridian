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

function mockRawByTable(table: {
  category?: unknown[];
  credit?: unknown[];
  funding?: unknown[];
  curve?: unknown[];
}) {
  mocks.raw.mockImplementation((sql: string) => {
    const s = String(sql);
    if (s.includes("gold_macro_category_summary")) return Promise.resolve(table.category ?? []);
    if (s.includes("gold_credit_spread_daily")) return Promise.resolve(table.credit ?? []);
    if (s.includes("gold_funding_stress_daily")) return Promise.resolve(table.funding ?? []);
    if (s.includes("gold_treasury_curve_metrics")) return Promise.resolve(table.curve ?? []);
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

  test("fails closed when Gold is not configured: no query attempted, all four detectors return unavailable", async () => {
    mocks.goldEnabled.mockReturnValue(false);

    const candidates = await detectMaterialChangeCandidates();

    expect(candidates).toHaveLength(4);
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

  test("every ready candidate's scoreBreakdown cites one of the four approved Phase 1 tables, never a free-form value", async () => {
    mockRawByTable({
      category: categorySummaryRows(),
      credit: creditSpreadRows(),
      funding: fundingStressRow("stressed"),
      curve: curveMetricsRow({ is_inverted_10y3m: 1 }),
    });

    const candidates = await detectMaterialChangeCandidates();
    const ready = candidates.filter((c) => c.status === "ready");
    const approvedTables = ["macro_category_summary", "credit_spread_daily", "funding_stress_daily", "treasury_curve_metrics"];

    expect(ready.length).toBeGreaterThanOrEqual(3);
    for (const candidate of ready) {
      expect(candidate.scoreBreakdown && candidate.scoreBreakdown.length).toBeGreaterThan(0);
      for (const entry of candidate.scoreBreakdown ?? []) {
        expect(approvedTables).toContain(entry.goldTable);
        expect(entry.goldColumn.length).toBeGreaterThan(0);
        expect(entry.threshold.length).toBeGreaterThan(0);
      }
    }
  });

  test("queries only the four approved Phase 1 tables, no forbidden fallback references", async () => {
    mockRawByTable({
      category: categorySummaryRows(),
      credit: creditSpreadRows(),
      funding: fundingStressRow("elevated"),
      curve: curveMetricsRow({ is_recession: 1 }),
    });

    await detectMaterialChangeCandidates();

    const sql = mocks.raw.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain("gold_macro_category_summary");
    expect(sql).toContain("gold_credit_spread_daily");
    expect(sql).toContain("gold_funding_stress_daily");
    expect(sql).toContain("gold_treasury_curve_metrics");
    expect(sql).not.toContain("bilello");
    expect(sql).not.toContain("snapshot");
    expect(sql).not.toContain("src/data/market");
  });
});
