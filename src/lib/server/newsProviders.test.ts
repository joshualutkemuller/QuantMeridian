import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const KEYS = ["ALPHAVANTAGE_API_KEY", "MARKETAUX_API_KEY", "FINNHUB_API_KEY", "NEWSAPI_API_KEY"] as const;

function clearKeys() {
  for (const key of KEYS) delete process.env[key];
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("news provider chain", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  test("reports configured providers in documented priority order", async () => {
    process.env.NEWSAPI_API_KEY = "newsapi";
    process.env.ALPHAVANTAGE_API_KEY = "alpha";
    process.env.FINNHUB_API_KEY = "finnhub";
    process.env.MARKETAUX_API_KEY = "marketaux";

    const { configuredNewsProviders } = await import("./newsProviders");

    expect(configuredNewsProviders()).toEqual(["Alpha Vantage", "Marketaux", "Finnhub", "NewsAPI"]);
  });

  test("tries Alpha Vantage before Marketaux and stops on the first provider with headlines", async () => {
    process.env.ALPHAVANTAGE_API_KEY = "alpha";
    process.env.MARKETAUX_API_KEY = "marketaux";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("alphavantage.co")) return jsonResponse({ feed: [] });
      if (url.includes("marketaux.com")) {
        return jsonResponse({
          data: [{
            uuid: "mx-1",
            title: "Stocks rise as earnings sentiment improves",
            published_at: "2026-08-28T12:00:00Z",
            source: "Marketaux",
            entities: [{ symbol: "SPY", sentiment_score: 0.4 }],
          }],
        });
      }
      throw new Error(`unexpected URL ${url}`);
    }));

    const { fetchLiveNews } = await import("./newsProviders");
    const live = await fetchLiveNews(10);

    expect(urls[0]).toContain("alphavantage.co");
    expect(urls[1]).toContain("marketaux.com");
    expect(urls).toHaveLength(2);
    expect(live?.source).toBe("Marketaux");
    expect(live?.headlines).toHaveLength(1);
    expect(live?.diagnostics.map((d) => [d.provider, d.configured, d.ok, d.headlineCount])).toEqual([
      ["Alpha Vantage", true, false, 0],
      ["Marketaux", true, true, 1],
    ]);
  });
});
