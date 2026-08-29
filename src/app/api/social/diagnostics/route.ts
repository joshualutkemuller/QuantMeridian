// Exception to DB-only policy — non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1.
import { getSocialDiagnostics } from "@/lib/server/socialDiagnostics";
import { json } from "@/lib/server/http";

/**
 * GET /api/social/diagnostics
 *
 * Real social-feed smoke check for DataOps: provider attempts, winning source,
 * post volume, and top ticker/theme. Never falls back to generated social data.
 */
export async function GET() {
  const diagnostics = await getSocialDiagnostics();
  return json(diagnostics);
}
