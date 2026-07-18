import { json } from "@/lib/server/http";
import { fredEnabled, fredSeries } from "@/lib/server/fred";
import { FRED_CATALOG, getSeriesHistory, getSeriesHistoryRaw, resolveFred, type FredSeries } from "@/data/econSeries";
import { getSnapshotObservations, getSnapshotRawObservations } from "@/data/econSnapshot";
import { worstSource } from "@/lib/provenance";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

type EconSource = "FRED" | "SNAPSHOT" | "SIM" | "DB";

export interface LiveIndicator {
  id: string;
  value: number;
  prior: number;
  change: number;
  changePct: number | null;
  mom: number | null;
  momDelta: number | null;
  qoq: number | null;
  qoqDelta: number | null;
  yoy: number | null;
  yoyDelta: number | null;
  monthlyPrint: number | null;
  asOf: string;
  history: number[];
  source: EconSource;
  staleness_days?: number | null;
  realtime_start?: string | null;
  zscore?: number | null;
  percentile?: number | null;
  surprise?: number | null;
  direction_is_good?: boolean | null;
}

// Gold layer row shape from gold.macro_indicator_dashboard
interface GoldIndicatorRow {
  series_id: string;
  latest_value: number;
  prior_value: number | null;
  change: number | null;
  yoy_pct: number | null;
  zscore: number | null;
  percentile: number | null;
  surprise: number | null;
  staleness_days: number | null;
  realtime_start: string | null;
  direction_is_good: boolean | null;
  as_of_date: string | null;
}

interface GoldSparklineRow {
  series_id: string;
  date: string;
  value: number;
}

const pct = (now: number | undefined, then: number | undefined, decimals = 1): number | null => {
  if (now == null || then == null || then === 0) return null;
  return Number((((now - then) / Math.abs(then)) * 100).toFixed(decimals));
};

const ppDelta = (now: number | null, then: number | null, decimals = 2): number | null =>
  now != null && then != null ? Number((now - then).toFixed(decimals)) : null;

function buildPoint(
  s: FredSeries,
  hist: { date: string; value: number }[],
  source: EconSource,
  rawHist?: { date: string; value: number }[]
): LiveIndicator {
  const values = hist.map((h) => h.value);
  const rawValues = rawHist?.map((h) => h.value) ?? values;
  const value = values[values.length - 1] ?? s.level;
  const prior = values[values.length - 2] ?? value;
  const rawValue = rawValues[rawValues.length - 1];
  const priorRaw = rawValues[rawValues.length - 2];
  const qoqRaw = s.freq === "M" ? rawValues[rawValues.length - 4] : s.freq === "Q" ? priorRaw : undefined;
  const yoyRaw = s.freq === "M" ? rawValues[rawValues.length - 13] : s.freq === "Q" ? rawValues[rawValues.length - 5] : undefined;
  const priorQoqRaw = s.freq === "M" ? rawValues[rawValues.length - 5] : s.freq === "Q" ? rawValues[rawValues.length - 3] : undefined;
  const priorYoyRaw = s.freq === "M" ? rawValues[rawValues.length - 14] : s.freq === "Q" ? rawValues[rawValues.length - 6] : undefined;
  const canDerivePeriodRates = rawHist != null || (!s.unit.includes("y/y") && !s.unit.includes("m/m"));
  const mom = canDerivePeriodRates && (s.freq === "M" || s.freq === "Q") ? pct(rawValue, priorRaw, 2) : null;
  const priorMom = canDerivePeriodRates && (s.freq === "M" || s.freq === "Q") ? pct(priorRaw, rawValues[rawValues.length - 3], 2) : null;
  const qoq = canDerivePeriodRates ? s.freq === "M" ? pct(rawValue, qoqRaw, 2) : s.freq === "Q" ? pct(rawValue, qoqRaw, 2) : null : null;
  const priorQoq = canDerivePeriodRates ? s.freq === "M" ? pct(priorRaw, priorQoqRaw, 2) : s.freq === "Q" ? pct(priorRaw, priorQoqRaw, 2) : null : null;
  const yoy = s.unit.includes("y/y") && !rawHist
    ? Number(value.toFixed(s.decimals))
    : s.freq === "M" && rawValues.length >= 13
    ? pct(rawValue, rawValues[rawValues.length - 13], 1)
    : s.freq === "Q" && rawValues.length >= 5
    ? pct(rawValue, rawValues[rawValues.length - 5], 1)
    : null;
  const priorYoy = canDerivePeriodRates && s.freq === "M" && rawValues.length >= 14
    ? pct(priorRaw, priorYoyRaw, 1)
    : canDerivePeriodRates && s.freq === "Q" && rawValues.length >= 6
    ? pct(priorRaw, priorYoyRaw, 1)
    : null;
  return {
    id: s.id,
    value: Number(value.toFixed(s.decimals)),
    prior: Number(prior.toFixed(s.decimals)),
    change: Number((value - prior).toFixed(s.decimals)),
    changePct: pct(value, prior, 2),
    mom,
    momDelta: ppDelta(mom, priorMom),
    qoq,
    qoqDelta: ppDelta(qoq, priorQoq),
    yoy,
    yoyDelta: ppDelta(yoy, priorYoy),
    monthlyPrint: s.category === "INFLATION" && (s.freq === "M" || s.freq === "Q") ? mom : null,
    asOf: hist[hist.length - 1]?.date ?? "",
    history: values.map((v) => Number(v.toFixed(s.decimals))),
    source,
  };
}

