/**
 * EDA view assembled from the Gold layer (fred-bronze-to-gold-pipeline).
 *
 * Sources — see GOLD_DB_MIGRATION_HANDOFF §4 (Phase 5, "Stats, EDA"):
 *   gold.series_lead_lag          → cross-correlation function + Granger tests
 *   gold.series_correlation       → Pearson heatmap (window = 0, full sample)
 *   gold.series_structural_breaks → CUSUM changepoints
 *
 * Two panels have **no Gold source** and are returned empty, with the reason
 * carried on `EdaView.coverage` so the UI can say so explicitly instead of
 * silently falling back to the committed snapshot:
 *   lagged_ols — the pipeline stores no lagged-OLS table.
 *   pelt       — the pipeline runs Chow, not PELT, so there are no regime
 *                segments (mean return / volatility per segment) to read.
 *
 * Gold's break/correlation facts are keyed by **pair**, not by series, so CUSUM
 * rows are identified as `A|B` with an `A ↔ B` display name. That is a faithful
 * representation of what the pipeline computes; do not collapse it to one side
 * of the pair, which would imply a per-series test that was never run.
 */
import { goldTable, type GoldStore } from "@/lib/server/goldStore";
import type {
  CrossCorrelationResult,
  CusumResult,
  EdaView,
  GrangerResult,
  PearsonHeatmap,
} from "@/data/marketPipeline";

interface LeadLagRow {
  series_a: string;
  series_b: string;
  lag: number;
  cross_correlation: number | null;
  best_lag: number | null;
  granger_f_ab: number | null;
  granger_p_ab: number | null;
  granger_f_ba: number | null;
  granger_p_ba: number | null;
  as_of_date: string | null;
}

interface BreakRow {
  series_a: string;
  series_b: string;
  test_type: string;
  break_date: string | null;
  cusum_max: number | null;
  is_significant: number | null;
  as_of_date: string | null;
}

interface CorrRow {
  series_a: string;
  series_b: string;
  correlation: number | null;
  observation_date: string | null;
}

