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

function goldRows() {
  const reserves = Array.from({ length: 14 }, (_, index) => ({
    series_id: "WRESBAL",
    date: dateFrom("2026-01-07", index * 7),
    value: index < 12 ? 100 : 110 + index,
    realtime_start: dateFrom("2026-01-07", index * 7),
  }));
  const vix = Array.from({ length: 120 }, (_, index) => ({
    series_id: "VIXCLS",
    date: dateFrom("2026-01-07", index),
    value: 30 - index * 0.05,
    realtime_start: dateFrom("2026-01-07", index),
  }));
  return [...reserves, ...vix];
}

async function callReserveVix(path = "http://local.test/api/market-volatility/reserve-vix?start=2026-03-01") {
  const res = await GET(new Request(path));
  return res.json();
}

describe("/api/market-volatility/reserve-vix", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.goldEnabled.mockReturnValue(true);
    mocks.raw.mockResolvedValue(goldRows());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns ERR without SIM fallback when Gold DB is not configured", async () => {
    mocks.goldEnabled.mockReturnValue(false);

    const body = await callReserveVix();

    expect(body.source).toBe("ERR");
    expect(body.rows).toEqual([]);
    expect(body.error).toBe("MACRO_DB_URL not configured.");
    expect(mocks.raw).not.toHaveBeenCalled();
  });

  test("returns an explicit error when WRESBAL rows are missing", async () => {
    mocks.raw.mockResolvedValue(goldRows().filter((row) => row.series_id !== "WRESBAL"));

    const body = await callReserveVix();

    expect(body.source).toBe("ERR");
    expect(body.error).toBe("No Gold DB observations found for WRESBAL.");
  });

  test("returns an explicit error when VIXCLS rows are missing", async () => {
    mocks.raw.mockResolvedValue(goldRows().filter((row) => row.series_id !== "VIXCLS"));

    const body = await callReserveVix();

    expect(body.source).toBe("ERR");
    expect(body.error).toBe("No Gold DB observations found for VIXCLS.");
  });

  test("returns Gold-sourced reserve/VIX stats, diagnostics, rows, and citations", async () => {
    const body = await callReserveVix("http://local.test/api/market-volatility/reserve-vix?start=2026-03-01&forwardDays=7&signal=above_mean");

    expect(body.source).toBe("DB");
    expect(body.experimentId).toBe("reserve-vix");
    expect(body.mode).toBe("research");
    expect(body.forwardDays).toBe(7);
    expect(body.stats.unconditional.n).toBeGreaterThan(0);
    expect(body.stats.conditional.n).toBeGreaterThan(0);
    expect(body.diagnostics.confidenceIntervalMethod).toBe("wilson");
    expect(body.citations.map((citation: { seriesId: string }) => citation.seriesId)).toEqual(["WRESBAL", "VIXCLS"]);
    expect(body.series.vix.length).toBeGreaterThan(0);
    expect(body.series.vix[0]).toHaveProperty("date");
    expect(body.series.vix[0]).toHaveProperty("value");
    expect(body.rows[0]).toHaveProperty("trailing12WeekMean");
    expect(mocks.raw).toHaveBeenCalledTimes(1);
    expect(String(mocks.raw.mock.calls[0][0])).toContain("gold_fred_latest_observation");
  });

  test("does not guess Tradability Mode release timing", async () => {
    const body = await callReserveVix("http://local.test/api/market-volatility/reserve-vix?mode=tradability");

    expect(body.source).toBe("ERR");
    expect(body.mode).toBe("tradability");
    expect(body.error).toBe("Tradability Mode is unavailable until approved Gold release timing is exposed.");
    expect(mocks.raw).not.toHaveBeenCalled();
  });
});
