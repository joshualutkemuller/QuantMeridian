export type MarketVolAlignmentMode = "research" | "tradability";
export type MarketVolSignalMode = "above_mean" | "cross_above";
export type MarketVolSource = "DB" | "ERR" | "UNAVAILABLE";

export interface MarketVolSeriesPoint {
  date: string;
  value: number;
  actionableDate?: string | null;
}

export interface HitRateStats {
  n: number;
  hits: number;
  hitRatePct: number | null;
  ciLowPct: number | null;
  ciHighPct: number | null;
}

export interface Citation {
  seriesId: string;
  title: string;
  source: string;
  url: string;
  note?: string;
}

export interface ReserveVixExperimentRow {
  observationDate: string;
  anchorDate: string;
  actionableDate: string | null;
  reserveValue: number;
  trailing12WeekMean: number;
  reserveAboveMean: boolean;
  reservePctChange: number | null;
  crossAbove: boolean;
  signalEligible: boolean;
  vixStartDate: string;
  vixStart: number;
  vixEndDate: string;
  vixEnd: number;
  forwardDays: 7 | 14;
  vixPointChange: number;
  vixPctChange: number | null;
  vixFell: boolean;
  spxStartDate?: string;
  spxStart?: number;
  spxEndDate?: string;
  spxEnd?: number;
  spxPctChange?: number | null;
  spxRose?: boolean;
}

export interface MarketVolDiagnostics {
  droppedRows: number;
  missingVixStart: number;
  missingVixEndpoint: number;
  insufficientTrailingMean: number;
  missingActionableDate: number;
  missingSpxStart: number;
  missingSpxEndpoint: number;
  confidenceIntervalMethod: "wilson";
  warnings: string[];
}

export type VixRegimeId = "lt15" | "15_20" | "20_30" | "gte30";

export interface VixRegimeStats {
  id: VixRegimeId;
  label: string;
  all: HitRateStats;
  signal: HitRateStats;
  liftPctPoints: number | null;
  meanVixPointChange: number | null;
  spxRiseRatePct: number | null;
  meanSpxPctChange: number | null;
}

export interface MarketVolStats {
  unconditional: HitRateStats;
  conditional: HitRateStats;
  spxUnconditionalRise: HitRateStats;
  spxConditionalRise: HitRateStats;
  liftPctPoints: number | null;
  meanVixPointChange: number | null;
  medianVixPointChange: number | null;
  meanVixPctChange: number | null;
  medianVixPctChange: number | null;
  meanSpxPctChange: number | null;
  medianSpxPctChange: number | null;
  reservePctChangeVixPointChangeCorr: number | null;
  claimThresholdPct: number;
  claimDeltaPctPoints: number | null;
  vixRegimes: VixRegimeStats[];
}

export type MarketVolBias = "risk_on" | "neutral" | "risk_off" | "unavailable";
export type MarketVolConfidence = "low" | "medium" | "high";
export type MarketVolVerdict =
  | "Unavailable"
  | "Insufficient Sample"
  | "No Meaningful Edge"
  | "Weak Lower-Vol Association"
  | "Potential Context Signal"
  | "Risk-Off / No Short-Vol Support";

export interface MarketVolReadout {
  verdict: MarketVolVerdict;
  bias: MarketVolBias;
  confidence: MarketVolConfidence;
  ciOverlap: boolean | null;
  evidence: {
    baseRatePct: number | null;
    signalRatePct: number | null;
    liftPctPoints: number | null;
    signalN: number;
    meanVixPointChange: number | null;
    spxRiseRatePct: number | null;
    meanSpxPctChange: number | null;
    claimDeltaPctPoints: number | null;
  };
  notes: string[];
}

export interface ComputeReserveVixExperimentInput {
  reserves: MarketVolSeriesPoint[];
  vix: MarketVolSeriesPoint[];
  spx?: MarketVolSeriesPoint[];
  startDate?: string;
  endDate?: string;
  alignmentMode?: MarketVolAlignmentMode;
  signalMode?: MarketVolSignalMode;
  forwardDays?: 7 | 14;
  claimThresholdPct?: number;
}

