import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { createPaperOrder, getPaperLedgerSnapshot, resetPaperLedger } from "./paperLedger";
import type { PolyMarket } from "@/data/polymarket";
import type { PolyOrderBook } from "@/data/polybot";

function market(overrides: Partial<PolyMarket> = {}): PolyMarket {
  return {
    id: "poly-ledger-test",
    question: "AC-PAPER-LEDGER test market?",
    category: "Economics",
    yesPrice: 0.5,
    noPrice: 0.5,
    spread: 0.02,
    volume24h: 25_000,
    totalVolume: 500_000,
    liquidity: 50_000,
    chg24h: 0,
    endDate: "2026-12-31",
    spark: [0.48, 0.49, 0.5],
    active: true,
    yesTokenId: "yes-ledger-test",
    noTokenId: "no-ledger-test",
    ...overrides,
  };
}

function book(overrides: Partial<PolyOrderBook> = {}): PolyOrderBook {
  return {
    source: "SIM",
    tokenId: "yes-ledger-test",
    levels: [
      { level: 1, bid: 0.38, bidSize: 500, ask: 0.4, askSize: 500 },
      { level: 2, bid: 0.37, bidSize: 400, ask: 0.41, askSize: 400 },
    ],
    bestBid: 0.38,
    bestAsk: 0.4,
    midpoint: 0.39,
    spread: 0.02,
    depthUsd: 1_000,
    hash: "sim-ledger-test",
    ...overrides,
  };
}

describe("server paper ledger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00Z"));
    delete (globalThis as any).__qitPaperLedgerState;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).__qitPaperLedgerState;
  });

  test("AC-PAPER-LEDGER-ORDER-FILL accepts a valid order, simulates a fill, and marks P&L", () => {
    const result = createPaperOrder({
      botCode: "POLYBOT",
      marketId: "poly-ledger-test",
      side: "BUY_YES",
      price: 0.4,
      sizeUsd: 5,
      riskProfile: "CONSERVATIVE",
      market: market({ yesPrice: 0.5, noPrice: 0.5 }),
      book: book(),
    });

    expect(result.accepted).toBe(true);
    expect(result.order?.id).toBe("paper-000001");
    expect(result.fill?.id).toBe("fill-000002");
    expect(result.fill?.shares).toBe(12.5);
    expect(result.snapshot.source).toBe("SERVER");
    expect(result.snapshot.storage).toBe("IN_MEMORY");
    expect(result.snapshot.orders).toHaveLength(1);
    expect(result.snapshot.fills).toHaveLength(1);
    expect(result.snapshot.positions).toHaveLength(1);
    expect(result.snapshot.positions[0].costBasis).toBe(5);
    expect(result.snapshot.positions[0].marketValue).toBeCloseTo(6.25, 6);
    expect(result.snapshot.pnlUsd).toBeCloseTo(1.25, 6);
    expect(result.snapshot.events.map((event) => event.type)).toEqual(["FILL_SIMULATED", "ORDER_ACCEPTED"]);
  });

  test("AC-PAPER-LEDGER-RISK rejects orders that breach conservative max order size", () => {
    const result = createPaperOrder({
      botCode: "POLYBOT",
      marketId: "poly-ledger-test",
      side: "BUY_YES",
      sizeUsd: 6,
      riskProfile: "CONSERVATIVE",
      market: market(),
      book: book(),
    });

    expect(result.accepted).toBe(false);
    expect(result.order).toBeUndefined();
    expect(result.fill).toBeUndefined();
    expect(result.reason).toBe("Paper order blocked by risk checks");
    expect(result.snapshot.orders).toHaveLength(0);
    expect(result.snapshot.fills).toHaveLength(0);
    expect(result.riskChecks.find((check) => check.label === "Max order")?.ok).toBe(false);
    expect(result.snapshot.events[0].type).toBe("ORDER_REJECTED");
  });

  test("AC-PAPER-LEDGER-RESET clears orders, fills, positions, and previous events", () => {
    createPaperOrder({
      botCode: "POLYBOT",
      marketId: "poly-ledger-test",
      side: "BUY_YES",
      price: 0.4,
      sizeUsd: 5,
      riskProfile: "CONSERVATIVE",
      market: market(),
      book: book(),
    });

    const reset = resetPaperLedger();

    expect(reset.orders).toEqual([]);
    expect(reset.fills).toEqual([]);
    expect(reset.positions).toEqual([]);
    expect(reset.exposureUsd).toBe(0);
    expect(reset.pnlUsd).toBe(0);
    expect(reset.events.map((event) => event.type)).toEqual(["LEDGER_RESET"]);
  });

  test("AC-PAPER-LEDGER-SNAPSHOT returns a fresh empty server snapshot before trading", () => {
    const snapshot = getPaperLedgerSnapshot();

    expect(snapshot.source).toBe("SERVER");
    expect(snapshot.storage).toBe("IN_MEMORY");
    expect(snapshot.botCode).toBe("POLYBOT");
    expect(snapshot.asOf).toBe("2026-08-23T12:00:00.000Z");
    expect(snapshot.orders).toEqual([]);
    expect(snapshot.fills).toEqual([]);
    expect(snapshot.positions).toEqual([]);
  });
});
