import { describe, expect, test } from "vitest";
import { buildReserveVixReadout, computeReserveVixExperiment, wilsonInterval, type MarketVolSeriesPoint, type MarketVolStats } from "./marketVolatility";

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
    expect(result.series.vix[0]).toMatchObject({ date: "2026-03-01" });
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

  test("computes matched SPX forward outcomes without changing VIX row eligibility", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 150]);
    const result = computeReserveVixExperiment({
      reserves,
      vix: dailyVix({
        "2026-04-01": 20,
        "2026-04-08": 19,
      }),
      spx: dailyVix({
        "2026-04-01": 1000,
        "2026-04-08": 1010,
      }),
      startDate: "2026-04-01",
      forwardDays: 7,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].spxStartDate).toBe("2026-04-01");
    expect(result.rows[0].spxEndDate).toBe("2026-04-08");
    expect(result.rows[0].spxPctChange).toBeCloseTo(1, 6);
    expect(result.rows[0].spxRose).toBe(true);
    expect(result.stats.spxConditionalRise).toMatchObject({ n: 1, hits: 1, hitRatePct: 100 });
    expect(result.stats.meanSpxPctChange).toBeCloseTo(1, 6);
  });

  test("does not match distant future SPX rows to earlier reserve anchors", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 150]);
    const result = computeReserveVixExperiment({
      reserves,
      vix: dailyVix({
        "2026-04-01": 20,
        "2026-04-08": 19,
      }),
      spx: dailyVix({
        "2026-06-01": 1000,
        "2026-06-08": 1010,
      }),
      startDate: "2026-04-01",
      forwardDays: 7,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].spxStartDate).toBeUndefined();
    expect(result.stats.spxConditionalRise.n).toBe(0);
    expect(result.diagnostics.missingSpxStart).toBe(1);
    expect(result.diagnostics.warnings).toContain("Some rows have no matched SP500 forward outcome; SPX outcome rates use the matched subset.");
  });

  test("segments signal performance by VIX level regime", () => {
    const reserves = weeklyReserves([...Array(12).fill(100), 150, 160, 170, 180]);
    const result = computeReserveVixExperiment({
      reserves,
      vix: dailyVix({
        "2026-04-01": 14,
        "2026-04-08": 17,
        "2026-04-15": 25,
        "2026-04-22": 35,
        "2026-04-29": 32,
      }),
      spx: dailyVix({
        "2026-04-01": 100,
        "2026-04-08": 101,
        "2026-04-15": 103,
        "2026-04-22": 102,
        "2026-04-29": 104,
      }),
      startDate: "2026-04-01",
      forwardDays: 7,
    });

    expect(result.stats.vixRegimes.map((row) => row.label)).toEqual([
      "VIX < 15",
      "15 <= VIX < 20",
      "20 <= VIX < 30",
      "VIX >= 30",
    ]);
    expect(result.stats.vixRegimes.map((row) => row.signal.n)).toEqual([1, 1, 1, 1]);
    expect(result.stats.vixRegimes[0].signal.hitRatePct).toBe(0);
    expect(result.stats.vixRegimes[3].signal.hitRatePct).toBe(100);
    expect(result.stats.vixRegimes[3].spxRiseRatePct).toBe(100);
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
    expect(result.series.vix).toEqual([{ date: "2026-04-01", value: 20 }]);
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

function stats(overrides: Partial<MarketVolStats>): MarketVolStats {
  return {
    unconditional: { n: 100, hits: 53, hitRatePct: 53, ciLowPct: 48, ciHighPct: 58 },
    conditional: { n: 80, hits: 43, hitRatePct: 54, ciLowPct: 47, ciHighPct: 61 },
    spxUnconditionalRise: { n: 100, hits: 55, hitRatePct: 55, ciLowPct: 50, ciHighPct: 60 },
    spxConditionalRise: { n: 80, hits: 45, hitRatePct: 56.25, ciLowPct: 49, ciHighPct: 63 },
    liftPctPoints: 1,
    meanVixPointChange: -0.1,
    medianVixPointChange: -0.1,
    meanVixPctChange: null,
    medianVixPctChange: null,
    meanSpxPctChange: 0.2,
    medianSpxPctChange: 0.1,
    reservePctChangeVixPointChangeCorr: null,
    claimThresholdPct: 71,
    claimDeltaPctPoints: -17,
    vixRegimes: [],
    ...overrides,
  };
}

describe("buildReserveVixReadout", () => {
  test("classifies unavailable stats with no eligible signal rows", () => {
    const readout = buildReserveVixReadout(stats({
      unconditional: { n: 0, hits: 0, hitRatePct: null, ciLowPct: null, ciHighPct: null },
      conditional: { n: 0, hits: 0, hitRatePct: null, ciLowPct: null, ciHighPct: null },
      liftPctPoints: null,
      claimDeltaPctPoints: null,
    }));

    expect(readout.verdict).toBe("Unavailable");
    expect(readout.bias).toBe("unavailable");
  });

  test("classifies strong lower-vol evidence as a context signal", () => {
    const readout = buildReserveVixReadout(stats({
      unconditional: { n: 900, hits: 477, hitRatePct: 53, ciLowPct: 50, ciHighPct: 56 },
      conditional: { n: 260, hits: 159, hitRatePct: 61, ciLowPct: 57, ciHighPct: 65 },
      liftPctPoints: 8,
      meanVixPointChange: -0.7,
      claimDeltaPctPoints: -10,
    }));

    expect(readout.verdict).toBe("Potential Context Signal");
    expect(readout.bias).toBe("risk_on");
    expect(readout.confidence).toBe("medium");
    expect(readout.ciOverlap).toBe(false);
  });

  test("classifies small lift with overlapping intervals as no meaningful edge", () => {
    const readout = buildReserveVixReadout(stats({}));

    expect(readout.verdict).toBe("No Meaningful Edge");
    expect(readout.bias).toBe("neutral");
    expect(readout.notes).toContain("Base-rate and signal-rate confidence intervals overlap.");
  });

  test("classifies adverse evidence as risk-off or no short-vol support", () => {
    const readout = buildReserveVixReadout(stats({
      conditional: { n: 140, hits: 63, hitRatePct: 45, ciLowPct: 39, ciHighPct: 51 },
      liftPctPoints: -8,
      meanVixPointChange: 0.8,
      claimDeltaPctPoints: -26,
    }));

    expect(readout.verdict).toBe("Risk-Off / No Short-Vol Support");
    expect(readout.bias).toBe("risk_off");
  });
});