export interface ComputeReserveVixExperimentResult {
  source: MarketVolSource;
  experimentId: "reserve-vix";
  mode: MarketVolAlignmentMode;
  signal: MarketVolSignalMode;
  forwardDays: 7 | 14;
  dateRange: { start: string; end: string };
  inputs: {
    reservesSeriesId: "WRESBAL";
    vixSeriesId: "VIXCLS";
    spxSeriesId: "SP500";
    reservesRows: number;
    vixRows: number;
    spxRows: number;
    latestReserveDate: string | null;
    latestVixDate: string | null;
    latestSpxDate: string | null;
  };
  stats: MarketVolStats;
  readout: MarketVolReadout;
  series: {
    vix: MarketVolSeriesPoint[];
    spx: MarketVolSeriesPoint[];
  };
  rows: ReserveVixExperimentRow[];
  diagnostics: MarketVolDiagnostics;
  citations: Citation[];
  error?: string;
}

const DAY_MS = 86_400_000;
const DEFAULT_START = "2009-01-01";
const DEFAULT_CLAIM_THRESHOLD = 71;

export const RESERVE_VIX_CITATIONS: Citation[] = [
  {
    seriesId: "WRESBAL",
    title: "Reserve Balances with Federal Reserve Banks: Week Average",
    source: "Board of Governors of the Federal Reserve System (US), retrieved from FRED, Federal Reserve Bank of St. Louis",
    url: "https://fred.stlouisfed.org/series/WRESBAL",
  },
  {
    seriesId: "VIXCLS",
    title: "CBOE Volatility Index: VIX",
    source: "Chicago Board Options Exchange, retrieved from FRED, Federal Reserve Bank of St. Louis",
    url: "https://fred.stlouisfed.org/series/VIXCLS",
    note: "FRED displays CBOE copyright/reprint notes for this series; externally shared exports should respect applicable FRED and CBOE usage terms.",
  },
  {
    seriesId: "SP500",
    title: "S&P 500",
    source: "S&P Dow Jones Indices LLC, retrieved from FRED, Federal Reserve Bank of St. Louis",
    url: "https://fred.stlouisfed.org/series/SP500",
  },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return Number.NaN;
  const [, y, m, d] = match;
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return formatDate(parseDate(date) + days * DAY_MS);
}

function sortSeries(rows: MarketVolSeriesPoint[]): MarketVolSeriesPoint[] {
  return rows
    .filter((row) => Number.isFinite(parseDate(row.date)) && isFiniteNumber(row.value))
    .slice()
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));
}

function latestDate(rows: MarketVolSeriesPoint[]): string | null {
  return rows.length ? rows[rows.length - 1].date : null;
}

function betweenDates(rows: MarketVolSeriesPoint[], startDate: string, endDate: string): MarketVolSeriesPoint[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return rows.filter((row) => {
    const date = parseDate(row.date);
    return date >= start && date <= end;
  });
}

function firstOnOrAfterWithin(rows: MarketVolSeriesPoint[], date: string, maxLagDays: number): MarketVolSeriesPoint | null {
  const target = parseDate(date);
  const latestAllowed = target + maxLagDays * DAY_MS;
  for (const row of rows) {
    const rowDate = parseDate(row.date);
    if (rowDate < target) continue;
    return rowDate <= latestAllowed ? row : null;
  }
  return null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function wilsonInterval(hits: number, n: number, z = 1.959963984540054): { lowPct: number | null; highPct: number | null } {
  if (n <= 0) return { lowPct: null, highPct: null };
  const p = hits / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return {
    lowPct: Math.max(0, (center - margin) * 100),
    highPct: Math.min(100, (center + margin) * 100),
  };
}

function hitRateBy<T>(rows: T[], predicate: (row: T) => boolean): HitRateStats {
  const n = rows.length;
  const hits = rows.filter(predicate).length;
  const ci = wilsonInterval(hits, n);
  return {
    n,
    hits,
    hitRatePct: n ? (hits / n) * 100 : null,
    ciLowPct: ci.lowPct,
    ciHighPct: ci.highPct,
  };
}

function hitRate(rows: ReserveVixExperimentRow[]): HitRateStats {
  return hitRateBy(rows, (row) => row.vixFell);
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const xMean = mean(xs);
  const yMean = mean(ys);
  if (xMean === null || yMean === null) return null;

  let numerator = 0;
  let xDenom = 0;
  let yDenom = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const xDelta = xs[i] - xMean;
    const yDelta = ys[i] - yMean;
    numerator += xDelta * yDelta;
    xDenom += xDelta * xDelta;
    yDenom += yDelta * yDelta;
  }

  const denom = Math.sqrt(xDenom * yDenom);
  return denom === 0 ? null : numerator / denom;
}

