import { Rng } from "@/lib/rng";

const ANCHOR_DATE = new Date("2026-06-17T00:00:00Z");

export type PolyCategory =
  | "Politics"
  | "Crypto"
  | "Economics"
  | "Sports"
  | "Science"
  | "Culture"
  | "Tech"
  | "Climate";

export interface PolyMarket {
  id: string;
  question: string;
  category: PolyCategory;
  yesPrice: number;
  noPrice: number;
  spread: number;
  volume24h: number;
  totalVolume: number;
  liquidity: number;
  chg24h: number;
  endDate: string;
  spark: number[];
  active: boolean;
  eventId?: string;
  slug?: string;
  yesTokenId?: string;
  noTokenId?: string;
}

export interface PolyEvent {
  id: string;
  title: string;
  category: PolyCategory;
  markets: PolyMarket[];
  totalVolume: number;
}

export interface PolyPricePoint {
  date: string;
  price: number;
}

interface CategoryStat {
  category: PolyCategory;
  count: number;
  volume: number;
}

type UnknownRecord = Record<string, unknown>;

const MARKET_DEFS: { q: string; cat: PolyCategory; anchor: number; endOff: number }[] = [
  { q: "Will the Republicans win the 2026 US midterm House?", cat: "Politics", anchor: 0.58, endOff: 130 },
  { q: "Will Trump approval rating exceed 50% by Dec 2026?", cat: "Politics", anchor: 0.32, endOff: 180 },
  { q: "Will a US government shutdown occur in 2026?", cat: "Politics", anchor: 0.41, endOff: 190 },
  { q: "Will Ukraine-Russia ceasefire be signed by end of 2026?", cat: "Politics", anchor: 0.24, endOff: 185 },
  { q: "Will the UK call a snap election before 2027?", cat: "Politics", anchor: 0.12, endOff: 200 },
  { q: "Will BTC exceed $150k by Dec 2026?", cat: "Crypto", anchor: 0.42, endOff: 180 },
  { q: "Will ETH exceed $8k by Dec 2026?", cat: "Crypto", anchor: 0.28, endOff: 180 },
  { q: "Will a Solana ETF be approved in 2026?", cat: "Crypto", anchor: 0.55, endOff: 190 },
  { q: "Will total crypto market cap exceed $5T by year-end?", cat: "Crypto", anchor: 0.47, endOff: 195 },
  { q: "Will DOGE exceed $1 in 2026?", cat: "Crypto", anchor: 0.08, endOff: 190 },
  { q: "Will the Fed cut rates before Sep 2026?", cat: "Economics", anchor: 0.72, endOff: 80 },
  { q: "Will US CPI fall below 2.5% YoY in 2026?", cat: "Economics", anchor: 0.38, endOff: 190 },
  { q: "Will US GDP growth exceed 3% in Q3 2026?", cat: "Economics", anchor: 0.31, endOff: 100 },
  { q: "Will US unemployment exceed 5% in 2026?", cat: "Economics", anchor: 0.15, endOff: 190 },
  { q: "Will the 10Y Treasury yield drop below 4% by year-end?", cat: "Economics", anchor: 0.45, endOff: 195 },
  { q: "Will the ECB cut rates below 2% in 2026?", cat: "Economics", anchor: 0.52, endOff: 180 },
  { q: "Will a US recession be declared in 2026?", cat: "Economics", anchor: 0.18, endOff: 190 },
  { q: "Will the S&P 500 close above 6500 in 2026?", cat: "Economics", anchor: 0.61, endOff: 195 },
  { q: "Will AI generate >$1T in enterprise revenue by 2026?", cat: "Tech", anchor: 0.22, endOff: 190 },
  { q: "Will Apple release a foldable device in 2026?", cat: "Tech", anchor: 0.35, endOff: 170 },
  { q: "Will OpenAI IPO in 2026?", cat: "Tech", anchor: 0.44, endOff: 190 },
  { q: "Will TikTok be banned in the US in 2026?", cat: "Tech", anchor: 0.28, endOff: 185 },
  { q: "Will global average temperature exceed 1.5C above pre-industrial in 2026?", cat: "Climate", anchor: 0.67, endOff: 195 },
  { q: "Will a Category 5 hurricane hit the US mainland in 2026?", cat: "Climate", anchor: 0.33, endOff: 170 },
  { q: "Will WHO declare a new pandemic emergency in 2026?", cat: "Science", anchor: 0.11, endOff: 190 },
  { q: "Will a new mRNA vaccine (non-COVID) receive FDA approval?", cat: "Science", anchor: 0.58, endOff: 180 },
  { q: "Will the FIFA Club World Cup final average 1B+ viewers?", cat: "Sports", anchor: 0.41, endOff: 30 },
  { q: "Will a European team win the 2026 FIFA World Cup?", cat: "Sports", anchor: 0.54, endOff: 365 },
  { q: "Will the NBA expand to 32 teams by end of 2026?", cat: "Sports", anchor: 0.38, endOff: 190 },
  { q: "Will a major Hollywood studio declare bankruptcy in 2026?", cat: "Culture", anchor: 0.09, endOff: 195 },
  { q: "Will global box office revenue exceed $45B in 2026?", cat: "Culture", anchor: 0.52, endOff: 195 },
  { q: "Will the Democrats win the 2026 Senate?", cat: "Politics", anchor: 0.44, endOff: 130 },
  { q: "Will China GDP growth fall below 4% in 2026?", cat: "Economics", anchor: 0.27, endOff: 190 },
  { q: "Will Nvidia market cap exceed $5T by year-end?", cat: "Tech", anchor: 0.39, endOff: 195 },
  { q: "Will BTC dominance exceed 60% in 2026?", cat: "Crypto", anchor: 0.36, endOff: 190 },
  { q: "Will Arctic summer sea ice reach a record low in 2026?", cat: "Climate", anchor: 0.42, endOff: 120 },
];

