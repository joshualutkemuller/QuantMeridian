import type { LineageRun, ProviderRun, SeriesRunResult } from "@/data/dataOps";
import { getNewsDiagnostics, type NewsDiagnostics } from "@/lib/server/newsDiagnostics";
import { getSocialDiagnostics, type SocialDiagnostics } from "@/lib/server/socialDiagnostics";

export interface IntelligenceFeedDiagnostics {
  checkedAt: string;
  live: boolean;
  configured: boolean;
  news: NewsDiagnostics;
  social: SocialDiagnostics;
  detail: string;
}

export interface IntelligenceFeedManifest {
  diagnostics: IntelligenceFeedDiagnostics;
  runs: ProviderRun[];
  series: SeriesRunResult[];
  lineage: LineageRun[];
}

const fmtTs = (iso: string): string => iso.slice(0, 16).replace("T", " ");
const minutesSince = (iso: string): number => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
const runIdFrom = (prefix: string, iso: string): string => {
  const compact = iso
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replaceAll("T", "")
    .replaceAll("Z", "")
    .replaceAll(".", "");
  return `${prefix}-${compact.slice(0, 14)}`;
};

function statusFrom(success: number, requested: number): ProviderRun["status"] {
  if (requested > 0 && success === requested) return "OK";
  if (success > 0) return "PARTIAL";
  return "FAILED";
}

function qualityScore(status: ProviderRun["status"]): number {
  return status === "OK" ? 98 : status === "PARTIAL" ? 84 : 45;
}

