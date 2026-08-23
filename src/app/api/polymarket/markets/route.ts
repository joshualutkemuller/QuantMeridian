import { json } from "@/lib/server/http";
import {
  getPolymarkets,
  mapGammaEventsToMarkets,
  type PolyCategory,
} from "@/data/polymarket";

const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events";

function simMarkets(limit: number, category?: string) {
  const markets = getPolymarkets().filter((market) => !category || market.category === category);
  return markets.slice(0, limit);
}

/**
 * GET /api/polymarket/markets
 * Live-first public Polymarket discovery with deterministic SIM fallback.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 100), 250));
  const category = url.searchParams.get("category") as PolyCategory | null;
  const useSim = url.searchParams.get("sim") === "1";

  if (useSim) {
    return json({ source: "SIM", data: simMarkets(limit, category ?? undefined) });
  }

  try {
    const fetchLimit = Math.max(limit, 100);
    const gammaUrl = `${GAMMA_EVENTS_URL}?active=true&closed=false&limit=${fetchLimit}`;
    const res = await fetch(gammaUrl, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Gamma ${res.status}`);

    const payload = await res.json();
    const data = mapGammaEventsToMarkets(payload, fetchLimit)
      .filter((market) => market.active && (!category || market.category === category))
      .slice(0, limit);

    if (!data.length) throw new Error("Gamma returned no active markets");
    return json({ source: "POLY", data });
  } catch (err) {
    return json({
      source: "SIM",
      data: simMarkets(limit, category ?? undefined),
      warning: err instanceof Error ? err.message : "Polymarket discovery unavailable",
    });
  }
}
