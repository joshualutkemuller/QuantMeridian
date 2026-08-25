import { json } from "@/lib/server/http";
import { worstSource } from "@/lib/provenance";
import { goldEnabled, goldParam, goldStore, goldTable } from "@/lib/server/goldStore";

export interface BatchSeries {
  id: string;
  observations: { date: string; value: number }[];
  source: "DB" | "ERR";
}

interface GoldFeatureRow {
  series_id: string;
  date: string;
  value: number;
}

function transformColumn(units: string | undefined): string {
  if (units === "pc1" || units === "yoy") return "yoy";
  if (units === "pch" || units === "mom") return "mom";
  if (units === "chg" || units === "diff") return "diff";
  if (units === "zscore") return "zscore";
  return "value";
}

/**
 * GET /api/econ/batch?ids=A,B,C&units=lin&n=15
 *
 * Resolution order:
 *   1. Gold DB — gold.macro_feature_daily (transformed) or fred_feature_transforms
 *   2. Explicit empty/error state
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 60);
  const requestedN = Number(url.searchParams.get("n") ?? 15);
  const n = Number.isFinite(requestedN) ? Math.max(1, Math.min(5000, Math.floor(requestedN))) : 15;
  const unitsOverride = url.searchParams.get("units") ?? undefined;

  if (!ids.length) return json({ source: "DB", series: [] });

  if (goldEnabled()) {
    try {
      const store = goldStore();
      // Gold stores transforms in wide columns (value/yoy/mom/diff/zscore).
      const placeholders = ids.map((_, i) => goldParam(i + 1)).join(",");
      const table = unitsOverride === "lin" ? goldTable("fred_latest_observation") : goldTable("fred_feature_transforms");
      const valueCol = transformColumn(unitsOverride);
      const rows = await store.raw<GoldFeatureRow>(
        `SELECT series_id, date, value
         FROM (
           SELECT series_id, observation_date AS date, ${valueCol} AS value,
             ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY observation_date DESC) AS rn
           FROM ${table}
           WHERE series_id IN (${placeholders}) AND ${valueCol} IS NOT NULL
         ) ranked
         WHERE rn <= ${n}
         ORDER BY series_id, date DESC`,
        ids
      );

      if (rows.length) {
        const byId = new Map<string, { date: string; value: number }[]>();
        for (const row of rows) {
          if (!byId.has(row.series_id)) byId.set(row.series_id, []);
          byId.get(row.series_id)!.push({ date: row.date, value: row.value });
        }

        // Reverse to ascending order for each series
        for (const [id, obs] of byId) byId.set(id, obs.reverse());

        const series: BatchSeries[] = ids.map((id) => {
          const obs = byId.get(id);
          if (!obs?.length) {
            return { id, observations: [], source: "ERR" as const };
          }
          return { id, observations: obs.slice(-n), source: "DB" as const };
        });

        const source = worstSource(series.map((s) => s.source));
        return json({ source, series });
      }
    } catch (err) {
      console.warn("[batch] Gold DB read failed:", (err as Error).message);
      return json({ source: "ERR", series: ids.map((id) => ({ id, observations: [], source: "ERR" as const })), error: (err as Error).message });
    }
  }

  const series: BatchSeries[] = ids.map((id) => ({ id, observations: [], source: "ERR" }));
  const source = worstSource(series.map((s) => s.source));
  return json({ source, series, error: "MACRO_DB_URL not configured or no Gold DB observations found." });
}
