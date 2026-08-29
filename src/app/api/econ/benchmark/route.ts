import { json } from "@/lib/server/http";
import { worstSource } from "@/lib/provenance";
import { goldEnabled, goldParam, goldStore, goldTable } from "@/lib/server/goldStore";

export interface BenchmarkBatchSeries {
  id: string;
  observations: { date: string; value: number }[];
  source: "DB" | "ERR";
  trend?: string | null;
  spread_to_benchmark?: number | null;
  regime?: string | null;
  zscore?: number | null;
  percentile?: number | null;
  staleness_days?: number | null;
}

interface GoldBenchmarkRow {
  series_id: string;
  latest_date: string;
  latest_value: number;
  trend: string | null;
  spread_to_benchmark_bps: number | null;
  regime: string | null;
  zscore: number | null;
  percentile: number | null;
  staleness_days: number | null;
}

interface GoldObsRow {
  series_id: string;
  date: string;
  value: number;
}

/**
 * GET /api/econ/benchmark?ids=SOFR,DGS10&n=520
 *
 * Resolution order:
 *   1. Gold DB — gold.benchmark_rate_board + fred_latest_observation history
 *   2. Explicit empty/error state
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);
  const n = Number(url.searchParams.get("n") ?? 520);

  if (goldEnabled() && ids.length) {
    try {
      const store = goldStore();
      const [boardRows, obsRows] = await Promise.all([
        store.latest<GoldBenchmarkRow>("benchmark_rate_board"),
        store.raw<GoldObsRow>(
          `SELECT series_id, observation_date AS date, value FROM ${goldTable("fred_latest_observation")} WHERE series_id IN (${ids.map((_, i) => goldParam(i + 1)).join(",")}) AND value IS NOT NULL ORDER BY series_id, observation_date ASC`,
          ids
        ),
      ]);

      if (boardRows.length || obsRows.length) {
        const boardById = new Map(boardRows.map((r) => [r.series_id, r]));
        const obsByIdMap = new Map<string, { date: string; value: number }[]>();
        for (const row of obsRows) {
          const arr = obsByIdMap.get(row.series_id) ?? [];
          arr.push({ date: row.date, value: row.value });
          obsByIdMap.set(row.series_id, arr);
        }

        const series: BenchmarkBatchSeries[] = ids.map((id) => {
          const board = boardById.get(id);
          const obsAll = obsByIdMap.get(id) ?? [];
          const obs = obsAll.slice(-n);

          if (!obs.length && !board) {
            return { id, observations: [], source: "ERR" as const };
          }

          return {
            id,
            observations: obs,
            source: "DB" as const,
            trend: board?.trend ?? null,
            spread_to_benchmark: board?.spread_to_benchmark_bps ?? null,
            regime: board?.regime ?? null,
            zscore: board?.zscore ?? null,
            percentile: board?.percentile ?? null,
            staleness_days: board?.staleness_days ?? null,
          };
        });

        const source = worstSource(series.map((s) => s.source));
        return json({ source, series });
      }
    } catch (err) {
      console.warn("[benchmark] Gold DB read failed:", (err as Error).message);
      return json({ source: "ERR", series: ids.map((id) => ({ id, observations: [], source: "ERR" as const })), error: (err as Error).message });
    }
  }

  const series: BenchmarkBatchSeries[] = ids.map((id) => ({ id, observations: [], source: "ERR" }));

  const source = series.length ? worstSource(series.map((s) => s.source)) : "ERR";
  return json({ source, series, error: "MACRO_DB_URL not configured or no Gold DB benchmark rows found." });
}
