import { json } from "@/lib/server/http";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

/**
 * GET /api/econ/regime
 * Macro regime daily scores and named regime from Gold.
 * Exception to DB-only policy: no Tier-B live feed — returns empty if DB unavailable.
 */
export async function GET() {
  if (!goldEnabled()) {
    return json({ source: "DB", ok: false, error: "MACRO_DB_URL not configured", rows: [] });
  }
  try {
    const store = goldStore();
    const rows = await store.latest("macro_regime_daily");
    return json({ source: "DB", ok: true, rows });
  } catch (err) {
    return json({ source: "DB", ok: false, error: (err as Error).message, rows: [] });
  }
}
