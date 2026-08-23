import { json } from "@/lib/server/http";
import { getPolymarkets } from "@/data/polymarket";
import { buildSimBook, normalizeBook, type PolyBookLevel } from "@/data/polybot";

const CLOB_BOOK_URL = "https://clob.polymarket.com/book";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, ""));
    return isFinite(n) ? n : 0;
  }
  return 0;
}

function asLevels(value: unknown, side: "bid" | "ask") {
  return (Array.isArray(value) ? value : [])
    .map((row) => {
      const record = asRecord(row);
      return {
        price: asNumber(record.price),
        size: asNumber(record.size),
      };
    })
    .filter((row) => row.price > 0 && row.size > 0)
    .sort((a, b) => side === "bid" ? b.price - a.price : a.price - b.price);
}

function mapBook(payload: unknown): PolyBookLevel[] {
  const root = asRecord(payload);
  const bids = asLevels(root.bids, "bid");
  const asks = asLevels(root.asks, "ask");
  const len = Math.min(5, Math.max(bids.length, asks.length));

  return Array.from({ length: len }, (_, idx) => ({
    level: idx + 1,
    bid: bids[idx]?.price ?? 0,
    bidSize: bids[idx]?.size ?? 0,
    ask: asks[idx]?.price ?? 0,
    askSize: asks[idx]?.size ?? 0,
  })).filter((row) => row.bid > 0 || row.ask > 0);
}

/**
 * GET /api/polymarket/book?tokenId=<outcomeTokenId>&marketId=<marketId>
 * Reads public CLOB order book data by token id with deterministic SIM fallback.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenId = url.searchParams.get("tokenId") ?? "";
  const marketId = url.searchParams.get("marketId") ?? "";
  const useSim = url.searchParams.get("sim") === "1" || tokenId.startsWith("sim-");
  const market = getPolymarkets().find((m) => m.id === marketId || m.yesTokenId === tokenId || m.noTokenId === tokenId);

  if (useSim || !tokenId) {
    if (market) return json({ source: "SIM", data: buildSimBook(market) });
    return json({ source: "ERR", data: normalizeBook([], "ERR", tokenId), warning: "No market available for simulated book" });
  }

  try {
    const res = await fetch(`${CLOB_BOOK_URL}?token_id=${encodeURIComponent(tokenId)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CLOB book ${res.status}`);

    const payload = await res.json();
    const root = asRecord(payload);
    const book = normalizeBook(mapBook(payload), "CLOB", tokenId, typeof root.hash === "string" ? root.hash : undefined);
    if (!book.levels.length) throw new Error("CLOB book returned no levels");

    return json({ source: "POLY", data: book });
  } catch (err) {
    if (market) {
      return json({
        source: "SIM",
        data: { ...buildSimBook(market), warning: err instanceof Error ? err.message : "CLOB book unavailable" },
      });
    }
    return json({
      source: "ERR",
      data: normalizeBook([], "ERR", tokenId),
      warning: err instanceof Error ? err.message : "CLOB book unavailable",
    });
  }
}
