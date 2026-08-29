import { configuredSocialProviders, fetchLiveSocial, type SocialProviderAttempt } from "@/lib/server/socialProviders";

export interface SocialDiagnostics {
  checkedAt: string;
  source: string;
  live: boolean;
  configuredProviders: string[];
  attempts: SocialProviderAttempt[];
  totalPosts: number;
  platformCount: number;
  topTicker: {
    label: string;
    mentions: number;
    velocity: number;
    sentiment: number;
  } | null;
  topTheme: {
    label: string;
    mentions: number;
    velocity: number;
    sentiment: number;
  } | null;
  error?: string;
}

export async function getSocialDiagnostics(): Promise<SocialDiagnostics> {
  const checkedAt = new Date().toISOString();
  const configuredProviders = configuredSocialProviders();
  const live = await fetchLiveSocial().catch((err) => ({
    source: "ERR",
    intel: { tickers: [], sectors: [], themes: [], totalPosts: 0, platforms: [] },
    diagnostics: [{
      provider: "SOCIAL",
      configured: configuredProviders.length > 0,
      ok: false,
      postCount: 0,
      tickerCount: 0,
      themeCount: 0,
      latencyMs: 0,
      error: err instanceof Error ? err.message : String(err),
    }],
  }));

  const topTicker = live.intel.tickers[0] ?? null;
  const topTheme = live.intel.themes[0] ?? null;
  const liveOk = live.source !== "ERR" && live.intel.totalPosts > 0;

  return {
    checkedAt,
    source: liveOk ? live.source : "ERR",
    live: liveOk,
    configuredProviders,
    attempts: live.diagnostics,
    totalPosts: live.intel.totalPosts,
    platformCount: live.intel.platforms.length,
    topTicker: topTicker
      ? { label: topTicker.label, mentions: topTicker.mentions, velocity: topTicker.velocity, sentiment: topTicker.sentiment }
      : null,
    topTheme: topTheme
      ? { label: topTheme.label, mentions: topTheme.mentions, velocity: topTheme.velocity, sentiment: topTheme.sentiment }
      : null,
    error: liveOk ? undefined : "No configured social provider returned posts.",
  };
}
