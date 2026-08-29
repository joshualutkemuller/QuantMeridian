import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

const KEYS = ["ALPHAVANTAGE_API_KEY", "MARKETAUX_API_KEY", "FINNHUB_API_KEY", "NEWSAPI_API_KEY", "NEWS_NLP_URL"] as const;

function clearKeys() {
  for (const key of KEYS) delete process.env[key];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function callDiagnostics(path = "http://local.test/api/news/diagnostics") {
  const res = await GET(new Request(path));
  return res.json();
}

describe("/api/news/diagnostics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  test("returns explicit non-live diagnostics when no provider or NLP service is configured", async () => {
    const body = await callDiagnostics();

    expect(body.source).toBe("ERR");
    expect(body.live).toBe(false);
    expect(body.headlineCount).toBe(0);
    expect(body.newestHeadline).toBeNull();
    expect(body.nlp).toMatchObject({
      configured: false,
      ok: false,
      error: "NEWS_NLP_URL not configured",
    });
    expect(body.attempts.map((d: { provider: string; configured: boolean; ok: boolean }) => [d.provider, d.configured, d.ok])).toEqual([
      ["Alpha Vantage", false, false],
      ["Marketaux", false, false],
      ["Finnhub", false, false],
      ["NewsAPI", false, false],
    ]);
  });

  test("surfaces winning news provider, newest headline, and NLP health", async () => {
    process.env.ALPHAVANTAGE_API_KEY = "alpha";
    process.env.NEWS_NLP_URL = "http://nlp.local";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("alphavantage.co")) {
        return jsonResponse({
          feed: [{
            url: "https://example.test/a",
            title: "Markets climb as chip stocks rally",
            source: "Alpha Wire",
            time_published: "20260828T130000",
            overall_sentiment_score: "0.35",
            relevance_score: "0.8",
            ticker_sentiment: [{ ticker: "NVDA" }],
          }],
        });
      }
      if (url === "http://nlp.local/health") {
        return jsonResponse({ model: "FinBERT-test" });
      }
      throw new Error(`unexpected URL ${url}`);
    }));

    const body = await callDiagnostics("http://local.test/api/news/diagnostics?n=10");

    expect(body.source).toBe("Alpha Vantage");
    expect(body.live).toBe(true);
    expect(body.configuredProviders).toEqual(["Alpha Vantage"]);
    expect(body.headlineCount).toBe(1);
    expect(body.newestHeadline).toMatchObject({
      source: "Alpha Wire",
      headline: "Markets climb as chip stocks rally",
      time: "13:00",
    });
    expect(body.nlp).toMatchObject({
      configured: true,
      ok: true,
      model: "FinBERT-test",
    });
    expect(body.attempts[0]).toMatchObject({
      provider: "Alpha Vantage",
      configured: true,
      ok: true,
      headlineCount: 1,
    });
  });
});
