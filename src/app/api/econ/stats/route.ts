import { json } from "@/lib/server/http";
import { STAT_SERIES, monthlyDate } from "@/data/statsConfig";
import type { Obs } from "@/lib/stats";
import { goldEnabled, goldParam, goldStore, goldTable } from "@/lib/server/goldStore";

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
 *   2. Explicit empty/error state
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get("start") ?? monthlyDate(240);
  const end = url.searchParams.get("end") ?? monthlyDate(0);
  const ids = STAT_SERIES.map(([id]) => id);

  if (goldEnabled()) {
    try {
      const store = goldStore();
      const placeholders = ids.map((_, i) => goldParam(i + 3)).join(",");
      const rows = await store.raw<GoldObsRow>(
        `SELECT series_id, observation_date AS date, value FROM ${goldTable("fred_feature_transforms")} WHERE observation_date >= ${goldParam(1)} AND observation_date <= ${goldParam(2)} AND series_id IN (${placeholders}) ORDER BY series_id, observation_date`,
        [start, end, ...ids]
      );

      if (rows.length) {
        const byId = new Map<string, { date: string; value: number }[]>();
        for (const row of rows) {
          const arr = byId.get(row.series_id) ?? [];
          arr.push({ date: row.date, value: row.value });
          byId.set(row.series_id, arr);
        }

        const series = STAT_SERIES.map(([id, label]) => {
          const obs = byId.get(id);
          if (obs?.length) return { id, label, points: toMonthly(obs, start, end) };
          return { id, label, points: [] };
        });

        return json({ source: "DB", start, end, series });
      }
    } catch (err) {
      console.warn("[stats] Gold DB read failed:", (err as Error).message);
      return json({ source: "ERR", start, end, series: [], error: (err as Error).message });
    }
  }

  return json({ source: "ERR", start, end, series: [], error: goldEnabled() ? "No Gold DB stats rows found." : "MACRO_DB_URL not configured." });
}
