import { fetchLiveNews, configuredNewsProviders, type NewsProviderAttempt } from "@/lib/server/newsProviders";

export interface NewsNlpProbe {
  configured: boolean;
  ok: boolean;
  latencyMs: number;
  model?: string;
  sentiment?: NewsNlpComponentProbe;
  clustering?: NewsNlpComponentProbe;
  ner?: NewsNlpComponentProbe;
  lexiconFallback?: {
    enabled: boolean;
    model?: string;
    version?: string;
  };
  device?: string;
  runtime?: string;
  error?: string;
}

export interface NewsNlpComponentProbe {
  ok: boolean;
  model?: string;
  backend?: string;
  version?: string;
  error?: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function componentValue(value: unknown): NewsNlpComponentProbe | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  return {
    ok: boolValue(row.ok),
    model: stringValue(row.model),
    backend: stringValue(row.backend),
    version: stringValue(row.version),
    error: stringValue(row.error),
  };
}

function normalizeNewsNlpHealth(body: Record<string, unknown>, latencyMs: number): NewsNlpProbe {
  const sentiment = componentValue(body.sentiment);
  const clustering = componentValue(body.clustering);
  const ner = componentValue(body.ner);
  const legacyModel = stringValue(body.model);
  const model = legacyModel ?? sentiment?.model ?? clustering?.model ?? ner?.model;
  const lexicon = body.lexiconFallback && typeof body.lexiconFallback === "object"
    ? body.lexiconFallback as Record<string, unknown>
    : undefined;
  return {
    configured: true,
    ok: true,
    latencyMs,
    model,
    sentiment,
    clustering,
    ner,
    lexiconFallback: lexicon
      ? {
          enabled: boolValue(lexicon.enabled),
          model: stringValue(lexicon.model),
          version: stringValue(lexicon.version),
        }
      : undefined,
    device: stringValue(body.device),
    runtime: stringValue(body.runtime),
  };
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
    const latencyMs = Date.now() - started;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return normalizeNewsNlpHealth(body, latencyMs);
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
