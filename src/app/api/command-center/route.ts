import {
  EMPTY_COMMAND_CENTER,
  type CommandCenterCatalyst,
  type CommandCenterChangeMode,
  type CommandCenterMetric,
  type CommandCenterPayload,
  type CommandCenterReturn,
  type CommandCenterReturnHorizon,
  type CommandCenterSection,
  type CommandCenterTone,
} from "@/lib/commandCenter";
import { goldEnabled, goldParam, goldStore, goldTable } from "@/lib/server/goldStore";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";

type Transform = "lin" | "chg" | "pch" | "pc1" | "pca";
type Frequency = "D" | "W" | "M" | "Q";

interface SeriesSpec {
  id: string;
  label: string;
  short: string;
  section: CommandCenterSection;
  transform: Transform;
  frequency: Frequency;
  unit: string;
  decimals: number;
  changeMode: CommandCenterChangeMode;
  scale?: number;
  toneDirection?: "higher_is_better" | "lower_is_better";
  topline?: boolean;
}

interface GoldObservationRow {
  series_id: string;
  date: string;
  value: number;
  realtime_start?: string | null;
}

interface GoldReleaseCalendarRow {
  release_id: number;
  release_name: string;
  release_date: string;
  importance: string | null;
  econ_category: string | null;
  representative_series_id: string | null;
  fetched_at: string | null;
}

interface DisplayPoint {
  date: string;
  value: number;
  realtimeStart: string | null;
}

const MARKET_RETURN_HORIZONS: CommandCenterReturnHorizon[] = ["1D", "5D", "MTD", "1M", "3M", "QTD", "YTD", "1Y", "3Y", "5Y"];

