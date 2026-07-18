import { json } from "@/lib/server/http";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

/**
 * GET /api/econ/inflation
 * CPI/PCE item tree, contributions, and accel metrics from Gold.
 * Exception to DB-only policy: no Tier-B live feed — returns empty if DB unavailable.
 *
 * Note: PCE item-level drill is deferred pending BEA manifest in the pipeline.
 * INFL shows headline/core PCE until the pipeline adds the BEA manifest (see §9.3).
 */
export async function GET() {
  if (!goldEnabled()) {
    return json({ source: "DB", ok: false, error: "MACRO_DB_URL not configured", rows: [] });
  }
  try {
    const store = goldStore();
    const [explorer, contribution] = await Promise.all([
      store.latest("inflation_explorer"),
      store.latest("inflation_contribution"),
    ]);
    return json({ source: "DB", ok: true, explorer, contribution });
  } catch (err) {
    return json({ source: "DB", ok: false, error: (err as Error).message, rows: [] });
  }
}