/**
 * GET /api/econ/indicators
 *
 * Resolution order:
 *   1. Gold DB (MACRO_DB_URL) — gold.macro_indicator_dashboard + macro_indicator_sparkline
 *   2. Live FRED API (FRED_API_KEY)
 *   3. Committed snapshot
 *   4. Deterministic SIM
 */
export async function GET() {
  // 1. Gold DB
  if (goldEnabled()) {
    try {
      const store = goldStore();
      const [dashRows, sparkRows] = await Promise.all([
        store.latest<GoldIndicatorRow>("macro_indicator_dashboard"),
        store.latest<GoldSparklineRow>("macro_indicator_sparkline"),
      ]);

      if (dashRows.length) {
        const byId = new Map(dashRows.map((r) => [r.series_id, r]));
        const sparkById = new Map<string, number[]>();
        for (const row of sparkRows) {
          const arr = sparkById.get(row.series_id) ?? [];
          arr.push(row.value);
          sparkById.set(row.series_id, arr);
        }

        const indicators: LiveIndicator[] = FRED_CATALOG.map((s) => {
          const r = byId.get(s.id);
          if (!r) {
            // series not yet in Gold — fall through to SIM for this one
            const simHist = getSeriesHistory(s.id, 24);
            return buildPoint(s, simHist, "SIM");
          }
          const latest = r.latest_value ?? s.level;
          const prior = r.prior_value ?? latest;
          const history = sparkById.get(s.id) ?? [prior, latest];
          return {
            id: s.id,
            value: Number(latest.toFixed(s.decimals)),
            prior: Number(prior.toFixed(s.decimals)),
            change: Number((r.change ?? latest - prior).toFixed(s.decimals)),
            changePct: pct(latest, prior, 2),
            mom: null,
            momDelta: null,
            qoq: null,
            qoqDelta: null,
            yoy: r.yoy_pct != null ? Number(r.yoy_pct.toFixed(1)) : null,
            yoyDelta: null,
            monthlyPrint: null,
            asOf: r.as_of_date ?? "",
            history: history.map((v) => Number(v.toFixed(s.decimals))),
            source: "DB",
            staleness_days: r.staleness_days,
            realtime_start: r.realtime_start,
            zscore: r.zscore,
            percentile: r.percentile,
            surprise: r.surprise,
            direction_is_good: r.direction_is_good,
          };
        });

        return json({ source: "DB", indicators });
      }
    } catch (err) {
      console.warn("[indicators] Gold DB read failed:", (err as Error).message);
    }
  }

  // 2. FRED → 3. SNAPSHOT → 4. SIM
  const live = fredEnabled();
  const out = await Promise.all(
    FRED_CATALOG.map(async (s) => {
      const r = resolveFred(s.id);
      if (live && !r.simOnly) {
        try {
          const hist = await fredSeries(s.id, { limit: 24, units: r.units, scale: r.scale });
          if (hist.length) {
            const needsRaw = s.freq === "M" || s.freq === "Q";
            const rawHist = needsRaw && r.units !== "lin"
              ? await fredSeries(s.id, { limit: 24, units: "lin", scale: r.scale })
              : hist;
            return buildPoint(s, hist as { date: string; value: number }[], "FRED", rawHist as { date: string; value: number }[]);
          }
        } catch {
          /* fall back */
        }
      }
      const snap = getSnapshotObservations(s.id, 24);
      if (snap) {
        const rawSnap = getSnapshotRawObservations(s.id, 24);
        return buildPoint(
          s,
          snap as { date: string; value: number }[],
          "SNAPSHOT",
          rawSnap ? rawSnap as { date: string; value: number }[] : undefined
        );
      }
      const simHist = getSeriesHistory(s.id, 24);
      const resolved = resolveFred(s.id);
      const simRaw = resolved.units !== "lin" ? getSeriesHistoryRaw(s.id, 24) ?? undefined : undefined;
      return buildPoint(s, simHist, "SIM", simRaw);
    })
  );
  const source: EconSource = worstSource(out.map((o) => o.source));
  return json({ source, indicators: out });
}
