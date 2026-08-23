import { json } from "@/lib/server/http";
import { getPolyPriceHistory } from "@/data/polymarket";

const CLOB_HISTORY_URL = "https://clob.polymarket.com/prices-history";

function asPrice(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return isFinite(n) ? Math.max(0.01, Math.min(0.99, n)) : null;
}

function mapHistory(payload: unknown) {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(root.history) ? root.history : Array.isArray(root.data) ? root.data : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const price = asPrice(record.p ?? record.price ?? record.value);
    const ts = Number(record.t ?? record.timestamp ?? record.time);
    if (price == null || !isFinite(ts)) return [];
    const millis = ts > 10_000_000_000 ? ts : ts * 1000;
    return [{ date: new Date(millis).toISOString().slice(0, 10), price }];
  });
}

/**
 * GET /api/polymarket/history?id=<outcomeTokenId>&days=90
 * Reads public CLOB price history where possible, with SIM fallback.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const days = Math.max(7, Math.min(Number(url.searchParams.get("days") ?? 90), 365));
  const useSim = url.searchParams.get("sim") === "1" || id.startsWith("poly-") || id.startsWith("sim-");

  if (!id || useSim) {
    return json({ source: "SIM", data: id ? getPolyPriceHistory(id, days) : [] });
  }

  try {
    const res = await fetch(`${CLOB_HISTORY_URL}?market=${encodeURIComponent(id)}&interval=max`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CLOB history ${res.status}`);

    const data = mapHistory(await res.json()).slice(-days);
    if (!data.length) throw new Error("CLOB history returned no points");

    return json({ source: "POLY", data });
  } catch (err) {
    return json({
      source: "SIM",
      data: getPolyPriceHistory(id, days),
      warning: err instanceof Error ? err.message : "Polymarket history unavailable",
    });
  }
}