function endDate(daysOut: number): string {
  const d = new Date(ANCHOR_DATE);
  d.setUTCDate(d.getUTCDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

function clamp(n: number, lo = 0.01, hi = 0.99): number {
  return Math.max(lo, Math.min(hi, n));
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, ""));
    if (isFinite(n)) return n;
  }
  return fallback;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function inferCategory(event: UnknownRecord, market: UnknownRecord): PolyCategory {
  const blob = JSON.stringify([event.title, event.category, event.tags, market.question, market.description]).toLowerCase();
  if (blob.includes("bitcoin") || blob.includes("btc") || blob.includes("ethereum") || blob.includes("crypto") || blob.includes("solana")) return "Crypto";
  if (blob.includes("fed") || blob.includes("rate") || blob.includes("cpi") || blob.includes("inflation") || blob.includes("econom") || blob.includes("recession") || blob.includes("gdp")) return "Economics";
  if (blob.includes("election") || blob.includes("trump") || blob.includes("senate") || blob.includes("house") || blob.includes("government") || blob.includes("politic")) return "Politics";
  if (blob.includes("nba") || blob.includes("fifa") || blob.includes("world cup") || blob.includes("sports")) return "Sports";
  if (blob.includes("climate") || blob.includes("temperature") || blob.includes("hurricane") || blob.includes("arctic")) return "Climate";
  if (blob.includes("ai") || blob.includes("apple") || blob.includes("openai") || blob.includes("tech") || blob.includes("nvidia")) return "Tech";
  if (blob.includes("vaccine") || blob.includes("science") || blob.includes("pandemic")) return "Science";
  return "Culture";
}

function parseTokenIds(value: unknown): string[] {
  return asArray(value).map((v) => String(v)).filter(Boolean);
}

function sparkAround(anchor: number, seed: string, points = 30): number[] {
  const rng = new Rng(seed);
  const spark: number[] = [];
  let p = anchor - rng.float(0.03, 0.12) * (rng.bool() ? 1 : -1);
  for (let i = 0; i < points; i++) {
    p = clamp(p + (anchor - p) * 0.08 + rng.normal(0, 0.012), 0.02, 0.98);
    spark.push(Number(p.toFixed(3)));
  }
  return spark;
}

