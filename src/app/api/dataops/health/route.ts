import { json } from "@/lib/server/http";
import { fredProbe } from "@/lib/server/fred";
import { getIntelligenceFeedDiagnostics } from "@/lib/server/intelligenceFeedManifest";
import { configuredSocialProviders } from "@/lib/server/socialProviders";
import { goldConfigStatus, goldEnabled, goldStore } from "@/lib/server/goldStore";

type Status = "LIVE" | "CACHED" | "SIM" | "STALE" | "ERROR" | "FALLBACK_AVAILABLE";
interface ProviderProbe {
  status: Status;
  detail: string;
  live: boolean;
  latencyMs?: number;
  configured?: boolean;
  readSuccessfully?: boolean;
  backend?: string;
  target?: string;
  explicitStatus?: string;
  diagnostics?: unknown;
}

/** Reachability probe for URL-based upstreams (news_nlp, market pipeline). */
async function probe(base: string, path = "/health", ms = 3000): Promise<{ ok: boolean; body?: Record<string, unknown> }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}${path}`, { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) return { ok: false };
    return { ok: true, body: await r.json().catch(() => undefined) };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/dataops/health
 * Probes each backend's real status from the server (env config + reachability
 * checks for URL-based services). Always 200.
 *
 * After the Gold DB migration, MACRO_DB (GoldStore) is the primary source for
 * all Tier A/C series data. FRED, MARKET_*, MACRO_ETL are legacy/fallback paths.
 */
export async function GET() {
  const providers: Record<string, ProviderProbe> = {};
  const goldConfig = goldConfigStatus();

  // Gold DB — primary series data source post-migration (Tier A + C).
  if (goldEnabled()) {
    try {
      const h = await goldStore().health();
      providers.MACRO_DB = h.ok
        ? {
            status: "LIVE",
            detail: `MACRO_DB_URL configured properly; Gold DB read successfully — backend=${h.backend}, ${h.detail}`,
            live: true,
            latencyMs: h.latencyMs,
            configured: true,
            readSuccessfully: true,
            backend: h.backend,
            target: goldConfig.target,
            explicitStatus: "MACRO_DB_URL configured properly; Gold DB read successfully",
          }
        : {
            status: "ERROR",
            detail: `MACRO_DB_URL configured properly; Gold DB read failed — ${h.detail}`,
            live: false,
            latencyMs: h.latencyMs,
            configured: true,
            readSuccessfully: false,
            backend: h.backend,
            target: goldConfig.target,
            explicitStatus: "MACRO_DB_URL configured properly; Gold DB read failed",
          };
      console.log(`[dataops:MACRO_DB] ${providers.MACRO_DB.explicitStatus} (${goldConfig.target}, latencyMs=${providers.MACRO_DB.latencyMs ?? "?"})`);
    } catch (err) {
      providers.MACRO_DB = {
        status: "ERROR",
        detail: `MACRO_DB_URL configured properly; Gold DB read failed — ${(err as Error).message}`,
        live: false,
        configured: true,
        readSuccessfully: false,
        backend: goldConfig.backend,
        target: goldConfig.target,
        explicitStatus: "MACRO_DB_URL configured properly; Gold DB read failed",
      };
      console.warn(`[dataops:MACRO_DB] ${providers.MACRO_DB.explicitStatus} (${goldConfig.target}): ${(err as Error).message}`);
    }
  } else {
    providers.MACRO_DB = {
      status: "ERROR",
      detail: "MACRO_DB_URL not configured — Tier A/C routes return explicit empty/error states",
      live: false,
      configured: false,
      readSuccessfully: false,
      backend: goldConfig.backend,
      target: goldConfig.target,
      explicitStatus: "MACRO_DB_URL not configured",
    };
    console.warn(`[dataops:MACRO_DB] ${providers.MACRO_DB.explicitStatus}`);
  }

  // Gold source coverage (if DB is live)
  if (providers.MACRO_DB?.live) {
    try {
      const rows = await goldStore().raw<{ source: string; series_count: number; avg_staleness_days: number }>(
        `SELECT source, COUNT(*) AS series_count, AVG(days_since_last) AS avg_staleness_days FROM ${process.env.MACRO_DB_URL?.startsWith("sqlite") ? "gold_v_source_coverage" : "gold.v_source_coverage"} GROUP BY source`,
        []
      );
      providers.MACRO_DB_COVERAGE = {
        status: "LIVE",
        detail: rows.map((r) => `${r.source}: ${r.series_count} series, avg staleness ${r.avg_staleness_days?.toFixed(1) ?? "?"}d`).join(" · "),
        live: true,
      };
    } catch {
      // coverage view not yet populated — non-fatal
    }
  }

  // FRED — legacy fallback for Tier A routes when Gold DB is not configured.
  const fred = await fredProbe();
  providers.FRED = !fred.keyPresent
    ? { status: "ERROR", detail: fred.detail + " — Tier A routes return explicit empty/error states when Gold DB is absent", live: false }
    : fred.ok
    ? { status: "LIVE", detail: fred.detail + " (legacy fallback — Gold DB preferred)", live: true }
    : { status: "ERROR", detail: fred.detail, live: false };

  // Market pipeline (YAHOO) — legacy fallback; Gold equity tables are now preferred.
  const { MARKET_DB_URL, MARKET_DATA_DIR, MARKET_PIPELINE_URL } = process.env;
  if (MARKET_PIPELINE_URL) {
    const p = await probe(MARKET_PIPELINE_URL);
    providers.YAHOO = p.ok
      ? { status: "LIVE", detail: `pipeline service reachable (${MARKET_PIPELINE_URL}) — Gold equity tables preferred`, live: true }
      : { status: "STALE", detail: "MARKET_PIPELINE_URL set but unreachable", live: false };
  } else if (MARKET_DB_URL) {
    providers.YAHOO = { status: "LIVE", detail: "MARKET_DB_URL (DuckDB/Postgres analytics_api_views) — Gold equity tables preferred", live: true };
  } else if (MARKET_DATA_DIR) {
    providers.YAHOO = { status: "LIVE", detail: "MARKET_DATA_DIR (exported views) — Gold equity tables preferred", live: true };
  } else {
    providers.YAHOO = { status: "CACHED", detail: "committed market snapshot (Gold equity tables preferred)", live: false };
  }

  // macro_data_etl — committed gold snapshot at build time.
  providers.MACRO_ETL = { status: "CACHED", detail: "committed macro_data_etl gold snapshot", live: false };

  // News/social provider chains — Tier B (kept live, deliberate exception to DB-only policy).
  // Exception to DB-only policy: non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1.
  const socialP = configuredSocialProviders();
  const intelligence = await getIntelligenceFeedDiagnostics();
  const news = intelligence.news;
  const social = intelligence.social;
  const feeds = [...news.configuredProviders, ...socialP];
  providers.INTELLIGENCE_FEEDS = intelligence.live
    ? {
        status: "LIVE",
        detail: intelligence.detail,
        live: true,
        configured: intelligence.configured,
        readSuccessfully: true,
        explicitStatus: "At least one real intelligence feed is available",
        diagnostics: intelligence,
      }
    : {
        status: "ERROR",
        detail: intelligence.configured
          ? `${intelligence.detail}; configured feed paths returned no usable rows`
          : "No NEWS, SOCIAL, or NEWS_NLP providers configured; routes return ERR unless sim=1 is requested",
        live: false,
        configured: intelligence.configured,
        readSuccessfully: false,
        explicitStatus: "No real intelligence feeds available",
        diagnostics: intelligence,
      };

  try {
    providers.NEWS = news.live
      ? {
          status: "LIVE",
          detail: `${news.source}: ${news.headlineCount} headlines; newest ${news.newestMinutesAgo ?? "?"}m ago${news.nlp.ok ? `; NLP ${news.nlp.model ?? "up"}` : ""}`,
          live: true,
          configured: news.configuredProviders.length > 0,
          readSuccessfully: true,
          latencyMs: news.attempts.find((attempt) => attempt.ok)?.latencyMs,
          explicitStatus: "Real news provider returned headlines",
          diagnostics: news,
        }
      : {
          status: "ERROR",
          detail: news.configuredProviders.length
            ? `Configured providers returned no headlines: ${news.attempts.map((attempt) => `${attempt.provider}=${attempt.error ?? "no headlines"}`).join("; ")}`
            : "No news provider keys configured; /api/news returns ERR unless sim=1 is requested",
          live: false,
          configured: news.configuredProviders.length > 0,
          readSuccessfully: false,
          explicitStatus: "No real news headlines available",
          diagnostics: news,
        };
  } catch (err) {
    providers.NEWS = {
      status: "ERROR",
      detail: `News diagnostics failed — ${err instanceof Error ? err.message : String(err)}`,
      live: false,
      configured: news.configuredProviders.length > 0,
      readSuccessfully: false,
      explicitStatus: "News diagnostics failed",
    };
  }
  providers.SOCIAL = social.live
    ? {
        status: "LIVE",
        detail: `${social.source}: ${social.totalPosts} posts across ${social.platformCount} platforms${social.topTicker ? `; top ticker ${social.topTicker.label}` : ""}`,
        live: true,
        configured: social.configuredProviders.length > 0,
        readSuccessfully: true,
        latencyMs: social.attempts.find((attempt) => attempt.ok)?.latencyMs,
        explicitStatus: "Real social provider returned posts",
        diagnostics: social,
      }
    : {
        status: "ERROR",
        detail: social.configuredProviders.length
          ? `Configured social providers returned no posts: ${social.attempts.map((attempt) => `${attempt.provider}=${attempt.error ?? "no posts"}`).join("; ")}`
          : "No social provider keys configured; /api/social returns ERR unless sim=1 is requested",
        live: false,
        configured: social.configuredProviders.length > 0,
        readSuccessfully: false,
        explicitStatus: "No real social posts available",
        diagnostics: social,
      };

  if (news.nlp.configured) {
    providers.NEWS_NLP = news.nlp.ok
      ? { status: "LIVE", detail: `FinBERT service up (model=${news.nlp.model ?? "?"})${feeds.length ? ` · feeds: ${feeds.join(", ")}` : ""}`, live: true, diagnostics: news.nlp }
      : { status: "STALE", detail: `NEWS_NLP_URL set but /health unreachable — ${news.nlp.error ?? "unknown error"}`, live: false, diagnostics: news.nlp };
  } else if (feeds.length) {
    providers.NEWS_NLP = { status: "CACHED", detail: `provider sentiment + in-house heuristic · feeds: ${feeds.join(", ")}`, live: false, diagnostics: news.nlp };
  } else {
    providers.NEWS_NLP = { status: "SIM", detail: "no news/social keys, no NEWS_NLP_URL — heuristic/SIM", live: false, diagnostics: news.nlp };
  }

  // Internal books — Tier C: book stays synthetic; macro inputs wired to Gold DB.
  providers.LOCAL_BOOK = {
    status: providers.MACRO_DB?.live ? "LIVE" : "ERROR",
    detail: providers.MACRO_DB?.live
      ? "Tier C book: macro/rate inputs from Gold DB; position/P&L synthetic"
      : "Tier C book: macro inputs not connected (Gold DB absent), falling back to SIM",
    live: providers.MACRO_DB?.live ?? false,
  };

  // Deterministic fallback — always available.
  providers.SYNTHETIC = { status: "FALLBACK_AVAILABLE", detail: "deterministic fallback available; not a live upstream", live: false };

  return json({ probedAt: new Date().toISOString(), providers });
}
