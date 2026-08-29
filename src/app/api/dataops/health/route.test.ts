import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

const KEYS = [
  "MACRO_DB_URL",
  "MACRO_DB_BACKEND",
  "FRED_API_KEY",
  "MARKET_DB_URL",
  "MARKET_DATA_DIR",
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

async function callHealth() {
  const res = await GET();
  return res.json();
}

describe("/api/dataops/health intelligence feeds", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  test("reports an umbrella intelligence row plus separate news, social, and NLP rows", async () => {
    const body = await callHealth();

    expect(body.providers.INTELLIGENCE_FEEDS).toMatchObject({
      status: "ERROR",
      live: false,
      configured: false,
      explicitStatus: "No real intelligence feeds available",
    });
    expect(body.providers.NEWS).toMatchObject({ status: "ERROR", live: false });
    expect(body.providers.SOCIAL).toMatchObject({ status: "ERROR", live: false });
    expect(body.providers.NEWS_NLP).toMatchObject({ status: "SIM", live: false });
  });
});
