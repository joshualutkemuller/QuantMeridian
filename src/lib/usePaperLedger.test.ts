import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildLocalPaperLedgerSnapshot,
  createLocalFallbackOrder,
  localPaperFills,
} from "./usePaperLedger";
import type { PolyMarket } from "@/data/polymarket";

const market: PolyMarket = {
  id: "poly-local-ledger-test",
  question: "AC-PAPER-LOCAL test market?",
  category: "Economics",
  yesPrice: 0.5,
  noPrice: 0.5,
  spread: 0.02,
  volume24h: 10_000,
  totalVolume: 300_000,
  liquidity: 30_000,
  chg24h: 0,
  endDate: "2026-12-31",
  spark: [0.48, 0.5],
  active: true,
  yesTokenId: "yes-local-ledger-test",
  noTokenId: "no-local-ledger-test",
};

describe("local paper ledger fallback helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("AC-PAPER-LOCAL-FALLBACK builds a deterministic local paper order", () => {
    const order = createLocalFallbackOrder({
      marketId: market.id,
      side: "BUY_YES",
      price: 0.4,
      sizeUsd: 5,
      market,
    });

    expect(order).toMatchObject({
      id: "paper-local-1787486400000",
      createdAt: "2026-08-23T12:00:00.000Z",
      marketId: market.id,
      question: market.question,
      side: "BUY_YES",
      price: 0.4,
      sizeUsd: 5,
      mode: "PAPER",
    });
  });

  test("AC-PAPER-LOCAL-FALLBACK returns null for invalid local order side", () => {
    const order = createLocalFallbackOrder({
      marketId: market.id,
      side: "SELL_YES" as any,
      sizeUsd: 5,
      market,
    });

    expect(order).toBeNull();
  });

  test("AC-PAPER-LOCAL-PNL builds local fills, exposure, and mark-to-market P&L", () => {
    const order = createLocalFallbackOrder({
      marketId: market.id,
      side: "BUY_YES",
      price: 0.4,
      sizeUsd: 5,
      market,
    })!;

    const snapshot = buildLocalPaperLedgerSnapshot([order], [market]);

    expect(snapshot.source).toBe("LOCAL");
    expect(snapshot.storage).toBe("LOCAL_STORAGE");
    expect(snapshot.fills).toEqual(localPaperFills([order]));
    expect(snapshot.fills[0].shares).toBe(12.5);
    expect(snapshot.exposureUsd).toBe(5);
    expect(snapshot.positions[0].marketValue).toBeCloseTo(6.25, 6);
    expect(snapshot.pnlUsd).toBeCloseTo(1.25, 6);
  });
});
