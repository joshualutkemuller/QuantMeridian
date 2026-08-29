import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

const KEYS = [
  "MACRO_DB_URL",
  "MACRO_DB_BACKEND",
  "MARKET_DB_URL",
  "MARKET_PIPELINE_URL",
  "ALPHAVANTAGE_API_KEY",
  "MARKETAUX_API_KEY",
  "FINNHUB_API_KEY",
  "NEWSAPI_API_KEY",
  "NEWS_NLP_URL",
  "REDDIT_USER_AGENT",
  "STOCKTWITS_ACCESS_TOKEN",
  "STOCKTWITS_ENABLED",
] as const;

function clearKeys() {
  for (const key of KEYS) delete process.env[key];
}

async function callRuns() {
  const res = await GET();
  return res.json();
}

describe("/api/dataops/runs intelligence feeds", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  test("returns live DataOps-shaped intelligence feed attempts even when providers are off", async () => {
    const body = await callRuns();

    expect(body.source).toBe("INTELLIGENCE_FEEDS");
    expect(body.live).toBe(true);
    expect(body.runs.map((run: { provider: string }) => run.provider)).toEqual(["INTELLIGENCE_FEEDS", "NEWS", "SOCIAL", "NEWS_NLP"]);
    expect(body.series.some((row: { provider: string; seriesId: string; status: string }) => row.provider === "NEWS" && row.seriesId === "alpha_vantage")).toBe(true);
    expect(body.series.some((row: { provider: string; seriesId: string; status: string }) => row.provider === "SOCIAL" && row.seriesId === "stocktwits")).toBe(true);
    expect(body.lineage.some((row: { source: string; dataset: string }) => row.source === "INTELLIGENCE_FEEDS" && row.dataset === "intelligence_feeds")).toBe(true);
  });
});