const SERIES_SPECS: SeriesSpec[] = [
  { id: "SP500", label: "S&P 500", short: "SPX", section: "markets", transform: "lin", frequency: "D", unit: "index", decimals: 0, changeMode: "pct", toneDirection: "higher_is_better", topline: true },
  { id: "NASDAQCOM", label: "Nasdaq Composite", short: "NDX", section: "markets", transform: "lin", frequency: "D", unit: "index", decimals: 0, changeMode: "pct", toneDirection: "higher_is_better" },
  { id: "DJIA", label: "Dow Jones Industrial Average", short: "DJIA", section: "markets", transform: "lin", frequency: "D", unit: "index", decimals: 0, changeMode: "pct", toneDirection: "higher_is_better" },
  { id: "DTWEXBGS", label: "Trade-Weighted U.S. Dollar", short: "USD", section: "markets", transform: "lin", frequency: "D", unit: "index", decimals: 1, changeMode: "pct" },
  { id: "GOLDPMGBD228NLBM", label: "Gold PM Fix", short: "Gold", section: "markets", transform: "lin", frequency: "D", unit: "$/oz", decimals: 0, changeMode: "pct" },
  { id: "DCOILWTICO", label: "WTI Crude Oil", short: "WTI", section: "markets", transform: "lin", frequency: "D", unit: "$/bbl", decimals: 2, changeMode: "pct" },

  { id: "SOFR", label: "Secured Overnight Financing Rate", short: "SOFR", section: "rates", transform: "lin", frequency: "D", unit: "%", decimals: 2, changeMode: "bps" },
  { id: "EFFR", label: "Effective Fed Funds Rate", short: "EFFR", section: "rates", transform: "lin", frequency: "D", unit: "%", decimals: 2, changeMode: "bps" },
  { id: "DGS2", label: "2-Year Treasury Yield", short: "UST 2Y", section: "rates", transform: "lin", frequency: "D", unit: "%", decimals: 2, changeMode: "bps" },
  { id: "DGS10", label: "10-Year Treasury Yield", short: "UST 10Y", section: "rates", transform: "lin", frequency: "D", unit: "%", decimals: 2, changeMode: "bps", topline: true },
  { id: "DGS30", label: "30-Year Treasury Yield", short: "UST 30Y", section: "rates", transform: "lin", frequency: "D", unit: "%", decimals: 2, changeMode: "bps" },
  { id: "DFII10", label: "10-Year TIPS Real Yield", short: "Real 10Y", section: "rates", transform: "lin", frequency: "D", unit: "%", decimals: 2, changeMode: "bps" },
  { id: "T10Y2Y", label: "10Y Minus 2Y Treasury Spread", short: "10Y-2Y", section: "rates", transform: "lin", frequency: "D", unit: "bps", decimals: 0, changeMode: "bps", scale: 100, topline: true },
  { id: "T10YIE", label: "10-Year Breakeven Inflation", short: "10Y BEI", section: "rates", transform: "lin", frequency: "D", unit: "%", decimals: 2, changeMode: "bps" },

  { id: "VIXCLS", label: "CBOE Volatility Index", short: "VIX", section: "volatility", transform: "lin", frequency: "D", unit: "index", decimals: 1, changeMode: "points", toneDirection: "lower_is_better", topline: true },
  { id: "NFCI", label: "National Financial Conditions Index", short: "NFCI", section: "volatility", transform: "lin", frequency: "W", unit: "index", decimals: 2, changeMode: "points", toneDirection: "lower_is_better" },
  { id: "STLFSI4", label: "St. Louis Fed Financial Stress Index", short: "STLFSI", section: "volatility", transform: "lin", frequency: "W", unit: "index", decimals: 2, changeMode: "points", toneDirection: "lower_is_better" },
  { id: "BAMLH0A0HYM2", label: "High Yield OAS", short: "HY OAS", section: "volatility", transform: "lin", frequency: "D", unit: "bps", decimals: 0, changeMode: "bps", scale: 100, toneDirection: "lower_is_better" },
  { id: "BAMLC0A0CM", label: "Investment Grade OAS", short: "IG OAS", section: "volatility", transform: "lin", frequency: "D", unit: "bps", decimals: 0, changeMode: "bps", scale: 100, toneDirection: "lower_is_better" },
  { id: "WRESBAL", label: "Reserve Balances", short: "Reserves", section: "volatility", transform: "lin", frequency: "W", unit: "$T", decimals: 2, changeMode: "absolute", scale: 0.000001, toneDirection: "higher_is_better" },

  { id: "GDPNOW", label: "Atlanta Fed GDPNow", short: "GDPNow", section: "domestic", transform: "lin", frequency: "D", unit: "% q/q ann.", decimals: 1, changeMode: "points", toneDirection: "higher_is_better", topline: true },
  { id: "GDPC1", label: "Real GDP", short: "Real GDP", section: "domestic", transform: "pca", frequency: "Q", unit: "% q/q ann.", decimals: 1, changeMode: "points", toneDirection: "higher_is_better" },
  { id: "INDPRO", label: "Industrial Production", short: "IP", section: "domestic", transform: "pch", frequency: "M", unit: "% m/m", decimals: 1, changeMode: "points", toneDirection: "higher_is_better" },
  { id: "RSAFS", label: "Retail Sales", short: "Retail", section: "domestic", transform: "pch", frequency: "M", unit: "% m/m", decimals: 1, changeMode: "points", toneDirection: "higher_is_better" },
  { id: "PCEPILFE", label: "Core PCE Price Index", short: "Core PCE", section: "domestic", transform: "pc1", frequency: "M", unit: "% y/y", decimals: 1, changeMode: "points", toneDirection: "lower_is_better", topline: true },
  { id: "UNRATE", label: "Unemployment Rate", short: "Unemployment", section: "domestic", transform: "lin", frequency: "M", unit: "%", decimals: 1, changeMode: "points", toneDirection: "lower_is_better", topline: true },
  { id: "PAYEMS", label: "Nonfarm Payrolls", short: "Payrolls", section: "domestic", transform: "chg", frequency: "M", unit: "k", decimals: 0, changeMode: "absolute", scale: 1, toneDirection: "higher_is_better" },
  { id: "ICSA", label: "Initial Jobless Claims", short: "Claims", section: "domestic", transform: "lin", frequency: "W", unit: "k", decimals: 0, changeMode: "absolute", scale: 0.001, toneDirection: "lower_is_better" },

  { id: "CP0000EZ19M086NEST", label: "Euro Area CPI", short: "Euro CPI", section: "global", transform: "pc1", frequency: "M", unit: "% y/y", decimals: 1, changeMode: "points", toneDirection: "lower_is_better" },
  { id: "GBRCPIALLMINMEI", label: "United Kingdom CPI", short: "UK CPI", section: "global", transform: "pc1", frequency: "M", unit: "% y/y", decimals: 1, changeMode: "points", toneDirection: "lower_is_better" },
  { id: "JPNCPIALLMINMEI", label: "Japan CPI", short: "Japan CPI", section: "global", transform: "pc1", frequency: "M", unit: "% y/y", decimals: 1, changeMode: "points", toneDirection: "lower_is_better" },
  { id: "CANCPIALLMINMEI", label: "Canada CPI", short: "Canada CPI", section: "global", transform: "pc1", frequency: "M", unit: "% y/y", decimals: 1, changeMode: "points", toneDirection: "lower_is_better" },
  { id: "ECBDFR", label: "ECB Deposit Facility Rate", short: "ECB DFR", section: "global", transform: "lin", frequency: "D", unit: "%", decimals: 2, changeMode: "bps" },
  { id: "IRSTCB01GBM156N", label: "United Kingdom Policy Rate", short: "UK Rate", section: "global", transform: "lin", frequency: "M", unit: "%", decimals: 2, changeMode: "bps" },
  { id: "IRSTCB01JPM156N", label: "Japan Policy Rate", short: "Japan Rate", section: "global", transform: "lin", frequency: "M", unit: "%", decimals: 2, changeMode: "bps" },
  { id: "IRSTCB01CAM156N", label: "Canada Policy Rate", short: "Canada Rate", section: "global", transform: "lin", frequency: "M", unit: "%", decimals: 2, changeMode: "bps" },
];