function buildMarket(def: typeof MARKET_DEFS[number], rng: Rng, idx: number): PolyMarket {
  const prob = Math.max(0.02, Math.min(0.98, def.anchor + rng.normal(0, 0.04)));
  const spread = rng.float(0.01, 0.04);
  const yesPrice = Number(prob.toFixed(2));
  const noPrice = Number(Math.max(0.01, 1 - prob - spread * 0.5).toFixed(2));
  const chg24h = Number(rng.normal(0, 0.03).toFixed(3));

  return {
    id: `poly-${idx.toString().padStart(3, "0")}`,
    question: def.q,
    category: def.cat,
    yesPrice,
    noPrice,
    spread: Number(spread.toFixed(3)),
    volume24h: Math.round(rng.float(5_000, 2_500_000)),
    totalVolume: Math.round(rng.float(500_000, 80_000_000)),
    liquidity: Math.round(rng.float(20_000, 3_000_000)),
    chg24h,
    endDate: endDate(def.endOff),
    spark: sparkAround(prob, `poly-spark-${idx}`),
    active: true,
    eventId: `evt-sim-${Math.floor(idx / 4)}`,
    slug: `sim-${idx}`,
    yesTokenId: `sim-yes-${idx}`,
    noTokenId: `sim-no-${idx}`,
  };
}

export function mapGammaEventsToMarkets(eventsPayload: unknown, limit = 100): PolyMarket[] {
  const events = asArray(eventsPayload);
  const markets: PolyMarket[] = [];

  for (const eventRaw of events) {
    const event = asRecord(eventRaw);
    const eventMarkets = asArray(event.markets);
    for (const marketRaw of eventMarkets) {
      const market = asRecord(marketRaw);
      const id = String(market.id ?? market.conditionId ?? market.slug ?? `${event.id ?? "evt"}-${markets.length}`);
      const question = asString(market.question) ?? asString(event.title) ?? "Untitled Polymarket market";
      const outcomePrices = asArray(market.outcomePrices).map((v) => asNumber(v, NaN)).filter((n) => isFinite(n));
      const yesPrice = clamp(asNumber(market.lastTradePrice, outcomePrices[0] ?? asNumber(market.bestAsk, 0.5)));
      const noPrice = clamp(outcomePrices[1] ?? 1 - yesPrice);
      const bestBid = asNumber(market.bestBid, Math.max(0.01, yesPrice - 0.01));
      const bestAsk = asNumber(market.bestAsk, Math.min(0.99, yesPrice + 0.01));
      const spread = clamp(Math.max(0.005, bestAsk - bestBid), 0.005, 0.25);
      const volume24h = asNumber(market.volume24hr, asNumber(market.volume24h, asNumber(market.volume, 0)));
      const totalVolume = asNumber(market.volume, asNumber(market.totalVolume, volume24h));
      const liquidity = asNumber(market.liquidity, asNumber(market.liquidityNum, Math.max(10_000, totalVolume * 0.05)));
      const chg24h = asNumber(market.oneDayPriceChange, asNumber(market.priceChange24h, 0));
      const end = asString(market.endDate) ?? asString(market.endDateIso) ?? asString(event.endDate) ?? new Date(Date.now() + 30 * 86_400_000).toISOString();
      const tokenIds = parseTokenIds(market.clobTokenIds ?? market.clobTokenId ?? market.tokenIds);

      markets.push({
        id,
        question,
        category: inferCategory(event, market),
        yesPrice: Number(yesPrice.toFixed(4)),
        noPrice: Number(noPrice.toFixed(4)),
        spread: Number(spread.toFixed(4)),
        volume24h: Math.round(volume24h),
        totalVolume: Math.round(totalVolume),
        liquidity: Math.round(liquidity),
        chg24h: Number(chg24h.toFixed(4)),
        endDate: end.slice(0, 10),
        spark: sparkAround(yesPrice, `gamma-${id}`),
        active: market.active !== false && market.closed !== true,
        eventId: String(event.id ?? ""),
        slug: asString(market.slug) ?? asString(event.slug),
        yesTokenId: tokenIds[0],
        noTokenId: tokenIds[1],
      });

      if (markets.length >= limit) return markets;
    }
  }

  return markets;
}

