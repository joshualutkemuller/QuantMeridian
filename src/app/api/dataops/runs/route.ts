import { json } from "@/lib/server/http";
import { fetchPipelineManifest } from "@/lib/server/marketManifest";
import { fetchIntelligenceFeedManifest } from "@/lib/server/intelligenceFeedManifest";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";
import type { LineageRun, ProviderRun, SeriesRunResult } from "@/data/dataOps";

interface GoldEtlRunRow {
  run_id: string;
  pipeline: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  series_count: number | null;
  rows_written: number | null;
  error_msg: string | null;
}

interface GoldSeriesRunRow {
  run_id: string;
  series_id: string;
  status: string;
  rows_written: number | null;
  error_msg: string | null;
}

interface GoldDqRow {
  run_id: string;
  series_id: string;
  check_name: string;
  result: string;
  detail: string | null;
  checked_at: string;
}

/**
 * GET /api/dataops/runs
 *
 * Resolution order:
 *   1. Gold DB — audit.etl_run + audit.etl_series_run + audit.data_quality_result
 *   2. MARKET_PIPELINE_URL manifest (legacy)
 *   3. Empty fixture
 */
export async function GET() {
  const intelligence = await fetchIntelligenceFeedManifest().catch((err) => {
    console.warn("[dataops/runs] intelligence feed manifest failed:", (err as Error).message);
    return null;
  });

  // 1. Gold DB audit tables
  if (goldEnabled()) {
    try {
      const store = goldStore();
      // Audit tables use the audit schema — physical names differ from gold.*
      const isSqlite = !process.env.MACRO_DB_URL?.startsWith("postgres") && process.env.MACRO_DB_BACKEND !== "databricks";
      const runTable = isSqlite ? "audit_etl_run" : "audit.etl_run";
      const seriesTable = isSqlite ? "audit_etl_series_run" : "audit.etl_series_run";
      const dqTable = isSqlite ? "audit_data_quality_result" : "audit.data_quality_result";

      const [runs, seriesRuns, dqResults] = await Promise.all([
        store.raw<GoldEtlRunRow>(`SELECT * FROM ${runTable} ORDER BY started_at DESC LIMIT 50`, []),
        store.raw<GoldSeriesRunRow>(`SELECT * FROM ${seriesTable} ORDER BY run_id DESC LIMIT 500`, []),
        store.raw<GoldDqRow>(`SELECT * FROM ${dqTable} ORDER BY checked_at DESC LIMIT 500`, []),
      ]);

      if (runs.length) {
        const lineage = dqResults.map((r) => ({
          series_id: r.series_id,
          check: r.check_name,
          result: r.result,
          detail: r.detail,
          checked_at: r.checked_at,
        }));

        return json({
          source: intelligence ? "DB+INTELLIGENCE_FEEDS" : "DB",
          live: true,
          runs: [...runs, ...(intelligence?.runs ?? [])],
          series: [...seriesRuns, ...(intelligence?.series ?? [])],
          lineage: [...lineage, ...(intelligence?.lineage ?? [])],
        });
      }
    } catch (err) {
      console.warn("[dataops/runs] Gold audit DB read failed:", (err as Error).message);
    }
  }

  // 2. MARKET_PIPELINE_URL manifest (legacy fallback)
  const data = await fetchPipelineManifest().catch(() => null);
  const merged = {
    runs: [...(data?.runs ?? []), ...(intelligence?.runs ?? [])] as ProviderRun[],
    series: [...(data?.series ?? []), ...(intelligence?.series ?? [])] as SeriesRunResult[],
    lineage: [...(data?.lineage ?? []), ...(intelligence?.lineage ?? [])] as LineageRun[],
  };
  if (merged.runs.length) {
    return json({
      source: data && intelligence ? "PIPELINE+INTELLIGENCE_FEEDS" : data ? "PIPELINE" : "INTELLIGENCE_FEEDS",
      live: true,
      ...merged,
    });
  }

  // 3. Empty fixture
  return json({ source: "NONE", live: false, runs: [], series: [], lineage: [] });
}
