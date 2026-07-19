
import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import { getSeriesHistory, type Observation } from "@/data/econSeries";
import { getSnapshotObservations, getSnapshotRawObservations } from "@/data/econSnapshot";
import {
  getCurrentCurve,
  getCurveSnapshots,
  getInversionsForSpread,
  getInversionStats,
  getSpreadSeriesFor,
  type CurveSnapshot,
  type Inversion,
} from "@/data/econCurve";
import { type EconEvent } from "@/data/econRates";
import { useSimMode } from "@/lib/simMode";

export type DataSource = "DB" | "FRED" | "SNAPSHOT" | "SIM" | "LOADING" | "ETL";
export type RealEconSource = "DB" | "FRED" | "SNAPSHOT";
export type EconSeriesSource = RealEconSource | "SIM";

/** True when a row came from an external/committed source rather than generated SIM. */
export function isRealEconSource(source: unknown): source is RealEconSource {
  return source === "DB" || source === "FRED" || source === "SNAPSHOT";
}

/** Map a route's `source` string to the badge vocabulary. */
function mapSource(s: unknown): DataSource {
  if (typeof s !== "string") return "SIM";
  if (s === "DB") return "DB";
  if (s === "FRED" || s.includes("FRED") || s.includes("Finnhub")) return "FRED";
  if (s === "SNAPSHOT") return "SNAPSHOT";
  if (s === "ETL") return "ETL";
  return "SIM";
}

/**
 * Resilient econ data hooks. Each returns a fallback value immediately (SSR-safe,
 * no empty states), then transparently swaps in whatever the API route reports
 * (`DB` Gold, `FRED` live, `SNAPSHOT` real-frozen, else `SIM`). `fallbackSource` is what the
 * fallback value itself represents — `SNAPSHOT` when seeded from the committed
 * real snapshot, otherwise `SIM` — so a static-only deploy (no `/api`) still
 * labels real frozen data correctly instead of calling it SIM.
 */
