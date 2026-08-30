/**
 * Canonical data-provenance vocabulary for the whole terminal.
 *
 * Post Gold-DB migration the primary source for Tier A/C series data is:
 *   DB        Gold DB (fred-bronze-to-gold-pipeline) — see GOLD_DB_MIGRATION_HANDOFF
 *
 * Freshness of DB rows is derived from the row's `staleness_days` field against
 * the series frequency in gold.dim_series: FRESH / AGING / STALE (§8).
 * The "vintage as of" tooltip uses `realtime_start` from Gold rows.
 *
 * Legacy tiers (used when Gold DB is not configured):
 *   FRED      live Federal Reserve (api.stlouisfed.org)
 *   LIVE      live market_data_pipeline FastAPI service
 *   FILE      local exported-file cache (mdp export-views)
 *   ETL       macro_data_etl gold tables (World Bank · BIS · CME)
 *   SNAPSHOT  committed build-time gold snapshot (FRED · Yahoo)
 *   ECON      deterministic econ model standing in for a macro level
 *   SIM       deterministic synthetic series (no real data available)
 *   LOADING   request in flight
 *   UNAVAILABLE approved source exists, but required upstream contract is not ready
 *   ERR       resolution failed
 *
 * Tier B sources (kept live — deliberate exceptions to DB-only policy):
 *   POLY      Polymarket Gamma API (non-series prediction market)
 */

export type ProvenanceSource =
  | "FRED"
  | "LIVE"
  | "POLY"
  | "DB"
  | "FILE"
  | "ETL"
  | "SNAPSHOT"
  | "ECON"
  | "SIM"
  | "LOADING"
  | "UNAVAILABLE"
  | "ERR";

export type ProvenanceTone = "live" | "snapshot" | "model" | "etl" | "loading" | "error";

export interface ProvenanceMeta {
  /** Short pill label shown to the user. */
  label: string;
  /** Whether this tier represents real, current data (drives the green pulse). */
  live: boolean;
  tone: ProvenanceTone;
  title: string;
}

export const PROVENANCE_META: Record<ProvenanceSource, ProvenanceMeta> = {
  FRED: { label: "LIVE · FRED", live: true, tone: "live", title: "Live data from FRED (api.stlouisfed.org)" },
  LIVE: { label: "LIVE · PIPELINE", live: true, tone: "live", title: "Live from the market_data_pipeline FastAPI service (MARKET_PIPELINE_URL)" },
  POLY: { label: "LIVE · POLY", live: true, tone: "live", title: "Live from Polymarket CLOB + Gamma APIs (public, no auth)" },
  DB: { label: "LIVE · DB", live: true, tone: "live", title: "Gold macro database — fred-bronze-to-gold-pipeline (MACRO_DB_URL)" },
  FILE: { label: "LIVE · FILE", live: true, tone: "live", title: "Local exported-file cache (MARKET_DATA_DIR — `mdp export-views`)" },
  ETL: { label: "ETL · MACRO", live: false, tone: "etl", title: "macro_data_etl gold tables (frozen 2026-06-24). Committed JSON snapshot — not live. Enable SIM or configure a live source (GOLD_DB_URL, FRED_API_KEY) for fresh data." },
  SNAPSHOT: { label: "SNAPSHOT", live: false, tone: "snapshot", title: "Committed gold snapshot (FRED · Yahoo). Configure a live source for fresh data." },
  ECON: { label: "ECON MODEL", live: false, tone: "model", title: "Deterministic econ model standing in for this macro level (set FRED_API_KEY for live data)." },
  SIM: { label: "SIM", live: false, tone: "model", title: "Deterministic simulation — no real data available for this series." },
  LOADING: { label: "SYNC", live: false, tone: "loading", title: "Fetching…" },
  UNAVAILABLE: { label: "PENDING", live: false, tone: "model", title: "Approved source path exists, but the required upstream contract is not ready." },
  ERR: { label: "ERR", live: false, tone: "error", title: "Could not resolve this series." },
};

/** Resolve meta for any string, tolerating unknown codes (treated as SIM). */
export function provenanceMeta(source: string): ProvenanceMeta {
  return PROVENANCE_META[source as ProvenanceSource] ?? PROVENANCE_META.SIM;
}

/**
 * Freshness of a dated observation, independent of its source tier. A live
 * pipeline can still serve stale data (no recent ingestion), and a committed
 * snapshot is fresh on the day it was cut — so freshness is classified from the
 * `asOf` date, not the source. This is what stops an old snapshot from looking
 * current (the "snapshot fallback can look current" risk in the readiness doc).
 */
export type Freshness = "FRESH" | "AGING" | "STALE" | "UNKNOWN";

export interface FreshnessInfo {
  status: Freshness;
  /** Whole calendar days between `asOf` and now, or `null` if unparseable. */
  ageDays: number | null;
  /** Compact marker, e.g. "6d" or "STALE · 21d" (empty when fresh/unknown). */
  label: string;
  title: string;
}

/**
 * Classify an `asOf` (YYYY-MM-DD or ISO) by age. Daily market closes tolerate a
 * few days (weekends/holidays) before they are "aging"; defaults: fresh ≤ 4d,
 * aging ≤ 10d, stale beyond that.
 */
