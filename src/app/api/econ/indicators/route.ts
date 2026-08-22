import { json } from "@/lib/server/http";
import { fredEnabled, fredSeries } from "@/lib/server/fred"; // MIGRATION FALLBACK — remove in Phase 6
import { FRED_CATALOG, getSeriesHistory, getSeriesHistoryRaw, resolveFred, type FredSeries } from "@/data/econSeries"; // MIGRATION FALLBACK — remove in Phase 6
import { getSnapshotObservations, getSnapshotRawObservations } from "@/data/econSnapshot"; // MIGRATION FALLBACK — remove in Phase 6
import { worstSource } from "@/lib/provenance";
import { goldEnabled, goldParam, goldStore, goldTable } from "@/lib/server/goldStore";
import { simFallbackEnabled, snapshotFallbackEnabled } from "@/lib/server/fallbacks";

type EconSource = "FRED" | "SNAPSHOT" | "SIM" | "DB" | "ERR";

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
  indexValue?: number | null;
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
  change_abs: number | null;
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

interface GoldObservationRow {
  series_id: string;
  observation_date: string;
  value: number;
}

const pct = (now: number | undefined, then: number | undefined, decimals = 1): number | null => {
  if (now == null || then == null || then === 0) return null;
  return Number((((now - then) / Math.abs(then)) * 100).toFixed(decimals));
};

const ppDelta = (now: number | null, then: number | null, decimals = 2): number | null =>
  now != null && then != null ? Number((now - then).toFixed(decimals)) : null;

const yearLag = (freq: FredSeries["freq"]): number | null =>
  freq === "M" ? 12 : freq === "Q" ? 4 : freq === "W" ? 52 : freq === "D" ? 252 : null;

const annualPeriods = (freq: FredSeries["freq"]): number =>
  freq === "M" ? 12 : freq === "Q" ? 4 : freq === "W" ? 52 : freq === "D" ? 252 : 1;

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
    indexValue: s.category === "INFLATION" && rawValue != null ? Number(rawValue.toFixed(s.decimals)) : null,
    asOf: hist[hist.length - 1]?.date ?? "",
    history: values.map((v) => Number(v.toFixed(s.decimals))),
    source,
  };
}

function buildInflationMetrics(
  s: FredSeries,
  rows: { date: string; value: number }[]
): Pick<LiveIndicator, "indexValue" | "mom" | "momDelta" | "yoy" | "yoyDelta" | "monthlyPrint"> | null {
  if (s.category !== "INFLATION" || rows.length < 2) return null;
  const values = rows.map((r) => r.value);
  const indexValue = values[values.length - 1];
  const prior = values[values.length - 2];
  const mom = s.freq === "M" ? pct(indexValue, prior, 2) : null;
  const priorMom = s.freq === "M" && values.length >= 3 ? pct(prior, values[values.length - 3], 2) : null;
  const yoyLag = s.freq === "M" ? 13 : s.freq === "Q" ? 5 : null;
  const priorYoyLag = s.freq === "M" ? 14 : s.freq === "Q" ? 6 : null;
  const yoy = yoyLag && values.length >= yoyLag ? pct(indexValue, values[values.length - yoyLag], 1) : null;
  const priorYoy = priorYoyLag && values.length >= priorYoyLag ? pct(prior, values[values.length - priorYoyLag], 1) : null;
  return {
    indexValue: Number(indexValue.toFixed(s.decimals)),
    mom,
    momDelta: ppDelta(mom, priorMom),
    yoy,
    yoyDelta: ppDelta(yoy, priorYoy),
    monthlyPrint: mom,
  };
}

