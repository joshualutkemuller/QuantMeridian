import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

const KEYS = ["REDDIT_USER_AGENT", "STOCKTWITS_ACCESS_TOKEN", "STOCKTWITS_ENABLED"] as const;

function clearKeys() {
  for (const key of KEYS) delete process.env[key];
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function callDiagnostics() {
  const res = await GET();
  return res.json();
}

describe("/api/social/diagnostics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  test("returns explicit non-live diagnostics when no social providers are configured", async () => {
    const body = await callDiagnostics();

    expect(body.source).toBe("ERR");
    expect(body.live).toBe(false);
    expect(body.totalPosts).toBe(0);
    expect(body.topTicker).toBeNull();
    expect(body.attempts.map((d: { provider: string; configured: boolean; ok: boolean }) => [d.provider, d.configured, d.ok])).toEqual([
      ["Reddit", false, false],
      ["StockTwits", false, false],
    ]);
  });

  test("surfaces StockTwits provider health and top ticker when configured", async () => {
    process.env.STOCKTWITS_ENABLED = "1";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      symbols: [
        { symbol: "NVDA", watchlist_count: 260000 },
        { symbol: "SPY", watchlist_count: 100000 },
      ],
    })));

    const body = await callDiagnostics();

    expect(body.source).toBe("StockTwits");
    expect(body.live).toBe(true);
    expect(body.configuredProviders).toEqual(["StockTwits"]);
    expect(body.totalPosts).toBe(2);
    expect(body.topTicker).toMatchObject({ label: "NVDA" });
    expect(body.attempts[1]).toMatchObject({
      provider: "StockTwits",
      configured: true,
      ok: true,
      postCount: 2,
      tickerCount: 2,
    });
  });
});
