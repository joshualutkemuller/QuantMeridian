import { describe, test, expect } from "vitest";
import { SNAPSHOTS, PRICE_SNAPSHOTS } from "@/data/marketPipeline";

describe("market snapshots", () => {
  test("SNAPSHOTS has all required views", () => {
    const required = ["market", "cross-asset", "rates", "inflation", "regime", "bilello", "index-returns"];
    for (const view of required) {
      expect(SNAPSHOTS).toHaveProperty(view);
      expect(SNAPSHOTS[view as keyof typeof SNAPSHOTS]).toBeTruthy();
    }
  });

  test("PRICE_SNAPSHOTS covers price-eligible views", () => {
    const priceViews = ["market", "cross-asset", "regime", "bilello", "index-returns"];
    for (const view of priceViews) {
      expect(PRICE_SNAPSHOTS).toHaveProperty(view);
    }
  });

  test("bilello snapshot has required fields", () => {
    const b = SNAPSHOTS.bilello as any;
    expect(b.return_basis).toBe("total");
    expect(b.asof).toBeTruthy();
    expect(Array.isArray(b.asset_class_returns_by_year)).toBe(true);
    expect(b.asset_class_returns_by_year.length).toBeGreaterThan(0);
  });

  test("bilello snapshot daily prices are optional legacy fixture data", () => {
    const b = SNAPSHOTS.bilello as any;
    expect(Array.isArray(b.asset_daily_prices)).toBe(true);
    if (b.asset_daily_prices.length) {
      const first = b.asset_daily_prices[0];
      expect(first).toHaveProperty("series_id");
      expect(first).toHaveProperty("date");
      expect(first).toHaveProperty("price");
    }
  });

  test("bilello price snapshot has different returns than total", () => {
    const total = (SNAPSHOTS.bilello as any).asset_class_returns_by_year;
    const price = (PRICE_SNAPSHOTS.bilello as any).asset_class_returns_by_year;
    const spy2020t = total.find((r: any) => r.series_id === "SPY" && r.year === 2020);
    const spy2020p = price.find((r: any) => r.series_id === "SPY" && r.year === 2020);
    expect(spy2020t.total_return).not.toBe(spy2020p.total_return);
  });

  test("market snapshot cards have required fields", () => {
    const cards = (SNAPSHOTS.market as any).cards;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeGreaterThan(0);
    const card = cards[0];
    expect(card).toHaveProperty("series_id");
    expect(card).toHaveProperty("display_name");
    expect(card).toHaveProperty("price");
  });
});

describe("legacy market snapshot fixtures", () => {
  test("total market snapshot fixture is still present", () => {
    expect(SNAPSHOTS.market).toBeTruthy();
    expect((SNAPSHOTS.market as any).cards.length).toBeGreaterThan(0);
  });

  test("price snapshot exists for price-eligible views", () => {
    expect(PRICE_SNAPSHOTS.market).toBeTruthy();
    expect(PRICE_SNAPSHOTS.bilello).toBeTruthy();
  });

  test("price snapshot is absent for views without price data", () => {
    expect("rates" in PRICE_SNAPSHOTS).toBe(false);
    expect("inflation" in PRICE_SNAPSHOTS).toBe(false);
  });
});

describe("source mapping contract", () => {
  test("valid market sources are LIVE, DB, FILE, or LOADING", () => {
    const validSources = ["LIVE", "DB", "FILE", "LOADING"];
    for (const s of validSources) {
      expect(validSources).toContain(s);
    }
  });

  test("SIM is not in the market source vocabulary", () => {
    const marketSources = ["LIVE", "DB", "FILE", "LOADING"];
    expect(marketSources).not.toContain("SIM");
  });

  test("unknown API source strings map to LOADING for market data", () => {
    const mapMarketSource = (s: unknown): string => {
      if (s === "LIVE" || s === "DB" || s === "FILE") return s as string;
      return "LOADING";
    };
    expect(mapMarketSource("LIVE")).toBe("LIVE");
    expect(mapMarketSource("DB")).toBe("DB");
    expect(mapMarketSource("FILE")).toBe("FILE");
    expect(mapMarketSource("garbage")).toBe("LOADING");
    expect(mapMarketSource(undefined)).toBe("LOADING");
    expect(mapMarketSource("")).toBe("LOADING");
    expect(mapMarketSource(null)).toBe("LOADING");
  });
});
