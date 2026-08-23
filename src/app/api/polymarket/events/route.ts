import { json } from "@/lib/server/http";
import { getPolyEvents, mapGammaEventsToPolyEvents } from "@/data/polymarket";

const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events";

/**
 * GET /api/polymarket/events
 * Public Gamma event discovery with deterministic SIM fallback.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const useSim = url.searchParams.get("sim") === "1";
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 100), 250));

  if (useSim) {
    return json({ source: "SIM", data: getPolyEvents().slice(0, limit) });
  }

  try {
    const gammaUrl = `${GAMMA_EVENTS_URL}?active=true&closed=false&limit=${limit}`;
    const res = await fetch(gammaUrl, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Gamma ${res.status}`);

    const payload = await res.json();
    const data = mapGammaEventsToPolyEvents(payload, limit);
    if (!data.length) throw new Error("Gamma returned no active events");

    return json({ source: "POLY", data });
  } catch (err) {
    return json({
      source: "SIM",
      data: getPolyEvents().slice(0, limit),
      warning: err instanceof Error ? err.message : "Polymarket events unavailable",
    });
  }
}
