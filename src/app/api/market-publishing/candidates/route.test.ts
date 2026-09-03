import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET as getCandidates } from "./route";
import { GET as getDaily } from "../daily/route";

const mocks = vi.hoisted(() => ({
  goldEnabled: vi.fn(),
  raw: vi.fn(),
  readDetectorState: vi.fn(),
}));

vi.mock("@/lib/server/goldStore", () => ({
  goldEnabled: mocks.goldEnabled,
  goldParam: (index: number) => `?${index}`,
  goldStore: () => ({ raw: mocks.raw }),
  goldTable: (table: string) => `gold_${table}`,
}));

vi.mock("@/lib/server/detectorStateStore", () => ({
  readDetectorState: mocks.readDetectorState,
}));

function dateFrom(base: string, days: number): string {
  return new Date(Date.UTC(
    Number(base.slice(0, 4)),
    Number(base.slice(5, 7)) - 1,
    Number(base.slice(8, 10)) + days
  )).toISOString().slice(0, 10);
}

function dailyRows(series_id: string, start: string, count: number, value: number, step: number) {
  return Array.from({ length: count }, (_, index) => ({
    series_id,
    date: dateFrom(start, index),
    value: value + index * step,
    realtime_start: dateFrom(start, index),
  }));
}

function weeklyRows(series_id: string, start: string, count: number, value: number, step: number) {
  return Array.from({ length: count }, (_, index) => ({
    series_id,
    date: dateFrom(start, index * 7),
    value: value + index * step,
    realtime_start: dateFrom(start, index * 7),
  }));
}

function monthlyRows(series_id: string, start: string, count: number, value: number, step: number) {
  return Array.from({ length: count }, (_, index) => ({
    series_id,
    date: new Date(Date.UTC(
      Number(start.slice(0, 4)),
      Number(start.slice(5, 7)) - 1 + index,
      Number(start.slice(8, 10))
    )).toISOString().slice(0, 10),
    value: value + index * step,
    realtime_start: dateFrom(start, index * 30),
  }));
}

function quarterlyRows(series_id: string, start: string, count: number, value: number, step: number) {
  return Array.from({ length: count }, (_, index) => ({
    series_id,
    date: new Date(Date.UTC(
      Number(start.slice(0, 4)),
      Number(start.slice(5, 7)) - 1 + index * 3,
      Number(start.slice(8, 10))
    )).toISOString().slice(0, 10),
    value: value + index * step,
    realtime_start: dateFrom(start, index * 90),
  }));
}

function observationRows() {
  return [
    ...dailyRows("SP500", "2023-01-01", 1300, 5200, 5),
    ...dailyRows("NASDAQCOM", "2026-07-01", 25, 17000, 15),
    ...dailyRows("DJIA", "2026-07-01", 25, 41000, -10),
    ...dailyRows("DGS10", "2026-07-01", 25, 4.1, 0.01),
    ...dailyRows("DGS2", "2026-07-01", 25, 3.7, -0.005),
    ...dailyRows("T10Y2Y", "2026-07-01", 25, -0.2, 0.01),
    ...dailyRows("VIXCLS", "2026-07-01", 25, 19, -0.1),
    ...dailyRows("BAMLH0A0HYM2", "2026-07-01", 25, 3.2, 0.01),
    ...dailyRows("BAMLC0A0CM", "2026-07-01", 25, 1.1, 0.002),
    ...weeklyRows("WRESBAL", "2026-01-01", 30, 3200, 4),
    ...monthlyRows("PCEPILFE", "2025-01-01", 19, 125, 0.25),
    ...monthlyRows("UNRATE", "2025-01-01", 19, 4.4, -0.01),
    ...quarterlyRows("GDPC1", "2025-01-01", 7, 23000, 80),
  ];
}