function nonOverlapping(rows: ReserveVixExperimentRow[]): ReserveVixExperimentRow[] {
  const selected: ReserveVixExperimentRow[] = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const anchor = parseDate(row.anchorDate);
    if (anchor <= lastEnd) continue;
    selected.push(row);
    lastEnd = parseDate(row.vixEndDate);
  }
  return selected;
}

function intervalsOverlap(a: HitRateStats, b: HitRateStats): boolean | null {
  if (a.ciLowPct === null || a.ciHighPct === null || b.ciLowPct === null || b.ciHighPct === null) return null;
  return a.ciLowPct <= b.ciHighPct && b.ciLowPct <= a.ciHighPct;
}

const VIX_REGIMES: Array<{ id: VixRegimeId; label: string; test: (value: number) => boolean }> = [
  { id: "lt15", label: "VIX < 15", test: (value) => value < 15 },
  { id: "15_20", label: "15 <= VIX < 20", test: (value) => value >= 15 && value < 20 },
  { id: "20_30", label: "20 <= VIX < 30", test: (value) => value >= 20 && value < 30 },
  { id: "gte30", label: "VIX >= 30", test: (value) => value >= 30 },
];

function signalRowsForMode(rows: ReserveVixExperimentRow[], signalMode: MarketVolSignalMode): ReserveVixExperimentRow[] {
  const eligible = rows.filter((row) => row.signalEligible);
  return signalMode === "cross_above" ? nonOverlapping(eligible) : eligible;
}

function spxRowsWithOutcomes(rows: ReserveVixExperimentRow[]): Array<ReserveVixExperimentRow & { spxRose: boolean; spxPctChange: number }> {
  return rows.filter((row): row is ReserveVixExperimentRow & { spxRose: boolean; spxPctChange: number } => (
    typeof row.spxRose === "boolean" && isFiniteNumber(row.spxPctChange)
  ));
}

function buildVixRegimes(rows: ReserveVixExperimentRow[], signalMode: MarketVolSignalMode): VixRegimeStats[] {
  return VIX_REGIMES.map(({ id, label, test }) => {
    const allRows = rows.filter((row) => test(row.vixStart));
    const signalRows = signalRowsForMode(allRows, signalMode);
    const all = hitRate(allRows);
    const signal = hitRate(signalRows);
    const signalSpxRows = spxRowsWithOutcomes(signalRows);
    const liftPctPoints = all.hitRatePct !== null && signal.hitRatePct !== null
      ? signal.hitRatePct - all.hitRatePct
      : null;

    return {
      id,
      label,
      all,
      signal,
      liftPctPoints,
      meanVixPointChange: mean(signalRows.map((row) => row.vixPointChange).filter(isFiniteNumber)),
      spxRiseRatePct: hitRateBy(signalSpxRows, (row) => row.spxRose).hitRatePct,
      meanSpxPctChange: mean(signalSpxRows.map((row) => row.spxPctChange)),
    };
  });
}