function useEconResource<T>(
  url: string,
  fallback: T,
  pick: (json: any) => T,
  fallbackSource: DataSource = "SIM",
  emptyValue?: T,
): { data: T; source: DataSource } {
  const { simEnabled, snapshotFallbackEnabled } = useSimMode();
  const suppressSnapshot = (source: DataSource) => source === "SNAPSHOT" && !snapshotFallbackEnabled;
  const suppressedData = () => (emptyValue !== undefined ? emptyValue : fallback);
  const suppressedSource = () => (emptyValue !== undefined || fallbackSource === "SNAPSHOT" ? "LOADING" : fallbackSource);
  const cached = peekFresh<any>(url);
  const cachedSource = cached ? mapSource(cached.source) : fallbackSource;
  const [rawData, setRawData] = useState<T>(cached && !suppressSnapshot(cachedSource) ? pick(cached) : suppressSnapshot(cachedSource) ? suppressedData() : fallback);
  const [rawSource, setRawSource] = useState<DataSource>(suppressSnapshot(cachedSource) ? suppressedSource() : cachedSource);

  useEffect(() => {
    let alive = true;
    const seed = peekFresh<any>(url);
    if (seed) {
      const seedSource = mapSource(seed.source);
      if (suppressSnapshot(seedSource)) {
        setRawData(suppressedData());
        setRawSource(suppressedSource());
      } else {
        setRawData(pick(seed));
        setRawSource(seedSource);
      }
    } else {
      setRawSource("LOADING");
    }
    fetchJson<any>(url)
      .then((json) => {
        if (!alive) return;
        const nextSource = mapSource(json.source);
        if (suppressSnapshot(nextSource)) {
          setRawData(suppressedData());
          setRawSource(suppressedSource());
          return;
        }
        setRawData(pick(json));
        setRawSource(nextSource);
      })
      .catch(() => {
        if (!alive) return;
        if (suppressSnapshot(fallbackSource)) {
          setRawData(suppressedData());
          setRawSource(suppressedSource());
        } else {
          setRawSource(fallbackSource);
        }
      });
    return () => {
      alive = false;
    };
  }, [url, snapshotFallbackEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // When SIM is off, suppress SIM-sourced data
  if (!simEnabled && rawSource === "SIM" && emptyValue !== undefined) {
    return { data: emptyValue, source: rawSource };
  }

  return { data: rawData, source: rawSource };
}

export function useEconSeries(id: string, n = 120): { data: Observation[]; source: DataSource } {
  const snap = getSnapshotObservations(id, n);
  return useEconResource<Observation[]>(
    `/api/econ/series?id=${id}&n=${n}`,
    snap ?? getSeriesHistory(id, n),
    (j) => j.observations ?? [],
    snap ? "SNAPSHOT" : "SIM",
    [],
  );
}

export function useLiveCurve(): { data: CurveSnapshot | null; source: DataSource } {
  return useEconResource<CurveSnapshot | null>(`/api/econ/curve`, getCurrentCurve(), (j) => j.curve, "SIM", null);
}

/**
 * Real point-in-time curve snapshots (Today + 1M/3M/6M/1Y/2Y ago + deep
 * reference curves), assembled server-side from each tenor's FRED daily
 * history. Falls back to the simulated presets without a key.
 */
export function useCurveSnapshots(years = 7): { data: CurveSnapshot[]; source: DataSource } {
  return useEconResource<CurveSnapshot[]>(
    `/api/econ/curve-history?years=${years}`,
    getCurveSnapshots(),
    (j) => (Array.isArray(j.snapshots) && j.snapshots.length ? j.snapshots : getCurveSnapshots()),
    "SIM",
  );
}

export function useEconCalendar(): { data: EconEvent[]; source: DataSource } {
  return useEconResource<EconEvent[]>(`/api/econ/calendar`, [], (j) => j.events ?? [], "LOADING", []);
}

export interface InversionData {
  inversions: Inversion[];
  stats: ReturnType<typeof getInversionStats>;
  timeline: { date: string; value: number; recession: boolean }[];
}

/**
 * Live inversion detection for any curve spread — pulls the spread's real daily
 * FRED history server-side and detects every unique inversion period. Falls back
 * to the curated/simulated record without a key.
 */
export function useInversions(spreadId: string): { data: InversionData | null; source: DataSource } {
  return useEconResource<InversionData | null>(
    `/api/econ/inversions?spread=${encodeURIComponent(spreadId)}`,
    {
      inversions: getInversionsForSpread(spreadId),
      stats: getInversionStats(spreadId),
      timeline: getSpreadSeriesFor(spreadId),
    },
    (j) => ({
      inversions: j.inversions ?? [],
      stats: j.stats ?? getInversionStats(spreadId),
      timeline: j.timeline ?? [],
    }),
    "SIM",
    null,
  );
}

export interface LiveIndicator {
  id: string;
  value: number;
  prior: number;
  change: number;
  changePct: number | null;
  mom: number | null;
  momDelta: number | null;
  qoq: number | null;
  qoqDelta: number | null;
  yoy: number | null;
  yoyDelta: number | null;
  monthlyPrint: number | null;
  asOf: string;
  history: number[];
  source: EconSeriesSource;
}

/** All indicators with live current value + 24m history, keyed by series id. */
export function useLiveIndicators(): { data: Record<string, LiveIndicator>; source: DataSource } {
  const { data, source } = useEconResource<Record<string, LiveIndicator>>(
    `/api/econ/indicators`,
    {},
    (j) => Object.fromEntries((j.indicators ?? []).map((i: LiveIndicator) => [i.id, i])),
    "SIM",
    {},
  );
  return { data, source };
}

export interface SeriesObs {
  observations: { date: string; value: number }[];
  source: EconSeriesSource;
}

/**
 * Batch-fetch many series (one request). Returns a map keyed by id of the raw
 * observations + per-series source. Pass `units: "lin"` to get raw index levels
 * so the page can derive MoM/YoY/acceleration itself. Empty map until loaded;
 * callers keep their simulation values unless a series reports a real source.
 */
export function useLiveSeriesSet(
  ids: string[],
  units?: string,
  n = 15
): { data: Record<string, SeriesObs>; source: DataSource } {
  const key = ids.join(",");
  const url = `/api/econ/batch?ids=${encodeURIComponent(key)}${units ? `&units=${units}` : ""}&n=${n}`;
  // Seed from the committed snapshot so a static-only deploy still shows real
  // frozen series (labelled SNAPSHOT) rather than nothing/SIM.
  const seeded = Object.fromEntries(
    ids
      .map((id) => {
        const obs = units === "lin" ? getSnapshotRawObservations(id, n) ?? getSnapshotObservations(id, n) : getSnapshotObservations(id, n);
        return obs ? ([id, { observations: obs, source: "SNAPSHOT" as const }] as const) : null;
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
  );
  return useEconResource(
    url,
    seeded as Record<string, SeriesObs>,
    (j) => Object.fromEntries((j.series ?? []).map((s: { id: string; observations: { date: string; value: number }[]; source: unknown }) => {
      const mapped = mapSource(s.source);
      return [s.id, { observations: s.observations, source: isRealEconSource(mapped) ? mapped : "SIM" }];
    })),
    Object.keys(seeded).length ? "SNAPSHOT" : "SIM",
    {},
  );
}

export interface MacroInputsData {
  source: "DB" | "SIM";
  curve: Record<string, number>;
  benchmarks: Record<string, number>;
  funding: { stress_gauge: number | null; sofr_effr_spread_bps: number | null; ioer_effr_spread_bps: number | null };
  credit: { hy_oas_bps: number | null; ig_oas_bps: number | null };
  regime: { named_regime: string | null; confidence: number | null; growth_score: number | null; inflation_score: number | null; financial_conditions_score: number | null };
  indicators: Record<string, number>;
  asOf: string | null;
}

const MACRO_INPUTS_FALLBACK: MacroInputsData = {
  source: "SIM",
  curve: { "1M": 4.3, "3M": 4.25, "6M": 4.15, "1Y": 3.95, "2Y": 3.74, "5Y": 3.8, "10Y": 4.11, "30Y": 4.35 },
  benchmarks: { FEDFUNDS: 4.08, SOFR: 4.31, DGS2: 3.74, DGS10: 4.11 },
  funding: { stress_gauge: null, sofr_effr_spread_bps: null, ioer_effr_spread_bps: null },
  credit: { hy_oas_bps: 312, ig_oas_bps: 105 },
  regime: { named_regime: null, confidence: null, growth_score: null, inflation_score: null, financial_conditions_score: null },
  indicators: {},
  asOf: null,
};

/**
 * Hook for Tier C synthetic-book modules. Returns Gold DB macro context
 * (benchmark rates, curve, credit spreads, funding stress, regime) for use
 * as anchors in SIM time-series generation. Falls back to SIM defaults when
 * Gold DB is not configured (source: "SIM").
 */
export function useMacroInputs(): { data: MacroInputsData | null; source: "DB" | "SIM" } {
  const raw = useEconResource<MacroInputsData | null>(
    "/api/econ/macro-inputs",
    MACRO_INPUTS_FALLBACK,
    (j) => j as MacroInputsData,
    "SIM",
    null, // suppress SIM when toggle is off — Tier C pages show empty state
  );
  return { data: raw.data, source: (raw.data?.source ?? "SIM") };
}

export interface FomcResponse {
  source: string;
  fedPriceSource: "cme" | "fred_model" | "sim" | null;
  asOf: string | null;
  sourceDetail: string | null;
  spotEffectiveRate: number | null;
  goldAnchored: boolean;
  currentTarget: { low: number; high: number; mid: number };
  modelInputs: Record<string, unknown> | null;
  meetings: { date: string; label: string; daysOut: number; outcomes: { move: number; prob: number }[]; impliedRate: number; mostLikely: string }[];
  path: { label: string; rate: number }[];
}

/**
 * Gold-anchored FOMC FedProbabilityEngine hook. Fetches from /api/econ/fomc
 * which grounds the probability ladder in the live Gold DB SOFR/EFFR value.
 * Falls back to null (caller should use static ETL data) when loading or
 * when Gold DB is not configured.
 */
export function useFomc(): { data: FomcResponse | null; loading: boolean } {
  const [data, setData] = useState<FomcResponse | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetchJson<FomcResponse>("/api/econ/fomc")
      .then((j) => { if (alive && j?.meetings) setData(j); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { data, loading };
}
