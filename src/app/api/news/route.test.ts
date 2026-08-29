import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

const KEYS = ["ALPHAVANTAGE_API_KEY", "MARKETAUX_API_KEY", "FINNHUB_API_KEY", "NEWSAPI_API_KEY", "NEWS_NLP_URL"] as const;

function clearKeys() {
  for (const key of KEYS) delete process.env[key];
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function callNews(path = "http://local.test/api/news") {
  const res = await GET(new Request(path));
  return res.json();
}

describe("/api/news", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  test("returns ERR with provider diagnostics when no provider is configured and SIM is not requested", async () => {
    const body = await callNews();

    expect(body.source).toBe("ERR");
    expect(body.headlines).toEqual([]);
    expect(body.clusters).toEqual([]);
    expect(body.error).toMatch(/No configured news provider returned headlines/);
    expect(body.diagnostics.map((d: { provider: string; configured: boolean; ok: boolean }) => [d.provider, d.configured, d.ok])).toEqual([
      ["Alpha Vantage", false, false],
      ["Marketaux", false, false],
      ["Finnhub", false, false],
      ["NewsAPI", false, false],
    ]);
  });

  test("uses generated headlines only when sim=1 is explicitly requested", async () => {
    const body = await callNews("http://local.test/api/news?sim=1&n=10");

    expect(body.source).toBe("SIM");
    expect(body.headlines).toHaveLength(10);
    expect(body.diagnostics).toHaveLength(4);
  });

  test("returns live provider headlines and diagnostics when a provider succeeds", async () => {
    process.env.ALPHAVANTAGE_API_KEY = "alpha";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      feed: [{
        url: "https://example.test/a",
        title: "Markets climb as chip stocks rally",
        source: "Alpha Wire",
        time_published: "20260828T130000",
        overall_sentiment_score: "0.35",
        relevance_score: "0.8",
        ticker_sentiment: [{ ticker: "NVDA" }],
      }],
    })));

    const body = await callNews("http://local.test/api/news?n=10");

    expect(body.source).toBe("Alpha Vantage");
    expect(body.headlines).toHaveLength(1);
    expect(body.headlines[0].tickers).toEqual(["NVDA"]);
    expect(body.diagnostics[0]).toMatchObject({
      provider: "Alpha Vantage",
      configured: true,
      ok: true,
      headlineCount: 1,
    });
  });
});
