// Exception to DB-only policy — non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1.
import { json } from "@/lib/server/http";
import { fetchLivePriceHistory } from "@/lib/server/polymarket";
import { getPolyPriceHistory } from "@/data/polymarket";
import { simFallbackEnabled } from "@/lib/server/fallbacks";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "poly-000";
  const days = Number(url.searchParams.get("days") ?? 90);

  // 1. LIVE — Polymarket CLOB API (public, no auth)
  try {
    const history = await fetchLivePriceHistory(id, days);
    if (history.length) {
      return json({ source: "POLY", data: history });
    }
  } catch (err) {
    console.warn(`[polymarket] live price history fetch failed: ${(err as Error).message}`);
  }

  // 2. SIM — deterministic fallback
  if (!simFallbackEnabled(req)) return json({ source: "ERR", data: [] });
  return json({ source: "SIM", data: getPolyPriceHistory(id, days) });
}
