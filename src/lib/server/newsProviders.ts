/**
 * Live news provider chain for the NEWS module.
 *
 * Tries each configured provider in priority order and returns the first that
 * yields headlines, normalized into the module's `Headline` shape. Every
 * provider is independent and behind its own env key, so the chain degrades
 * visibly: if Alpha Vantage is missing/rate-limited/errors, it falls through to
 * Marketaux → Finnhub → NewsAPI. The API route returns ERR unless the request
 * explicitly opts into SIM with `sim=1`.
 *
 * Env keys (set any/all):
 *   ALPHAVANTAGE_API_KEY   — Alpha Vantage NEWS_SENTIMENT (sentiment + tickers)
 *   MARKETAUX_API_KEY      — Marketaux /news/all (sentiment + entities)
 *   FINNHUB_API_KEY        — Finnhub /news (general market news)
 *   NEWSAPI_API_KEY        — NewsAPI.org /top-headlines (business)
 */
import { getHeadlines, type Headline, type AssetClass, type Sentiment } from "@/data/news";
import { scoreText } from "@/lib/server/sentimentNlp";

export interface LiveNews {
  source: string;
  headlines: Headline[];
  diagnostics: NewsProviderAttempt[];
}

export interface NewsProviderAttempt {
  provider: string;
  configured: boolean;
  ok: boolean;
  headlineCount: number;
  latencyMs: number;
  error?: string;
}

const FETCH_TIMEOUT_MS = 6000;

const sentimentFrom = (s: number): Sentiment => (s > 0.15 ? "BULLISH" : s < -0.15 ? "BEARISH" : "NEUTRAL");
const clampScore = (s: number) => Math.max(-1, Math.min(1, s));

/** Infer an asset class from the mentioned tickers / headline text. */
function inferAssetClass(tickers: string[], title = ""): AssetClass {
  const t = tickers.join(" ").toUpperCase();
  const x = `${t} ${title.toUpperCase()}`;
  if (/\b(BTC|ETH|CRYPTO|BITCOIN|ETHEREUM|COIN)\b/.test(x)) return "CRYPTO";
  if (/\b(TLT|IEF|SHY|UST|TREASUR|YIELD|FED|RATE)\b/.test(x)) return "RATES";
  if (/\b(HYG|LQD|CREDIT|SPREAD|BOND)\b/.test(x)) return "CREDIT";
  if (/\b(GLD|USO|OIL|GOLD|COPPER|CRUDE|COMMODIT)\b/.test(x)) return "COMMODITY";
  if (/\b(DXY|FX|DOLLAR|EURO|YEN|CURRENC)\b/.test(x)) return "FX";
  return "EQUITY";
}

/** In-house heuristic sentiment (shared, negation-aware) for providers that don't supply a score. */
const keywordScore = (text: string): number => scoreText(text).score;

function minsAgoFromISO(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60000)) : 0;
}
function hhmmFromISO(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 16);
}

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Provider adapters (each returns Headline[] or null) ──────────────────────

/** Alpha Vantage NEWS_SENTIMENT — richest free option: per-article + per-ticker sentiment. */
async function alphaVantage(n: number): Promise<Headline[] | null> {
  const key = process.env.ALPHAVANTAGE_API_KEY;
  if (!key) return null;
  const j = await getJson(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&sort=LATEST&limit=${n}&apikey=${key}`);
  if (!Array.isArray(j?.feed) || !j.feed.length) return null; // includes rate-limit "Note"/"Information" payloads
  return j.feed.slice(0, n).map((a: any, i: number): Headline => {
    const score = clampScore(Number(a.overall_sentiment_score ?? 0));
    const tickers = Array.isArray(a.ticker_sentiment) ? a.ticker_sentiment.slice(0, 4).map((x: any) => x.ticker) : [];
    const ts = String(a.time_published ?? ""); // YYYYMMDDTHHMMSS (UTC)
    const iso = ts.length >= 15 ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}Z` : undefined;
    return {
      id: a.url ?? `av-${i}`,
      minutesAgo: minsAgoFromISO(iso),
      time: hhmmFromISO(iso),
      importance: Math.round(Math.min(99, Math.max(8, Number(a.relevance_score ?? 0.4) * 100 + 30))),
      impact: Math.round(Math.min(99, Math.max(5, Math.abs(score) * 80 + 20))),
      assetClass: inferAssetClass(tickers, a.title),
      region: "US",
      source: a.source ?? "Alpha Vantage",
      headline: a.title ?? "",
      sentiment: sentimentFrom(score),
      sentimentScore: score,
      tickers,
    };
  });
}

/** Marketaux — financial news with entity tagging + per-entity sentiment. */
async function marketaux(n: number): Promise<Headline[] | null> {
  const key = process.env.MARKETAUX_API_KEY;
  if (!key) return null;
  const j = await getJson(`https://api.marketaux.com/v1/news/all?language=en&filter_entities=true&limit=${Math.min(n, 100)}&api_token=${key}`);
  if (!Array.isArray(j?.data) || !j.data.length) return null;
  return j.data.slice(0, n).map((a: any, i: number): Headline => {
    const ents = Array.isArray(a.entities) ? a.entities : [];
    const score = clampScore(ents.length ? ents.reduce((s: number, e: any) => s + Number(e.sentiment_score ?? 0), 0) / ents.length : keywordScore(a.title ?? ""));
    const tickers = ents.filter((e: any) => e.symbol).slice(0, 4).map((e: any) => e.symbol);
    return {
      id: a.uuid ?? a.url ?? `mx-${i}`,
      minutesAgo: minsAgoFromISO(a.published_at),
      time: hhmmFromISO(a.published_at),
      importance: Math.round(Math.min(99, Math.max(8, 45 + Math.abs(score) * 40))),
      impact: Math.round(Math.min(99, Math.max(5, Math.abs(score) * 80 + 20))),
      assetClass: inferAssetClass(tickers, a.title),
      region: "US",
      source: a.source ?? "Marketaux",
      headline: a.title ?? "",
      sentiment: sentimentFrom(score),
      sentimentScore: score,
      tickers,
    };
  });
}

