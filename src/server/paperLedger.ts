import { getPolymarkets, type PolyMarket } from "@/data/polymarket";
import {
  RISK_LIMITS,
  canPlacePaperOrder,
  computePaperPositions,
  runRiskChecks,
  type BotCode,
  type PaperOrder,
  type PolyOrderBook,
  type RiskCheck,
  type RiskProfile,
} from "@/data/polybot";
import type {
  PaperFill,
  PaperLedgerEvent,
  PaperLedgerSnapshot,
  PaperOrderIntent,
} from "@/data/paperLedger";

interface PaperLedgerState {
  seq: number;
  orders: PaperOrder[];
  fills: PaperFill[];
  events: PaperLedgerEvent[];
  markets: Record<string, PolyMarket>;
}

declare global {
  // Retain paper state across route module reloads in the dev/server process.
  // This is intentionally not a production-durable store.
  // eslint-disable-next-line no-var
  var __qitPaperLedgerState: PaperLedgerState | undefined;
}

function state(): PaperLedgerState {
  if (!globalThis.__qitPaperLedgerState) {
    globalThis.__qitPaperLedgerState = {
      seq: 0,
      orders: [],
      fills: [],
      events: [],
      markets: {},
    };
  }
  return globalThis.__qitPaperLedgerState;
}

function nextId(prefix: string): string {
  const st = state();
  st.seq += 1;
  return `${prefix}-${st.seq.toString().padStart(6, "0")}`;
}

function finiteNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return isFinite(n) ? n : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function cleanRiskProfile(value: unknown): RiskProfile {
  return typeof value === "string" && value in RISK_LIMITS ? value as RiskProfile : "CONSERVATIVE";
}

function cleanBotCode(value: unknown): BotCode {
  return value === "POLYBOT" ? "POLYBOT" : "POLYBOT";
}

function cleanSide(value: unknown): PaperOrder["side"] | null {
  return value === "BUY_YES" || value === "BUY_NO" ? value : null;
}

function cleanMarket(input: unknown): PolyMarket | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const question = typeof raw.question === "string" ? raw.question : "";
  if (!id || !question) return null;
  const yesPrice = clamp(finiteNumber(raw.yesPrice, 0.5), 0.01, 0.99);
  const spread = clamp(finiteNumber(raw.spread, 0.02), 0.001, 0.5);
  const noPrice = clamp(finiteNumber(raw.noPrice, 1 - yesPrice), 0.01, 0.99);

  return {
    id,
    question,
    category: typeof raw.category === "string" ? raw.category as PolyMarket["category"] : "Culture",
    yesPrice,
    noPrice,
    spread,
    volume24h: Math.max(0, finiteNumber(raw.volume24h, 0)),
    totalVolume: Math.max(0, finiteNumber(raw.totalVolume, 0)),
    liquidity: Math.max(0, finiteNumber(raw.liquidity, 0)),
    chg24h: finiteNumber(raw.chg24h, 0),
    endDate: typeof raw.endDate === "string" ? raw.endDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
    spark: Array.isArray(raw.spark) ? raw.spark.map((v) => finiteNumber(v, yesPrice)).slice(0, 90) : [],
    active: raw.active !== false,
    eventId: typeof raw.eventId === "string" ? raw.eventId : undefined,
    slug: typeof raw.slug === "string" ? raw.slug : undefined,
    yesTokenId: typeof raw.yesTokenId === "string" ? raw.yesTokenId : undefined,
    noTokenId: typeof raw.noTokenId === "string" ? raw.noTokenId : undefined,
  };
}

function findMarket(intent: PaperOrderIntent): PolyMarket | null {
  const st = state();
  const posted = cleanMarket(intent.market);
  if (posted) {
    st.markets[posted.id] = posted;
    return posted;
  }

  const known = st.markets[intent.marketId] ?? getPolymarkets().find((market) => market.id === intent.marketId) ?? null;
  if (known) st.markets[known.id] = known;
  return known;
}

function marketsForMarks(): PolyMarket[] {
  const st = state();
  const map = new Map<string, PolyMarket>();
  for (const market of getPolymarkets()) map.set(market.id, market);
  for (const market of Object.values(st.markets)) map.set(market.id, market);
  return Array.from(map.values());
}

