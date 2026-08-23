import { json } from "@/lib/server/http";
import { fredEnabled, fredSeries } from "@/lib/server/fred"; // MIGRATION FALLBACK — remove in Phase 6
import { getSeriesHistory, getSeriesHistoryRaw, resolveFred } from "@/data/econSeries"; // MIGRATION FALLBACK — remove in Phase 6
import { getSnapshotObservations, getSnapshotRawObservations } from "@/data/econSnapshot"; // MIGRATION FALLBACK — remove in Phase 6
import { worstSource } from "@/lib/provenance";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";
import { simFallbackEnabled, snapshotFallbackEnabled } from "@/lib/server/fallbacks";

export interface BatchSeries {
  id: string;
  observations: { date: string; value: number }[];
  source: "FRED" | "SNAPSHOT" | "SIM" | "DB" | "ERR";
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
 *   2. Live FRED API
 *   3. Committed snapshot
 *   4. Deterministic SIM
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 60);
  const requestedN = Number(url.searchParams.get("n") ?? 15);
  const n = Number.isFinite(requestedN) ? Math.max(1, Math.min(5000, Math.floor(requestedN))) : 15;
  const unitsOverride = url.searchParams.get("units") ?? undefined;
  const allowSim = simFallbackEnabled(req);
  const allowSnapshot = snapshotFallbackEnabled(req);

  if (!ids.length) return json({ source: "DB", series: [] });

  // 1. Gold DB
  if (goldEnabled()) {
    try {
      const store = goldStore();
      // Gold stores transforms in wide columns (value/yoy/mom/diff/zscore).
      const placeholders = ids.map((_, i) => (process.env.MACRO_DB_BACKEND === "databricks" || /^postgres/.test(process.env.MACRO_DB_URL ?? "") ? `$${i + 1}` : "?")).join(",");
      const table = process.env.MACRO_DB_URL?.startsWith("sqlite") ? "gold_fred_feature_transforms" : "gold.fred_feature_transforms";
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
            if (!allowSim) return { id, observations: [], source: "ERR" as const };
            const r = resolveFred(id);
            const wantsRaw = unitsOverride === "lin" && r.units !== "lin";
            const simObs = wantsRaw ? getSeriesHistoryRaw(id, n) ?? getSeriesHistory(id, n) : getSeriesHistory(id, n); // MIGRATION FALLBACK — remove in Phase 6
            return { id, observations: simObs, source: "SIM" as const };
          }
          return { id, observations: obs.slice(-n), source: "DB" as const };
        });

        const source = worstSource(series.map((s) => s.source));
        return json({ source, series });
      }
    } catch (err) {
      console.warn("[batch] Gold DB read failed:", (err as Error).message);
    }
  }

  // 2. FRED → 3. SNAPSHOT → 4. SIM
  const live = fredEnabled();
  const series = await Promise.all(
    ids.map(async (id): Promise<BatchSeries> => {
      const r = resolveFred(id);
      const units = unitsOverride ?? r.units;
      if (live && !r.simOnly) {
        try {
          const obs = await fredSeries(id, { limit: n, units, scale: r.scale }); // MIGRATION FALLBACK — remove in Phase 6
          if (obs.length) return { id, observations: obs as { date: string; value: number }[], source: "FRED" };
        } catch {
          /* fall through */
        }
      }
      if (allowSnapshot) {
        const snap = units === "lin" ? getSnapshotRawObservations(id, n) ?? getSnapshotObservations(id, n) : getSnapshotObservations(id, n); // MIGRATION FALLBACK — remove in Phase 6
        if (snap) return { id, observations: snap as { date: string; value: number }[], source: "SNAPSHOT" };
      }
      if (!allowSim) return { id, observations: [], source: "ERR" };
      const wantsRaw = units === "lin" && r.units !== "lin";
      const simObs = wantsRaw ? getSeriesHistoryRaw(id, n) ?? getSeriesHistory(id, n) : getSeriesHistory(id, n); // MIGRATION FALLBACK — remove in Phase 6
      return { id, observations: simObs, source: "SIM" };
    })
  );

  const source = worstSource(series.map((s) => s.source));
  return json({ source, series });
}
