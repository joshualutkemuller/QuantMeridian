
import { useEffect, useState } from "react";
import type { DataSource } from "@/lib/useEcon";
import { STAT_SERIES, monthlyDate, simStatFull, type StatSeries } from "@/data/statsConfig";
import { useSimMode } from "@/lib/simMode";

/**
 * Statistical Analysis data loader with an incremental session cache.
 *
 * The default lookback is 20 years. The raw monthly series are cached at module
 * level, so changing the lookback within the cached window recomputes locally
 * with no network call; only requesting an *older* window than is cached fetches
 * the missing (incremental) delta and merges it. All statistics are computed
 * client-side from the cached series.
 */
const CACHE = {
  byLabel: new Map<string, Map<string, number>>(),
  earliest: null as string | null, // earliest start date held
  source: "SIM" as "DB" | "FRED" | "SNAPSHOT" | "SIM" | "ERR",
};

function mergePoints(label: string, points: { date: string; value: number }[]) {
  let m = CACHE.byLabel.get(label);
  if (!m) { m = new Map(); CACHE.byLabel.set(label, m); }
  for (const p of points) m.set(p.date, p.value);
}

function buildActive(startDate: string): StatSeries[] {
  return STAT_SERIES.map(([id, label]) => {
    const m = CACHE.byLabel.get(label) ?? new Map<string, number>();
    const points = [...m.entries()]
      .filter(([d]) => d >= startDate)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));
    return { id, label, points };
  });
}

function sliceSim(startDate: string): StatSeries[] {
  return simStatFull(320).map((s) => ({ ...s, points: s.points.filter((p) => p.date >= startDate) }));
}

export function useStatsData(defaultMonths = 240): {
  series: StatSeries[];
  source: DataSource;
  loading: boolean;
  lookbackMonths: number;
  setLookbackMonths: (m: number) => void;
  startDate: string;
  endDate: string;
} {
  const { simEnabled, snapshotFallbackEnabled } = useSimMode();
  const [lookbackMonths, setLookbackMonths] = useState(defaultMonths);
  const startDate = monthlyDate(lookbackMonths);
  const endDate = monthlyDate(0);
  const [series, setSeries] = useState<StatSeries[]>(() => sliceSim(startDate));
  const [source, setSource] = useState<DataSource>("SIM");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    // Already cached this far back → recompute locally, no fetch.
    if (CACHE.earliest && startDate >= CACHE.earliest) {
      setSeries(!simEnabled && CACHE.source === "SIM" ? [] : buildActive(startDate));
      setSource(!simEnabled && CACHE.source === "SIM" ? "ERR" : CACHE.source);
      return;
    }
    setLoading(true);
    setSource("LOADING");
    const fetchEnd = CACHE.earliest ?? endDate; // only the older delta when extending
    fetch(`/api/econ/stats?start=${startDate}&end=${fetchEnd}${simEnabled ? "&sim=1" : ""}${snapshotFallbackEnabled ? "&snapshot=1" : ""}`)
      .then((r) => r.json())
      .then((j: { source: "DB" | "FRED" | "SNAPSHOT" | "SIM" | "ERR"; series: { label: string; points: { date: string; value: number }[] }[] }) => {
        if (!alive) return;
        for (const s of j.series) mergePoints(s.label, s.points);
        CACHE.earliest = CACHE.earliest && startDate >= CACHE.earliest ? CACHE.earliest : startDate;
        CACHE.source = j.source;
        setSource(j.source);
        setSeries(buildActive(startDate));
      })
      .catch(() => {
        if (!alive) return;
        if (simEnabled) {
          setSeries(sliceSim(startDate));
          setSource("SIM");
        } else {
          setSeries([]);
          setSource("ERR");
        }
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [startDate, endDate, simEnabled, snapshotFallbackEnabled]);

  const effectiveSeries = !simEnabled && source === "SIM" ? [] : series;
  const effectiveSource = !simEnabled && source === "SIM" ? "ERR" : source;
  return { series: effectiveSeries, source: effectiveSource, loading, lookbackMonths, setLookbackMonths, startDate, endDate };
}