function buildRawGoldPoint(
  s: FredSeries,
  rows: { date: string; value: number }[],
  scale: number
): LiveIndicator | null {
  if (!rows.length) return null;
  const scaledRows = rows.map((row) => ({ date: row.date, value: row.value * scale }));
  const latest = scaledRows[scaledRows.length - 1];
  const prior = scaledRows[scaledRows.length - 2] ?? latest;
  return {
    id: s.id,
    value: Number(latest.value.toFixed(s.decimals)),
    prior: Number(prior.value.toFixed(s.decimals)),
    change: Number((latest.value - prior.value).toFixed(s.decimals)),
    changePct: pct(latest.value, prior.value, 2),
    mom: null,
    momDelta: null,
    qoq: null,
    qoqDelta: null,
    yoy: null,
    yoyDelta: null,
    monthlyPrint: null,
    indexValue: null,
    asOf: latest.date,
    history: scaledRows.map((row) => Number(row.value.toFixed(s.decimals))),
    source: "DB",
  };
}

function transformGoldValue(
  rows: { date: string; value: number }[],
  index: number,
  units: string,
  scale: number,
  freq: FredSeries["freq"]
): number | null {
  const current = rows[index]?.value;
  if (current == null) return null;
  if (units === "lin") return current * scale;
  if (units === "chg") {
    const prior = rows[index - 1]?.value;
    return prior == null ? null : (current - prior) * scale;
  }
  if (units === "pch") return pct(current, rows[index - 1]?.value, 6);
  if (units === "pc1") {
    const lag = yearLag(freq);
    return lag == null ? null : pct(current, rows[index - lag]?.value, 6);
  }
  if (units === "pca") {
    const prior = rows[index - 1]?.value;
    if (prior == null || prior === 0) return null;
    const ratio = current / prior;
    return ratio > 0 ? Number(((Math.pow(ratio, annualPeriods(freq)) - 1) * 100).toFixed(6)) : null;
  }
  return current * scale;
}

