// Exception to DB-only policy — non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1.
import { json } from "@/lib/server/http";
import { fetchLiveMarkets } from "@/lib/server/polymarket";
import { getPolymarkets } from "@/data/polymarket";
import { simFallbackEnabled } from "@/lib/server/fallbacks";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const category = url.searchParams.get("category") ?? undefined;

  // 1. LIVE — Polymarket Gamma API (public, no auth)
  try {
    const markets = await fetchLiveMarkets({ limit, category });
    if (markets.length) {
      return json({ source: "POLY", data: markets });
    }
  } catch (err) {
    console.warn(`[polymarket] live markets fetch failed: ${(err as Error).message}`);
  }

  // 2. SIM — deterministic fallback
  if (!simFallbackEnabled(req)) return json({ source: "ERR", data: [] });
  let markets = getPolymarkets();
  if (category) markets = markets.filter((m) => m.category === category);
  if (limit) markets = markets.slice(0, limit);
  return json({ source: "SIM", data: markets });
}
