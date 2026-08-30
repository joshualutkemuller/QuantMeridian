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

  test("surfaces structured NEWS_NLP health when the service is configured", async () => {
    process.env.NEWS_NLP_URL = "http://nlp.local";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "http://nlp.local/health") {
        return new Response(JSON.stringify({
          status: "ok",
          model: "FinBERT-test",
          sentiment: { ok: true, model: "FinBERT-test", backend: "transformers" },
          clustering: { ok: true, model: "all-MiniLM-test", backend: "sentence-transformers" },
          ner: { ok: true, model: "en_core_web_sm", backend: "spacy" },
          lexiconFallback: { enabled: false, model: "finance-lexicon", version: "1" },
          device: "cpu",
          runtime: "python 3.12.0",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected URL ${url}`);
    }));

    const body = await callHealth();

    expect(body.providers.NEWS_NLP.status).toBe("LIVE");
    expect(body.providers.NEWS_NLP.detail).toContain("sentiment=FinBERT-test");
    expect(body.providers.NEWS_NLP.detail).toContain("cluster=all-MiniLM-test");
    expect(body.providers.NEWS_NLP.detail).toContain("NER=en_core_web_sm");
    expect(body.providers.NEWS_NLP.diagnostics).toMatchObject({
      configured: true,
      ok: true,
      sentiment: { model: "FinBERT-test" },
      clustering: { model: "all-MiniLM-test" },
      ner: { model: "en_core_web_sm" },
      device: "cpu",
    });
  });
});
