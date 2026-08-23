import { json } from "@/lib/server/http";
import { getPaperLedgerSnapshot } from "@/server/paperLedger";

/**
 * GET /api/trading-assistant/paper/positions
 * Returns server-side paper positions, fills, P&L, and ledger events.
 */
export async function GET() {
  const snapshot = getPaperLedgerSnapshot();
  return json({
    source: "SERVER",
    data: {
      ...snapshot,
      orders: snapshot.orders,
      positions: snapshot.positions,
      fills: snapshot.fills,
      events: snapshot.events,
    },
  });
}
