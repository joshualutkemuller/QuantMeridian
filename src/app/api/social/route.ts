import { json } from "@/lib/server/http";

/**
 * GET /api/social
 * Social sentiment removed — all data is sourced from the fred-bronze-to-gold-pipeline
 * via MACRO_DB_URL. No external social providers are wired.
 */
export async function GET() {
  return json({ source: "DISABLED", tickers: [], sectors: [], themes: [], totalPosts: 0, platforms: [] });
}
