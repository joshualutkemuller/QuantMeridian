import { useEffect, useMemo, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import type {
  ComputeReserveVixExperimentResult,
  HitRateStats,
  MarketVolAlignmentMode,
  MarketVolSignalMode,
} from "@/lib/marketVolatility";

export type MarketVolUiSource = "LOADING" | "DB" | "UNAVAILABLE" | "ERR";

export interface ReserveVixOptions {
  mode: MarketVolAlignmentMode;
  signal: MarketVolSignalMode;
  forwardDays: 7 | 14;
  start: string;
  claimThresholdPct: number;
}

const emptyHitRate: HitRateStats = {
  n: 0,
  hits: 0,
  hitRatePct: null,
  ciLowPct: null,
  ciHighPct: null,
};

const TRADABILITY_PENDING = "Tradability Mode is unavailable until approved Gold release timing is exposed.";

function emptyReserveVix(options: ReserveVixOptions, source: MarketVolUiSource, error?: string): ComputeReserveVixExperimentResult {
  return {
    source: source === "DB" ? "DB" : source === "UNAVAILABLE" ? "UNAVAILABLE" : "ERR",
    experimentId: "reserve-vix",
    mode: options.mode,
    signal: options.signal,
    forwardDays: options.forwardDays,
    dateRange: { start: options.start, end: options.start },
    inputs: {
      reservesSeriesId: "WRESBAL",
      vixSeriesId: "VIXCLS",
      spxSeriesId: "SP500",
      reservesRows: 0,
      vixRows: 0,
      spxRows: 0,
      latestReserveDate: null,
      latestVixDate: null,
      latestSpxDate: null,
    },
    stats: {
      unconditional: emptyHitRate,
      conditional: emptyHitRate,
      spxUnconditionalRise: emptyHitRate,
      spxConditionalRise: emptyHitRate,
      liftPctPoints: null,
      meanVixPointChange: null,
      medianVixPointChange: null,
      meanVixPctChange: null,
      medianVixPctChange: null,
      meanSpxPctChange: null,
      medianSpxPctChange: null,
      reservePctChangeVixPointChangeCorr: null,
      claimThresholdPct: options.claimThresholdPct,
      claimDeltaPctPoints: null,
      vixRegimes: [],
    },
    readout: {
      verdict: "Unavailable",
      bias: "unavailable",
      confidence: "low",
      ciOverlap: null,
      evidence: {
        baseRatePct: null,
        signalRatePct: null,
        liftPctPoints: null,
        signalN: 0,
        meanVixPointChange: null,
        spxRiseRatePct: null,
        meanSpxPctChange: null,
        claimDeltaPctPoints: null,
      },
      notes: error ? [error] : [],
    },
    series: {
      vix: [],
      spx: [],
    },
    rows: [],
    diagnostics: {
      droppedRows: 0,
      missingVixStart: 0,
      missingVixEndpoint: 0,
      insufficientTrailingMean: 0,
      missingActionableDate: 0,
      missingSpxStart: 0,
      missingSpxEndpoint: 0,
      confidenceIntervalMethod: "wilson",
      warnings: error ? [error] : [],
    },
    citations: [],
    error,
  };
}

export function useReserveVixExperiment(options: ReserveVixOptions): { data: ComputeReserveVixExperimentResult; source: MarketVolUiSource } {
  const url = useMemo(() => {
    const params = new URLSearchParams({
      mode: options.mode,
      signal: options.signal,
      forwardDays: String(options.forwardDays),
      start: options.start,
      claimThresholdPct: String(options.claimThresholdPct),
    });
    return `/api/market-volatility/reserve-vix?${params.toString()}`;
  }, [options.claimThresholdPct, options.forwardDays, options.mode, options.signal, options.start]);

  const [data, setData] = useState<ComputeReserveVixExperimentResult>(() => emptyReserveVix(options, "LOADING"));
  const [source, setSource] = useState<MarketVolUiSource>("LOADING");

  useEffect(() => {
    let alive = true;

    if (options.mode === "tradability") {
      setData(emptyReserveVix(options, "UNAVAILABLE", TRADABILITY_PENDING));
      setSource("UNAVAILABLE");
      return () => {
        alive = false;
      };
    }

    const apply = (body: ComputeReserveVixExperimentResult) => {
      const nextSource: MarketVolUiSource = body.source === "DB" ? "DB" : body.source === "UNAVAILABLE" ? "UNAVAILABLE" : "ERR";
      setData(body);
      setSource(nextSource);
    };

    const cached = peekFresh<ComputeReserveVixExperimentResult>(url);
    if (cached) apply(cached);
    else {
      setData(emptyReserveVix(options, "LOADING"));
      setSource("LOADING");
    }

    fetchJson<ComputeReserveVixExperimentResult>(url)
      .then((body) => {
        if (alive) apply(body);
      })
      .catch((err) => {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "Market volatility experiment unavailable.";
        setData(emptyReserveVix(options, "ERR", message));
        setSource("ERR");
      });

    return () => {
      alive = false;
    };
  }, [options, url]);

  return { data, source };
}