function snapshot(): PaperLedgerSnapshot {
  const st = state();
  const positions = computePaperPositions(st.orders, marketsForMarks());
  return {
    source: "SERVER",
    storage: "IN_MEMORY",
    botCode: "POLYBOT",
    asOf: new Date().toISOString(),
    orders: st.orders.slice(0, 100),
    fills: st.fills.slice(0, 100),
    positions,
    events: st.events.slice(0, 100),
    exposureUsd: positions.reduce((sum, position) => sum + position.costBasis, 0),
    pnlUsd: positions.reduce((sum, position) => sum + position.pnl, 0),
  };
}

function recordEvent(event: Omit<PaperLedgerEvent, "id" | "createdAt">): PaperLedgerEvent {
  const st = state();
  const next: PaperLedgerEvent = {
    id: nextId("evt"),
    createdAt: new Date().toISOString(),
    ...event,
  };
  st.events = [next, ...st.events].slice(0, 200);
  return next;
}

function orderPrice(side: PaperOrder["side"], market: PolyMarket, book: PolyOrderBook | null, requested: unknown): number {
  const fallback = side === "BUY_YES"
    ? book?.bestAsk && book.bestAsk > 0 ? book.bestAsk : market.yesPrice
    : market.noPrice;
  return clamp(finiteNumber(requested, fallback), 0.01, 0.99);
}

export function getPaperLedgerSnapshot(): PaperLedgerSnapshot {
  return snapshot();
}

export function createPaperOrder(intent: PaperOrderIntent): {
  accepted: boolean;
  order?: PaperOrder;
  fill?: PaperFill;
  riskChecks: RiskCheck[];
  snapshot: PaperLedgerSnapshot;
  reason?: string;
} {
  const st = state();
  const side = cleanSide(intent.side);
  const riskProfile = cleanRiskProfile(intent.riskProfile);
  const botCode = cleanBotCode(intent.botCode);
  const market = findMarket(intent);

  if (botCode !== "POLYBOT") {
    const event = recordEvent({ type: "ORDER_REJECTED", message: "Unsupported bot code" });
    return { accepted: false, riskChecks: [], snapshot: snapshot(), reason: event.message };
  }

  if (!side || !market) {
    const event = recordEvent({ type: "ORDER_REJECTED", message: "Invalid paper order intent" });
    return { accepted: false, riskChecks: [], snapshot: snapshot(), reason: event.message };
  }

  const sizeUsd = Math.max(0, finiteNumber(intent.sizeUsd, RISK_LIMITS[riskProfile].maxOrderUsd));
  const book = intent.book ?? null;
  const positions = computePaperPositions(st.orders, marketsForMarks());
  const riskChecks = runRiskChecks({
    market,
    book,
    orders: st.orders,
    positions,
    riskProfile,
    orderSizeUsd: sizeUsd,
  });

  if (!sizeUsd || !canPlacePaperOrder(riskChecks)) {
    const event = recordEvent({
      type: "ORDER_REJECTED",
      message: !sizeUsd ? "Order size must be positive" : "Paper order blocked by risk checks",
      riskChecks,
    });
    return { accepted: false, riskChecks, snapshot: snapshot(), reason: event.message };
  }

  const now = new Date().toISOString();
  const price = orderPrice(side, market, book, intent.price);
  const order: PaperOrder = {
    id: nextId("paper"),
    createdAt: now,
    marketId: market.id,
    question: intent.question ?? market.question,
    side,
    price,
    sizeUsd,
    mode: "PAPER",
  };
  const fill: PaperFill = {
    id: nextId("fill"),
    orderId: order.id,
    createdAt: now,
    marketId: market.id,
    side,
    price,
    sizeUsd,
    shares: Number((sizeUsd / Math.max(price, 0.01)).toFixed(6)),
    liquiditySource: book?.source ?? "LOCAL",
    slippageBps: 0,
  };

  st.orders = [order, ...st.orders].slice(0, 200);
  st.fills = [fill, ...st.fills].slice(0, 200);
  st.markets[market.id] = market;
  recordEvent({ type: "ORDER_ACCEPTED", message: `${side} paper order accepted`, orderId: order.id, riskChecks });
  recordEvent({ type: "FILL_SIMULATED", message: `Simulated fill at ${(price * 100).toFixed(1)}c`, orderId: order.id });

  return { accepted: true, order, fill, riskChecks, snapshot: snapshot() };
}

export function resetPaperLedger(): PaperLedgerSnapshot {
  const st = state();
  st.orders = [];
  st.fills = [];
  st.events = [];
  st.markets = {};
  recordEvent({ type: "LEDGER_RESET", message: "Paper ledger reset" });
  return snapshot();
}