export function classifyFreshness(
  asOf: string | null | undefined,
  opts: { freshDays?: number; agingDays?: number; now?: Date } = {}
): FreshnessInfo {
  const freshDays = opts.freshDays ?? 4;
  const agingDays = opts.agingDays ?? 10;
  if (!asOf) return { status: "UNKNOWN", ageDays: null, label: "", title: "No as-of date reported for this data." };
  const ts = Date.parse(asOf.length <= 10 ? `${asOf}T00:00:00Z` : asOf);
  if (!Number.isFinite(ts)) return { status: "UNKNOWN", ageDays: null, label: "", title: `Unparseable as-of date: ${asOf}` };
  const now = opts.now ?? new Date();
  const ageDays = Math.max(0, Math.floor((now.getTime() - ts) / 86_400_000));
  if (ageDays <= freshDays) return { status: "FRESH", ageDays, label: "", title: `Data as of ${asOf} (${ageDays}d ago) — current.` };
  if (ageDays <= agingDays) return { status: "AGING", ageDays, label: `${ageDays}d`, title: `Data as of ${asOf} (${ageDays}d ago) — aging; check upstream refresh.` };
  return { status: "STALE", ageDays, label: `STALE · ${ageDays}d`, title: `Data as of ${asOf} (${ageDays}d ago) — stale; upstream has not refreshed.` };
}

/**
 * Classify DB freshness from a Gold row's `staleness_days` field (§8).
 * Replaces the asOf-date guess for Tier A/C payloads — Gold carries exact staleness.
 *
 * Thresholds vary by series frequency:
 *   Daily  (D): fresh ≤ 3d, aging ≤ 7d
 *   Weekly (W): fresh ≤ 7d, aging ≤ 14d
 *   Monthly(M): fresh ≤ 35d, aging ≤ 60d
 *   Quarterly(Q): fresh ≤ 100d, aging ≤ 120d
 */
export function classifyDbStaleness(
  stalenessDays: number | null | undefined,
  freq: "D" | "W" | "M" | "Q" = "D",
  realtimeStart?: string | null
): FreshnessInfo {
  if (stalenessDays == null) return { status: "UNKNOWN", ageDays: null, label: "", title: "No staleness reported by Gold DB." };
  const thresholds: Record<string, [number, number]> = { D: [3, 7], W: [7, 14], M: [35, 60], Q: [100, 120] };
  const [freshDays, agingDays] = thresholds[freq] ?? thresholds.D;
  const vintage = realtimeStart ? ` (vintage ${realtimeStart})` : "";
  if (stalenessDays <= freshDays) return { status: "FRESH", ageDays: stalenessDays, label: "", title: `Gold DB: ${stalenessDays}d old — current${vintage}.` };
  if (stalenessDays <= agingDays) return { status: "AGING", ageDays: stalenessDays, label: `${stalenessDays}d`, title: `Gold DB: ${stalenessDays}d old — aging${vintage}; check pipeline refresh.` };
  return { status: "STALE", ageDays: stalenessDays, label: `STALE · ${stalenessDays}d`, title: `Gold DB: ${stalenessDays}d old — stale${vintage}; pipeline has not refreshed.` };
}

/**
 * Given an array of source strings, return the worst (lowest-tier) source.
 * Tier order: FRED > LIVE > DB > FILE > ETL > SNAPSHOT > ECON > SIM.
 * If any source is SIM, the overall source is SIM.
 * If sources are mixed across live/non-live, returns the worst one present.
 */
const SOURCE_TIER: Record<string, number> = {
  FRED: 0, LIVE: 1, POLY: 2, DB: 3, FILE: 4, ETL: 5, SNAPSHOT: 6, ECON: 7, SIM: 8, UNAVAILABLE: 9, ERR: 10,
};

export function worstSource<T extends string>(sources: T[]): T {
  if (!sources.length) return "SIM" as T;
  let worst = sources[0];
  let worstTier = SOURCE_TIER[worst] ?? 8;
  for (let i = 1; i < sources.length; i++) {
    const tier = SOURCE_TIER[sources[i]] ?? 8;
    if (tier > worstTier) { worst = sources[i]; worstTier = tier; }
  }
  return worst;
}

/** Tailwind classes for the non-fresh freshness states: [pill, dot]. */
export const FRESHNESS_TONE_CLASS: Record<"AGING" | "STALE", { pill: string; dot: string }> = {
  AGING: { pill: "border-term-amber/40 bg-term-amber/10 text-term-amber", dot: "bg-term-amber" },
  STALE: { pill: "border-term-down/40 bg-term-down/10 text-term-down", dot: "bg-term-down" },
};

/** Tailwind classes for each tone: [pill border+bg+text, dot bg]. */
export const PROVENANCE_TONE_CLASS: Record<ProvenanceTone, { pill: string; dot: string }> = {
  live: { pill: "border-term-up/40 bg-term-up/10 text-term-up", dot: "bg-term-up animate-blink" },
  snapshot: { pill: "border-term-violet/40 bg-term-violet/10 text-term-violet", dot: "bg-term-violet" },
  model: { pill: "border-term-amber/40 bg-term-amber/10 text-term-amber", dot: "bg-term-amber" },
  etl: { pill: "border-term-blue/40 bg-term-blue/10 text-term-blue", dot: "bg-term-blue" },
  loading: { pill: "border-term-border bg-term-panel-3 text-term-text-mute", dot: "bg-term-text-mute" },
  error: { pill: "border-term-down/40 bg-term-down/10 text-term-down", dot: "bg-term-down" },
};
