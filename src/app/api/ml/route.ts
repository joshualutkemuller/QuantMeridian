import { json } from "@/lib/server/http";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

/**
 * GET /api/ml?view=recession|inflation|factors|anomaly|attribution
 *
 * ML Applications (EML module) — serves Gold-precomputed ML outputs.
 * Returns empty if Gold DB is not configured (no SIM fallback for ML outputs).
 */
export async function GET(req: Request) {
  const view = new URL(req.url).searchParams.get("view") ?? "recession";

  if (!goldEnabled()) {
    return json({ source: "DB", ok: false, error: "MACRO_DB_URL not configured", rows: [] });
  }

  const TABLE_MAP: Record<string, string> = {
    recession: "recession_probability_daily",
    inflation: "inflation_forecast",
    factors: "macro_factor_scores",
    loadings: "macro_factor_loadings",
    anomaly: "macro_anomaly_scores",
    attribution: "equity_factor_attribution",
    implied_return: "equity_factor_implied_return",
  };

  const table = TABLE_MAP[view];
  if (!table) {
    return json({ error: `unknown view '${view}'. Valid: ${Object.keys(TABLE_MAP).join(", ")}` }, { status: 400 });
  }

  try {
    const store = goldStore();
    const rows = await store.latest(table);
    return json({ source: "DB", ok: true, view, rows });
  } catch (err) {
    return json({ source: "DB", ok: false, error: (err as Error).message, rows: [] });
  }
}