function releaseRows() {
  return [
    {
      release_id: 1,
      release_name: "Employment Situation",
      release_date: "2026-09-04",
      importance: "HIGH",
      econ_category: "labor",
      representative_series_id: "UNRATE",
      fetched_at: "2026-08-30T12:00:00Z",
    },
  ];
}

function categorySummaryRows() {
  return [
    { econ_category: "GROWTH", as_of_date: "2026-08-24", n_series: 10, n_improving: 8, n_deteriorating: 0, breadth_pct: 1.0, avg_zscore: 2.1, surprise_index: 2.1 },
  ];
}

function creditSpreadRows() {
  return [
    { instrument: "CCC_OAS", series_id: "CCC_OAS_SERIES", category: "credit", observation_date: "2026-08-20", oas_bps: 1035, change_bps: 5, zscore: 1.75, percentile: 0.98, is_stress_episode: 1 },
  ];
}

function fundingStressRows() {
  return [{ observation_date: "2026-08-20", composite_z: 0.55, stress_score: 60.9, stress_bucket: "elevated", n_components: 3 }];
}

function curveMetricsRows() {
  return [{ as_of_date: "2026-08-20", level: 4.37, slope_10y2y: 0.5, slope_10y3m: 0.82, curve_move: "bear-steepener", is_inverted_10y2y: 1, is_inverted_10y3m: 0, is_recession: 0 }];
}

async function readJson(response: Response) {
  return response.json();
}

