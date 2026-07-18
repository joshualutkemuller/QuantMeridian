import { json } from "@/lib/server/http";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

/**
 * GET /api/econ/credit
 * Credit spread daily observations and rolling metrics from Gold.
 * Exception to DB-only policy: no Tier-B live feed — returns empty if DB unavailable.
 */
export async function GET() {
  if (!goldEnabled()) {
    return json({ source: "DB", ok: false, error: "MACRO_DB_URL not configured", rows: [] });
  }
  try {
    const store = goldStore();
    const [daily, rolling] = await Promise.all([
      store.latest("credit_spread_daily"),
      store.latest("credit_spread_rolling"),
    ]);
    return json({ source: "DB", ok: true, daily, rolling });
  } catch (err) {
    return json({ source: "DB", ok: false, error: (err as Error).message, rows: [] });
  }
}
