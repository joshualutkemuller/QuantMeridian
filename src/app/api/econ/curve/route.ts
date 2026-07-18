import { json } from "@/lib/server/http";
import { fredEnabled, fredLatest } from "@/lib/server/fred";
import { getCurrentCurve } from "@/data/econCurve";
import { getSnapshotObservations, getSnapshotRawObservations } from "@/data/econSnapshot";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

interface GoldCurveRow {
  as_of_date: string;
  tenor: string;
  tenor_months: number;
  yield_pct: number;
  slope: number | null;
  curvature: number | null;
  butterfly: number | null;
  move_class: string | null;
}

function snapshotCurve() {
  const sim = getCurrentCurve();
  let matched = false;
  let asOf = sim.date;
  const points = sim.points.map((p) => {
    const obs = getSnapshotRawObservations(p.fredId, 1) ?? getSnapshotObservations(p.fredId, 1);
    const latest = obs?.[obs.length - 1];
    if (!latest) return p;
    matched = true;
    if (latest.date > asOf) asOf = latest.date;
    return { ...p, yield: Number(latest.value.toFixed(2)) };
  });
  return matched ? { ...sim, label: `Snapshot · ${asOf}`, date: asOf, points } : null;
}

/**
 * GET /api/econ/curve
 *
 * Resolution order:
 *   1. Gold DB — gold.treasury_curve (latest as-of)
 *   2. Live FRED API
 *   3. Committed snapshot
 *   4. Deterministic SIM
 */
export async function GET() {
  const sim = getCurrentCurve();

  // 1. Gold DB
  if (goldEnabled()) {
    try {
      const store = goldStore();
      const rows = await store.latest<GoldCurveRow>("treasury_curve");
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
          const base = sim.points.find((p) => p.fredId === tenorToFredId[r.tenor]) ?? sim.points[0];
          return { ...base, yield: Number(r.yield_pct.toFixed(2)) };
        }).filter(Boolean);

        const metrics = latest[0] ? {
          slope: latest[0].slope,
          curvature: latest[0].curvature,
          butterfly: latest[0].butterfly,
          move_class: latest[0].move_class,
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
    }
  }

  // 2. FRED
  const snap = snapshotCurve();
  if (!fredEnabled()) {
    return snap ? json({ source: "SNAPSHOT", asOf: snap.date, curve: snap }) : json({ source: "SIM", curve: sim });
  }
  try {
    const resolved = await Promise.all(
      sim.points.map(async (p) => {
        const latest = await fredLatest(p.fredId);
        return { point: { ...p, yield: latest?.value ?? p.yield }, date: latest?.date ?? null };
      })
    );
    const points = resolved.map((r) => r.point);
    const dates = resolved.map((r) => r.date).filter((d): d is string => !!d).sort();
    const asOf = dates.length ? dates[dates.length - 1] : sim.date;
    return json({
      source: "FRED",
      asOf,
      curve: { ...sim, label: `Live · ${asOf}`, date: asOf, points },
    });
  } catch (err) {
    return snap
      ? json({ source: "SNAPSHOT", note: err instanceof Error ? err.message : "FRED error", asOf: snap.date, curve: snap })
      : json({ source: "SIM", note: err instanceof Error ? err.message : "FRED error", curve: sim });
  }
}
