import { json } from "@/lib/server/http";
import { buildLiveSnapshots, type CurveHistory } from "@/data/econCurve";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

interface GoldCurveRow {
  as_of_date: string;
  tenor?: string;
  tenor_label?: string;
  tenor_months: number;
  yield_pct: number;
}

interface GoldCurveMetricsRow {
  as_of_date: string;
  level: number | null;
  slope_10y2y: number | null;
  slope_10y3m: number | null;
  curvature_2_5_10: number | null;
  butterfly_2_10_30: number | null;
  curve_move: string | null;
  is_recession: boolean | null;
}

const TENOR_TO_FRED: Record<string, string> = {
  "1M": "DGS1MO", "3M": "DGS3MO", "6M": "DGS6MO",
  "1Y": "DGS1", "2Y": "DGS2", "3Y": "DGS3", "5Y": "DGS5",
  "7Y": "DGS7", "10Y": "DGS10", "20Y": "DGS20", "30Y": "DGS30",
};

/**
 * GET /api/econ/curve-history?years=7
 *
 * Resolution order:
 *   1. Gold DB — gold.treasury_curve (all as-of dates) + treasury_curve_metrics
 *   2. Explicit empty/error state
 */
export async function GET(req: Request) {
  const reqYears = Number(new URL(req.url).searchParams.get("years") ?? 7);
  const years = Math.max(2, Math.min(25, Number.isFinite(reqYears) ? reqYears : 7));
  const start = `${new Date().getUTCFullYear() - years}-01-01`;

  if (goldEnabled()) {
    try {
      const store = goldStore();
      const isPg = /^postgres/.test(process.env.MACRO_DB_URL ?? "");
      const startParam = isPg ? "$1" : "?";
      const [curveRows, metricsRows] = await Promise.all([
        store.raw<GoldCurveRow>(
          `SELECT as_of_date, tenor_label, tenor_months, yield_pct FROM ${process.env.MACRO_DB_URL?.startsWith("sqlite") ? "gold_treasury_curve" : "gold.treasury_curve"} WHERE as_of_date >= ${startParam} ORDER BY as_of_date, tenor_months`,
          [start]
        ),
        store.raw<GoldCurveMetricsRow>(
          `SELECT as_of_date, level, slope_10y2y, slope_10y3m, curvature_2_5_10, butterfly_2_10_30, curve_move, is_recession FROM ${process.env.MACRO_DB_URL?.startsWith("sqlite") ? "gold_treasury_curve_metrics" : "gold.treasury_curve_metrics"} WHERE as_of_date >= ${startParam} ORDER BY as_of_date`,
          [start]
        ),
      ]);

      if (curveRows.length) {
        // Build CurveHistory (fredId → [{date, value}]) from Gold rows
        const history: CurveHistory = {};
        for (const row of curveRows) {
          const fredId = TENOR_TO_FRED[row.tenor ?? row.tenor_label ?? ""];
          if (!fredId) continue;
          if (!history[fredId]) history[fredId] = [];
          history[fredId].push({ date: row.as_of_date, value: row.yield_pct });
        }

        const snapshots = buildLiveSnapshots(history);
        const metricsById = new Map(metricsRows.map((r) => [r.as_of_date, r]));
        const asOf = snapshots.find((s) => s.id === "now")?.date ?? null;

        return json({ source: "DB", asOf, years, snapshots, metrics: Object.fromEntries(metricsById) });
      }
    } catch (err) {
      console.warn("[curve-history] Gold DB read failed:", (err as Error).message);
      return json({ source: "ERR", years, snapshots: [], error: (err as Error).message });
    }
  }

  return json({ source: "ERR", years, snapshots: [], error: goldEnabled() ? "No Gold DB curve history rows found." : "MACRO_DB_URL not configured." });
}