function unavailablePayload(error: string): CommandCenterPayload {
  return { ...EMPTY_COMMAND_CENTER, generatedAt: new Date().toISOString(), error };
}

function annualLag(frequency: Frequency): number {
  if (frequency === "D") return 252;
  if (frequency === "W") return 52;
  if (frequency === "Q") return 4;
  return 12;
}

function periodsPerYear(frequency: Frequency): number {
  if (frequency === "D") return 252;
  if (frequency === "W") return 52;
  if (frequency === "Q") return 4;
  return 12;
}

function scaled(value: number, spec: SeriesSpec): number {
  return value * (spec.scale ?? 1);
}

function transformedValue(rows: GoldObservationRow[], index: number, spec: SeriesSpec): number | null {
  const current = Number(rows[index]?.value);
  if (!Number.isFinite(current)) return null;
  if (spec.transform === "lin") return scaled(current, spec);
  if (spec.transform === "chg") {
    const prior = Number(rows[index - 1]?.value);
    if (!Number.isFinite(prior)) return null;
    return (current - prior) * (spec.scale ?? 1);
  }
  if (spec.transform === "pch") {
    const prior = Number(rows[index - 1]?.value);
    if (!Number.isFinite(prior) || prior === 0) return null;
    return (current / prior - 1) * 100;
  }
  if (spec.transform === "pc1") {
    const prior = Number(rows[index - annualLag(spec.frequency)]?.value);
    if (!Number.isFinite(prior) || prior === 0) return null;
    return (current / prior - 1) * 100;
  }
  const prior = Number(rows[index - 1]?.value);
  if (!Number.isFinite(prior) || prior === 0) return null;
  return (Math.pow(current / prior, periodsPerYear(spec.frequency)) - 1) * 100;
}

function displaySeries(rows: GoldObservationRow[], spec: SeriesSpec): DisplayPoint[] {
  return rows
    .map((row, index) => {
      const value = transformedValue(rows, index, spec);
      if (value == null || !Number.isFinite(value)) return null;
      return { date: row.date, value, realtimeStart: row.realtime_start ?? null };
    })
    .filter((row): row is DisplayPoint => row != null);
}

