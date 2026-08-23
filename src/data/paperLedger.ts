import type { PolyMarket } from "@/data/polymarket";
import type {
  BotCode,
  PaperOrder,
  PaperPosition,
  PolyOrderBook,
  RiskCheck,
  RiskProfile,
} from "@/data/polybot";

export const PAPER_LEDGER_LOCAL_STORAGE_KEY = "qit.polybot.paperOrders";

export type PaperLedgerStorage = "IN_MEMORY" | "LOCAL_STORAGE";
export type PaperLedgerSource = "SERVER" | "LOCAL";

export interface PaperFill {
  id: string;
  orderId: string;
  createdAt: string;
  marketId: string;
  side: PaperOrder["side"];
  price: number;
  sizeUsd: number;
  shares: number;
  liquiditySource: PolyOrderBook["source"] | "LOCAL";
  slippageBps: number;
}

export interface PaperLedgerEvent {
  id: string;
  createdAt: string;
  type: "ORDER_ACCEPTED" | "ORDER_REJECTED" | "FILL_SIMULATED" | "LEDGER_RESET";
  message: string;
  orderId?: string;
  riskChecks?: RiskCheck[];
}

export interface PaperLedgerSnapshot {
  source: PaperLedgerSource;
  storage: PaperLedgerStorage;
  botCode: BotCode;
  asOf: string;
  orders: PaperOrder[];
  fills: PaperFill[];
  positions: PaperPosition[];
  events: PaperLedgerEvent[];
  exposureUsd: number;
  pnlUsd: number;
}

export interface PaperOrderIntent {
  botCode?: BotCode;
  marketId: string;
  question?: string;
  side: PaperOrder["side"];
  price?: number;
  sizeUsd?: number;
  riskProfile?: RiskProfile;
  market?: PolyMarket | null;
  book?: PolyOrderBook | null;
}
