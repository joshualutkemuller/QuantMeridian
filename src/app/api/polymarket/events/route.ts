// Exception to DB-only policy — non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1.
import { json } from "@/lib/server/http";
import { fetchLiveEvents } from "@/lib/server/polymarket";
import { getPolyEvents } from "@/data/polymarket";
import { simFallbackEnabled } from "@/lib/server/fallbacks";

export async function GET(req: Request) {
  // 1. LIVE — Polymarket Gamma API (public, no auth)
  try {
    const events = await fetchLiveEvents(20);
    if (events.length) {
      return json({ source: "POLY", data: events });
    }
  } catch (err) {
    console.warn(`[polymarket] live events fetch failed: ${(err as Error).message}`);
  }

  // 2. SIM — deterministic fallback
  if (!simFallbackEnabled(req)) return json({ source: "ERR", data: [] });
  return json({ source: "SIM", data: getPolyEvents() });
}
