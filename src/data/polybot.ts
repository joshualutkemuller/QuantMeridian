import type { PolyMarket } from "@/data/polymarket";

export type BotCode = "POLYBOT";
export type AssistantMode = "RESEARCH" | "PAPER" | "LIVE";
export type RiskProfile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "CUSTOM";

export interface PolyBotSignal {
  market: PolyMarket;
  modelProbability: number;
  executablePrice: number;
  expectedEdge: number;
  spread: number;
  depthScore: number;
  urgencyScore: number;
  signalScore: number;
  confidence: "LOW" | "MED" | "HIGH";
  warning: string;
}

export interface PolyBookLevel {
  level: number;
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
}

export interface PolyOrderBook {
  source: "CLOB" | "SIM" | "ERR" | "LOADING";
  tokenId?: string;
  levels: PolyBookLevel[];
  bestBid: number;
  bestAsk: number;
  midpoint: number;
  spread: number;
  depthUsd: number;
  hash?: string;
  warning?: string;
}

export interface PaperOrder {
  id: string;
  createdAt: string;
  marketId: string;
  question: string;
  side: "BUY_YES" | "BUY_NO";
  price: number;
  sizeUsd: number;
  mode: "PAPER";
}

export interface PaperPosition {
  marketId: string;
  question: string;
  yesUsd: number;
  noUsd: number;
  yesShares: number;
  noShares: number;
  netShares: number;
  avgYesPrice: number;
  avgNoPrice: number;
  markYes: number;
  markNo: number;
  marketValue: number;
  costBasis: number;
  pnl: number;
}

export interface RiskCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export const BOT_OPTIONS: { value: BotCode; label: string }[] = [
  { value: "POLYBOT", label: "Polymarket" },
];

export const RISK_OPTIONS: { value: RiskProfile; label: string }[] = [
  { value: "CONSERVATIVE", label: "Conservative" },
  { value: "BALANCED", label: "Balanced" },
  { value: "AGGRESSIVE", label: "Aggressive" },
  { value: "CUSTOM", label: "Custom" },
];

export const MODE_OPTIONS: { value: AssistantMode; label: string; disabled?: boolean }[] = [
  { value: "RESEARCH", label: "Research" },
  { value: "PAPER", label: "Paper" },
  { value: "LIVE", label: "Live", disabled: true },
];

