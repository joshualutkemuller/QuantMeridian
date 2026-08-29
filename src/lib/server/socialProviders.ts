/**
 * Live social-sentiment provider chain for NEWS-3 (and SENT's social layer).
 *
 * Aggregates Reddit (subreddit hot posts) and StockTwits (trending symbols)
 * into the module's `SocialIntel` shape. Each provider is gated by env and
 * degrades gracefully — if neither is configured/reachable the route falls back
 * to the deterministic SIM engine. Ticker mentions + keyword sentiment are
 * derived from post text; "velocity" is a relative-attention proxy (true
 * velocity needs a stored baseline, which the pipeline layer will supply).
 *
 * Env:
 *   REDDIT_USER_AGENT        — required to enable Reddit (Reddit mandates a UA)
 *   STOCKTWITS_ENABLED=1     — enable StockTwits public trending, or
 *   STOCKTWITS_ACCESS_TOKEN  — StockTwits token (also enables it)
 */
import { getSocialIntel, type SocialIntel, type SocialRow } from "@/data/news";
import { scoreText } from "@/lib/server/sentimentNlp";

export interface LiveSocial {
  source: string;
  intel: SocialIntel;
  diagnostics: SocialProviderAttempt[];
}

export interface SocialProviderAttempt {
  provider: string;
  configured: boolean;
  ok: boolean;
  postCount: number;
  tickerCount: number;
  themeCount: number;
  latencyMs: number;
  error?: string;
}

const FETCH_TIMEOUT_MS = 6000;
const REDDIT_SUBS = ["wallstreetbets", "stocks", "investing", "options", "stockmarket"];
const TICKER_WHITELIST = new Set([
  "NVDA", "AAPL", "MSFT", "TSLA", "JPM", "BAC", "XLF", "SPY", "QQQ", "TLT", "HYG", "LQD", "GLD", "USO", "BTC", "DXY", "GME", "AMC", "SMCI", "META",
  "AMD", "GOOGL", "AMZN", "NFLX", "PLTR", "COIN", "SOFI", "INTC", "MU", "AVGO",
]);

const NARRATIVE_KW: Record<string, RegExp> = {
  "AI Capex Boom": /\bAI\b|chip|semi|nvidia|data ?cent/i,
  "Fed Cuts": /\bfed\b|rate cut|cuts|dovish|fomc|powell/i,
  "Recession Risk": /recession|slowdown|crash|bear/i,
  "Earnings Resilience": /earnings|guidance|beat|squeeze|moon|calls?/i,
  "Energy Shock": /\boil\b|crude|energy|gas/i,
  "Credit Stress": /credit|default|bankrupt|stress/i,
  "Dollar Strength": /dollar|\bdxy\b|\byen\b|currenc/i,
  "China Stimulus": /china|stimulus/i,
};

// Shared in-house heuristic scorer (finance + market-social lexicon, negation-aware).
const keywordScore = (text: string): number => scoreText(text).score;

function extractTickers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\$([A-Za-z]{1,5})\b/g)) out.add(m[1].toUpperCase()); // cashtags
  for (const w of text.toUpperCase().split(/[^A-Z]+/)) if (TICKER_WHITELIST.has(w)) out.add(w); // bare known tickers
  return [...out];
}

async function getJson(url: string, headers?: Record<string, string>): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctrl.signal, headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

