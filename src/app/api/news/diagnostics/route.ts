// Exception to DB-only policy — non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1.
import { getNewsDiagnostics } from "@/lib/server/newsDiagnostics";
import { json } from "@/lib/server/http";

/**
 * GET /api/news/diagnostics?n=20
 *
 * Real news smoke check for DataOps: provider attempts, winning provider,
 * newest headline age, and NEWS_NLP health. Never falls back to generated data.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("n") ?? 20);
  const n = Number.isFinite(requested) ? Math.min(60, Math.max(5, requested)) : 20;
  const diagnostics = await getNewsDiagnostics(n);
  return json(diagnostics);
}
