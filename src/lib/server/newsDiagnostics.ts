import { fetchLiveNews, configuredNewsProviders, type NewsProviderAttempt } from "@/lib/server/newsProviders";

export interface NewsNlpProbe {
  configured: boolean;
  ok: boolean;
  latencyMs: number;
  model?: string;
  error?: string;
}

export interface NewsDiagnostics {
  checkedAt: string;
  source: string;
  live: boolean;
  configuredProviders: string[];
  attempts: NewsProviderAttempt[];
  headlineCount: number;
  newestMinutesAgo: number | null;
  newestHeadlineAt: string | null;
  newestHeadline: {
    source: string;
    headline: string;
    minutesAgo: number;
    time: string;
  } | null;
  nlp: NewsNlpProbe;
  error?: string;
}

export async function probeNewsNlp(): Promise<NewsNlpProbe> {
  const url = process.env.NEWS_NLP_URL;
  if (!url) return { configured: false, ok: false, latencyMs: 0, error: "NEWS_NLP_URL not configured" };

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) {
      return { configured: true, ok: false, latencyMs: Date.now() - started, error: `HTTP ${res.status}` };
    }
    const body = (await res.json().catch(() => ({}))) as { model?: unknown };
    return { configured: true, ok: true, latencyMs: Date.now() - started, model: String(body?.model ?? "?") };
  } catch (err) {
    return { configured: true, ok: false, latencyMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function getNewsDiagnostics(n = 20): Promise<NewsDiagnostics> {
  const checkedAt = new Date().toISOString();
  const configuredProviders = configuredNewsProviders();
  const [live, nlp] = await Promise.all([
    fetchLiveNews(n).catch((err) => ({
      source: "ERR",
      headlines: [],
      diagnostics: [{
        provider: "NEWS",
        configured: configuredProviders.length > 0,
        ok: false,
        headlineCount: 0,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      }],
    })),
    probeNewsNlp(),
  ]);

  const headlines = live?.headlines ?? [];
  const newest = headlines.reduce<typeof headlines[number] | null>((best, row) => {
    if (!best) return row;
    return row.minutesAgo < best.minutesAgo ? row : best;
  }, null);
  const newestHeadlineAt = newest ? new Date(Date.now() - newest.minutesAgo * 60_000).toISOString() : null;
  const source = headlines.length ? live?.source ?? "ERR" : "ERR";

  return {
    checkedAt,
    source,
    live: headlines.length > 0 && source !== "ERR",
    configuredProviders,
    attempts: live?.diagnostics ?? [],
    headlineCount: headlines.length,
    newestMinutesAgo: newest?.minutesAgo ?? null,
    newestHeadlineAt,
    newestHeadline: newest
      ? { source: newest.source, headline: newest.headline, minutesAgo: newest.minutesAgo, time: newest.time }
      : null,
    nlp,
    error: headlines.length ? undefined : "No configured news provider returned headlines.",
  };
}