/** Finnhub general market news (no sentiment → keyword score). */
async function finnhub(n: number): Promise<Headline[] | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const j = await getJson(`https://finnhub.io/api/v1/news?category=general&token=${key}`);
  if (!Array.isArray(j) || !j.length) return null;
  return j.slice(0, n).map((a: any, i: number): Headline => {
    const score = clampScore(keywordScore(`${a.headline ?? ""} ${a.summary ?? ""}`));
    const iso = a.datetime ? new Date(a.datetime * 1000).toISOString() : undefined;
    const related = typeof a.related === "string" && a.related ? a.related.split(",").slice(0, 4) : [];
    return {
      id: String(a.id ?? a.url ?? `fh-${i}`),
      minutesAgo: minsAgoFromISO(iso),
      time: hhmmFromISO(iso),
      importance: Math.round(Math.min(99, Math.max(8, 40 + Math.abs(score) * 40))),
      impact: Math.round(Math.min(99, Math.max(5, Math.abs(score) * 70 + 20))),
      assetClass: inferAssetClass(related, a.headline),
      region: "GLOBAL",
      source: a.source ?? "Finnhub",
      headline: a.headline ?? "",
      sentiment: sentimentFrom(score),
      sentimentScore: score,
      tickers: related,
    };
  });
}

/** NewsAPI.org business top-headlines (no sentiment → keyword score). */
async function newsapi(n: number): Promise<Headline[] | null> {
  const key = process.env.NEWSAPI_API_KEY;
  if (!key) return null;
  const j = await getJson(`https://newsapi.org/v2/top-headlines?category=business&language=en&pageSize=${Math.min(n, 100)}&apiKey=${key}`);
  if (!Array.isArray(j?.articles) || !j.articles.length) return null;
  return j.articles.slice(0, n).map((a: any, i: number): Headline => {
    const score = clampScore(keywordScore(`${a.title ?? ""} ${a.description ?? ""}`));
    return {
      id: a.url ?? `na-${i}`,
      minutesAgo: minsAgoFromISO(a.publishedAt),
      time: hhmmFromISO(a.publishedAt),
      importance: Math.round(Math.min(99, Math.max(8, 40 + Math.abs(score) * 40))),
      impact: Math.round(Math.min(99, Math.max(5, Math.abs(score) * 70 + 20))),
      assetClass: inferAssetClass([], a.title),
      region: "GLOBAL",
      source: a.source?.name ?? "NewsAPI",
      headline: a.title ?? "",
      sentiment: sentimentFrom(score),
      sentimentScore: score,
      tickers: [],
    };
  });
}

const PROVIDERS: { name: string; envKey: string; fn: (n: number) => Promise<Headline[] | null> }[] = [
  { name: "Alpha Vantage", envKey: "ALPHAVANTAGE_API_KEY", fn: alphaVantage },
  { name: "Marketaux", envKey: "MARKETAUX_API_KEY", fn: marketaux },
  { name: "Finnhub", envKey: "FINNHUB_API_KEY", fn: finnhub },
  { name: "NewsAPI", envKey: "NEWSAPI_API_KEY", fn: newsapi },
];

/** Try providers in documented order; return the first with headlines plus an attempt log. */
export async function fetchLiveNews(n = 60): Promise<LiveNews | null> {
  const diagnostics: NewsProviderAttempt[] = [];
  for (const p of PROVIDERS) {
    const configured = Boolean(process.env[p.envKey]);
    if (!configured) {
      diagnostics.push({ provider: p.name, configured, ok: false, headlineCount: 0, latencyMs: 0, error: `${p.envKey} not configured` });
      continue;
    }
    const started = Date.now();
    try {
      const headlines = await p.fn(n);
      if (headlines && headlines.length) {
        headlines.sort((a, b) => a.minutesAgo - b.minutesAgo);
        diagnostics.push({ provider: p.name, configured, ok: true, headlineCount: headlines.length, latencyMs: Date.now() - started });
        console.log(`[NEWS] ${p.name}: ${headlines.length} headlines`);
        return { source: p.name, headlines, diagnostics };
      }
      diagnostics.push({ provider: p.name, configured, ok: false, headlineCount: 0, latencyMs: Date.now() - started, error: "provider returned no headlines" });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      diagnostics.push({ provider: p.name, configured, ok: false, headlineCount: 0, latencyMs: Date.now() - started, error });
      console.warn(`[NEWS] ${p.name} failed:`, error);
    }
  }
  console.warn("[NEWS] all configured providers failed or no news provider keys are configured");
  return { source: "ERR", headlines: [], diagnostics };
}

/** Provider keys configured in this environment (for DATAOPS / diagnostics). */
export function configuredNewsProviders(): string[] {
  return PROVIDERS.filter((p) => Boolean(process.env[p.envKey])).map((p) => p.name);
}

export { getHeadlines };
