import { json } from "@/lib/server/http";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

/**
 * GET /api/econ/funding
 * Funding tape and stress metrics from Gold.
 * Exception to DB-only policy: no Tier-B live feed — returns empty if DB unavailable.
 */
export async function GET() {
  if (!goldEnabled()) {
    return json({ source: "DB", ok: false, error: "MACRO_DB_URL not configured", rows: [] });
  }
  try {
    const store = goldStore();
    const [tape, stress] = await Promise.all([
      store.latest("funding_tape_daily"),
      store.latest("funding_stress_daily"),
    ]);
    return json({ source: "DB", ok: true, tape, stress });
  } catch (err) {
    return json({ source: "DB", ok: false, error: (err as Error).message, rows: [] });
  }
}