export function buildReserveVixReadout(stats: MarketVolStats): MarketVolReadout {
  const signalN = stats.conditional.n;
  const ciOverlap = intervalsOverlap(stats.unconditional, stats.conditional);
  const lift = stats.liftPctPoints;
  const meanVix = stats.meanVixPointChange;
  const notes: string[] = [];
  const evidence = {
    baseRatePct: stats.unconditional.hitRatePct,
    signalRatePct: stats.conditional.hitRatePct,
    liftPctPoints: lift,
    signalN,
    meanVixPointChange: meanVix,
    spxRiseRatePct: stats.spxConditionalRise.hitRatePct,
    meanSpxPctChange: stats.meanSpxPctChange,
    claimDeltaPctPoints: stats.claimDeltaPctPoints,
  };

  if (stats.unconditional.hitRatePct === null || stats.conditional.hitRatePct === null || lift === null) {
    return {
      verdict: "Unavailable",
      bias: "unavailable",
      confidence: "low",
      ciOverlap,
      evidence,
      notes: ["Gold DB data is unavailable or produced no eligible signal rows."],
    };
  }

  if (signalN < 30) {
    notes.push("Signal n is below 30 observations; treat the readout as exploratory.");
    return {
      verdict: "Insufficient Sample",
      bias: "neutral",
      confidence: "low",
      ciOverlap,
      evidence,
      notes,
    };
  }

  if (ciOverlap) {
    notes.push("Base-rate and signal-rate confidence intervals overlap.");
  }
  if (stats.claimDeltaPctPoints !== null && stats.claimDeltaPctPoints < -5) {
    notes.push("Observed signal rate is well below the claim threshold.");
  }

  const lowerVolSupport = lift >= 3 && (meanVix === null || meanVix < 0);
  const adverseSupport = lift <= -3 || (meanVix !== null && meanVix > 0.25);
  const confidence: MarketVolConfidence = !ciOverlap && signalN >= 150 && Math.abs(lift) >= 6 ? "medium" : "low";

  if (lowerVolSupport && lift >= 6) {
    return {
      verdict: "Potential Context Signal",
      bias: "risk_on",
      confidence,
      ciOverlap,
      evidence,
      notes,
    };
  }

  if (lowerVolSupport) {
    return {
      verdict: "Weak Lower-Vol Association",
      bias: "risk_on",
      confidence: "low",
      ciOverlap,
      evidence,
      notes,
    };
  }

  if (adverseSupport) {
    return {
      verdict: "Risk-Off / No Short-Vol Support",
      bias: "risk_off",
      confidence,
      ciOverlap,
      evidence,
      notes,
    };
  }

  return {
    verdict: "No Meaningful Edge",
    bias: "neutral",
    confidence: "low",
    ciOverlap,
    evidence,
    notes,
  };
}

function emptyResult(input: Required<Pick<ComputeReserveVixExperimentInput, "alignmentMode" | "signalMode" | "forwardDays" | "claimThresholdPct">> & { startDate: string; endDate: string }, reservesRows: MarketVolSeriesPoint[], vixRows: MarketVolSeriesPoint[], spxRows: MarketVolSeriesPoint[], diagnostics: MarketVolDiagnostics, error?: string): ComputeReserveVixExperimentResult {
  const emptyStats = hitRate([]);
  const stats: MarketVolStats = {
    unconditional: emptyStats,
    conditional: emptyStats,
    spxUnconditionalRise: emptyStats,
    spxConditionalRise: emptyStats,
    liftPctPoints: null,
    meanVixPointChange: null,
    medianVixPointChange: null,
    meanVixPctChange: null,
    medianVixPctChange: null,
    meanSpxPctChange: null,
    medianSpxPctChange: null,
    reservePctChangeVixPointChangeCorr: null,
    claimThresholdPct: input.claimThresholdPct,
    claimDeltaPctPoints: null,
    vixRegimes: buildVixRegimes([], input.signalMode),
  };
  return {
    source: "ERR",
    experimentId: "reserve-vix",
    mode: input.alignmentMode,
    signal: input.signalMode,
    forwardDays: input.forwardDays,
    dateRange: { start: input.startDate, end: input.endDate },
    inputs: {
      reservesSeriesId: "WRESBAL",
      vixSeriesId: "VIXCLS",
      spxSeriesId: "SP500",
      reservesRows: reservesRows.length,
      vixRows: vixRows.length,
      spxRows: spxRows.length,
      latestReserveDate: latestDate(reservesRows),
      latestVixDate: latestDate(vixRows),
      latestSpxDate: latestDate(spxRows),
    },
    stats,
    readout: buildReserveVixReadout(stats),
    series: {
      vix: betweenDates(vixRows, input.startDate, input.endDate),
      spx: betweenDates(spxRows, input.startDate, input.endDate),
    },
    rows: [],
    diagnostics,
    citations: RESERVE_VIX_CITATIONS,
    error,
  };
}

