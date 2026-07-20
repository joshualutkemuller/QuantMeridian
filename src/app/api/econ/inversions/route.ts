import { json } from "@/lib/server/http";
import { fredEnabled, fredSeries } from "@/lib/server/fred"; // MIGRATION FALLBACK — remove in Phase 6
import { getSnapshotObservations, getSnapshotRawObservations } from "@/data/econSnapshot"; // MIGRATION FALLBACK — remove in Phase 6
import {
  computeInversionStats,
  detectInversions,
  getInversionStats,
  getInversionsForSpread,
  getSpreadSeriesFor,
  monthlySpreadTimeline,
  recessionRangesFromUsrec,
  spreadDef,
  tenorToFredId,
} from "@/data/econCurve";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";
import { simFallbackEnabled, snapshotFallbackEnabled } from "@/lib/server/fallbacks";

interface GoldEpisodeRow {
  spread_id: string;
  start_date: string;
  end_date: string | null;
  trough_bps: number | null;
  duration_days: number | null;
  recession_overlap: boolean | null;
  recession_lead_days: number | null;
}

interface GoldSpreadRow {
  spread_id: string;
  date: string;
  spread_bps: number;
  zscore: number | null;
  is_inverted: boolean | null;
  recession_flag: boolean | null;
}

const HISTORY_START = "1976-01-01";
const REVALIDATE = 12 * 60 * 60;

function snapshotObs(id: string) {
  return getSnapshotRawObservations(id) ?? getSnapshotObservations(id); // MIGRATION FALLBACK — remove in Phase 6
}

/**
 * GET /api/econ/inversions?spread=10Y2Y
 *
 * Resolution order:
 *   1. Gold DB — gold.spread_inversion_episode + curve_spread_daily
 *   2. Live FRED API
 *   3. Committed snapshot
 *   4. Deterministic SIM
 */