function nlpHealthSummary(nlp: NewsDiagnostics["nlp"]): string {
  if (!nlp.ok) return nlp.error ?? "NEWS_NLP offline";
  const parts = [
    nlp.sentiment?.model ? `sentiment=${nlp.sentiment.model}` : nlp.model ? `model=${nlp.model}` : null,
    nlp.clustering?.model ? `cluster=${nlp.clustering.model}` : null,
    nlp.ner?.model ? `NER=${nlp.ner.model}` : null,
    nlp.lexiconFallback?.enabled ? `fallback=${nlp.lexiconFallback.model ?? "lexicon"}` : null,
    nlp.device ? `device=${nlp.device}` : null,
    nlp.runtime,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : `model=${nlp.model ?? "?"}`;
}

export async function getIntelligenceFeedDiagnostics(): Promise<IntelligenceFeedDiagnostics> {
  const [news, social] = await Promise.all([getNewsDiagnostics(20), getSocialDiagnostics()]);
  const checkedAt = new Date().toISOString();
  const configured = news.configuredProviders.length > 0 || social.configuredProviders.length > 0 || news.nlp.configured;
  const live = news.live || social.live || news.nlp.ok;
  const detail = `NEWS ${news.live ? `${news.source} ${news.headlineCount} headlines` : "offline"}; SOCIAL ${social.live ? `${social.source} ${social.totalPosts} posts` : "offline"}; NLP ${news.nlp.ok ? nlpHealthSummary(news.nlp) : news.nlp.configured ? "unreachable" : "off"}`;

  return { checkedAt, live, configured, news, social, detail };
}

export async function fetchIntelligenceFeedManifest(): Promise<IntelligenceFeedManifest> {
  const diagnostics = await getIntelligenceFeedDiagnostics();
  const checkedAt = diagnostics.checkedAt;
  const started = fmtTs(checkedAt);
  const freshnessMin = minutesSince(checkedAt);

  const newsSuccess = diagnostics.news.live ? 1 : 0;
  const socialSuccess = diagnostics.social.live ? 1 : 0;
  const nlpSuccess = diagnostics.news.nlp.ok ? 1 : 0;
  const feedRequested = diagnostics.news.attempts.length + diagnostics.social.attempts.length + 1;
  const feedSuccess = diagnostics.news.attempts.filter((attempt) => attempt.ok).length + diagnostics.social.attempts.filter((attempt) => attempt.ok).length + nlpSuccess;
  const feedStatus = statusFrom(feedSuccess, feedRequested);
  const newsStatus = statusFrom(newsSuccess, 1);
  const socialStatus = statusFrom(socialSuccess, 1);
  const nlpStatus = statusFrom(nlpSuccess, 1);

  const runs: ProviderRun[] = [
    {
      runId: runIdFrom("INTEL", checkedAt),
      provider: "INTELLIGENCE_FEEDS",
      pipeline: "intelligence_feeds",
      started,
      completed: started,
      durationMs: Math.max(0, ...diagnostics.news.attempts.map((attempt) => attempt.latencyMs), ...diagnostics.social.attempts.map((attempt) => attempt.latencyMs), diagnostics.news.nlp.latencyMs),
      status: feedStatus,
      requestedSeries: feedRequested,
      successSeries: feedSuccess,
      failedSeries: Math.max(0, feedRequested - feedSuccess),
      rowsIngested: diagnostics.news.headlineCount + diagnostics.social.totalPosts + nlpSuccess,
      rowsRejected: diagnostics.news.attempts.filter((attempt) => attempt.configured && !attempt.ok).length + diagnostics.social.attempts.filter((attempt) => attempt.configured && !attempt.ok).length + (diagnostics.news.nlp.configured && !diagnostics.news.nlp.ok ? 1 : 0),
      freshnessMin,
      artifact: "/api/dataops/runs#intelligence_feeds",
    },
    {
      runId: runIdFrom("NEWS", diagnostics.news.checkedAt),
      provider: "NEWS",
      pipeline: "news_feed",
      started: fmtTs(diagnostics.news.checkedAt),
      completed: fmtTs(diagnostics.news.checkedAt),
      durationMs: Math.max(0, ...diagnostics.news.attempts.map((attempt) => attempt.latencyMs)),
      status: newsStatus,
      requestedSeries: diagnostics.news.attempts.length,
      successSeries: diagnostics.news.attempts.filter((attempt) => attempt.ok).length,
      failedSeries: diagnostics.news.attempts.filter((attempt) => !attempt.ok).length,
      rowsIngested: diagnostics.news.headlineCount,
      rowsRejected: diagnostics.news.attempts.filter((attempt) => attempt.configured && !attempt.ok).length,
      freshnessMin: diagnostics.news.newestMinutesAgo ?? freshnessMin,
      artifact: "/api/news/diagnostics",
    },
    {
      runId: runIdFrom("SOCIAL", diagnostics.social.checkedAt),
      provider: "SOCIAL",
      pipeline: "social_feed",
      started: fmtTs(diagnostics.social.checkedAt),
      completed: fmtTs(diagnostics.social.checkedAt),
      durationMs: Math.max(0, ...diagnostics.social.attempts.map((attempt) => attempt.latencyMs)),
      status: socialStatus,
      requestedSeries: diagnostics.social.attempts.length,
      successSeries: diagnostics.social.attempts.filter((attempt) => attempt.ok).length,
      failedSeries: diagnostics.social.attempts.filter((attempt) => !attempt.ok).length,
      rowsIngested: diagnostics.social.totalPosts,
      rowsRejected: diagnostics.social.attempts.filter((attempt) => attempt.configured && !attempt.ok).length,
      freshnessMin,
      artifact: "/api/social/diagnostics",
    },
    {
      runId: runIdFrom("NEWSNLP", diagnostics.news.checkedAt),
      provider: "NEWS_NLP",
      pipeline: "news_nlp",
      started: fmtTs(diagnostics.news.checkedAt),
      completed: fmtTs(diagnostics.news.checkedAt),
      durationMs: diagnostics.news.nlp.latencyMs,
      status: nlpStatus,
      requestedSeries: 1,
      successSeries: nlpSuccess,
      failedSeries: nlpSuccess ? 0 : 1,
      rowsIngested: nlpSuccess,
      rowsRejected: diagnostics.news.nlp.configured && !diagnostics.news.nlp.ok ? 1 : 0,
      freshnessMin,
      artifact: "/api/news/diagnostics#nlp",
    },
  ];

  const series: SeriesRunResult[] = [
    {
      runId: runs[0].runId,
      provider: "INTELLIGENCE_FEEDS",
      seriesId: "news_feed",
      dataset: "intelligence_feeds",
      displayName: "NEWS provider chain",
      status: diagnostics.news.live ? "SUCCESS" : "FAILED",
      rows: diagnostics.news.headlineCount,
      asOf: checkedAt.slice(0, 10),
      latencyMs: runs[1].durationMs,
      message: diagnostics.news.live ? `${diagnostics.news.source} returned headlines` : diagnostics.news.error ?? "news offline",
    },
    {
      runId: runs[0].runId,
      provider: "INTELLIGENCE_FEEDS",
      seriesId: "social_feed",
      dataset: "intelligence_feeds",
      displayName: "SOCIAL provider chain",
      status: diagnostics.social.live ? "SUCCESS" : "FAILED",
      rows: diagnostics.social.totalPosts,
      asOf: checkedAt.slice(0, 10),
      latencyMs: runs[2].durationMs,
      message: diagnostics.social.live ? `${diagnostics.social.source} returned posts` : diagnostics.social.error ?? "social offline",
    },
    {
      runId: runs[0].runId,
      provider: "INTELLIGENCE_FEEDS",
      seriesId: "news_nlp",
      dataset: "intelligence_feeds",
      displayName: "NEWS_NLP service",
      status: diagnostics.news.nlp.ok ? "SUCCESS" : "FAILED",
      rows: nlpSuccess,
      asOf: checkedAt.slice(0, 10),
      latencyMs: diagnostics.news.nlp.latencyMs,
      message: nlpHealthSummary(diagnostics.news.nlp),
    },
    ...diagnostics.news.attempts.map((attempt): SeriesRunResult => ({
      runId: runs[1].runId,
      provider: "NEWS",
      seriesId: attempt.provider.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      dataset: "provider_chain",
      displayName: `${attempt.provider} headline adapter`,
      status: attempt.ok ? "SUCCESS" : "FAILED",
      rows: attempt.headlineCount,
      asOf: checkedAt.slice(0, 10),
      latencyMs: attempt.latencyMs,
      message: attempt.ok ? `${attempt.headlineCount} headlines` : attempt.error ?? "no headlines",
    })),
    ...diagnostics.social.attempts.map((attempt): SeriesRunResult => ({
      runId: runs[2].runId,
      provider: "SOCIAL",
      seriesId: attempt.provider.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      dataset: "social_provider_chain",
      displayName: `${attempt.provider} social adapter`,
      status: attempt.ok ? "SUCCESS" : "FAILED",
      rows: attempt.postCount,
      asOf: checkedAt.slice(0, 10),
      latencyMs: attempt.latencyMs,
      message: attempt.ok ? `${attempt.postCount} posts · ${attempt.tickerCount} tickers` : attempt.error ?? "no posts",
    })),
    {
      runId: runs[3].runId,
      provider: "NEWS_NLP",
      seriesId: "news_nlp_health",
      dataset: "nlp_service",
      displayName: "FinBERT health check",
      status: diagnostics.news.nlp.ok ? "SUCCESS" : "FAILED",
      rows: nlpSuccess,
      asOf: checkedAt.slice(0, 10),
      latencyMs: diagnostics.news.nlp.latencyMs,
      message: nlpHealthSummary(diagnostics.news.nlp),
    },
  ];

  const lineage: LineageRun[] = runs.map((run) => ({
    runId: run.runId,
    source: run.provider,
    dataset: run.pipeline,
    rows: run.rowsIngested,
    started: run.started,
    completed: run.completed,
    durationMs: run.durationMs,
    status: run.status,
    upstreamRunId: run.runId,
    downstream: run.provider === "INTELLIGENCE_FEEDS" ? ["NEWS", "SENT", "DATAOPS"] : run.provider === "SOCIAL" ? ["NEWS", "SENT", "DATAOPS"] : ["NEWS", "DATAOPS"],
    artifact: run.artifact,
    qualityScore: qualityScore(run.status),
  }));

  return { diagnostics, runs, series, lineage };
}
