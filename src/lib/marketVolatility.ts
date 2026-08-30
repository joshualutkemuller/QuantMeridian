export type MarketVolAlignmentMode = "research" | "tradability";
export type MarketVolSignalMode = "above_mean" | "cross_above";
export type MarketVolSource = "DB" | "ERR";

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
}

export interface MarketVolDiagnostics {
  droppedRows: number;
  missingVixStart: number;
  missingVixEndpoint: number;
  insufficientTrailingMean: number;
  missingActionableDate: number;
  confidenceIntervalMethod: "wilson";
  warnings: string[];
}

export interface MarketVolStats {
  unconditional: HitRateStats;
  conditional: HitRateStats;
  liftPctPoints: number | null;
  meanVixPointChange: number | null;
  medianVixPointChange: number | null;
  meanVixPctChange: number | null;
  medianVixPctChange: number | null;
  reservePctChangeVixPointChangeCorr: number | null;
  claimThresholdPct: number;
  claimDeltaPctPoints: number | null;
}

export interface ComputeReserveVixExperimentInput {
  reserves: MarketVolSeriesPoint[];
  vix: MarketVolSeriesPoint[];
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
    reservesRows: number;
    vixRows: number;
    latestReserveDate: string | null;
    latestVixDate: string | null;
  };
  stats: MarketVolStats;
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

function firstOnOrAfter(rows: MarketVolSeriesPoint[], date: string): MarketVolSeriesPoint | null {
  const target = parseDate(date);
  for (const row of rows) {
    if (parseDate(row.date) >= target) return row;
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

function hitRate(rows: ReserveVixExperimentRow[]): HitRateStats {
  const n = rows.length;
  const hits = rows.filter((row) => row.vixFell).length;
  const ci = wilsonInterval(hits, n);
  return {
    n,
    hits,
    hitRatePct: n ? (hits / n) * 100 : null,
    ciLowPct: ci.lowPct,
    ciHighPct: ci.highPct,
  };
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

function emptyResult(input: Required<Pick<ComputeReserveVixExperimentInput, "alignmentMode" | "signalMode" | "forwardDays" | "claimThresholdPct">> & { startDate: string; endDate: string }, reservesRows: MarketVolSeriesPoint[], vixRows: MarketVolSeriesPoint[], diagnostics: MarketVolDiagnostics, error?: string): ComputeReserveVixExperimentResult {
  const emptyStats = hitRate([]);
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
      reservesRows: reservesRows.length,
      vixRows: vixRows.length,
      latestReserveDate: latestDate(reservesRows),
      latestVixDate: latestDate(vixRows),
    },
    stats: {
      unconditional: emptyStats,
      conditional: emptyStats,
      liftPctPoints: null,
      meanVixPointChange: null,
      medianVixPointChange: null,
      meanVixPctChange: null,
      medianVixPctChange: null,
      reservePctChangeVixPointChangeCorr: null,
      claimThresholdPct: input.claimThresholdPct,
      claimDeltaPctPoints: null,
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
    confidenceIntervalMethod: "wilson",
    warnings: [],
  };
  const normalized = { alignmentMode, signalMode, forwardDays, claimThresholdPct, startDate, endDate };

  if (forwardDays !== 7 && forwardDays !== 14) {
    return emptyResult(normalized, reserves, vix, diagnostics, "forwardDays must be 7 or 14.");
  }
  if (!reserves.length || !vix.length) {
    return emptyResult(normalized, reserves, vix, diagnostics, "WRESBAL and VIXCLS observations are required.");
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

    const vixStart = firstOnOrAfter(vix, anchorDate);
    if (!vixStart) {
      diagnostics.missingVixStart += 1;
      diagnostics.droppedRows += 1;
      continue;
    }

    const endpointDate = addDays(anchorDate, forwardDays);
    const vixEnd = firstOnOrAfter(vix, endpointDate);
    if (!vixEnd) {
      diagnostics.missingVixEndpoint += 1;
      diagnostics.droppedRows += 1;
      continue;
    }

    const vixPointChange = vixEnd.value - vixStart.value;
    const vixPctChange = vixStart.value !== 0 ? ((vixEnd.value / vixStart.value) - 1) * 100 : null;
    const signalEligible = signalMode === "above_mean" ? reserveAboveMean : crossAbove;

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
    });
  }

  const conditionalRows = signalMode === "cross_above"
    ? nonOverlapping(rows.filter((row) => row.signalEligible))
    : rows.filter((row) => row.signalEligible);
  const unconditional = hitRate(rows);
  const conditional = hitRate(conditionalRows);
  const liftPctPoints = unconditional.hitRatePct !== null && conditional.hitRatePct !== null
    ? conditional.hitRatePct - unconditional.hitRatePct
    : null;
  const pointChanges = conditionalRows.map((row) => row.vixPointChange).filter(isFiniteNumber);
  const pctChanges = conditionalRows.map((row) => row.vixPctChange).filter(isFiniteNumber);
  const corrPairs = rows
    .map((row) => ({ x: row.reservePctChange, y: row.vixPointChange }))
    .filter((row): row is { x: number; y: number } => isFiniteNumber(row.x) && isFiniteNumber(row.y));

  if (alignmentMode === "tradability" && diagnostics.missingActionableDate > 0) {
    diagnostics.warnings.push("Some rows were dropped because no approved actionable release date was provided.");
  }
  if (diagnostics.missingVixEndpoint > 0) {
    diagnostics.warnings.push("Some rows were dropped because the forward VIX endpoint was unavailable.");
  }

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
      reservesRows: reserves.length,
      vixRows: vix.length,
      latestReserveDate: latestDate(reserves),
      latestVixDate: latestDate(vix),
    },
    stats: {
      unconditional,
      conditional,
      liftPctPoints,
      meanVixPointChange: mean(pointChanges),
      medianVixPointChange: median(pointChanges),
      meanVixPctChange: mean(pctChanges),
      medianVixPctChange: median(pctChanges),
      reservePctChangeVixPointChangeCorr: pearson(corrPairs.map((row) => row.x), corrPairs.map((row) => row.y)),
      claimThresholdPct,
      claimDeltaPctPoints: conditional.hitRatePct === null ? null : conditional.hitRatePct - claimThresholdPct,
    },
    rows,
    diagnostics,
    citations: RESERVE_VIX_CITATIONS,
    error: rows.length ? undefined : "No eligible reserve/VIX experiment rows found.",
  };
}
