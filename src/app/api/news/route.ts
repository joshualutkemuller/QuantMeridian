import { json } from "@/lib/server/http";

/**
 * GET /api/news
 * News feed removed — all data is sourced from the fred-bronze-to-gold-pipeline
 * via MACRO_DB_URL. No external news providers are wired.
 */
export async function GET() {
  return json({ source: "DISABLED", headlines: [], clusters: [] });
}
