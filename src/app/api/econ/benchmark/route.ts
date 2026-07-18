import { json } from "@/lib/server/http";
import { fredEnabled, fredSeries } from "@/lib/server/fred";
import { getSeriesHistory, resolveFred } from "@/data/econSeries";
import { getSnapshotObservations } from "@/data/econSnapshot";
import { BENCHMARK_SERIES } from "@/data/benchmarkRates";
import { worstSource } from "@/lib/provenance";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

export interface BenchmarkBatchSeries {
  id: string;
  observations: { date: string; value: number }[];
  source: "FRED" | "SNAPSHOT" | "SIM" | "DB";
  trend?: string | null;
  spread_to_benchmark?: number | null;
  regime?: string | null;
  zscore?: number | null;
  percentile?: number | null;
  staleness_days?: number | null;
}

interface GoldBenchmarkRow {
  rate_id: string;
  date: string;
  value: number;
  trend: string | null;
  spread_to_benchmark: number | null;
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
 *   2. Live FRED API
 *   3. Committed snapshot
 *   4. Deterministic SIM
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);
  const n = Number(url.searchParams.get("n") ?? 520);

  // 1. Gold DB
  if (goldEnabled() && ids.length) {
    try {
      const store = goldStore();
      const [boardRows, obsRows] = await Promise.all([
        store.latest<GoldBenchmarkRow>("benchmark_rate_board"),
        store.raw<GoldObsRow>(
          `SELECT series_id, date, value FROM ${process.env.MACRO_DB_URL?.startsWith("sqlite") ? "gold_fred_latest_observation" : "gold.fred_latest_observation"} WHERE series_id IN (${ids.map((_, i) => /^postgres/.test(process.env.MACRO_DB_URL ?? "") ? `$${i + 1}` : "?").join(",")}) ORDER BY series_id, date ASC`,
          ids
        ),
      ]);

      if (boardRows.length || obsRows.length) {
        const boardById = new Map(boardRows.map((r) => [r.rate_id, r]));
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
            return { id, observations: getSeriesHistory(id, n), source: "SIM" as const };
          }

          return {
            id,
            observations: obs,
            source: "DB" as const,
            trend: board?.trend ?? null,
            spread_to_benchmark: board?.spread_to_benchmark ?? null,
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
    }
  }

  // 2. FRED → 3. SNAPSHOT → 4. SIM
  const live = fredEnabled();
  const series = await Promise.all(
    ids.map(async (id): Promise<BenchmarkBatchSeries> => {
      const bmDef = BENCHMARK_SERIES.find((s) => s.id === id);
      const r = resolveFred(id);

      if (live && bmDef?.hasFred && !r.simOnly) {
        try {
          const obs = await fredSeries(id, { limit: n, units: "lin", scale: r.scale });
          if (obs.length) return { id, observations: obs as { date: string; value: number }[], source: "FRED" };
        } catch {
          /* fall through */
        }
      }

      const snap = getSnapshotObservations(id, n);
      if (snap) return { id, observations: snap as { date: string; value: number }[], source: "SNAPSHOT" };

      return { id, observations: getSeriesHistory(id, n), source: "SIM" };
    })
  );

  const source = worstSource(series.map((s) => s.source));
  return json({ source, series });
}
