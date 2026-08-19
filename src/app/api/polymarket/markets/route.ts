import { json } from "@/lib/server/http";

/**
 * GET /api/polymarket/markets
 * Polymarket removed — all data is sourced from the fred-bronze-to-gold-pipeline.
 */
export async function GET() {
  return json({ source: "DISABLED", markets: [] });
}