interface Acc {
  n: number;
  s: number;
}
const mergeAcc = (m: Map<string, Acc>, key: string, score: number) => {
  const e = m.get(key) ?? { n: 0, s: 0 };
  e.n += 1;
  e.s += score;
  m.set(key, e);
};
function toRows(m: Map<string, Acc>, limit: number): SocialRow[] {
  const maxN = Math.max(1, ...[...m.values()].map((e) => e.n));
  return [...m.entries()]
    .map(([label, e]) => ({
      label,
      mentions: e.n,
      velocity: Math.round(Math.min(99, (e.n / maxN) * 100)), // relative-attention proxy
      sentiment: Number((e.s / e.n).toFixed(2)),
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, limit);
}

// ── Reddit ───────────────────────────────────────────────────────────────────
async function reddit(): Promise<{ tickers: Map<string, Acc>; themes: Map<string, Acc>; posts: number; sentSum: number; sentN: number } | null> {
  const ua = process.env.REDDIT_USER_AGENT;
  if (!ua) return null;
  const tickers = new Map<string, Acc>();
  const themes = new Map<string, Acc>();
  let posts = 0;
  let sentSum = 0;
  let sentN = 0;
  let ok = false;
  for (const sub of REDDIT_SUBS) {
    try {
      const j = await getJson(`https://www.reddit.com/r/${sub}/hot.json?limit=50`, { "User-Agent": ua });
      const children = j?.data?.children;
      if (!Array.isArray(children)) continue;
      ok = true;
      for (const c of children) {
        const title = String(c?.data?.title ?? "");
        if (!title) continue;
        posts += 1;
        const score = keywordScore(title);
        sentSum += score;
        sentN += 1;
        for (const t of extractTickers(title)) mergeAcc(tickers, t, score);
        for (const [name, kw] of Object.entries(NARRATIVE_KW)) if (kw.test(title)) mergeAcc(themes, name, score);
      }
    } catch {
      /* skip this subreddit */
    }
  }
  return ok ? { tickers, themes, posts, sentSum, sentN } : null;
}

// ── StockTwits ─────────────────────────────────────────────────────────────
async function stocktwits(): Promise<{ tickers: Map<string, Acc>; posts: number } | null> {
  const token = process.env.STOCKTWITS_ACCESS_TOKEN;
  if (!token && process.env.STOCKTWITS_ENABLED !== "1") return null;
  try {
    const j = await getJson(`https://api.stocktwits.com/api/2/trending/symbols.json${token ? `?access_token=${token}` : ""}`);
    const symbols = j?.symbols;
    if (!Array.isArray(symbols) || !symbols.length) return null;
    const tickers = new Map<string, Acc>();
    for (const s of symbols) {
      const sym = String(s?.symbol ?? "").toUpperCase();
      if (!sym) continue;
      // trending endpoint carries no sentiment → neutral; mentions weighted by watchers
      const watchers = Number(s?.watchlist_count ?? 0);
      const reps = Math.max(1, Math.round(watchers / 50000));
      const e = tickers.get(sym) ?? { n: 0, s: 0 };
      e.n += reps;
      tickers.set(sym, e);
    }
    return { tickers, posts: symbols.length };
  } catch {
    return null;
  }
}

const PROVIDERS: { name: string; configured: () => boolean; fn: () => Promise<any | null> }[] = [
  { name: "Reddit", configured: () => Boolean(process.env.REDDIT_USER_AGENT), fn: reddit },
  { name: "StockTwits", configured: () => Boolean(process.env.STOCKTWITS_ACCESS_TOKEN || process.env.STOCKTWITS_ENABLED === "1"), fn: stocktwits },
];

async function attemptSocialProvider(provider: typeof PROVIDERS[number]): Promise<{ provider: string; data: any | null; attempt: SocialProviderAttempt }> {
  const configured = provider.configured();
  if (!configured) {
    return {
      provider: provider.name,
      data: null,
      attempt: {
        provider: provider.name,
        configured: false,
        ok: false,
        postCount: 0,
        tickerCount: 0,
        themeCount: 0,
        latencyMs: 0,
        error: `${provider.name} not configured`,
      },
    };
  }
  const started = Date.now();
  try {
    const data = await provider.fn();
    const postCount = Number(data?.posts ?? 0);
    const tickerCount = data?.tickers instanceof Map ? data.tickers.size : 0;
    const themeCount = data?.themes instanceof Map ? data.themes.size : 0;
    const ok = Boolean(data && postCount > 0);
    return {
      provider: provider.name,
      data,
      attempt: {
        provider: provider.name,
        configured: true,
        ok,
        postCount,
        tickerCount,
        themeCount,
        latencyMs: Date.now() - started,
        error: ok ? undefined : "provider returned no social rows",
      },
    };
  } catch (err) {
    return {
      provider: provider.name,
      data: null,
      attempt: {
        provider: provider.name,
        configured: true,
        ok: false,
        postCount: 0,
        tickerCount: 0,
        themeCount: 0,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

const emptySocial = (): SocialIntel => ({ tickers: [], sectors: [], themes: [], totalPosts: 0, platforms: [] });

/** Merge configured social providers into a SocialIntel, or ERR when no real rows are available. */
export async function fetchLiveSocial(): Promise<LiveSocial> {
  const attempts = await Promise.all(PROVIDERS.map((provider) => attemptSocialProvider(provider)));
  const rd = attempts.find((attempt) => attempt.provider === "Reddit")?.data as Awaited<ReturnType<typeof reddit>> | null;
  const st = attempts.find((attempt) => attempt.provider === "StockTwits")?.data as Awaited<ReturnType<typeof stocktwits>> | null;
  const diagnostics = attempts.map((attempt) => attempt.attempt);

  if (!rd && !st) return { source: "ERR", intel: emptySocial(), diagnostics };

  const tickers = new Map<string, Acc>();
  const platforms: { name: string; posts: number; sentiment: number }[] = [];
  let totalPosts = 0;

  if (rd) {
    for (const [k, e] of rd.tickers) { const a = tickers.get(k) ?? { n: 0, s: 0 }; a.n += e.n; a.s += e.s; tickers.set(k, a); }
    totalPosts += rd.posts;
    platforms.push({ name: "Reddit", posts: rd.posts, sentiment: rd.sentN ? Number((rd.sentSum / rd.sentN).toFixed(2)) : 0 });
  }
  if (st) {
    for (const [k, e] of st.tickers) { const a = tickers.get(k) ?? { n: 0, s: 0 }; a.n += e.n; a.s += e.s; tickers.set(k, a); }
    totalPosts += st.posts;
    platforms.push({ name: "StockTwits", posts: st.posts, sentiment: 0 });
  }

  const seeded = getSocialIntel();
  const themeRows = rd ? toRows(rd.themes, 8) : seeded.themes;
  const intel: SocialIntel = {
    tickers: tickers.size ? toRows(tickers, 12) : seeded.tickers,
    sectors: seeded.sectors, // sector tagging needs an entity map → engine for now
    themes: themeRows.length ? themeRows : seeded.themes,
    totalPosts: totalPosts || seeded.totalPosts,
    platforms: platforms.length ? platforms : seeded.platforms,
  };
  return { source: platforms.map((p) => p.name).join(" + "), intel, diagnostics };
}

/** Social providers configured in this environment (for DATAOPS / diagnostics). */
export function configuredSocialProviders(): string[] {
  return PROVIDERS.filter((provider) => provider.configured()).map((provider) => provider.name);
}
