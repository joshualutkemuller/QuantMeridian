import { describe, it, expect } from "vitest";
import { buildEdaFromGold } from "./goldEda";
import type { GoldStore } from "./goldStore";

/** Two lag rows per pair, mirroring the Gold shape (Granger F/p repeated per lag). */
function leadLagRows() {
  return [
    { series_a: "DGS2", series_b: "DGS10", lag: -1, cross_correlation: 0.1, best_lag: 0, granger_f_ab: 5, granger_p_ab: 0.004, granger_f_ba: 1.3, granger_p_ba: 0.26, as_of_date: "2026-07-16" },
    { series_a: "DGS2", series_b: "DGS10", lag: 0, cross_correlation: 0.82, best_lag: 0, granger_f_ab: 5, granger_p_ab: 0.004, granger_f_ba: 1.3, granger_p_ba: 0.26, as_of_date: "2026-07-16" },
    { series_a: "PERMIT", series_b: "HOUST", lag: 0, cross_correlation: 0.41, best_lag: 0, granger_f_ab: 48, granger_p_ab: 1e-30, granger_f_ba: 2, granger_p_ba: 0.1, as_of_date: "2026-06-01" },
  ];
}

function stubStore(over: Partial<Record<string, unknown[]>> = {}): GoldStore {
  const tables: Record<string, unknown[]> = {
    series_lead_lag: leadLagRows(),
    series_structural_breaks: [
      { series_a: "DGS2", series_b: "DGS10", test_type: "cusum", break_date: "1984-05-30", cusum_max: 49.2, is_significant: 0, as_of_date: "2026-07-16" },
      { series_a: "PERMIT", series_b: "HOUST", test_type: "chow", break_date: "1975-04-01", cusum_max: null, is_significant: 0, as_of_date: "2026-06-01" },
    ],
    dim_series: [
      { series_id: "DGS2", title: "2-Year Treasury" },
      { series_id: "DGS10", title: "10-Year Treasury" },
    ],
    ...over,
  };
  const corr = (over.__corr as unknown[]) ?? [
    { series_a: "DGS2", series_b: "DGS10", correlation: 0.82, observation_date: "2026-07-16" },
  ];
  return {
    latest: async <T,>(table: string) => (tables[table] ?? []) as T[],
    history: async () => [],
    asOf: async () => [],
    raw: async <T,>() => corr as T[],
    health: async () => ({ ok: true, backend: "sqlite", latencyMs: 1, detail: "" }),
  };
}

describe("buildEdaFromGold", () => {
  it("groups lead-lag rows into one CCF series per pair", async () => {
    const view = (await buildEdaFromGold(stubStore()))!;
    expect(view.cross_correlation).toHaveLength(2);
    const pair = view.cross_correlation.find((p) => p.leader === "DGS2")!;
    expect(pair.ccf).toEqual([{ lag: -1, corr: 0.1 }, { lag: 0, corr: 0.82 }]);
    expect(pair.best_lag).toBe(0);
    expect(pair.best_corr).toBe(0.82);
  });

  it("resolves display names from dim_series and falls back to the series id", async () => {
    const view = (await buildEdaFromGold(stubStore()))!;
    const known = view.cross_correlation.find((p) => p.leader === "DGS2")!;
    expect(known.leader_name).toBe("2-Year Treasury");
    const unknown = view.cross_correlation.find((p) => p.leader === "PERMIT")!;
    expect(unknown.leader_name).toBe("PERMIT");
  });

  it("emits both Granger directions once per pair, not once per lag row", async () => {
    const view = (await buildEdaFromGold(stubStore()))!;
    // 2 pairs x 2 directions — the DGS2/DGS10 pair has 2 lag rows but must not double up.
    expect(view.granger_causality).toHaveLength(4);
    const ab = view.granger_causality.find((g) => g.leader === "DGS2" && g.follower === "DGS10")!;
    const ba = view.granger_causality.find((g) => g.leader === "DGS10" && g.follower === "DGS2")!;
    expect(ab.f_stat).toBe(5);
    expect(ba.f_stat).toBe(1.3);
  });

  it("builds a sparse symmetric heatmap with a unit diagonal and null for unmeasured pairs", async () => {
    const view = (await buildEdaFromGold(stubStore({ __corr: [
      { series_a: "DGS2", series_b: "DGS10", correlation: 0.82, observation_date: "2026-07-16" },
      { series_a: "PERMIT", series_b: "HOUST", correlation: 0.41, observation_date: "2026-06-01" },
    ] })))!;
    const { labels, matrix } = view.pearson_heatmap;
    expect(labels).toEqual(["DGS10", "DGS2", "HOUST", "PERMIT"]);
    expect(matrix[0][0]).toBe(1);
    // measured pair is mirrored…
    expect(matrix[labels.indexOf("DGS2")][labels.indexOf("DGS10")]).toBe(0.82);
    expect(matrix[labels.indexOf("DGS10")][labels.indexOf("DGS2")]).toBe(0.82);
    // …and an unmeasured pair stays null rather than collapsing to 0.
    expect(matrix[labels.indexOf("DGS2")][labels.indexOf("HOUST")]).toBeNull();
  });

  it("keeps only CUSUM breaks and keys them by pair", async () => {
    const view = (await buildEdaFromGold(stubStore()))!;
    expect(view.cusum).toHaveLength(1);
    expect(view.cusum[0].series_id).toBe("DGS2|DGS10");
    expect(view.cusum[0].changepoints).toEqual(["1984-05-30"]);
  });

  it("reports the panels Gold cannot serve instead of leaving them silently empty", async () => {
    const view = (await buildEdaFromGold(stubStore()))!;
    expect(view.lagged_ols).toEqual([]);
    expect(view.pelt).toEqual([]);
    expect(typeof view.coverage?.lagged_ols).toBe("string");
    expect(typeof view.coverage?.pelt).toBe("string");
    expect(view.coverage?.cross_correlation).toBe(true);
  });

  it("takes asof from the newest source date", async () => {
    const view = (await buildEdaFromGold(stubStore()))!;
    expect(view.asof).toBe("2026-07-16");
  });

  it("returns null when Gold holds no EDA rows, so the caller can fall through", async () => {
    const empty = stubStore({ series_lead_lag: [], series_structural_breaks: [], __corr: [] });
    expect(await buildEdaFromGold(empty)).toBeNull();
  });
});