function buildTransformedGoldPoint(
  s: FredSeries,
  rows: { date: string; value: number }[],
  units: string,
  scale: number
): LiveIndicator | null {
  const transformed = rows
    .map((row, index) => ({ date: row.date, value: transformGoldValue(rows, index, units, scale, s.freq) }))
    .filter((row): row is { date: string; value: number } => row.value != null && Number.isFinite(row.value));
  if (!transformed.length) return null;

  const latest = transformed[transformed.length - 1];
  const prior = transformed[transformed.length - 2] ?? latest;
  const rawValues = rows.map((row) => row.value);
  const rawLatest = rawValues[rawValues.length - 1];
  const rawPrior = rawValues[rawValues.length - 2];
  const rawQoqBase = s.freq === "M" ? rawValues[rawValues.length - 4] : s.freq === "Q" ? rawPrior : undefined;
  const rawPriorQoqBase = s.freq === "M" ? rawValues[rawValues.length - 5] : s.freq === "Q" ? rawValues[rawValues.length - 3] : undefined;
  const lag = yearLag(s.freq);
  const rawYoyBase = lag == null ? undefined : rawValues[rawValues.length - 1 - lag];
  const rawPriorYoyBase = lag == null ? undefined : rawValues[rawValues.length - 2 - lag];
  const mom = (s.freq === "M" || s.freq === "Q") ? pct(rawLatest, rawPrior, 2) : null;
  const priorMom = (s.freq === "M" || s.freq === "Q") ? pct(rawPrior, rawValues[rawValues.length - 3], 2) : null;
  const qoq = pct(rawLatest, rawQoqBase, 2);
  const priorQoq = pct(rawPrior, rawPriorQoqBase, 2);
  const yoy = lag == null ? null : pct(rawLatest, rawYoyBase, 1);
  const priorYoy = lag == null ? null : pct(rawPrior, rawPriorYoyBase, 1);

  return {
    id: s.id,
    value: Number(latest.value.toFixed(s.decimals)),
    prior: Number(prior.value.toFixed(s.decimals)),
    change: Number((latest.value - prior.value).toFixed(s.decimals)),
    changePct: pct(latest.value, prior.value, 2),
    mom,
    momDelta: ppDelta(mom, priorMom),
    qoq,
    qoqDelta: ppDelta(qoq, priorQoq),
    yoy: units === "pc1" ? Number(latest.value.toFixed(1)) : yoy,
    yoyDelta: units === "pc1" ? ppDelta(latest.value, prior.value) : ppDelta(yoy, priorYoy),
    monthlyPrint: null,
    indexValue: null,
    asOf: latest.date,
    history: transformed.map((row) => Number(row.value.toFixed(s.decimals))),
    source: "DB",
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
export async function GET(req: Request) {
  const allowSim = simFallbackEnabled(req);
  const allowSnapshot = snapshotFallbackEnabled(req);

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
        const rawFallbackIds = FRED_CATALOG.filter((s) => !resolveFred(s.id).simOnly).map((s) => s.id);
        const rawById = new Map<string, { date: string; value: number }[]>();
        if (rawFallbackIds.length) {
          const placeholders = rawFallbackIds.map((_id, i) => goldParam(i + 1)).join(", ");
          const obsTable = goldTable("fred_latest_observation");
          const rawRows = await store.raw<GoldObservationRow>(
            `SELECT series_id, observation_date, value
             FROM (
               SELECT series_id, observation_date, value,
                 ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY observation_date DESC) AS rn
               FROM ${obsTable}
               WHERE series_id IN (${placeholders}) AND NOT is_missing
             ) ranked
             WHERE rn <= 40
             ORDER BY series_id, observation_date ASC`,
            rawFallbackIds
          );
          for (const row of rawRows) {
            const arr = rawById.get(row.series_id) ?? [];
            arr.push({ date: row.observation_date, value: Number(row.value) });
            rawById.set(row.series_id, arr);
          }
        }
        const sparkById = new Map<string, number[]>();
        for (const row of sparkRows) {
          const arr = sparkById.get(row.series_id) ?? [];
          arr.push(row.value);
          sparkById.set(row.series_id, arr);
        }

        const indicators: LiveIndicator[] = FRED_CATALOG.flatMap((s) => {
          const r = byId.get(s.id);
          const rawRows = rawById.get(s.id) ?? [];
          const inflationMetrics = buildInflationMetrics(s, rawRows);
          if (!r) {
            if (inflationMetrics) {
              const latest = inflationMetrics.yoy ?? inflationMetrics.mom ?? inflationMetrics.indexValue ?? s.level;
              const prior = latest - (inflationMetrics.yoyDelta ?? inflationMetrics.momDelta ?? 0);
              return [{
                id: s.id,
                value: Number(latest.toFixed(s.decimals)),
                prior: Number(prior.toFixed(s.decimals)),
                change: Number((latest - prior).toFixed(s.decimals)),
                changePct: pct(latest, prior, 2),
                mom: inflationMetrics.mom,
                momDelta: inflationMetrics.momDelta,
                qoq: null,
                qoqDelta: null,
                yoy: inflationMetrics.yoy,
                yoyDelta: inflationMetrics.yoyDelta,
                monthlyPrint: inflationMetrics.monthlyPrint,
                indexValue: inflationMetrics.indexValue,
                asOf: rawRows[rawRows.length - 1]?.date ?? "",
                history: rawRows.map((row) => Number(row.value.toFixed(s.decimals))),
                source: "DB",
              }];
            }
            const resolved = resolveFred(s.id);
            if (resolved.units === "lin" && !resolved.simOnly) {
              const rawPoint = buildRawGoldPoint(s, rawRows, resolved.scale);
              if (rawPoint) return [rawPoint];
            }
            if (!allowSim) return [];
            const simHist = getSeriesHistory(s.id, 24); // MIGRATION FALLBACK — remove in Phase 6
            return [buildPoint(s, simHist, "SIM")];
          }
          const latest = r.latest_value ?? s.level;
          const prior = r.prior_value ?? latest;
          const history = sparkById.get(s.id) ?? [prior, latest];
          const resolved = resolveFred(s.id);
          if (s.category !== "INFLATION" && resolved.units !== "lin") {
            const transformed = buildTransformedGoldPoint(s, rawRows, resolved.units, resolved.scale);
            if (transformed) {
              return [{
                ...transformed,
                staleness_days: r.staleness_days,
                realtime_start: r.realtime_start,
                direction_is_good: r.direction_is_good,
              }];
            }
          }
          return [{
            id: s.id,
            value: Number(latest.toFixed(s.decimals)),
            prior: Number(prior.toFixed(s.decimals)),
            change: Number((r.change_abs ?? latest - prior).toFixed(s.decimals)),
            changePct: pct(latest, prior, 2),
            mom: inflationMetrics?.mom ?? null,
            momDelta: inflationMetrics?.momDelta ?? null,
            qoq: null,
            qoqDelta: null,
            yoy: inflationMetrics?.yoy ?? (r.yoy_pct != null ? Number(r.yoy_pct.toFixed(1)) : null),
            yoyDelta: inflationMetrics?.yoyDelta ?? null,
            monthlyPrint: inflationMetrics?.monthlyPrint ?? null,
            indexValue: inflationMetrics?.indexValue ?? null,
            asOf: r.as_of_date ?? "",
            history: history.map((v) => Number(v.toFixed(s.decimals))),
            source: "DB",
            staleness_days: r.staleness_days,
            realtime_start: r.realtime_start,
            zscore: r.zscore,
            percentile: r.percentile,
            surprise: r.surprise,
            direction_is_good: r.direction_is_good,
          }];
        });

        return json({ source: indicators.length ? "DB" : "ERR", indicators });
      }
    } catch (err) {
      console.warn("[indicators] Gold DB read failed:", (err as Error).message);
    }
  }

  // 2. FRED → 3. SNAPSHOT → 4. SIM
  const live = fredEnabled();
  const resolved = await Promise.all(
    FRED_CATALOG.map(async (s) => {
      const r = resolveFred(s.id);
      if (live && !r.simOnly) {
        try {
          const hist = await fredSeries(s.id, { limit: 24, units: r.units, scale: r.scale }); // MIGRATION FALLBACK — remove in Phase 6
          if (hist.length) {
            const needsRaw = s.freq === "M" || s.freq === "Q";
            const rawHist = needsRaw && r.units !== "lin"
              ? await fredSeries(s.id, { limit: 24, units: "lin", scale: r.scale }) // MIGRATION FALLBACK — remove in Phase 6
              : hist;
            return buildPoint(s, hist as { date: string; value: number }[], "FRED", rawHist as { date: string; value: number }[]);
          }
        } catch {
          /* fall back */
        }
      }
      if (allowSnapshot) {
        const snap = getSnapshotObservations(s.id, 24); // MIGRATION FALLBACK — remove in Phase 6
        if (snap) {
          const rawSnap = getSnapshotRawObservations(s.id, 24);
          return buildPoint(
            s,
            snap as { date: string; value: number }[],
            "SNAPSHOT",
            rawSnap ? rawSnap as { date: string; value: number }[] : undefined
          );
        }
      }
      if (!allowSim) return null;
      const simHist = getSeriesHistory(s.id, 24); // MIGRATION FALLBACK — remove in Phase 6
      const resolved = resolveFred(s.id);
      const simRaw = resolved.units !== "lin" ? getSeriesHistoryRaw(s.id, 24) ?? undefined : undefined; // MIGRATION FALLBACK — remove in Phase 6
      return buildPoint(s, simHist, "SIM", simRaw);
    })
  );
  const out = resolved.filter((i): i is LiveIndicator => i !== null);
  const source: EconSource = out.length ? worstSource(out.map((o) => o.source)) : "ERR";
  return json({ source, indicators: out });
}
