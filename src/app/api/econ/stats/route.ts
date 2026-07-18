import { json } from "@/lib/server/http";
import { fredEnabled, fredSeries } from "@/lib/server/fred"; // MIGRATION FALLBACK — remove in Phase 6
import { resolveFred } from "@/data/econSeries";
import { STAT_SERIES, simStatFull, monthlyDate } from "@/data/statsConfig";
import { getSnapshotObservations, getSnapshotRawObservations } from "@/data/econSnapshot"; // MIGRATION FALLBACK — remove in Phase 6
import type { Obs } from "@/lib/stats";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

interface GoldObsRow {
  series_id: string;
  date: string;
  value: number;
}

/** Resample observations to one (last) value per month, within [start, end]. */
function toMonthly(obs: { date: string; value: number | null }[], start: string, end: string): Obs[] {
  const m = new Map<string, number>();
  for (const o of obs) {
    if (o.value == null || !isFinite(o.value)) continue;
    if (o.date < start || o.date > end) continue;
    m.set(o.date.slice(0, 7), o.value);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ym, value]) => ({ date: `${ym}-01`, value }));
}

/**
 * GET /api/econ/stats?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Resolution order:
 *   1. Gold DB — gold.fred_feature_transforms (raw obs, monthly resampled client-side)
 *   2. Live FRED API
 *   3. Committed snapshot
 *   4. Deterministic SIM
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get("start") ?? monthlyDate(240);
  const end = url.searchParams.get("end") ?? monthlyDate(0);
  const sim = simStatFull(320);
  const ids = STAT_SERIES.map(([id]) => id);

  // 1. Gold DB
  if (goldEnabled()) {
    try {
      const store = goldStore();
      const isPg = /^postgres/.test(process.env.MACRO_DB_URL ?? "");
      const isSqlite = !isPg && process.env.MACRO_DB_BACKEND !== "databricks";
      const phys = isSqlite ? "gold_fred_feature_transforms" : "gold.fred_feature_transforms";
      const placeholders = ids.map((_, i) => isPg ? `$${i + 3}` : "?").join(",");
      const rows = await store.raw<GoldObsRow>(
        `SELECT series_id, date, value FROM ${phys} WHERE date >= ${isPg ? "$1" : "?"} AND date <= ${isPg ? "$2" : "?"} AND series_id IN (${placeholders}) ORDER BY series_id, date`,
        [start, end, ...ids]
      );

      if (rows.length) {
        const byId = new Map<string, { date: string; value: number }[]>();
        for (const row of rows) {
          const arr = byId.get(row.series_id) ?? [];
          arr.push({ date: row.date, value: row.value });
          byId.set(row.series_id, arr);
        }

        const series = STAT_SERIES.map(([id, label], idx) => {
          const obs = byId.get(id);
          if (obs?.length) return { id, label, points: toMonthly(obs, start, end) };
          return { id, label, points: sim[idx].points.filter((p) => p.date >= start && p.date <= end) };
        });

        return json({ source: "DB", start, end, series });
      }
    } catch (err) {
      console.warn("[stats] Gold DB read failed:", (err as Error).message);
    }
  }

  // 2. FRED → 3. SNAPSHOT → 4. SIM
  const live = fredEnabled();
  let anyFred = false;
  let anySnapshot = false;

  const series = await Promise.all(
    STAT_SERIES.map(async ([id, label], idx) => {
      const r = resolveFred(id);
      if (live && !r.simOnly) {
        try {
          const obs = await fredSeries(id, { start, end, units: "lin", scale: r.scale }); // MIGRATION FALLBACK — remove in Phase 6
          const pts = toMonthly(obs, start, end);
          if (pts.length > 6) {
            anyFred = true;
            return { id, label, points: pts };
          }
        } catch {
          /* fall through */
        }
      }
      const snap = getSnapshotRawObservations(id) ?? getSnapshotObservations(id); // MIGRATION FALLBACK — remove in Phase 6
      if (snap) {
        const pts = toMonthly(snap, start, end);
        if (pts.length > 6) {
          anySnapshot = true;
          return { id, label, points: pts };
        }
      }
      return { id, label, points: sim[idx].points.filter((p) => p.date >= start && p.date <= end) };
    })
  );

  return json({ source: anyFred ? "FRED" : anySnapshot ? "SNAPSHOT" : "SIM", start, end, series });
}
