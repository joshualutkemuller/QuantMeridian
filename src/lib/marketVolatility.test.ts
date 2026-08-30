import { describe, expect, test } from "vitest";
import { computeReserveVixExperiment, wilsonInterval, type MarketVolSeriesPoint } from "./marketVolatility";

function dateFrom(base: string, days: number): string {
  return new Date(Date.UTC(
    Number(base.slice(0, 4)),
    Number(base.slice(5, 7)) - 1,
    Number(base.slice(8, 10)) + days
  )).toISOString().slice(0, 10);
}

function weeklyReserves(values: number[], base = "2026-01-07", withActionable = false): MarketVolSeriesPoint[] {
  return values.map((value, index) => {
    const date = dateFrom(base, index * 7);
    return {
      date,
      value,
      actionableDate: withActionable ? dateFrom(date, 1) : undefined,
    };
  });
}

function dailyVix(valuesByDate: Record<string, number>): MarketVolSeriesPoint[] {
  return Object.entries(valuesByDate).map(([date, value]) => ({ date, value }));
}

function flatDailyVix(start: string, days: number, startValue = 20): MarketVolSeriesPoint[] {
  return Array.from({ length: days }, (_, index) => ({
    date: dateFrom(start, index),
    value: startValue - index * 0.1,
  }));
}

describe("computeReserveVixExperiment", () => {
  test("uses the 12 completed reserve observations before the anchor for the trailing mean", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 200]);
    const result = computeReserveVixExperiment({
      reserves,
      vix: flatDailyVix("2026-01-07", 120),
      startDate: "2026-03-01",
      forwardDays: 7,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      observationDate: "2026-04-01",
      trailing12WeekMean: 100,
      reserveAboveMean: true,
    });
  });

  test("above-mean mode includes all eligible weekly above-mean observations", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 101, 102, 103]);
    const result = computeReserveVixExperiment({
      reserves,
      vix: flatDailyVix("2026-01-07", 130),
      startDate: "2026-03-01",
      signalMode: "above_mean",
      forwardDays: 7,
    });

    expect(result.rows).toHaveLength(3);
    expect(result.stats.conditional.n).toBe(3);
    expect(result.rows.every((row) => row.signalEligible)).toBe(true);
  });

  test("research mode chooses the first available VIX close on or after the +7 and +14 calendar-day endpoints", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 150]);
    const vix = dailyVix({
      "2026-04-01": 20,
      "2026-04-09": 19,
      "2026-04-16": 18,
    });

    const oneWeek = computeReserveVixExperiment({
      reserves,
      vix,
      startDate: "2026-04-01",
      forwardDays: 7,
    });
    const twoWeeks = computeReserveVixExperiment({
      reserves,
      vix,
      startDate: "2026-04-01",
      forwardDays: 14,
    });

    expect(oneWeek.rows[0].vixStartDate).toBe("2026-04-01");
    expect(oneWeek.rows[0].vixEndDate).toBe("2026-04-09");
    expect(twoWeeks.rows[0].vixEndDate).toBe("2026-04-16");
  });

  test("tradability mode anchors on the approved actionable date when provided", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 150], "2026-01-07", true);
    const vix = dailyVix({
      "2026-04-01": 25,
      "2026-04-02": 20,
      "2026-04-09": 19,
    });

    const result = computeReserveVixExperiment({
      reserves,
      vix,
      startDate: "2026-04-01",
      alignmentMode: "tradability",
      forwardDays: 7,
    });

    expect(result.rows[0].anchorDate).toBe("2026-04-02");
    expect(result.rows[0].vixStart).toBe(20);
    expect(result.rows[0].vixEndDate).toBe("2026-04-09");
  });

  test("cross-above mode only counts false-to-true transitions and suppresses overlapping event windows", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 200, 50, 200]);
    const result = computeReserveVixExperiment({
      reserves,
      vix: flatDailyVix("2026-01-07", 140),
      startDate: "2026-03-01",
      signalMode: "cross_above",
      forwardDays: 14,
    });

    expect(result.rows.map((row) => row.crossAbove)).toEqual([true, false, true]);
    expect(result.rows.filter((row) => row.signalEligible)).toHaveLength(2);
    expect(result.stats.conditional.n).toBe(1);
  });

  test("cross-above state uses pre-start eligible history to avoid false range-boundary events", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 200, 210]);
    const result = computeReserveVixExperiment({
      reserves,
      vix: flatDailyVix("2026-01-07", 140),
      startDate: "2026-04-08",
      signalMode: "cross_above",
      forwardDays: 7,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].reserveAboveMean).toBe(true);
    expect(result.rows[0].crossAbove).toBe(false);
    expect(result.stats.conditional.n).toBe(0);
  });

  test("drops rows with missing forward VIX endpoints and counts diagnostics", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 150]);
    const result = computeReserveVixExperiment({
      reserves,
      vix: dailyVix({ "2026-04-01": 20 }),
      startDate: "2026-04-01",
      forwardDays: 7,
    });

    expect(result.source).toBe("ERR");
    expect(result.rows).toEqual([]);
    expect(result.diagnostics.missingVixEndpoint).toBe(1);
    expect(result.diagnostics.droppedRows).toBe(1);
  });

  test("computes Wilson intervals for small samples", () => {
    const interval = wilsonInterval(3, 5);

    expect(interval.lowPct).toBeGreaterThan(20);
    expect(interval.highPct).toBeLessThan(90);
  });

  test("computes Pearson correlation from finite reserve percent changes and VIX point changes", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 100, 110, 132]);
    const result = computeReserveVixExperiment({
      reserves,
      vix: dailyVix({
        "2026-04-01": 20,
        "2026-04-08": 19,
        "2026-04-15": 19,
        "2026-04-22": 20,
      }),
      startDate: "2026-04-01",
      forwardDays: 7,
    });

    expect(result.stats.reservePctChangeVixPointChangeCorr).toBeCloseTo(1, 6);
  });

  test("reports missing actionable dates in tradability mode instead of guessing", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 150]);
    const result = computeReserveVixExperiment({
      reserves,
      vix: flatDailyVix("2026-01-07", 120),
      startDate: "2026-04-01",
      alignmentMode: "tradability",
      forwardDays: 7,
    });

    expect(result.source).toBe("ERR");
    expect(result.diagnostics.missingActionableDate).toBe(1);
    expect(result.diagnostics.warnings).toContain("Some rows were dropped because no approved actionable release date was provided.");
  });
});
