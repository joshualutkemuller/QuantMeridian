import { json } from "@/lib/server/http";
import { seriesById, resolveFred } from "@/data/econSeries";
import { goldEnabled, goldParam, goldStore, goldTable } from "@/lib/server/goldStore";

interface GoldObsRow {
  series_id: string;
  date: string;
  value: number;
  realtime_start?: string;
}

function transformColumn(units: string | undefined): string {
  if (units === "pc1" || units === "yoy") return "yoy";
  if (units === "pch" || units === "mom") return "mom";
  if (units === "chg" || units === "diff") return "diff";
  if (units === "zscore") return "zscore";
  return "value";
}

/**
 * GET /api/econ/series?id=CPIAUCSL&n=24&units=pc1
 *
 * Resolution order:
 *   1. Gold DB — gold.fred_latest_observation (levels) or fred_feature_transforms (transformed)
 *   2. Explicit empty/error state
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "DGS10";
  const n = Number(url.searchParams.get("n") ?? 24);
  const reqUnits = url.searchParams.get("units") ?? undefined;
  const meta = seriesById(id);
  const resolved = resolveFred(id);
  const units = reqUnits ?? resolved.units;
  const label = meta?.label ?? id;

  if (goldEnabled()) {
    try {
      const store = goldStore();
      const table = units === "lin"
        ? goldTable("fred_latest_observation")
        : goldTable("fred_feature_transforms");
      const valueCol = transformColumn(units);
      const realtimeExpr = units === "lin" ? "realtime_start" : "NULL AS realtime_start";
      const rows = (await store.raw<GoldObsRow>(
        `SELECT series_id, observation_date AS date, ${valueCol} AS value, ${realtimeExpr}
         FROM ${table}
         WHERE series_id = ${goldParam(1)} AND ${valueCol} IS NOT NULL
         ORDER BY observation_date DESC
         LIMIT ${Number(n)}`,
        [id]
      )).reverse();
      if (rows.length) {
        const obs = rows.map((r) => ({ date: r.date, value: r.value }));
        return json({ source: "DB", id, label, units, observations: obs, realtime_start: rows[rows.length - 1]?.realtime_start ?? null });
      }
    } catch (err) {
      console.warn("[series] Gold DB read failed:", (err as Error).message);
      return json({ source: "ERR", id, label, units, observations: [], error: (err as Error).message });
    }
  }

  return json({
    source: "ERR",
    id,
    label,
    units,
    observations: [],
    error: goldEnabled() ? "No Gold DB observations found for series." : "MACRO_DB_URL not configured.",
  });
}
