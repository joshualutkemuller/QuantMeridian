// Exception to DB-only policy — non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1.
import { json } from "@/lib/server/http";
import { fetchLiveNews } from "@/lib/server/newsProviders";
import { enrichWithNlp, fetchNlpClusters } from "@/lib/server/sentimentNlp";
import { getHeadlines } from "@/data/news";
import { simFallbackEnabled } from "@/lib/server/fallbacks";


/**
 * GET /api/news?n=60
 * Layered: headlines from the first configured provider (Alpha Vantage →
 * Marketaux → Finnhub → NewsAPI), then optionally re-scored + clustered by the
 * Python FinBERT stage (NEWS_NLP_URL). If no provider returns headlines, the
 * route returns ERR unless `sim=1` explicitly opts into generated headlines.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = Math.min(120, Math.max(10, Number(url.searchParams.get("n") ?? 60)));
  const live = await fetchLiveNews(n).catch(() => null);
  const diagnostics = live?.diagnostics ?? [];

  if (!live?.headlines.length && !simFallbackEnabled(req)) {
    return json({
      source: "ERR",
      headlines: [],
      clusters: [],
      diagnostics,
      error: "No configured news provider returned headlines. Add a provider key or request sim=1 for generated demo data.",
    });
  }

  const base = live?.headlines.length ? live : { source: "SIM", headlines: getHeadlines(n), diagnostics };
  const [{ headlines, nlp }, clusters] = await Promise.all([
    enrichWithNlp(base.headlines).catch(() => ({ headlines: base.headlines, nlp: false })),
    fetchNlpClusters(base.headlines).catch(() => null),
  ]);
  return json({ source: nlp ? `${base.source} + FinBERT` : base.source, headlines, clusters: clusters ?? [], diagnostics });
}
