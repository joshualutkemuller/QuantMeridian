import { json } from "@/lib/server/http";
import { fredEnabled, fredSeries } from "@/lib/server/fred"; // MIGRATION FALLBACK — remove in Phase 6
import { getSeriesHistory, getSeriesHistoryRaw, seriesById, resolveFred } from "@/data/econSeries"; // MIGRATION FALLBACK — remove in Phase 6
import { getSnapshotObservations, getSnapshotRawObservations } from "@/data/econSnapshot"; // MIGRATION FALLBACK — remove in Phase 6
import { getEtlInflationObservations } from "@/data/globalMacro";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";
import { simFallbackEnabled, snapshotFallbackEnabled } from "@/lib/server/fallbacks";

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
 *   2. Live FRED API
 *   3. Committed snapshot
 *   4. ETL inflation observations
 *   5. Deterministic SIM
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
  const allowSim = simFallbackEnabled(req);
  const allowSnapshot = snapshotFallbackEnabled(req);

  // 1. Gold DB
  if (goldEnabled()) {
    try {
      const store = goldStore();
      const isPg = /^postgres/.test(process.env.MACRO_DB_URL ?? "");
      const table = units === "lin"
        ? process.env.MACRO_DB_URL?.startsWith("sqlite") ? "gold_fred_latest_observation" : "gold.fred_latest_observation"
        : process.env.MACRO_DB_URL?.startsWith("sqlite") ? "gold_fred_feature_transforms" : "gold.fred_feature_transforms";
      const valueCol = transformColumn(units);
      const realtimeExpr = units === "lin" ? "realtime_start" : "NULL AS realtime_start";
      const rows = (await store.raw<GoldObsRow>(
        `SELECT series_id, observation_date AS date, ${valueCol} AS value, ${realtimeExpr}
         FROM ${table}
         WHERE series_id = ${isPg ? "$1" : "?"} AND ${valueCol} IS NOT NULL
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
    }
  }

  // 2. FRED
  if (fredEnabled() && !resolved.simOnly) {
    try {
      const obs = await fredSeries(id, { limit: n, units, scale: resolved.scale }); // MIGRATION FALLBACK — remove in Phase 6
      if (obs.length) {
        return json({ source: "FRED", id, label, units, observations: obs });
      }
    } catch {
      /* fall through */
    }
  }

  // 3. Snapshot
  if (allowSnapshot) {
    const snap = units === "lin"
      ? getSnapshotRawObservations(id, n) ?? getSnapshotObservations(id, n) // MIGRATION FALLBACK — remove in Phase 6
      : getSnapshotObservations(id, n); // MIGRATION FALLBACK — remove in Phase 6
    if (snap) {
      return json({ source: "SNAPSHOT", id, label, units, observations: snap });
    }
  }

  // 4. ETL
  const etl = getEtlInflationObservations(id, n);
  if (etl) {
    return json({ source: "ETL", id, label, units: "yoy", observations: etl });
  }

  // 5. SIM
  if (!allowSim) {
    return json({ source: "ERR", id, label, units, observations: [], error: "No DB/FRED/snapshot/ETL data available; enable SIM in the ribbon to use generated fallback data." });
  }
  const wantsRaw = reqUnits === "lin" && resolved.units !== "lin";
  if (wantsRaw) {
    const rawSim = getSeriesHistoryRaw(id, n); // MIGRATION FALLBACK — remove in Phase 6
    if (rawSim) return json({ source: "SIM", id, label, units, observations: rawSim });
  }
  return json({ source: "SIM", id, label, units, observations: getSeriesHistory(id, n) }); // MIGRATION FALLBACK — remove in Phase 6
}