export const RISK_LIMITS: Record<RiskProfile, { maxOrderUsd: number; maxMarketUsd: number; maxSpread: number; minDepthUsd: number; maxDailyLoss: number }> = {
  CONSERVATIVE: { maxOrderUsd: 5, maxMarketUsd: 25, maxSpread: 0.06, minDepthUsd: 100, maxDailyLoss: 25 },
  BALANCED: { maxOrderUsd: 10, maxMarketUsd: 50, maxSpread: 0.08, minDepthUsd: 75, maxDailyLoss: 50 },
  AGGRESSIVE: { maxOrderUsd: 25, maxMarketUsd: 125, maxSpread: 0.12, minDepthUsd: 50, maxDailyLoss: 100 },
  CUSTOM: { maxOrderUsd: 5, maxMarketUsd: 25, maxSpread: 0.06, minDepthUsd: 100, maxDailyLoss: 25 },
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function daysToClose(endDate: string): number {
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const now = Date.now();
  return Math.max(0, Math.round((end - now) / 86_400_000));
}

export function buildSimBook(market: PolyMarket): PolyOrderBook {
  const midpoint = market.yesPrice;
  const halfSpread = Math.max(0.005, market.spread / 2);
  const baseDepth = Math.max(25, market.liquidity / 50_000);
  const levels = Array.from({ length: 5 }, (_, i) => {
    const step = i * 0.01;
    return {
      level: i + 1,
      bid: clamp(midpoint - halfSpread - step, 0.01, 0.99),
      bidSize: Math.round(baseDepth * (5 - i) * 8),
      ask: clamp(midpoint + halfSpread + step, 0.01, 0.99),
      askSize: Math.round(baseDepth * (5 - i) * 7),
    };
  });
  return normalizeBook(levels, "SIM", market.yesTokenId, `sim-${market.id}`);
}

export function normalizeBook(levels: PolyBookLevel[], source: PolyOrderBook["source"], tokenId?: string, hash?: string): PolyOrderBook {
  const clean = levels
    .filter((l) => {
      const hasBid = isFinite(l.bid) && l.bid > 0;
      const hasAsk = isFinite(l.ask) && l.ask > 0;
      return hasBid || hasAsk;
    })
    .sort((a, b) => a.level - b.level);
  const bestBid = clean.find((l) => l.bid > 0)?.bid ?? 0;
  const bestAsk = clean.find((l) => l.ask > 0)?.ask ?? 0;
  const midpoint = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestAsk || bestBid || 0;
  const spread = bestBid && bestAsk ? Math.max(0, bestAsk - bestBid) : 0;
  const depthUsd = clean.reduce((sum, l) => sum + l.bid * l.bidSize + l.ask * l.askSize, 0);
  return {
    source,
    tokenId,
    levels: clean,
    bestBid,
    bestAsk,
    midpoint,
    spread,
    depthUsd,
    hash,
    warning: clean.length ? undefined : "No order book levels available",
  };
}

export function buildSignal(market: PolyMarket, book?: PolyOrderBook): PolyBotSignal {
  const bookSpread = book?.spread && book.spread > 0 ? book.spread : market.spread;
  const executablePrice = clamp(book?.bestAsk && book.bestAsk > 0 ? book.bestAsk : market.yesPrice + bookSpread / 2, 0.01, 0.99);
  const momentum = clamp(market.chg24h, -0.1, 0.1);
  const liquidityBoost = clamp(Math.log10(Math.max(book?.depthUsd || market.liquidity, 1)) / 10, 0, 0.85);
  const volumeBoost = clamp(Math.log10(Math.max(market.volume24h, 1)) / 10, 0, 0.75);
  const modelProbability = clamp(market.yesPrice + momentum * 0.35 + (liquidityBoost - 0.45) * 0.04, 0.02, 0.98);
  const spreadPenalty = bookSpread * 0.6;
  const expectedEdge = modelProbability - executablePrice - spreadPenalty;
  const depthScore = Math.round(clamp((liquidityBoost * 0.65 + volumeBoost * 0.35) * 100, 0, 100));
  const urgencyScore = Math.round(clamp((1 - daysToClose(market.endDate) / 180) * 100, 0, 100));
  const signalScore = Math.round(clamp((expectedEdge * 350) + depthScore * 0.45 + urgencyScore * 0.2 - bookSpread * 120, 0, 100));
  const confidence = signalScore >= 70 && depthScore >= 55 ? "HIGH" : signalScore >= 45 ? "MED" : "LOW";
  const warning = bookSpread >= 0.08 ? "Wide spread" : depthScore < 40 ? "Thin depth" : daysToClose(market.endDate) <= 7 ? "Near close" : "Risk checks clean";

  return {
    market,
    modelProbability,
    executablePrice,
    expectedEdge,
    spread: bookSpread,
    depthScore,
    urgencyScore,
    signalScore,
    confidence,
    warning,
  };
}

export function buildSignals(markets: PolyMarket[], selectedBook?: PolyOrderBook, selectedMarketId?: string): PolyBotSignal[] {
  return markets
    .map((market) => buildSignal(market, selectedMarketId === market.id ? selectedBook : undefined))
    .sort((a, b) => b.signalScore - a.signalScore);
}

export function computePaperPositions(orders: PaperOrder[], markets: PolyMarket[]): PaperPosition[] {
  const byMarket = new Map<string, PaperOrder[]>();
  for (const order of orders) {
    const next = byMarket.get(order.marketId) ?? [];
    next.push(order);
    byMarket.set(order.marketId, next);
  }

  return Array.from(byMarket.entries()).map(([marketId, rows]) => {
    const market = markets.find((m) => m.id === marketId);
    const yesRows = rows.filter((o) => o.side === "BUY_YES");
    const noRows = rows.filter((o) => o.side === "BUY_NO");
    const yesUsd = yesRows.reduce((sum, o) => sum + o.sizeUsd, 0);
    const noUsd = noRows.reduce((sum, o) => sum + o.sizeUsd, 0);
    const yesShares = yesRows.reduce((sum, o) => sum + o.sizeUsd / Math.max(o.price, 0.01), 0);
    const noShares = noRows.reduce((sum, o) => sum + o.sizeUsd / Math.max(o.price, 0.01), 0);
    const markYes = market?.yesPrice ?? yesRows[0]?.price ?? 0;
    const markNo = market?.noPrice ?? noRows[0]?.price ?? 0;
    const marketValue = yesShares * markYes + noShares * markNo;
    const costBasis = yesUsd + noUsd;
    return {
      marketId,
      question: rows[0]?.question ?? market?.question ?? marketId,
      yesUsd,
      noUsd,
      yesShares,
      noShares,
      netShares: yesShares - noShares,
      avgYesPrice: yesShares ? yesUsd / yesShares : 0,
      avgNoPrice: noShares ? noUsd / noShares : 0,
      markYes,
      markNo,
      marketValue,
      costBasis,
      pnl: marketValue - costBasis,
    };
  }).sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
}

export function runRiskChecks(args: {
  market: PolyMarket | null;
  book: PolyOrderBook | null;
  orders: PaperOrder[];
  positions: PaperPosition[];
  riskProfile: RiskProfile;
  orderSizeUsd?: number;
}): RiskCheck[] {
  const limits = RISK_LIMITS[args.riskProfile];
  const currentPosition = args.market ? args.positions.find((p) => p.marketId === args.market?.id) : undefined;
  const orderSize = args.orderSizeUsd ?? limits.maxOrderUsd;
  const projectedMarketUsd = (currentPosition?.costBasis ?? 0) + orderSize;
  const dailyPnl = args.positions.reduce((sum, p) => sum + p.pnl, 0);
  const spread = args.book?.spread ?? args.market?.spread ?? 0;
  const depthUsd = args.book?.depthUsd ?? args.market?.liquidity ?? 0;

  return [
    { label: "Max order", ok: orderSize <= limits.maxOrderUsd, detail: `$${orderSize} <= $${limits.maxOrderUsd}` },
    { label: "Max position", ok: projectedMarketUsd <= limits.maxMarketUsd, detail: `$${projectedMarketUsd.toFixed(0)} <= $${limits.maxMarketUsd}` },
    { label: "Spread", ok: spread <= limits.maxSpread, detail: `${(spread * 100).toFixed(1)}c <= ${(limits.maxSpread * 100).toFixed(1)}c` },
    { label: "Depth", ok: depthUsd >= limits.minDepthUsd, detail: `$${depthUsd.toFixed(0)} >= $${limits.minDepthUsd}` },
    { label: "Daily loss", ok: dailyPnl >= -limits.maxDailyLoss, detail: `${dailyPnl.toFixed(2)} >= -$${limits.maxDailyLoss}` },
  ];
}

export function canPlacePaperOrder(checks: RiskCheck[]): boolean {
  return checks.every((check) => check.ok);
}