export function computeReserveVixExperiment(input: ComputeReserveVixExperimentInput): ComputeReserveVixExperimentResult {
  const reserves = sortSeries(input.reserves);
  const vix = sortSeries(input.vix);
  const spx = sortSeries(input.spx ?? []);
  const alignmentMode = input.alignmentMode ?? "research";
  const signalMode = input.signalMode ?? "above_mean";
  const forwardDays = input.forwardDays ?? 7;
  const claimThresholdPct = input.claimThresholdPct ?? DEFAULT_CLAIM_THRESHOLD;
  const startDate = input.startDate ?? DEFAULT_START;
  const latestVix = latestDate(vix);
  const endDate = input.endDate ?? latestVix ?? startDate;
  const diagnostics: MarketVolDiagnostics = {
    droppedRows: 0,
    missingVixStart: 0,
    missingVixEndpoint: 0,
    insufficientTrailingMean: 0,
    missingActionableDate: 0,
    missingSpxStart: 0,
    missingSpxEndpoint: 0,
    confidenceIntervalMethod: "wilson",
    warnings: [],
  };
  const normalized = { alignmentMode, signalMode, forwardDays, claimThresholdPct, startDate, endDate };

  if (forwardDays !== 7 && forwardDays !== 14) {
    return emptyResult(normalized, reserves, vix, spx, diagnostics, "forwardDays must be 7 or 14.");
  }
  if (!reserves.length || !vix.length) {
    return emptyResult(normalized, reserves, vix, spx, diagnostics, "WRESBAL and VIXCLS observations are required.");
  }

  const rows: ReserveVixExperimentRow[] = [];
  let priorEligibleAbove: boolean | null = null;

  for (let i = 0; i < reserves.length; i += 1) {
    const reserve = reserves[i];
    const withinDateRange = parseDate(reserve.date) >= parseDate(startDate) && parseDate(reserve.date) <= parseDate(endDate);

    const trailing = reserves.slice(0, i).slice(-12);
    if (trailing.length < 12) {
      if (withinDateRange) {
        diagnostics.insufficientTrailingMean += 1;
        diagnostics.droppedRows += 1;
      }
      continue;
    }

    const trailing12WeekMean = mean(trailing.map((row) => row.value));
    if (trailing12WeekMean === null) {
      if (withinDateRange) {
        diagnostics.insufficientTrailingMean += 1;
        diagnostics.droppedRows += 1;
      }
      continue;
    }

    const prior = reserves[i - 1];
    const reservePctChange = prior && prior.value !== 0 ? ((reserve.value / prior.value) - 1) * 100 : null;
    const reserveAboveMean = reserve.value > trailing12WeekMean;
    const crossAbove = reserveAboveMean && priorEligibleAbove !== true;
    priorEligibleAbove = reserveAboveMean;

    if (!withinDateRange) continue;

    const actionableDate = reserve.actionableDate ?? null;
    const anchorDate = alignmentMode === "tradability" ? actionableDate : reserve.date;
    if (!anchorDate) {
      diagnostics.missingActionableDate += 1;
      diagnostics.droppedRows += 1;
      continue;
    }

    const vixStart = firstOnOrAfterWithin(vix, anchorDate, 7);
    if (!vixStart) {
      diagnostics.missingVixStart += 1;
      diagnostics.droppedRows += 1;
      continue;
    }

    const endpointDate = addDays(anchorDate, forwardDays);
    const vixEnd = firstOnOrAfterWithin(vix, endpointDate, 7);
    if (!vixEnd) {
      diagnostics.missingVixEndpoint += 1;
      diagnostics.droppedRows += 1;
      continue;
    }

    const vixPointChange = vixEnd.value - vixStart.value;
    const vixPctChange = vixStart.value !== 0 ? ((vixEnd.value / vixStart.value) - 1) * 100 : null;
    const signalEligible = signalMode === "above_mean" ? reserveAboveMean : crossAbove;
    const spxStart = spx.length ? firstOnOrAfterWithin(spx, anchorDate, 7) : null;
    let spxFields: Pick<ReserveVixExperimentRow, "spxStartDate" | "spxStart" | "spxEndDate" | "spxEnd" | "spxPctChange" | "spxRose"> = {};

    if (spx.length && !spxStart) {
      diagnostics.missingSpxStart += 1;
    } else if (spxStart) {
      const spxEnd = firstOnOrAfterWithin(spx, endpointDate, 7);
      if (!spxEnd) {
        diagnostics.missingSpxEndpoint += 1;
      } else {
        const spxPctChange = spxStart.value !== 0 ? ((spxEnd.value / spxStart.value) - 1) * 100 : null;
        spxFields = {
          spxStartDate: spxStart.date,
          spxStart: spxStart.value,
          spxEndDate: spxEnd.date,
          spxEnd: spxEnd.value,
          spxPctChange,
          spxRose: spxEnd.value > spxStart.value,
        };
      }
    }

    rows.push({
      observationDate: reserve.date,
      anchorDate,
      actionableDate,
      reserveValue: reserve.value,
      trailing12WeekMean,
      reserveAboveMean,
      reservePctChange,
      crossAbove,
      signalEligible,
      vixStartDate: vixStart.date,
      vixStart: vixStart.value,
      vixEndDate: vixEnd.date,
      vixEnd: vixEnd.value,
      forwardDays,
      vixPointChange,
      vixPctChange,
      vixFell: vixPointChange < 0,
      ...spxFields,
    });
  }

  const conditionalRows = signalRowsForMode(rows, signalMode);
  const unconditional = hitRate(rows);
  const conditional = hitRate(conditionalRows);
  const spxUnconditionalRows = spxRowsWithOutcomes(rows);
  const spxConditionalRows = spxRowsWithOutcomes(conditionalRows);
  const liftPctPoints = unconditional.hitRatePct !== null && conditional.hitRatePct !== null
    ? conditional.hitRatePct - unconditional.hitRatePct
    : null;
  const pointChanges = conditionalRows.map((row) => row.vixPointChange).filter(isFiniteNumber);
  const pctChanges = conditionalRows.map((row) => row.vixPctChange).filter(isFiniteNumber);
  const spxPctChanges = spxConditionalRows.map((row) => row.spxPctChange);
  const corrPairs = rows
    .map((row) => ({ x: row.reservePctChange, y: row.vixPointChange }))
    .filter((row): row is { x: number; y: number } => isFiniteNumber(row.x) && isFiniteNumber(row.y));

  if (alignmentMode === "tradability" && diagnostics.missingActionableDate > 0) {
    diagnostics.warnings.push("Some rows were dropped because no approved actionable release date was provided.");
  }
  if (diagnostics.missingVixEndpoint > 0) {
    diagnostics.warnings.push("Some rows were dropped because the forward VIX endpoint was unavailable.");
  }
  if (diagnostics.missingSpxStart > 0 || diagnostics.missingSpxEndpoint > 0) {
    diagnostics.warnings.push("Some rows have no matched SP500 forward outcome; SPX outcome rates use the matched subset.");
  }
  const stats: MarketVolStats = {
    unconditional,
    conditional,
    spxUnconditionalRise: hitRateBy(spxUnconditionalRows, (row) => row.spxRose),
    spxConditionalRise: hitRateBy(spxConditionalRows, (row) => row.spxRose),
    liftPctPoints,
    meanVixPointChange: mean(pointChanges),
    medianVixPointChange: median(pointChanges),
    meanVixPctChange: mean(pctChanges),
    medianVixPctChange: median(pctChanges),
    meanSpxPctChange: mean(spxPctChanges),
    medianSpxPctChange: median(spxPctChanges),
    reservePctChangeVixPointChangeCorr: pearson(corrPairs.map((row) => row.x), corrPairs.map((row) => row.y)),
    claimThresholdPct,
    claimDeltaPctPoints: conditional.hitRatePct === null ? null : conditional.hitRatePct - claimThresholdPct,
    vixRegimes: buildVixRegimes(rows, signalMode),
  };

  return {
    source: rows.length ? "DB" : "ERR",
    experimentId: "reserve-vix",
    mode: alignmentMode,
    signal: signalMode,
    forwardDays,
    dateRange: { start: startDate, end: endDate },
    inputs: {
      reservesSeriesId: "WRESBAL",
      vixSeriesId: "VIXCLS",
      spxSeriesId: "SP500",
      reservesRows: reserves.length,
      vixRows: vix.length,
      spxRows: spx.length,
      latestReserveDate: latestDate(reserves),
      latestVixDate: latestDate(vix),
      latestSpxDate: latestDate(spx),
    },
    stats,
    readout: buildReserveVixReadout(stats),
    series: {
      vix: betweenDates(vix, startDate, endDate),
      spx: betweenDates(spx, startDate, endDate),
    },
    rows,
    diagnostics,
    citations: RESERVE_VIX_CITATIONS,
    error: rows.length ? undefined : "No eligible reserve/VIX experiment rows found.",
  };
}