interface DimSeriesRow {
  series_id: string;
  title: string | null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Latest full-sample (window = 0) correlation per pair. */
function heatmapSql(): string {
  const t = goldTable("series_correlation");
  return `SELECT c.series_a, c.series_b, c.correlation, c.observation_date
          FROM ${t} c
          JOIN (SELECT series_a, series_b, MAX(observation_date) AS md
                FROM ${t}
                WHERE window = 0
                GROUP BY series_a, series_b) m
            ON c.series_a = m.series_a
           AND c.series_b = m.series_b
           AND c.observation_date = m.md
          WHERE c.window = 0`;
}

function nameOf(titles: Map<string, string>, id: string): string {
  return titles.get(id) ?? id;
}

function pairKey(a: string, b: string): string {
  return `${a}|${b}`;
}

function crossCorrelation(rows: LeadLagRow[], titles: Map<string, string>): CrossCorrelationResult[] {
  const byPair = new Map<string, LeadLagRow[]>();
  for (const r of rows) {
    const key = pairKey(r.series_a, r.series_b);
    const arr = byPair.get(key) ?? [];
    arr.push(r);
    byPair.set(key, arr);
  }

  const out: CrossCorrelationResult[] = [];
  for (const group of byPair.values()) {
    const ordered = [...group].sort((a, b) => a.lag - b.lag);
    const ccf = ordered
      .map((r) => ({ lag: r.lag, corr: num(r.cross_correlation) }))
      .filter((p): p is { lag: number; corr: number } => p.corr !== null);
    if (!ccf.length) continue;

    const first = ordered[0];
    // `best_lag` is stored per pair (repeated on every lag row); fall back to the
    // largest |corr| when the pipeline left it null.
    const storedBest = num(first.best_lag);
    const peak = ccf.reduce((best, p) => (Math.abs(p.corr) > Math.abs(best.corr) ? p : best));
    const bestLag = storedBest ?? peak.lag;
    const bestCorr = ccf.find((p) => p.lag === bestLag)?.corr ?? peak.corr;

    out.push({
      leader: first.series_a,
      follower: first.series_b,
      leader_name: nameOf(titles, first.series_a),
      follower_name: nameOf(titles, first.series_b),
      best_lag: bestLag,
      best_corr: bestCorr,
      ccf,
    });
  }
  return out.sort((a, b) => Math.abs(b.best_corr) - Math.abs(a.best_corr));
}

/**
 * Both directions of each pair as separate rows. Gold stores Granger F/p at the
 * pair level (constant across the lag rows), so `lags` stays empty — the page
 * reads only `best_lag`, `f_stat` and `p_value`.
 */
function granger(rows: LeadLagRow[], titles: Map<string, string>): GrangerResult[] {
  const seen = new Set<string>();
  const out: GrangerResult[] = [];

  for (const r of rows) {
    const key = pairKey(r.series_a, r.series_b);
    if (seen.has(key)) continue;
    seen.add(key);

    const bestLag = num(r.best_lag) ?? 0;
    const directions: [string, string, number | null, number | null][] = [
      [r.series_a, r.series_b, num(r.granger_f_ab), num(r.granger_p_ab)],
      [r.series_b, r.series_a, num(r.granger_f_ba), num(r.granger_p_ba)],
    ];

    for (const [leader, follower, fStat, pValue] of directions) {
      if (fStat === null || pValue === null) continue;
      out.push({
        leader,
        follower,
        leader_name: nameOf(titles, leader),
        follower_name: nameOf(titles, follower),
        best_lag: bestLag,
        f_stat: fStat,
        p_value: pValue,
        lags: [],
      });
    }
  }
  return out.sort((a, b) => a.p_value - b.p_value);
}

/**
 * Sparse matrix over the union of series that appear in any measured pair.
 * Unmeasured cells are `null` (rendered blank) rather than 0 — a zero would read
 * as "measured, uncorrelated", which is a different and false claim.
 */
function heatmap(rows: CorrRow[], titles: Map<string, string>): PearsonHeatmap {
  const labels = [...new Set(rows.flatMap((r) => [r.series_a, r.series_b]))].sort();
  const index = new Map(labels.map((l, i) => [l, i]));
  const matrix: (number | null)[][] = labels.map((_, i) => labels.map((__, j) => (i === j ? 1 : null)));

  for (const r of rows) {
    const i = index.get(r.series_a);
    const j = index.get(r.series_b);
    const v = num(r.correlation);
    if (i === undefined || j === undefined || v === null) continue;
    matrix[i][j] = v;
    matrix[j][i] = v;
  }

  return { labels, display_names: labels.map((l) => nameOf(titles, l)), matrix };
}

function cusum(rows: BreakRow[], titles: Map<string, string>): CusumResult[] {
  return rows
    .filter((r) => r.test_type?.toLowerCase() === "cusum" && r.break_date)
    .map((r) => ({
      series_id: pairKey(r.series_a, r.series_b),
      display_name: `${nameOf(titles, r.series_a)} ↔ ${nameOf(titles, r.series_b)}`,
      changepoints: [r.break_date as string],
      cusum_path: [],
    }))
    .sort((a, b) => (b.changepoints[0] ?? "").localeCompare(a.changepoints[0] ?? ""));
}

function latestDate(...dates: (string | null | undefined)[]): string | null {
  return dates.reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null);
}

/**
 * Build the EDA view from Gold. Returns `null` when Gold holds none of the three
 * source tables' data, so the caller can fall through to the next tier rather
 * than publishing an empty view as if it were a successful DB read.
 */
export async function buildEdaFromGold(store: GoldStore): Promise<EdaView | null> {
  const [leadLag, breaks, corr, dim] = await Promise.all([
    store.latest<LeadLagRow>("series_lead_lag"),
    store.latest<BreakRow>("series_structural_breaks"),
    store.raw<CorrRow>(heatmapSql()),
    store.latest<DimSeriesRow>("dim_series"),
  ]);

  if (!leadLag.length && !corr.length && !breaks.length) return null;

  const titles = new Map<string, string>();
  for (const d of dim) if (d.series_id && d.title) titles.set(d.series_id, d.title);

  const asof = latestDate(
    ...leadLag.map((r) => r.as_of_date),
    ...breaks.map((r) => r.as_of_date),
    ...corr.map((r) => r.observation_date),
  );

  return {
    asof: asof ?? undefined,
    cross_correlation: crossCorrelation(leadLag, titles),
    granger_causality: granger(leadLag, titles),
    pearson_heatmap: heatmap(corr, titles),
    cusum: cusum(breaks, titles),
    lagged_ols: [],
    pelt: [],
    coverage: {
      cross_correlation: true,
      granger_causality: true,
      pearson_heatmap: true,
      cusum: true,
      lagged_ols: "gold.series_lead_lag stores no lagged-OLS fit (no R²/beta table in the pipeline)",
      pelt: "the pipeline runs Chow structural-break tests, not PELT — no regime segments are computed",
    },
  };
}
