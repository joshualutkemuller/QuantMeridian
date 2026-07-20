
import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/fetchCache";
import { useSimMode } from "@/lib/simMode";
import { type SeriesRef, type RangePreset, rangeMonths } from "./spec";
import { POINT_TRANSFORMS, applyPointTransform, applyWindowTransform, type Transform } from "./transforms";

export interface ResolvedSeries {
  ref: SeriesRef;
  label: string;
  source: string; // provenance badge: FRED | SIM | SNAPSHOT | ECON | ERR
  values: (number | null)[]; // aligned to the shared axis
}

export interface ChartData {
  axis: string[]; // ISO dates, ascending
  series: ResolvedSeries[];
  loading: boolean;
  /**
   * Refs that resolved to no usable data — a resolver/network error (`ERR`,
   * e.g. `/api/chart/series` unreachable on a static-only deploy) or an empty
   * observation set. Surfaced so the studio can show an explicit "unavailable"
   * state instead of a silently blank chart; failed series are otherwise
   * dropped from `series` because they contribute no axis dates.
   */
  failed: { ref: SeriesRef; label: string; source: string }[];
}

interface RawSeries {
  ref: SeriesRef;
  label: string;
  source: string;
  obs: { date: string; value: number | null }[];
}

/** ISO cutoff date for a range preset relative to the latest axis date. */
function rangeStart(lastIso: string, range: RangePreset): string | null {
  const months = rangeMonths(range);
  if (months == null) return null;
  const d = new Date(`${lastIso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a set of series refs from the unified /api/chart/series endpoint,
 * align them to a shared date axis, filter to the range, and apply the
 * normalize transform. Pure client-side; provenance is preserved per series.
 */
export function useChartSeries(refs: SeriesRef[], range: RangePreset, transform: Transform): ChartData {
  const { simEnabled, snapshotFallbackEnabled } = useSimMode();
  const key = JSON.stringify(refs);
  const [raw, setRaw] = useState<RawSeries[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(
      refs.map((r) => {
        const qs = new URLSearchParams({ source: r.source, id: r.id });
        if (r.assetClass) qs.set("assetClass", r.assetClass);
        if ((r.source === "econ" || r.source === "fred") && POINT_TRANSFORMS.includes(transform)) qs.set("units", "lin");
        if (simEnabled) qs.set("sim", "1");
        if (snapshotFallbackEnabled) qs.set("snapshot", "1");
        return fetchJson<any>(`/api/chart/series?${qs}`)
          .then(
            (j): RawSeries => ({
              ref: r,
              label: j.label ?? r.id,
              source: j.source ?? "SIM",
              obs: Array.isArray(j.observations) ? j.observations : [],
            })
          )
          .catch((): RawSeries => ({ ref: r, label: r.id, source: "ERR", obs: [] }));
      })
    ).then((res) => {
      if (alive) {
        setRaw(res);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [key, simEnabled, snapshotFallbackEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const { axis, series } = useMemo(() => {
    if (!raw.length) return { axis: [] as string[], series: [] as ResolvedSeries[] };

    // 1. point transform (pct/yoy/mom/log) on each series' own dense history
    const transformed = raw.map((r) => {
      const clean = r.obs.filter((o) => o.value != null) as { date: string; value: number }[];
      const dates = clean.map((o) => o.date);
      const values = clean.map((o) => o.value);
      const tv = applyPointTransform(transform, dates, values);
      const m = new Map<string, number | null>();
      dates.forEach((d, i) => m.set(d, tv[i]));
      return { ref: r.ref, label: r.label, source: r.source, dates, map: m };
    });

    // 2. shared axis across all (transformed) series
    const dateSet = new Set<string>();
    for (const t of transformed) for (const d of t.dates) dateSet.add(d);
    const axisAll = [...dateSet].sort();
    if (!axisAll.length) return { axis: [], series: [] };

    // 3. range filter
    const start = rangeStart(axisAll[axisAll.length - 1], range);
    const axis = start ? axisAll.filter((d) => d >= start) : axisAll;

    // 4. align + window transform (index100/zscore over the visible window)
    const series: ResolvedSeries[] = transformed.map((t) => {
      const aligned: (number | null)[] = axis.map((d) => (t.map.has(d) ? t.map.get(d)! : null));
      return { ref: t.ref, label: t.label, source: t.source, values: applyWindowTransform(transform, aligned) };
    });

    return { axis, series };
  }, [raw, range, transform]);

  // A ref failed when the resolver flagged it ERR or it carries no real points.
  const failed = useMemo(
    () =>
      raw
        .filter((r) => r.source === "ERR" || !r.obs.some((o) => o.value != null))
        .map((r) => ({ ref: r.ref, label: r.label, source: r.source })),
    [raw]
  );

  return { axis, series, loading, failed };
}