export async function GET(req: Request) {
  const spreadId = new URL(req.url).searchParams.get("spread") ?? "10Y2Y";
  const allowSim = simFallbackEnabled(req);
  const allowSnapshot = snapshotFallbackEnabled(req);
  const def = spreadDef(spreadId);

  const sim = () => ({
    source: "SIM" as const,
    spread: spreadId,
    inversions: getInversionsForSpread(spreadId),
    stats: getInversionStats(spreadId),
    timeline: getSpreadSeriesFor(spreadId),
  });

  const snap = () => {
    let series: { date: string; bps: number }[] = [];
    if (def.fredId) {
      const obs = snapshotObs(def.fredId);
      if (obs?.length) series = obs.map((o) => ({ date: o.date, bps: o.value }));
    } else {
      const longId = tenorToFredId(def.longT);
      const shortId = tenorToFredId(def.shortT);
      const lo = longId ? snapshotObs(longId) : null;
      const sh = shortId ? snapshotObs(shortId) : null;
      if (lo?.length && sh?.length) {
        const shMap = new Map(sh.map((o) => [o.date, o.value]));
        series = lo
          .filter((o) => shMap.has(o.date))
          .map((o) => ({ date: o.date, bps: (o.value - (shMap.get(o.date) as number)) * 100 }));
      }
    }
    if (series.length < 30) return null;
    const usrec = snapshotObs("USREC") ?? [];
    const recessions = recessionRangesFromUsrec(usrec.map((o) => ({ date: o.date, value: o.value })));
    const inversions = detectInversions(series, recessions.length ? recessions : []);
    const stats = computeInversionStats(inversions);
    const timeline = monthlySpreadTimeline(series, recessions.length ? recessions : []);
    return {
      source: "SNAPSHOT" as const,
      spread: spreadId,
      asOf: series[series.length - 1].date,
      inversions: inversions.length ? inversions : getInversionsForSpread(spreadId),
      stats: inversions.length ? stats : getInversionStats(spreadId),
      timeline: timeline.length ? timeline : getSpreadSeriesFor(spreadId),
    };
  };
  const unavailable = (note?: string) => ({
    source: "ERR" as const,
    spread: spreadId,
    inversions: [],
    stats: computeInversionStats([]),
    timeline: [],
    ...(note ? { note } : {}),
  });

  // 1. Gold DB
  if (goldEnabled()) {
    try {
      const store = goldStore();
      const [episodeRows, spreadRows] = await Promise.all([
        store.latest<GoldEpisodeRow>("spread_inversion_episode", { spread_id: spreadId }),
        store.history<GoldSpreadRow>("curve_spread_daily", { spread_id: spreadId }),
      ]);

      if (spreadRows.length) {
        const series = spreadRows.map((r) => ({ date: r.date, bps: r.spread_bps }));
        const recessionRows = spreadRows.filter((r) => r.recession_flag);
        // Reconstruct recession ranges from flagged dates
        const recessions = recessionRangesFromUsrec(
          spreadRows.map((r) => ({ date: r.date, value: r.recession_flag ? 1 : 0 }))
        );

        const inversions = episodeRows.map((ep) => ({
          start: ep.start_date,
          end: ep.end_date ?? "ongoing",
          trough_bps: ep.trough_bps ?? 0,
          duration_days: ep.duration_days ?? 0,
          recession_overlap: ep.recession_overlap ?? false,
          recession_lead_days: ep.recession_lead_days ?? null,
        }));
        const stats = computeInversionStats(inversions.map((i) => ({
          start: i.start,
          end: i.end,
          troughBps: i.trough_bps,
          durationDays: i.duration_days,
          hadRecession: i.recession_overlap,
          leadDays: i.recession_lead_days,
        })));
        const timeline = monthlySpreadTimeline(series, recessions);

        return json({
          source: "DB",
          spread: spreadId,
          asOf: series[series.length - 1]?.date ?? null,
          inversions,
          stats,
          timeline,
        });
      }
    } catch (err) {
      console.warn("[inversions] Gold DB read failed:", (err as Error).message);
    }
  }

  // 2. FRED
  if (!fredEnabled()) return json((allowSnapshot ? snap() : null) ?? (allowSim ? sim() : unavailable("No DB/FRED/snapshot inversion data available; enable Snapshot Fallback or SIM in the ribbon to use fallback data.")));

  try {
    let series: { date: string; bps: number }[] = [];
    if (def.fredId) {
      const obs = await fredSeries(def.fredId, { start: HISTORY_START, revalidateSec: REVALIDATE }); // MIGRATION FALLBACK — remove in Phase 6
      series = obs
        .filter((o) => o.value !== null)
        .map((o) => ({ date: o.date, bps: (o.value as number) * 100 }));
    } else {
      const longId = tenorToFredId(def.longT);
      const shortId = tenorToFredId(def.shortT);
      if (!longId || !shortId) return json(allowSim ? sim() : unavailable("Unsupported spread definition."));
      const [lo, sh] = await Promise.all([
        fredSeries(longId, { start: HISTORY_START, revalidateSec: REVALIDATE }), // MIGRATION FALLBACK — remove in Phase 6
        fredSeries(shortId, { start: HISTORY_START, revalidateSec: REVALIDATE }), // MIGRATION FALLBACK — remove in Phase 6
      ]);
      const shMap = new Map(sh.filter((o) => o.value !== null).map((o) => [o.date, o.value as number]));
      series = lo
        .filter((o) => o.value !== null && shMap.has(o.date))
        .map((o) => ({ date: o.date, bps: ((o.value as number) - (shMap.get(o.date) as number)) * 100 }));
    }
    if (series.length < 30) return json(allowSim ? sim() : unavailable("Not enough observations to detect inversions."));

    const usrec = await fredSeries("USREC", { start: "1970-01-01", revalidateSec: REVALIDATE }); // MIGRATION FALLBACK — remove in Phase 6
    const recessions = recessionRangesFromUsrec(
      usrec.filter((o) => o.value !== null).map((o) => ({ date: o.date, value: o.value as number }))
    );

    const inversions = detectInversions(series, recessions);
    const stats = computeInversionStats(inversions);
    const timeline = monthlySpreadTimeline(series, recessions);

    return json({
      source: "FRED",
      spread: spreadId,
      asOf: series[series.length - 1].date,
      inversions,
      stats,
      timeline,
    });
  } catch (err) {
    return json({ ...((allowSnapshot ? snap() : null) ?? (allowSim ? sim() : unavailable())), note: err instanceof Error ? err.message : "FRED error" });
  }
}
