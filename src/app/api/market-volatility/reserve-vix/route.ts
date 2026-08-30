import { computeReserveVixExperiment, type MarketVolAlignmentMode, type MarketVolSeriesPoint, type MarketVolSignalMode } from "@/lib/marketVolatility";
import { goldEnabled, goldParam, goldStore, goldTable } from "@/lib/server/goldStore";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";

interface GoldObservationRow {
  series_id: "WRESBAL" | "VIXCLS" | "SP500";
  date: string;
  value: number;
  realtime_start?: string | null;
}

const SERIES_IDS = ["WRESBAL", "VIXCLS", "SP500"] as const;
const DEFAULT_START = "2009-01-01";

function parseMode(value: string | null): MarketVolAlignmentMode {
  return value === "tradability" ? "tradability" : "research";
}

function parseSignal(value: string | null): MarketVolSignalMode {
  return value === "cross_above" ? "cross_above" : "above_mean";
}

function parseForwardDays(value: string | null): 7 | 14 {
  return value === "14" ? 14 : 7;
}

function parseClaimThreshold(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 71;
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
  return formatDate(parseDate(date) + days * 86_400_000);
}

function unavailable(req: {
  mode: MarketVolAlignmentMode;
  signal: MarketVolSignalMode;
  forwardDays: 7 | 14;
  startDate: string;
  endDate?: string;
  claimThresholdPct: number;
}, error: string, source: "ERR" | "UNAVAILABLE" = "ERR") {
  const result = computeReserveVixExperiment({
    reserves: [],
    vix: [],
    startDate: req.startDate,
    endDate: req.endDate ?? req.startDate,
    alignmentMode: req.mode,
    signalMode: req.signal,
    forwardDays: req.forwardDays,
    claimThresholdPct: req.claimThresholdPct,
  });
  return json({
    ...result,
    source,
    error,
    readout: {
      ...result.readout,
      notes: [...result.readout.notes, error],
    },
    diagnostics: {
      ...result.diagnostics,
      warnings: [...result.diagnostics.warnings, error],
    },
  });
}

/**
 * GET /api/market-volatility/reserve-vix
 *
 * Gold DB-only reserve balances vs VIX claim-audit experiment.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = parseMode(url.searchParams.get("mode"));
  const signal = parseSignal(url.searchParams.get("signal"));
  const forwardDays = parseForwardDays(url.searchParams.get("forwardDays"));
  const startDate = url.searchParams.get("start") ?? DEFAULT_START;
  const endDate = url.searchParams.get("end") ?? undefined;
  const claimThresholdPct = parseClaimThreshold(url.searchParams.get("claimThresholdPct"));
  const requestConfig = { mode, signal, forwardDays, startDate, endDate, claimThresholdPct };

  if (mode === "tradability") {
    return unavailable(requestConfig, "Tradability Mode is unavailable until approved Gold release timing is exposed.", "UNAVAILABLE");
  }

  if (!goldEnabled()) {
    return unavailable(requestConfig, "MACRO_DB_URL not configured.");
  }

  try {
    const lookbackStart = addDays(startDate, -120);
    const params: unknown[] = [...SERIES_IDS, lookbackStart];
    const upperBound = endDate ? addDays(endDate, forwardDays + 10) : null;
    const lookbackParam = SERIES_IDS.length + 1;
    const upperParam = SERIES_IDS.length + 2;
    const upperClause = upperBound ? `AND observation_date <= ${goldParam(upperParam)}` : "";
    if (upperBound) params.push(upperBound);

    const rows = await goldStore().raw<GoldObservationRow>(
      `SELECT series_id, observation_date AS date, value, realtime_start
       FROM ${goldTable("fred_latest_observation")}
       WHERE series_id IN (${SERIES_IDS.map((_, index) => goldParam(index + 1)).join(", ")})
         AND observation_date >= ${goldParam(lookbackParam)}
         ${upperClause}
         AND value IS NOT NULL
       ORDER BY series_id, observation_date ASC`,
      params
    );

    const reserves: MarketVolSeriesPoint[] = [];
    const vix: MarketVolSeriesPoint[] = [];
    const spx: MarketVolSeriesPoint[] = [];
    for (const row of rows) {
      const point = { date: row.date, value: Number(row.value) };
      if (!Number.isFinite(point.value)) continue;
      if (row.series_id === "WRESBAL") reserves.push(point);
      if (row.series_id === "VIXCLS") vix.push(point);
      if (row.series_id === "SP500") spx.push(point);
    }

    if (!reserves.length) {
      return unavailable(requestConfig, "No Gold DB observations found for WRESBAL.");
    }
    if (!vix.length) {
      return unavailable(requestConfig, "No Gold DB observations found for VIXCLS.");
    }

    const result = computeReserveVixExperiment({
      reserves,
      vix,
      spx,
      startDate,
      endDate,
      alignmentMode: mode,
      signalMode: signal,
      forwardDays,
      claimThresholdPct,
    });
    if (!spx.length) {
      result.diagnostics.warnings.push("No Gold DB observations found for SP500; SPX outcome fields are unavailable.");
    }

    return json(result);
  } catch (err) {
    console.warn("[market-volatility/reserve-vix] Gold DB read failed:", (err as Error).message);
    return unavailable(requestConfig, (err as Error).message);
  }
}
