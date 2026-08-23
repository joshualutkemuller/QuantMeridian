import { json } from "@/lib/server/http";
import {
  createPaperOrder,
  getPaperLedgerSnapshot,
  resetPaperLedger,
} from "@/server/paperLedger";
import type { PaperOrderIntent } from "@/data/paperLedger";

/**
 * GET /api/trading-assistant/paper/orders
 * Returns the current in-process paper ledger snapshot.
 */
export async function GET() {
  return json({ source: "SERVER", data: getPaperLedgerSnapshot() });
}

/**
 * POST /api/trading-assistant/paper/orders
 * Accepts a paper order intent, runs server-side risk checks, and simulates a fill.
 */
export async function POST(req: Request) {
  let body: PaperOrderIntent;
  try {
    body = await req.json();
  } catch {
    return json({ source: "SERVER", accepted: false, error: "invalid body" }, { status: 400 });
  }

  const result = createPaperOrder(body);
  return json({
    source: "SERVER",
    accepted: result.accepted,
    order: result.order ?? null,
    fill: result.fill ?? null,
    riskChecks: result.riskChecks,
    reason: result.reason ?? null,
    data: result.snapshot,
  });
}

/**
 * DELETE /api/trading-assistant/paper/orders
 * Clears the in-process paper ledger. Useful for deterministic paper testing.
 */
export async function DELETE() {
  return json({ source: "SERVER", data: resetPaperLedger() });
}