function changeValue(latest: DisplayPoint, prior: DisplayPoint | undefined, spec: SeriesSpec): { change: number | null; changePct: number | null } {
  if (!prior) return { change: null, changePct: null };
  const rawChange = latest.value - prior.value;
  const changePct = prior.value === 0 ? null : (latest.value / prior.value - 1) * 100;
  if (spec.changeMode === "pct") return { change: rawChange, changePct };
  if (spec.changeMode === "bps" && spec.unit === "%") return { change: rawChange * 100, changePct };
  return { change: rawChange, changePct };
}

function parseDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00Z`);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonths(dateOnly: string, months: number): string {
  const date = parseDate(dateOnly);
  date.setUTCMonth(date.getUTCMonth() + months);
  return formatDate(date);
}

function startOfMonth(dateOnly: string): string {
  const date = parseDate(dateOnly);
  return formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

function startOfQuarter(dateOnly: string): string {
  const date = parseDate(dateOnly);
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return formatDate(new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1)));
}

function startOfYear(dateOnly: string): string {
  const date = parseDate(dateOnly);
  return formatDate(new Date(Date.UTC(date.getUTCFullYear(), 0, 1)));
}

function lastIndexOnOrBefore(points: DisplayPoint[], dateOnly: string): number {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].date <= dateOnly) return index;
  }
  return -1;
}

function firstIndexOnOrAfter(points: DisplayPoint[], dateOnly: string): number {
  return points.findIndex((point) => point.date >= dateOnly);
}

function periodAnchorIndex(points: DisplayPoint[], periodStart: string, latestIndex: number): number {
  const priorCloseIndex = lastIndexOnOrBefore(points, formatDate(new Date(parseDate(periodStart).getTime() - 86400000)));
  if (priorCloseIndex >= 0) return priorCloseIndex;
  const firstPeriodIndex = firstIndexOnOrAfter(points, periodStart);
  return firstPeriodIndex >= 0 && firstPeriodIndex < latestIndex ? firstPeriodIndex : -1;
}

function calendarAnchorIndex(points: DisplayPoint[], latestIndex: number, monthsBack: number): number {
  const anchorDate = addMonths(points[latestIndex].date, -monthsBack);
  return lastIndexOnOrBefore(points, anchorDate);
}

function horizonAnchorIndex(points: DisplayPoint[], latestIndex: number, horizon: CommandCenterReturnHorizon): number {
  if (horizon === "1D") return latestIndex - 1;
  if (horizon === "5D") return latestIndex - 5;
  if (horizon === "MTD") return periodAnchorIndex(points, startOfMonth(points[latestIndex].date), latestIndex);
  if (horizon === "QTD") return periodAnchorIndex(points, startOfQuarter(points[latestIndex].date), latestIndex);
  if (horizon === "YTD") return periodAnchorIndex(points, startOfYear(points[latestIndex].date), latestIndex);
  if (horizon === "1M") return calendarAnchorIndex(points, latestIndex, 1);
  if (horizon === "3M") return calendarAnchorIndex(points, latestIndex, 3);
  if (horizon === "1Y") return latestIndex - 252;
  if (horizon === "3Y") return latestIndex - 756;
  return latestIndex - 1260;
}

function emptyReturn(annualized: boolean): CommandCenterReturn {
  return { value: null, startDate: null, endDate: null, tradingDays: null, annualized };
}

function isAnnualizedHorizon(horizon: CommandCenterReturnHorizon): boolean {
  return horizon === "1Y" || horizon === "3Y" || horizon === "5Y";
}

function linkedReturn(points: DisplayPoint[], latestIndex: number, horizon: CommandCenterReturnHorizon): CommandCenterReturn {
  const annualized = isAnnualizedHorizon(horizon);
  const anchorIndex = horizonAnchorIndex(points, latestIndex, horizon);
  if (anchorIndex < 0 || anchorIndex >= latestIndex) return emptyReturn(annualized);
  const start = points[anchorIndex];
  const end = points[latestIndex];
  if (!Number.isFinite(start.value) || !Number.isFinite(end.value) || start.value <= 0) return emptyReturn(annualized);
  const tradingDays = latestIndex - anchorIndex;
  if (tradingDays <= 0) return emptyReturn(annualized);
  const cumulative = end.value / start.value - 1;
  const value = annualized ? (Math.pow(1 + cumulative, 252 / tradingDays) - 1) * 100 : cumulative * 100;
  return {
    value: Number.isFinite(value) ? value : null,
    startDate: start.date,
    endDate: end.date,
    tradingDays,
    annualized,
  };
}

function marketReturns(points: DisplayPoint[], spec: SeriesSpec): Record<CommandCenterReturnHorizon, CommandCenterReturn> | undefined {
  if (spec.section !== "markets" || spec.transform !== "lin") return undefined;
  const latestIndex = points.length - 1;
  return Object.fromEntries(
    MARKET_RETURN_HORIZONS.map((horizon) => [horizon, linkedReturn(points, latestIndex, horizon)])
  ) as Record<CommandCenterReturnHorizon, CommandCenterReturn>;
}

function toneFor(change: number | null, spec: SeriesSpec): CommandCenterTone {
  if (change == null || Math.abs(change) < 1e-9) return "neutral";
  const up = change > 0;
  if (spec.toneDirection === "higher_is_better") return up ? "up" : "down";
  if (spec.toneDirection === "lower_is_better") return up ? "down" : "up";
  return up ? "up" : "down";
}

function metricFromRows(spec: SeriesSpec, rows: GoldObservationRow[]): CommandCenterMetric | null {
  const points = displaySeries(rows, spec);
  if (!points.length) return null;
  const latest = points[points.length - 1];
  const prior = points[points.length - 2];
  const { change, changePct } = changeValue(latest, prior, spec);
  return {
    id: spec.id,
    label: spec.label,
    short: spec.short,
    section: spec.section,
    value: latest.value,
    unit: spec.unit,
    asOf: latest.date,
    realtimeStart: latest.realtimeStart,
    change,
    changePct,
    changeMode: spec.changeMode,
    marketReturns: marketReturns(points, spec),
    decimals: spec.decimals,
    history: points.slice(-36).map((point) => point.value),
    historyDates: points.slice(-36).map((point) => point.date),
    tone: toneFor(change, spec),
    source: "DB",
  };
}

function section(metrics: CommandCenterMetric[], name: CommandCenterSection): CommandCenterMetric[] {
  return metrics.filter((metric) => metric.section === name);
}

function importance(value: string | null): CommandCenterCatalyst["importance"] {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW") return value;
  return "MEDIUM";
}

function daysFromToday(dateOnly: string, todayMs: number): number {
  return Math.round((new Date(`${dateOnly}T00:00:00Z`).getTime() - todayMs) / 86400000);
}

function category(value: string | null): string {
  if (!value) return "Release";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function topLine(metrics: CommandCenterMetric[]): CommandCenterMetric[] {
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  return SERIES_SPECS.filter((spec) => spec.topline)
    .map((spec) => byId.get(spec.id))
    .filter((metric): metric is CommandCenterMetric => metric != null);
}

function maxDate(metrics: CommandCenterMetric[]): string | null {
  return metrics.reduce<string | null>((best, metric) => (!best || metric.asOf > best ? metric.asOf : best), null);
}

function maxAgeDays(frequency: Frequency): number {
  if (frequency === "D") return 14;
  if (frequency === "W") return 35;
  if (frequency === "M") return 120;
  return 180;
}

function ageDays(dateOnly: string, todayMs: number): number | null {
  const parsed = new Date(`${dateOnly}T00:00:00Z`).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.floor((todayMs - parsed) / 86400000);
}

function staleMetricWarnings(metrics: CommandCenterMetric[], todayMs: number): string[] {
  const byId = new Map(SERIES_SPECS.map((spec) => [spec.id, spec]));
  const stale = metrics.flatMap((metric) => {
    const spec = byId.get(metric.id);
    if (!spec) return [];
    const age = ageDays(metric.asOf, todayMs);
    if (age == null || age <= maxAgeDays(spec.frequency)) return [];
    return `${metric.id} as of ${metric.asOf}`;
  });
  return stale.length ? [`Stale Gold rows detected: ${stale.join(", ")}.`] : [];
}

function makePayload(metrics: CommandCenterMetric[], missingSeries: string[], catalysts: CommandCenterCatalyst[], warnings: string[]): CommandCenterPayload {
  return {
    source: metrics.length ? "DB" : "ERR",
    asOf: maxDate(metrics),
    generatedAt: new Date().toISOString(),
    topline: topLine(metrics),
    domesticRates: section(metrics, "rates"),
    volatility: section(metrics, "volatility"),
    domesticHealth: section(metrics, "domestic"),
    globalHealth: section(metrics, "global"),
    highLevelMarkets: section(metrics, "markets"),
    catalysts,
    missingSeries,
    warnings,
    error: metrics.length ? undefined : "No Gold DB observations found for Command Center series.",
  };
}

/**
 * GET /api/command-center
 *
 * Gold DB only. This route intentionally reads only the FRED/Eco pipeline's
 * local Gold tables and never falls back to market APIs, snapshots, or fixtures.
 */
export async function readCommandCenterPayload(): Promise<CommandCenterPayload> {
  if (!goldEnabled()) {
    return unavailablePayload("MACRO_DB_URL not configured.");
  }

  try {
    const ids = SERIES_SPECS.map((spec) => spec.id);
    const placeholders = ids.map((_, index) => goldParam(index + 1)).join(", ");
    const obsTable = goldTable("fred_latest_observation");
    const rows = await goldStore().raw<GoldObservationRow>(
      `WITH ranked AS (
         SELECT series_id, observation_date AS date, value, realtime_start,
                ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY observation_date DESC) AS rn
         FROM ${obsTable}
         WHERE series_id IN (${placeholders})
           AND value IS NOT NULL
       )
       SELECT series_id, date, value, realtime_start
       FROM ranked
       WHERE rn <= 1500
       ORDER BY series_id ASC, date ASC`,
      ids
    );

    const rowsBySeries = new Map<string, GoldObservationRow[]>();
    for (const row of rows) {
      const value = Number(row.value);
      if (!Number.isFinite(value)) continue;
      const list = rowsBySeries.get(row.series_id) ?? [];
      list.push({ ...row, value });
      rowsBySeries.set(row.series_id, list);
    }

    const metrics: CommandCenterMetric[] = [];
    const missingSeries: string[] = [];
    for (const spec of SERIES_SPECS) {
      const metric = metricFromRows(spec, rowsBySeries.get(spec.id) ?? []);
      if (metric) metrics.push(metric);
      else missingSeries.push(spec.id);
    }

    const now = new Date();
    const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const today = new Date(todayMs).toISOString().slice(0, 10);
    const horizon = new Date(todayMs + 60 * 86400000).toISOString().slice(0, 10);
    const calTable = goldTable("release_calendar");
    const releaseRows = await goldStore().raw<GoldReleaseCalendarRow>(
      `SELECT release_id, release_name, release_date, importance, econ_category, representative_series_id, fetched_at
       FROM ${calTable}
       WHERE release_date >= ${goldParam(1)}
         AND release_date <= ${goldParam(2)}
         AND (importance = 'HIGH' OR importance = 'MEDIUM')
       ORDER BY release_date ASC, release_id ASC
       LIMIT 8`,
      [today, horizon]
    );
    const catalysts = releaseRows.map<CommandCenterCatalyst>((row, index) => ({
      id: `GRC-${row.release_id}-${row.release_date}-${index}`,
      name: row.release_name,
      date: row.release_date,
      daysOut: daysFromToday(row.release_date, todayMs),
      category: category(row.econ_category),
      importance: importance(row.importance),
      representativeSeriesId: row.representative_series_id,
      fetchedAt: row.fetched_at,
      source: "DB",
    }));

    const warnings = [
      ...staleMetricWarnings(metrics, todayMs),
      ...(!catalysts.length ? ["No upcoming Gold release_calendar rows found for the next 60 days."] : []),
      ...(missingSeries.length ? [`Missing or untransformable Gold rows for ${missingSeries.length} configured series.`] : []),
    ];

    return makePayload(metrics, missingSeries, catalysts, warnings);
  } catch (err) {
    console.warn("[command-center] Gold DB read failed:", (err as Error).message);
    return unavailablePayload((err as Error).message);
  }
}

export async function GET() {
  return json(await readCommandCenterPayload());
}