export function mapGammaEventsToPolyEvents(eventsPayload: unknown, limit = 100): PolyEvent[] {
  const events = asArray(eventsPayload).slice(0, limit);
  return events.map((eventRaw, idx) => {
    const event = asRecord(eventRaw);
    const markets = mapGammaEventsToMarkets([event], 50);
    const totalVolume = markets.reduce((sum, m) => sum + m.totalVolume, 0);
    return {
      id: String(event.id ?? `evt-live-${idx}`),
      title: asString(event.title) ?? asString(event.slug) ?? `Polymarket Event ${idx + 1}`,
      category: markets[0]?.category ?? inferCategory(event, {}),
      markets,
      totalVolume,
    };
  }).filter((event) => event.markets.length > 0);
}

let _cache: PolyMarket[] | null = null;

export function getPolymarkets(): PolyMarket[] {
  if (_cache) return _cache;
  const rng = new Rng("poly-v1");
  _cache = MARKET_DEFS.map((def, i) => buildMarket(def, rng, i));
  return _cache;
}

export function getPolyEvents(): PolyEvent[] {
  const markets = getPolymarkets();
  const groups: Record<string, { title: string; cat: PolyCategory; ids: number[] }> = {
    midterms: { title: "2026 US Midterm Elections", cat: "Politics", ids: [0, 31] },
    btc: { title: "Bitcoin Price Milestones", cat: "Crypto", ids: [5, 34] },
    fedPolicy: { title: "Fed Monetary Policy 2026", cat: "Economics", ids: [10, 11, 14] },
    usEcon: { title: "US Economic Outlook", cat: "Economics", ids: [12, 13, 16, 17] },
    aiTech: { title: "AI & Big Tech 2026", cat: "Tech", ids: [18, 20, 33] },
    climate: { title: "Climate Events 2026", cat: "Climate", ids: [22, 23, 35] },
    worldCup: { title: "FIFA 2026", cat: "Sports", ids: [27] },
    crypto: { title: "Crypto Regulation & ETFs", cat: "Crypto", ids: [7, 9] },
    geopolitics: { title: "Geopolitics & Governance", cat: "Politics", ids: [2, 3, 4] },
  };

  return Object.entries(groups).map(([key, g]) => {
    const eventMarkets = g.ids.filter((i) => i < markets.length).map((i) => markets[i]);
    return {
      id: `evt-${key}`,
      title: g.title,
      category: g.cat,
      markets: eventMarkets,
      totalVolume: eventMarkets.reduce((s, m) => s + m.totalVolume, 0),
    };
  });
}

export function getPolyPriceHistory(marketId: string, days = 90): PolyPricePoint[] {
  const markets = getPolymarkets();
  const mkt = markets.find((m) => m.id === marketId);
  const anchor = mkt?.yesPrice ?? 0.5;
  const rng = new Rng(`poly-hist-${marketId}`);
  const out: PolyPricePoint[] = [];
  let p = anchor - rng.float(0.05, 0.2) * (rng.bool() ? 1 : -1);
  for (let i = 0; i < days; i++) {
    const d = new Date(ANCHOR_DATE);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    p = Math.max(0.02, Math.min(0.98, p + (anchor - p) * 0.03 + rng.normal(0, 0.015)));
    out.push({ date: d.toISOString().slice(0, 10), price: Number(p.toFixed(3)) });
  }
  return out;
}

export function getPolyCategories(): CategoryStat[] {
  const markets = getPolymarkets();
  const map = new Map<PolyCategory, { count: number; volume: number }>();
  for (const m of markets) {
    const entry = map.get(m.category) ?? { count: 0, volume: 0 };
    entry.count++;
    entry.volume += m.totalVolume;
    map.set(m.category, entry);
  }
  return Array.from(map.entries())
    .map(([category, { count, volume }]) => ({ category, count, volume }))
    .sort((a, b) => b.volume - a.volume);
}

export function getPolyMovers(n = 10): PolyMarket[] {
  return [...getPolymarkets()].sort((a, b) => Math.abs(b.chg24h) - Math.abs(a.chg24h)).slice(0, n);
}
