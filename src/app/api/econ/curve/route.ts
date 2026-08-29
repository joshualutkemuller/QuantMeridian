import { json } from "@/lib/server/http";
import { getCurrentCurve } from "@/data/econCurve";
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
  curvature_2_5_10: number | null;
  butterfly_2_10_30: number | null;
  curve_move: string | null;
}

/**
 * GET /api/econ/curve
 *
 * Resolution order:
 *   1. Gold DB — gold.treasury_curve (latest as-of)
 *   2. Explicit empty/error state
 */
export async function GET() {
  const sim = getCurrentCurve();

  if (goldEnabled()) {
    try {
      const store = goldStore();
      const [rows, metricsRows] = await Promise.all([
        store.latest<GoldCurveRow>("treasury_curve"),
        store.latest<GoldCurveMetricsRow>("treasury_curve_metrics"),
      ]);
      if (rows.length) {
        // Take the most recent as_of_date
        const maxDate = rows.reduce((m, r) => r.as_of_date > m ? r.as_of_date : m, "");
        const latest = rows.filter((r) => r.as_of_date === maxDate).sort((a, b) => a.tenor_months - b.tenor_months);

        const tenorToFredId: Record<string, string> = {
          "1M": "DGS1MO", "3M": "DGS3MO", "6M": "DGS6MO",
          "1Y": "DGS1", "2Y": "DGS2", "3Y": "DGS3", "5Y": "DGS5",
          "7Y": "DGS7", "10Y": "DGS10", "20Y": "DGS20", "30Y": "DGS30",
        };

        const points = latest.map((r) => {
          const tenor = r.tenor ?? r.tenor_label ?? "";
          const base = sim.points.find((p) => p.fredId === tenorToFredId[tenor]) ?? sim.points[0];
          return { ...base, yield: Number(r.yield_pct.toFixed(2)) };
        }).filter(Boolean);

        const metricRow = metricsRows.find((r) => r.as_of_date === maxDate);
        const metrics = metricRow ? {
          level: metricRow.level,
          slope: metricRow.slope_10y2y,
          curvature: metricRow.curvature_2_5_10,
          butterfly: metricRow.butterfly_2_10_30,
          move_class: metricRow.curve_move,
        } : {};

        return json({
          source: "DB",
          asOf: maxDate,
          curve: { ...sim, label: `DB · ${maxDate}`, date: maxDate, points },
          metrics,
        });
      }
    } catch (err) {
      console.warn("[curve] Gold DB read failed:", (err as Error).message);
      return json({ source: "ERR", curve: null, error: (err as Error).message });
    }
  }

  return json({ source: "ERR", curve: null, error: goldEnabled() ? "No Gold DB curve rows found." : "MACRO_DB_URL not configured." });
}