describe("/api/market-publishing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.goldEnabled.mockReturnValue(true);
    mocks.raw.mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes("gold_release_calendar")) return Promise.resolve(releaseRows());
      if (s.includes("gold_macro_category_summary")) return Promise.resolve(categorySummaryRows());
      if (s.includes("gold_credit_spread_daily")) return Promise.resolve(creditSpreadRows());
      if (s.includes("gold_funding_stress_daily")) return Promise.resolve(fundingStressRows());
      if (s.includes("gold_treasury_curve_metrics")) return Promise.resolve(curveMetricsRows());
      return Promise.resolve(observationRows());
    });
    mocks.readDetectorState.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("daily returns the MPUB shell from Gold-backed Command Center data", async () => {
    const body = await readJson(await getDaily());

    expect(body.source).toBe("DB");
    expect(body.commandCenter.source).toBe("DB");
    expect(body.workspaces).toContain("Today");
    expect(body.packages.map((pkg: { type: string }) => pkg.type)).toEqual(expect.arrayContaining([
      "pre_market",
      "market_close",
      "weekend_week_in_markets",
      "monthly_state_of_markets",
      "quarterly_market_guide",
    ]));
    expect(body.commandCenter.highLevelMarkets.map((metric: { id: string }) => metric.id)).toContain("SP500");
  });

  test("candidates builds ready and unavailable states without synthetic fallback", async () => {
    const body = await readJson(await getCandidates());

    expect(body.source).toBe("DB");
    expect(body.candidates.map((candidate: { templateId: string }) => candidate.templateId)).toEqual(expect.arrayContaining([
      "daily_scoreboard",
      "market_derby",
      "curve_watch",
      "vol_credit_watch",
      "macro_week_ahead",
      "reserve_vix_claim_audit",
      "earnings_valuation_gate",
    ]));
    expect(body.candidates.filter((candidate: { status: string }) => candidate.status === "ready").length).toBeGreaterThanOrEqual(5);
    const ready = body.candidates.filter((candidate: { status: string }) => candidate.status === "ready");
    expect(ready.every((candidate: { source: string; citation: unknown; dataAsOf: string | null }) => (
      candidate.source === "DB" && candidate.citation && candidate.dataAsOf
    ))).toBe(true);
    const earnings = body.candidates.find((candidate: { templateId: string }) => candidate.templateId === "earnings_valuation_gate");
    expect(earnings.status).toBe("unavailable");
    expect(earnings.unavailableReason).toContain("No approved upstream Gold contract");
  });

  test("candidates merges spec006 material-change detector output alongside the fixed templates", async () => {
    const body = await readJson(await getCandidates());

    const detectorTemplateIds = ["category_breadth", "credit_stress", "funding_stress", "curve_regime"];
    const detectorCandidates = body.candidates.filter((candidate: { templateId: string }) => detectorTemplateIds.includes(candidate.templateId));
    expect(detectorCandidates.map((c: { templateId: string }) => c.templateId)).toEqual(expect.arrayContaining(detectorTemplateIds));
    expect(detectorCandidates.every((c: { status: string; scoreBreakdown?: unknown[] }) => (
      c.status === "ready" && Array.isArray(c.scoreBreakdown) && c.scoreBreakdown.length > 0
    ))).toBe(true);
  });

  test("candidates annotates detector output with changeType/firstFlaggedAt from the last cron run's state (spec006 Phase 2, read-only)", async () => {
    mocks.readDetectorState.mockResolvedValue(new Map([
      ["credit-stress-CCC_OAS", { candidateId: "credit-stress-CCC_OAS", templateId: "credit_stress", changeType: "continuing", firstFlaggedAt: "2026-08-20T00:00:00.000Z", lastSeenAt: "2026-09-02T00:00:00.000Z", lastRunAt: "2026-09-02T00:00:00.000Z" }],
    ]));

    const body = await readJson(await getCandidates());

    const ccc = body.candidates.find((c: { id: string }) => c.id === "credit-stress-CCC_OAS");
    expect(ccc.changeType).toBe("continuing");
    expect(ccc.firstFlaggedAt).toBe("2026-08-20T00:00:00.000Z");
    // A candidate with no matching state row (never seen by a cron run yet) stays unannotated, not errored.
    const funding = body.candidates.find((c: { templateId: string }) => c.templateId === "funding_stress");
    expect(funding.changeType).toBeUndefined();
  });

  test("candidates degrades to a warning, not an unavailable status, when the transition-state read fails", async () => {
    mocks.readDetectorState.mockRejectedValue(new Error("connection refused"));

    const body = await readJson(await getCandidates());

    const ccc = body.candidates.find((c: { id: string }) => c.id === "credit-stress-CCC_OAS");
    expect(ccc.status).toBe("ready");
    expect(ccc.source).toBe("DB");
    expect(ccc.changeType).toBeUndefined();
    expect(ccc.warnings).toEqual(expect.arrayContaining([expect.stringContaining("Transition state unavailable: connection refused")]));
  });

  test("fails closed when Gold is not configured", async () => {
    mocks.goldEnabled.mockReturnValue(false);

    const body = await readJson(await getCandidates());

    expect(body.source).toBe("ERR");
    expect(body.candidates[0]).toMatchObject({
      status: "unavailable",
      source: "ERR",
      templateId: "daily_scoreboard",
    });
    expect(body.error).toBe("MACRO_DB_URL not configured.");
    expect(mocks.raw).not.toHaveBeenCalled();
  });

  test("queries only approved Gold tables", async () => {
    await getCandidates();

    // 2 Command Center reads (spec004 Phase 0) + 4 spec006 material-change
    // detector reads (spec004 Phase 0's "Spec006 Signal Table Audit",
    // approved 2026-09-02). Widening this count is a deliberate approval
    // decision each time, not something that should pass by accident —
    // if this fails, a new table was added without updating this guardrail.
    expect(mocks.raw).toHaveBeenCalledTimes(6);
    const sql = mocks.raw.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain("gold_fred_latest_observation");
    expect(sql).toContain("gold_release_calendar");
    expect(sql).toContain("gold_macro_category_summary");
    expect(sql).toContain("gold_credit_spread_daily");
    expect(sql).toContain("gold_funding_stress_daily");
    expect(sql).toContain("gold_treasury_curve_metrics");
    expect(sql).not.toContain("bilello");
    expect(sql).not.toContain("snapshot");
    expect(sql).not.toContain("src/data/market");
  });
});
