// Exception to DB-only policy — non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1.
import { json } from "@/lib/server/http";
import { fetchLiveSocial } from "@/lib/server/socialProviders";
import { getSocialIntel } from "@/data/news";
import { simFallbackEnabled } from "@/lib/server/fallbacks";


/**
 * GET /api/social
 * Returns aggregated social sentiment (Reddit + StockTwits) when configured,
 * returning ERR when no real posts are available unless `sim=1` explicitly opts
 * into generated social rows. Always 200 with a `source` provenance field.
 */
export async function GET(req: Request) {
  const live = await fetchLiveSocial().catch(() => null);
  if (live && live.source !== "ERR") return json({ source: live.source, ...live.intel, diagnostics: live.diagnostics });
  const diagnostics = live?.diagnostics ?? [];
  if (!simFallbackEnabled(req)) return json({ source: "ERR", tickers: [], sectors: [], themes: [], totalPosts: 0, platforms: [], diagnostics });
  return json({ source: "SIM", ...getSocialIntel(), diagnostics });
}
