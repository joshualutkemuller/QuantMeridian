import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { DELETE, GET, POST } from "./orders/route";
import { GET as GET_POSITIONS } from "./positions/route";
import type { PolyMarket } from "@/data/polymarket";
import type { PolyOrderBook } from "@/data/polybot";

const testMarket: PolyMarket = {
  id: "poly-api-ledger-test",
  question: "AC-PAPER-API test market?",
  category: "Economics",
  yesPrice: 0.5,
  noPrice: 0.5,
  spread: 0.02,
  volume24h: 20_000,
  totalVolume: 400_000,
  liquidity: 40_000,
  chg24h: 0,
  endDate: "2026-12-31",
  spark: [0.48, 0.5],
  active: true,
  yesTokenId: "yes-api-ledger-test",
  noTokenId: "no-api-ledger-test",
};

const testBook: PolyOrderBook = {
  source: "SIM",
  tokenId: "yes-api-ledger-test",
  levels: [{ level: 1, bid: 0.38, bidSize: 500, ask: 0.4, askSize: 500 }],
  bestBid: 0.38,
  bestAsk: 0.4,
  midpoint: 0.39,
  spread: 0.02,
  depthUsd: 1_000,
  hash: "sim-api-ledger-test",
};

describe("paper ledger API routes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00Z"));
    delete (globalThis as any).__qitPaperLedgerState;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).__qitPaperLedgerState;
  });

  test("AC-PAPER-API-GET returns the current server ledger snapshot", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("SERVER");
    expect(body.data.storage).toBe("IN_MEMORY");
    expect(body.data.orders).toEqual([]);
  });

  test("AC-PAPER-API-POST accepts a valid simulated order and exposes it through positions", async () => {
    const req = new Request("http://test.local/api/trading-assistant/paper/orders", {
      method: "POST",
      body: JSON.stringify({
        botCode: "POLYBOT",
        marketId: testMarket.id,
        side: "BUY_YES",
        price: 0.4,
        sizeUsd: 5,
        riskProfile: "CONSERVATIVE",
        market: testMarket,
        book: testBook,
      }),
    });

    const post = await POST(req);
    const postBody = await post.json();
    const positions = await GET_POSITIONS();
    const positionsBody = await positions.json();

    expect(postBody.accepted).toBe(true);
    expect(postBody.order.id).toBe("paper-000001");
    expect(postBody.fill.shares).toBe(12.5);
    expect(positionsBody.data.positions).toHaveLength(1);
    expect(positionsBody.data.positions[0].marketId).toBe(testMarket.id);
    expect(positionsBody.data.pnlUsd).toBeCloseTo(1.25, 6);
  });

  test("AC-PAPER-API-POST rejects invalid JSON with status 400", async () => {
    const req = new Request("http://test.local/api/trading-assistant/paper/orders", {
      method: "POST",
      body: "not-json",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.accepted).toBe(false);
    expect(body.error).toBe("invalid body");
  });

  test("AC-PAPER-API-DELETE resets the paper ledger", async () => {
    await POST(new Request("http://test.local/api/trading-assistant/paper/orders", {
      method: "POST",
      body: JSON.stringify({
        botCode: "POLYBOT",
        marketId: testMarket.id,
        side: "BUY_YES",
        price: 0.4,
        sizeUsd: 5,
        riskProfile: "CONSERVATIVE",
        market: testMarket,
        book: testBook,
      }),
    }));

    const res = await DELETE();
    const body = await res.json();

    expect(body.data.orders).toEqual([]);
    expect(body.data.fills).toEqual([]);
    expect(body.data.positions).toEqual([]);
    expect(body.data.events.map((event: { type: string }) => event.type)).toEqual(["LEDGER_RESET"]);
  });
});
