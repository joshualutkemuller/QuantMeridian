// Exception to DB-only policy — non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1.
import { json } from "@/lib/server/http";
import { fetchLiveEvents } from "@/lib/server/polymarket";
import { getPolyEvents } from "@/data/polymarket";

export async function GET() {
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
  return json({ source: "SIM", data: getPolyEvents() });
}
