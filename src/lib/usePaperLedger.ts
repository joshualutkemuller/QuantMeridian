import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/fetchCache";
import { type PolyMarket } from "@/data/polymarket";
import { computePaperPositions, type PaperOrder } from "@/data/polybot";
import {
  PAPER_LEDGER_LOCAL_STORAGE_KEY,
  type PaperFill,
  type PaperLedgerSnapshot,
  type PaperOrderIntent,
} from "@/data/paperLedger";

export type PaperLedgerStatus = "LOADING" | "SERVER" | "LOCAL";

function loadLocalOrders(): PaperOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PAPER_LEDGER_LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) as PaperOrder[] : [];
  } catch {
    return [];
  }
}

function saveLocalOrders(orders: PaperOrder[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PAPER_LEDGER_LOCAL_STORAGE_KEY, JSON.stringify(orders.slice(0, 50)));
}

export function localPaperFills(orders: PaperOrder[]): PaperFill[] {
  return orders.map((order) => ({
    id: `local-fill-${order.id}`,
    orderId: order.id,
    createdAt: order.createdAt,
    marketId: order.marketId,
    side: order.side,
    price: order.price,
    sizeUsd: order.sizeUsd,
    shares: Number((order.sizeUsd / Math.max(order.price, 0.01)).toFixed(6)),
    liquiditySource: "LOCAL",
    slippageBps: 0,
  }));
}

export function buildLocalPaperLedgerSnapshot(orders: PaperOrder[], markets: PolyMarket[]): PaperLedgerSnapshot {
  const positions = computePaperPositions(orders, markets);
  return {
    source: "LOCAL",
    storage: "LOCAL_STORAGE",
    botCode: "POLYBOT",
    asOf: new Date().toISOString(),
    orders,
    fills: localPaperFills(orders),
    positions,
    events: [],
    exposureUsd: positions.reduce((sum, position) => sum + position.costBasis, 0),
    pnlUsd: positions.reduce((sum, position) => sum + position.pnl, 0),
  };
}

export function createLocalFallbackOrder(intent: PaperOrderIntent): PaperOrder | null {
  if (intent.side !== "BUY_YES" && intent.side !== "BUY_NO") return null;
  const market = intent.market;
  const marketId = intent.marketId || market?.id;
  if (!marketId) return null;
  const price = typeof intent.price === "number"
    ? intent.price
    : intent.side === "BUY_YES"
      ? intent.book?.bestAsk || market?.yesPrice || 0.5
      : market?.noPrice || 0.5;
  return {
    id: `paper-local-${Date.now()}`,
    createdAt: new Date().toISOString(),
    marketId,
    question: intent.question ?? market?.question ?? marketId,
    side: intent.side,
    price: Math.max(0.01, Math.min(0.99, price)),
    sizeUsd: Math.max(0, intent.sizeUsd ?? 5),
    mode: "PAPER",
  };
}

export function usePaperLedger(markets: PolyMarket[]): {
  snapshot: PaperLedgerSnapshot;
  status: PaperLedgerStatus;
  submitOrder: (intent: PaperOrderIntent) => Promise<{ accepted: boolean; reason?: string | null }>;
  resetLedger: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [localOrders, setLocalOrders] = useState<PaperOrder[]>([]);
  const localSnapshot = useMemo(() => buildLocalPaperLedgerSnapshot(localOrders, markets), [localOrders, markets]);
  const [snapshot, setSnapshot] = useState<PaperLedgerSnapshot>(localSnapshot);
  const [status, setStatus] = useState<PaperLedgerStatus>("LOADING");

  useEffect(() => {
    setLocalOrders(loadLocalOrders());
  }, []);

  useEffect(() => {
    saveLocalOrders(localOrders);
  }, [localOrders]);

  useEffect(() => {
    if (status !== "SERVER") setSnapshot(localSnapshot);
  }, [localSnapshot, status]);

  const refresh = useCallback(async () => {
    try {
      const json = await fetchJson<any>("/api/trading-assistant/paper/orders", { maxAgeMs: 0, dedupeMs: 1_000 });
      if (json?.data) {
        setSnapshot(json.data);
        setStatus("SERVER");
        return;
      }
      throw new Error("paper ledger unavailable");
    } catch {
      setSnapshot(localSnapshot);
      setStatus("LOCAL");
    }
  }, [localSnapshot]);

  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitOrder = useCallback(async (intent: PaperOrderIntent) => {
    try {
      const res = await fetch("/api/trading-assistant/paper/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(intent),
      });
      const json = await res.json();
      if (json?.data) {
        setSnapshot(json.data);
        setStatus("SERVER");
        return { accepted: Boolean(json.accepted), reason: json.reason ?? null };
      }
      throw new Error("paper ledger order rejected without snapshot");
    } catch {
      const order = createLocalFallbackOrder(intent);
      if (!order) return { accepted: false, reason: "Invalid local paper order" };
      setStatus("LOCAL");
      setLocalOrders((prev) => {
        const next = [order, ...prev].slice(0, 50);
        setSnapshot(buildLocalPaperLedgerSnapshot(next, markets));
        return next;
      });
      return { accepted: true, reason: "Recorded in local fallback ledger" };
    }
  }, [markets]);

  const resetLedger = useCallback(async () => {
    try {
      const res = await fetch("/api/trading-assistant/paper/orders", { method: "DELETE" });
      const json = await res.json();
      if (json?.data) {
        setSnapshot(json.data);
        setStatus("SERVER");
        return;
      }
      throw new Error("paper ledger reset unavailable");
    } catch {
      setLocalOrders([]);
      setSnapshot(buildLocalPaperLedgerSnapshot([], markets));
      setStatus("LOCAL");
    }
  }, [markets]);

  return { snapshot, status, submitOrder, resetLedger, refresh };
}
