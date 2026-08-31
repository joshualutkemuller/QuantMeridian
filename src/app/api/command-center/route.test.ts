import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  goldEnabled: vi.fn(),
  raw: vi.fn(),
}));

vi.mock("@/lib/server/goldStore", () => ({
  goldEnabled: mocks.goldEnabled,
  goldParam: (index: number) => `?${index}`,
  goldStore: () => ({ raw: mocks.raw }),
  goldTable: (table: string) => `gold_${table}`,
}));

function dateFrom(base: string, days: number): string {
  return new Date(Date.UTC(
    Number(base.slice(0, 4)),
    Number(base.slice(5, 7)) - 1,
    Number(base.slice(8, 10)) + days
  )).toISOString().slice(0, 10);
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

function observationRows() {
  return [
    ...dailyRows("SP500", "2023-01-01", 1300, 5200, 5),
    ...dailyRows("NASDAQCOM", "2026-07-01", 25, 17000, 10),
    ...dailyRows("DGS10", "2026-07-01", 25, 4.1, 0.01),
    ...dailyRows("T10Y2Y", "2026-07-01", 25, -0.2, 0.01),
    ...dailyRows("VIXCLS", "2026-07-01", 25, 19, -0.1),
    ...weeklyRows("WRESBAL", "2026-01-01", 30, 3200, 4),
    ...monthlyRows("PCEPILFE", "2025-01-01", 19, 125, 0.25),
    ...monthlyRows("UNRATE", "2025-01-01", 19, 4.4, -0.01),
    ...quarterlyRows("GDPC1", "2025-01-01", 7, 23000, 80),
    ...monthlyRows("CP0000EZ19M086NEST", "2025-01-01", 19, 121, 0.2),
    ...monthlyRows("ECBDFR", "2025-01-01", 19, 3.5, -0.03),
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

async function callCommandCenter() {
  const res = await GET();
  return res.json();
}

describe("/api/command-center", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.goldEnabled.mockReturnValue(true);
    mocks.raw.mockImplementation((sql: string) => {
      if (String(sql).includes("gold_release_calendar")) return Promise.resolve(releaseRows());
      return Promise.resolve(observationRows());
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns ERR without fallback when Gold DB is not configured", async () => {
    mocks.goldEnabled.mockReturnValue(false);

    const body = await callCommandCenter();

    expect(body.source).toBe("ERR");
    expect(body.topline).toEqual([]);
    expect(body.error).toBe("MACRO_DB_URL not configured.");
    expect(mocks.raw).not.toHaveBeenCalled();
  });

  test("returns Gold-sourced macro command center sections and catalysts", async () => {
    const body = await callCommandCenter();

    expect(body.source).toBe("DB");
    expect(body.asOf).toBeTruthy();
    expect(body.topline.map((metric: { id: string }) => metric.id)).toEqual(expect.arrayContaining(["SP500", "DGS10", "T10Y2Y", "VIXCLS", "PCEPILFE", "UNRATE"]));
    expect(body.domesticRates.map((metric: { id: string }) => metric.id)).toContain("DGS10");
    expect(body.volatility.map((metric: { id: string }) => metric.id)).toEqual(expect.arrayContaining(["VIXCLS", "WRESBAL"]));
    expect(body.domesticHealth.map((metric: { id: string }) => metric.id)).toEqual(expect.arrayContaining(["GDPC1", "PCEPILFE", "UNRATE"]));
    expect(body.globalHealth.map((metric: { id: string }) => metric.id)).toEqual(expect.arrayContaining(["CP0000EZ19M086NEST", "ECBDFR"]));
    expect(body.highLevelMarkets.map((metric: { id: string }) => metric.id)).toEqual(expect.arrayContaining(["SP500", "NASDAQCOM"]));
    const spx = body.highLevelMarkets.find((metric: { id: string }) => metric.id === "SP500");
    expect(spx.change).toBe(5);
    expect(spx.marketReturns["1D"].value).toBeCloseTo((11695 / 11690 - 1) * 100, 8);
    expect(spx.marketReturns["5D"].tradingDays).toBe(5);
    expect(spx.marketReturns["1Y"]).toMatchObject({ annualized: true, tradingDays: 252 });
    expect(spx.marketReturns["3Y"]).toMatchObject({ annualized: true, tradingDays: 756 });
    expect(spx.marketReturns["5Y"]).toMatchObject({ annualized: true, tradingDays: 1260 });
    expect(body.catalysts[0]).toMatchObject({ source: "DB", name: "Employment Situation", representativeSeriesId: "UNRATE" });
    expect(body.topline.every((metric: { source: string; asOf: string }) => metric.source === "DB" && !!metric.asOf)).toBe(true);
    expect(body.missingSeries).toContain("SOFR");
  });

  test("queries only Gold observation and release calendar tables", async () => {
    await callCommandCenter();

    expect(mocks.raw).toHaveBeenCalledTimes(2);
    expect(String(mocks.raw.mock.calls[0][0])).toContain("gold_fred_latest_observation");
    expect(String(mocks.raw.mock.calls[1][0])).toContain("gold_release_calendar");
    expect(String(mocks.raw.mock.calls[0][0])).toContain("rn <= 1500");
    expect(String(mocks.raw.mock.calls[0][0])).not.toContain("market");
    expect(String(mocks.raw.mock.calls[0][0])).not.toContain("snapshot");
  });

  test("does not synthesize missing values", async () => {
    mocks.raw.mockImplementation((sql: string) => {
      if (String(sql).includes("gold_release_calendar")) return Promise.resolve([]);
      return Promise.resolve(observationRows().filter((row) => row.series_id !== "VIXCLS"));
    });

    const body = await callCommandCenter();

    expect(body.source).toBe("DB");
    expect(body.volatility.map((metric: { id: string }) => metric.id)).not.toContain("VIXCLS");
    expect(body.missingSeries).toContain("VIXCLS");
    expect(body.warnings).toEqual(expect.arrayContaining([
      "No upcoming Gold release_calendar rows found for the next 60 days.",
    ]));
  });
});
