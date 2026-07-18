import { json } from "@/lib/server/http";
import { fredEnabled, fredSeries } from "@/lib/server/fred"; // MIGRATION FALLBACK — remove in Phase 6
import { CURVE_TENORS, buildLiveSnapshots, getCurveSnapshots, type CurveHistory } from "@/data/econCurve";
import { getSnapshotObservations, getSnapshotRawObservations } from "@/data/econSnapshot"; // MIGRATION FALLBACK — remove in Phase 6
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

interface GoldCurveRow {
  as_of_date: string;
  tenor: string;
  tenor_months: number;
  yield_pct: number;
}

interface GoldCurveMetricsRow {
  as_of_date: string;
  slope: number | null;
  curvature: number | null;
  butterfly: number | null;
  move_class: string | null;
  recession_overlay: boolean | null;
}

const TENOR_TO_FRED: Record<string, string> = {
  "1M": "DGS1MO", "3M": "DGS3MO", "6M": "DGS6MO",
  "1Y": "DGS1", "2Y": "DGS2", "3Y": "DGS3", "5Y": "DGS5",
  "7Y": "DGS7", "10Y": "DGS10", "20Y": "DGS20", "30Y": "DGS30",
};

function snapshotHistory(): CurveHistory | null {
  const history: CurveHistory = {};
  for (const [, , fredId] of CURVE_TENORS) {
    const obs = getSnapshotRawObservations(fredId) ?? getSnapshotObservations(fredId); // MIGRATION FALLBACK — remove in Phase 6
    if (obs?.length) history[fredId] = obs.map((o) => ({ date: o.date, value: o.value }));
  }
  return Object.keys(history).length ? history : null;
}

/**
 * GET /api/econ/curve-history?years=7
 *
 * Resolution order:
 *   1. Gold DB — gold.treasury_curve (all as-of dates) + treasury_curve_metrics
 *   2. Live FRED API
 *   3. Committed snapshot
 *   4. Deterministic SIM
 */
export async function GET(req: Request) {
  const reqYears = Number(new URL(req.url).searchParams.get("years") ?? 7);
  const years = Math.max(2, Math.min(25, Number.isFinite(reqYears) ? reqYears : 7));
  const start = `${new Date().getUTCFullYear() - years}-01-01`;

  // 1. Gold DB
  if (goldEnabled()) {
    try {
      const store = goldStore();
      const [curveRows, metricsRows] = await Promise.all([
        store.raw<GoldCurveRow>(
          `SELECT as_of_date, tenor, tenor_months, yield_pct FROM ${process.env.MACRO_DB_URL?.startsWith("sqlite") ? "gold_treasury_curve" : "gold.treasury_curve"} WHERE as_of_date >= ? ORDER BY as_of_date, tenor_months`,
          [start]
        ),
        store.raw<GoldCurveMetricsRow>(
          `SELECT as_of_date, slope, curvature, butterfly, move_class, recession_overlay FROM ${process.env.MACRO_DB_URL?.startsWith("sqlite") ? "gold_treasury_curve_metrics" : "gold.treasury_curve_metrics"} WHERE as_of_date >= ? ORDER BY as_of_date`,
          [start]
        ),
      ]);

      if (curveRows.length) {
        // Build CurveHistory (fredId → [{date, value}]) from Gold rows
        const history: CurveHistory = {};
        for (const row of curveRows) {
          const fredId = TENOR_TO_FRED[row.tenor];
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
    }
  }

  const sim = getCurveSnapshots();
  const snapHistory = snapshotHistory();
  const snap = snapHistory ? buildLiveSnapshots(snapHistory) : null;

  // 2. FRED
  if (!fredEnabled()) {
    return snap ? json({ source: "SNAPSHOT", snapshots: snap }) : json({ source: "SIM", snapshots: sim });
  }

  try {
    const history: CurveHistory = {};
    await Promise.all(
      CURVE_TENORS.map(async ([, , fredId]) => {
        const obs = await fredSeries(fredId, { start, revalidateSec: 6 * 60 * 60 }); // MIGRATION FALLBACK — remove in Phase 6
        history[fredId] = obs
          .filter((o) => o.value !== null)
          .map((o) => ({ date: o.date, value: o.value as number }));
      })
    );
    const snapshots = buildLiveSnapshots(history);
    const asOf = snapshots.find((s) => s.id === "now")?.date ?? null;
    return json({ source: "FRED", asOf, years, snapshots });
  } catch (err) {
    return snap
      ? json({ source: "SNAPSHOT", note: err instanceof Error ? err.message : "FRED error", snapshots: snap })
      : json({ source: "SIM", note: err instanceof Error ? err.message : "FRED error", snapshots: sim });
  }
}
