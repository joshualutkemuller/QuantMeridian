import { json } from "@/lib/server/http";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

/**
 * GET /api/econ/global
 * Global CPI and policy rates from Gold.
 * Exception to DB-only policy: no Tier-B live feed — returns empty if DB unavailable.
 */
export async function GET() {
  if (!goldEnabled()) {
    return json({ source: "DB", ok: false, error: "MACRO_DB_URL not configured", rows: [] });
  }
  try {
    const store = goldStore();
    const [inflation, policyRates] = await Promise.all([
      store.latest("global_inflation"),
      store.latest("global_policy_rates"),
    ]);
    return json({ source: "DB", ok: true, inflation, policy_rates: policyRates });
  } catch (err) {
    return json({ source: "DB", ok: false, error: (err as Error).message, rows: [] });
  }
}
