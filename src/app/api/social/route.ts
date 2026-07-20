// Exception to DB-only policy — non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1.
import { json } from "@/lib/server/http";
import { fetchLiveSocial } from "@/lib/server/socialProviders";
import { getSocialIntel } from "@/data/news";
import { simFallbackEnabled } from "@/lib/server/fallbacks";


/**
 * GET /api/social
 * Returns aggregated social sentiment (Reddit + StockTwits) when configured,
 * falling back to the SIM engine. Always 200 with a `source` provenance field.
 */
export async function GET(req: Request) {
  const live = await fetchLiveSocial().catch(() => null);
  if (live) return json({ source: live.source, ...live.intel });
  if (!simFallbackEnabled(req)) return json({ source: "ERR", tickers: [], sectors: [], themes: [], totalPosts: 0, platforms: [] });
  return json({ source: "SIM", ...getSocialIntel() });
}
