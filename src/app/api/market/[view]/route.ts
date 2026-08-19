import { json } from "@/lib/server/http";
import { goldEnabled, goldStore, goldTable, goldParam } from "@/lib/server/goldStore";
import { buildEdaFromGold } from "@/lib/server/goldEda";
import {
  PRICE_SNAPSHOTS,
  SNAPSHOTS,
  type MarketView,
  type ReturnBasis,
  type SnapshotCard,
  type CrossAsset,
  type BilelloView,
  type IndexReturnsView,
  type IndexReturnMatrix,
} from "@/data/marketPipeline";

/** Market-snapshot view computed from observations: return basis + per-series cards. */
interface MarketSnapshotView {
  return_basis: ReturnBasis;
  cards: SnapshotCard[];
}

type ComputedView = MarketSnapshotView | CrossAsset | BilelloView | IndexReturnsView;

export const runtime = "nodejs"; // needs fs + optional native DB drivers


function returnBasis(req: Request): ReturnBasis {
  return new URL(req.url).searchParams.get("basis") === "price" ? "price" : "total";
}

function asOfDate(req: Request): string | null {
  const raw = new URL(req.url).searchParams.get("asof");
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function snapshotFallbackEnabled(req: Request): boolean {
  const requested = new URL(req.url).searchParams.get("snapshot");
  if (requested === "1" || requested === "true") return true;
  return process.env.MARKET_SNAPSHOT_FALLBACK === "1";
}


function snapshotFor(view: MarketView, basis: ReturnBasis): unknown {
  if (basis === "price" && view in PRICE_SNAPSHOTS) return PRICE_SNAPSHOTS[view as keyof typeof PRICE_SNAPSHOTS];
  return SNAPSHOTS[view];
}


interface MarketObservation {
  series_id: string;
  display_name: string;
  asset_class: string;
  source: string;
  date: string;
  value: number;
  price?: number;
}


function groupObs(rows: MarketObservation[]): Map<string, MarketObservation[]> {
  const grouped = new Map<string, MarketObservation[]>();
  for (const row of rows) {
    const arr = grouped.get(row.series_id) ?? [];
    arr.push(row);
    grouped.set(row.series_id, arr);
  }
  return grouped;
}

// Overloaded so a non-null numeric input keeps a `number` type (only NaN/Infinity
// would yield null, which the callers below don't produce), while a nullable input
// stays `number | null`. This keeps the typed view builders free of spurious nulls.
function round(v: number, dp?: number): number;
function round(v: number | null, dp?: number): number | null;
function round(v: number | null, dp = 4): number | null {
  return v === null || !Number.isFinite(v) ? null : Number(v.toFixed(dp));
}

function ret(values: number[], lookback: number): number | null {
  const idx = values.length - 1 - lookback;
  if (idx < 0 || values[idx] === 0) return null;
  return values[values.length - 1] / values[idx] - 1;
}

function since(dates: string[], values: number[], predicate: (d: string) => boolean): number | null {
  let base: number | null = null;
  for (let i = 0; i < dates.length; i++) {
    if (predicate(dates[i])) base = values[i];
    else break;
  }
  if (base === null || base === 0) return null;
  return values[values.length - 1] / base - 1;
}

function ytd(dates: string[], values: number[]): number | null {
  const year = dates[dates.length - 1]?.slice(0, 4);
  return since(dates, values, (d) => d.slice(0, 4) < year);
}

function mtd(dates: string[], values: number[]): number | null {
  const month = dates[dates.length - 1]?.slice(0, 7);
  return since(dates, values, (d) => d.slice(0, 7) < month);
}

function maxDrawdown(values: number[]): number | null {
  if (!values.length) return null;
  let peak = values[0];
  let worst = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) worst = Math.min(worst, v / peak - 1);
  }
  return worst;
}

function current52wHighDistance(dates: string[], values: number[]): number | null {
  const lastDate = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  const cutoff = new Date(lastDate);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const window = values.filter((_, i) => new Date(`${dates[i]}T00:00:00Z`) >= cutoff);
  if (!window.length) return null;
  const high = Math.max(...window);
  return high > 0 ? Math.min(0, values[values.length - 1] / high - 1) : null;
}

function cagr(dates: string[], values: number[], years: number): number | null {
  const lastDate = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  const target = new Date(lastDate);
  target.setUTCFullYear(target.getUTCFullYear() - years);
  let base: number | null = null;
  for (let i = 0; i < dates.length; i++) {
    if (new Date(`${dates[i]}T00:00:00Z`) <= target) base = values[i];
    else break;
  }
  if (base === null || base <= 0 || values[values.length - 1] <= 0) return null;
  return Math.pow(values[values.length - 1] / base, 1 / years) - 1;
}

function marketSnapshotFromObservations(rows: MarketObservation[], basis: ReturnBasis): MarketSnapshotView {
  const cards: SnapshotCard[] = [...groupObs(rows).entries()].map(([seriesId, obs]) => {
    const ordered = [...obs].sort((a, b) => a.date.localeCompare(b.date));
    const dates = ordered.map((o) => o.date);
    const values = ordered.map((o) => o.value);
    const prices = ordered.map((o) => o.price ?? o.value);
    const last = ordered[ordered.length - 1];
    return {
      series_id: seriesId,
      display_name: last.display_name,
      asset_class: last.asset_class,
      source: last.source,
      price: round(prices[prices.length - 1], 4),
      asof: dates[dates.length - 1],
      ret_1d: round(ret(values, 1)),
      ret_5d: round(ret(values, 5)),
      mtd: round(mtd(dates, values)),
      ytd: round(ytd(dates, values)),
      ret_1y: round(ret(values, 252)),
      cagr_3y: round(cagr(dates, values, 3)),
      cagr_5y: round(cagr(dates, values, 5)),
      max_drawdown: round(maxDrawdown(values)),
      pct_from_52w_high: round(current52wHighDistance(dates, values)),
    };
  });
  cards.sort((a, b) => `${a.asset_class}${a.series_id}`.localeCompare(`${b.asset_class}${b.series_id}`));
  return { return_basis: basis, cards };
}

function crossAssetFromCards(cards: SnapshotCard[], basis: ReturnBasis): CrossAsset & { return_basis: ReturnBasis } {
  const bucketMap: Record<string, string> = {
    EQUITY: "equities",
    BOND: "bonds",
    COMMODITY: "commodities",
    CREDIT: "credit",
    VOLATILITY: "volatility",
    CURRENCY: "currencies",
  };
  const out: any = { return_basis: basis, equities: [], bonds: [], commodities: [], credit: [], volatility: [], currencies: [], asof: cards[0]?.asof ?? null };
  for (const card of cards) {
    const bucket = bucketMap[card.asset_class];
    if (!bucket) continue;
    out[bucket].push({ series_id: card.series_id, display_name: card.display_name, price: card.price, ytd: card.ytd, ret_1y: card.ret_1y, asof: card.asof });
  }
  for (const key of Object.values(bucketMap)) out[key].sort((a: any, b: any) => (b.ytd ?? -999) - (a.ytd ?? -999));
  return out;
}

function yearlyReturns(rows: MarketObservation[]): BilelloView["asset_class_returns_by_year"] {
  const out: BilelloView["asset_class_returns_by_year"] = [];
  for (const [seriesId, obs] of groupObs(rows)) {
    const byYear = new Map<number, number>();
    for (const row of obs) byYear.set(Number(row.date.slice(0, 4)), row.value);
    const years = [...byYear.keys()].sort();
    const last = obs[obs.length - 1];
    for (let i = 1; i < years.length; i++) {
      const prev = byYear.get(years[i - 1]);
      const cur = byYear.get(years[i]);
      if (prev && cur) {
        out.push({
          series_id: seriesId,
          display_name: last.display_name,
          asset_class: last.asset_class,
          year: years[i],
          total_return: round(cur / prev - 1),
        });
      }
    }
  }
  return out.sort((a, b) => a.year - b.year || (a.series_id ?? "").localeCompare(b.series_id ?? ""));
}

function bilelloFromRows(rows: MarketObservation[], basis: ReturnBasis): BilelloView {
  const cards = marketSnapshotFromObservations(rows, basis).cards;
  const asof = cards[0]?.asof ?? null;
  const ytdRows = cards.filter((c) => c.ytd !== null).map((c) => ({ series_id: c.series_id, display_name: c.display_name, ytd: c.ytd as number }));
  ytdRows.sort((a, b) => b.ytd - a.ytd);
  const drawdowns = cards.map((c) => ({ series_id: c.series_id, display_name: c.display_name, drawdown: c.max_drawdown })).sort((a, b) => (a.drawdown ?? 0) - (b.drawdown ?? 0));
  return {
    return_basis: basis,
    asof,
    best_worst_ytd: { best: ytdRows.slice(0, 10), worst: [...ytdRows].reverse().slice(0, 10) },
    asset_class_returns_by_year: yearlyReturns(rows),
    current_drawdowns: drawdowns,
    rate_moves_ranked: [],
    inflation_vs_policy_gap: {},
    unemployment_vs_longrun: {},
  };
}

const INDEX_MAP = [
  ["SPX", "SPY", "S&P 500", 5975, 0.75, 4.2],
  ["NDX", "QQQ", "Nasdaq 100", 21450, 0.95, 6.0],
  ["RUT", "IWM", "Russell 2000", 2380, 0.62, 5.8],
  ["INDU", "DIA", "Dow Jones Industrial Average", 43400, 0.58, 3.8],
  ["EAFE", "EFA", "MSCI EAFE Proxy", 2450, 0.46, 4.6],
  ["EM", "EEM", "MSCI Emerging Markets Proxy", 1080, 0.52, 6.4],
] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function indexReturnsFromRows(rows: MarketObservation[], basis: ReturnBasis): IndexReturnsView {
  const grouped = groupObs(rows);
  const matrices: Record<string, IndexReturnMatrix> = {};
  for (const [symbol, seriesId, name, base, drift, vol] of INDEX_MAP) {
    const obs = grouped.get(seriesId);
    if (!obs?.length) continue;
    const byMonthEnd = new Map<string, number>();
    for (const row of obs) {
      const key = row.date.slice(0, 7);
      byMonthEnd.set(key, row.value);
    }
    const years = [...new Set(obs.map((o) => Number(o.date.slice(0, 4))))].sort((a, b) => a - b);
    const ytdYear = years[years.length - 1];
    const fullYears = years.filter((y) => y < ytdYear).slice(-10);
    const columns = [...fullYears, ytdYear];
    const monthly: Record<number, (number | null)[]> = {};
    for (const year of columns) {
      monthly[year] = MONTHS.map((_, i) => {
        const month = i + 1;
        const cur = byMonthEnd.get(`${year}-${String(month).padStart(2, "0")}`);
        const prevYear = month === 1 ? year - 1 : year;
        const prevMonth = month === 1 ? 12 : month - 1;
        const base = byMonthEnd.get(`${prevYear}-${String(prevMonth).padStart(2, "0")}`);
        return cur !== undefined && base ? round((cur / base - 1) * 100, 2) : null;
      });
    }
    const rowsOut = MONTHS.map((month, i) => {
      const values = Object.fromEntries(columns.map((year) => [String(year), monthly[year][i]]));
      const avgVals = fullYears.map((year) => monthly[year][i]).filter((v): v is number => v !== null);
      return { month, values, monthAverage: avgVals.length ? round(avgVals.reduce((a, v) => a + v, 0) / avgVals.length, 2) : null };
    });
    const compound = (vals: (number | null)[]) => {
      const valid = vals.filter((v): v is number => v !== null);
      return valid.length ? round((valid.reduce((a, v) => a * (1 + v / 100), 1) - 1) * 100, 2) : null;
    };
    const annualReturns = Object.fromEntries(columns.map((year) => [String(year), compound(monthly[year])]));
    const fullAnnuals = fullYears.map((year) => annualReturns[String(year)]).filter((v): v is number => v !== null);
    matrices[symbol] = {
      index: { symbol, proxy: seriesId, name, base, drift, vol },
      years: fullYears,
      ytdYear,
      rows: rowsOut,
      annualReturns,
      averageAnnualReturn: fullAnnuals.length ? round(fullAnnuals.reduce((a, v) => a + v, 0) / fullAnnuals.length, 2) : 0,
      summaries: columns.map((year) => {
        const monthlyVals = monthly[year].filter((v): v is number => v !== null);
        let dd: number | null = null;
        if (monthlyVals.length) {
          let level = 100;
          let peak = 100;
          let worst = 0;
          for (const v of monthlyVals) {
            level *= 1 + v / 100;
            peak = Math.max(peak, level);
            worst = Math.min(worst, level / peak - 1);
          }
          dd = round(worst * 100, 2);
        }
        return { year, annualReturn: annualReturns[String(year)], maxDrawdown: dd, isYtd: year === ytdYear };
      }),
    };
  }
  const latest = rows.reduce<string | null>((acc, row) => (!acc || row.date > acc ? row.date : acc), null);
  return { return_basis: basis, asof: latest, indices: INDEX_MAP.map(([symbol, proxy, name, base, drift, vol]) => ({ symbol, proxy, name, base, drift, vol })), matrices };
}

function computedView(view: MarketView, rows: MarketObservation[], basis: ReturnBasis): ComputedView | null {
  if (!rows.length) return null;
  const market = marketSnapshotFromObservations(rows, basis);
  if (view === "market") return market;
  if (view === "cross-asset") return crossAssetFromCards(market.cards, basis);
  if (view === "bilello") return bilelloFromRows(rows, basis);
  if (view === "index-returns") return indexReturnsFromRows(rows, basis);
  return null;
}

interface GoldEquityRow {
  ticker?: string;
  series_id?: string;
  name?: string;
  display_name?: string;
  asset_class?: string;
  observation_date?: string;
  date?: string;
  close?: number | string | null;
  price?: number | string | null;
  price_return_index?: number | string | null;
  total_return_index?: number | string | null;
}

function finiteNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function goldEquityRowsToObservations(rows: GoldEquityRow[], basis: ReturnBasis, asof: string | null): MarketObservation[] {
  return rows
    .map((r) => {
      const ticker = r.ticker ?? r.series_id;
      const date = String(r.observation_date ?? r.date ?? "");
      const close = finiteNumber(r.close ?? r.price);
      const returnValue = finiteNumber(
        basis === "total"
          ? r.total_return_index ?? r.price_return_index ?? close
          : r.price_return_index ?? close
      );
      if (!ticker || !date || close === null || returnValue === null) return null;
      if (asof && date > asof) return null;
      return {
        series_id: ticker,
        display_name: r.display_name ?? r.name ?? ticker,
        asset_class: (r.asset_class ?? "EQUITY").toUpperCase(),
        source: "DB",
        date,
        value: returnValue,
        price: close,
      } satisfies MarketObservation;
    })
    .filter((row): row is MarketObservation => row !== null)
    .sort((a, b) => a.series_id.localeCompare(b.series_id) || a.date.localeCompare(b.date));
}


function extractEarliestAsOf(data: unknown, view: MarketView): string | null {
  const d = data as any;
  if ((view === "market" || view === "cross-asset") && d?.cards) {
    return (d.cards as any[]).reduce<string | null>((min, c) => {
      if (!c.asof) return min;
      return !min || c.asof < min ? c.asof : min;
    }, null);
  }
  if (view === "bilello" && d?.asset_class_returns_by_year) {
    const years = (d.asset_class_returns_by_year as any[]).map((r: any) => r.year);
    const earliest = years.length ? Math.min(...years) : null;
    return earliest ? `${earliest}-01-01` : null;
  }
  if (view === "index-returns" && d?.matrices) {
    const allYears = Object.values(d.matrices as Record<string, any>).flatMap((m: any) => [...(m.years ?? []), m.ytdYear]);
    const earliest = allYears.length ? Math.min(...allYears) : null;
    return earliest ? `${earliest}-01-01` : null;
  }
  return null;
}

function filterSnapshotByAsOf(data: unknown, view: MarketView, asof: string): unknown {
  if (!asof) return data;
  const d = data as any;
  if (view === "market" && d?.cards) {
    const filtered = d.cards.filter((c: any) => !c.asof || c.asof <= asof);
    if (!filtered.length) return data;
    return { ...d, cards: filtered };
  }
  if (view === "cross-asset" && d) {
    const buckets = ["equities", "bonds", "commodities", "credit", "volatility", "currencies"] as const;
    const out = { ...d };
    for (const b of buckets) {
      if (Array.isArray(out[b])) {
        out[b] = out[b].filter((item: any) => !item.asof || item.asof <= asof);
      }
    }
    out.asof = asof;
    return out;
  }
  if (view === "bilello" && d) {
    const out = { ...d, asof };
    if (d.asset_class_returns_by_year) {
      out.asset_class_returns_by_year = d.asset_class_returns_by_year.filter(
        (r: any) => r.year < Number(asof.slice(0, 4)) || (r.year === Number(asof.slice(0, 4)))
      );
    }
    if (d.best_worst_ytd) {
      out.best_worst_ytd = { ...d.best_worst_ytd };
    }
    if (d.current_drawdowns) {
      out.current_drawdowns = [...d.current_drawdowns];
    }
    return out;
  }
  if (view === "index-returns" && d?.matrices) {
    const cutoffYear = Number(asof.slice(0, 4));
    const cutoffMonth = Number(asof.slice(5, 7));
    const out = { ...d, asof };
    const newMatrices: Record<string, any> = {};
    for (const [sym, matrix] of Object.entries(d.matrices as Record<string, any>)) {
      const m = { ...matrix };
      const allYears = [...(m.years ?? []), m.ytdYear].filter((y: number) => y <= cutoffYear);
      if (!allYears.length) { newMatrices[sym] = m; continue; }
      const newYtdYear = allYears[allYears.length - 1];
      const newFullYears = allYears.filter((y: number) => y < newYtdYear);
      const newRows = (m.rows ?? []).map((row: any) => {
        const monthIdx = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(row.month);
        const newValues = { ...row.values };
        for (const [yearStr, val] of Object.entries(newValues)) {
          const y = Number(yearStr);
          if (y > cutoffYear || (y === cutoffYear && monthIdx + 1 > cutoffMonth)) {
            newValues[yearStr] = null;
          }
        }
        return { ...row, values: newValues };
      });
      const newSummaries = (m.summaries ?? []).filter((s: any) => s.year <= cutoffYear).map((s: any) => ({
        ...s,
        isYtd: s.year === newYtdYear,
      }));
      const newAnnualReturns: Record<string, any> = {};
      for (const [yr, val] of Object.entries(m.annualReturns ?? {})) {
        if (Number(yr) <= cutoffYear) newAnnualReturns[yr] = val;
      }
      newMatrices[sym] = { ...m, years: newFullYears, ytdYear: newYtdYear, rows: newRows, summaries: newSummaries, annualReturns: newAnnualReturns };
    }
    out.matrices = newMatrices;
    return out;
  }
  return data;
}

/**
 * GET /api/market/[view]
 *
 * Reads market views from the Gold DB (MACRO_DB_URL) via goldStore, then falls
 * back to the committed build-time snapshot when explicitly enabled.
 * Always 200 with a `source` field so the UI renders uniformly and never blocks.
 */
export async function GET(req: Request, { params }: { params: { view: string } }) {
  const view = params.view as MarketView;
  if (!(view in SNAPSHOTS)) {
    return json({ error: `unknown view '${view}'` }, { status: 404 });
  }
  const basis = returnBasis(req);
  const asof = asOfDate(req);

  // 0a. Gold DB (MACRO_DB_URL) — EDA analytics tables
  if (goldEnabled() && view === "eda") {
    try {
      const data = await buildEdaFromGold(goldStore());
      if (data) {
        return json({ source: "DB", view, basis, ...(asof ? { asof } : {}), earliestAsOf: null, data });
      }
      console.warn("[market] Gold DB holds no series_lead_lag/correlation/structural_breaks rows for view 'eda'");
    } catch (err) {
      console.warn(`[market] Gold DB read failed for view 'eda': ${(err as Error).message}`);
    }
  }

  // 0b. Gold DB (MACRO_DB_URL) — equity tables (with date bounds to avoid OOM)
  if (goldEnabled() && ["market", "cross-asset", "bilello", "index-returns"].includes(view)) {
    try {
      const store = goldStore();
      // Fetch only recent data to avoid heap exhaustion on large equity tables (~29 GB).
      // Default to the last 10 years when asof is not specified; when asof is provided,
      // the goldEquityRowsToObservations filter will honor it.
      const cutoffDate = asof ? asof : new Date(new Date().setUTCFullYear(new Date().getUTCFullYear() - 10)).toISOString().split("T")[0];
      const dateCol = "observation_date";

      const [priceRows, totalRows] = await Promise.all([
        store.raw<GoldEquityRow>(
          `SELECT * FROM ${goldTable("equity_return_daily")} WHERE ${dateCol} >= ${goldParam(1)} ORDER BY ${dateCol} DESC`,
          [cutoffDate]
        ),
        store.raw<GoldEquityRow>(
          `SELECT * FROM ${goldTable("equity_total_return_index")} WHERE ${dateCol} >= ${goldParam(1)} ORDER BY ${dateCol} DESC`,
          [cutoffDate]
        ),
      ]);
      const rowsForBasis = basis === "total" && totalRows.length ? totalRows : priceRows.length ? priceRows : totalRows;
      if (rowsForBasis.length) {
        // Gold equity rows carry both return-index values and actual closes.
        // Quote-board `price` must be the close, not the return index level.
        const obs = goldEquityRowsToObservations(rowsForBasis as GoldEquityRow[], basis, asof);

        if (obs.length) {
          const data = computedView(view, obs, basis);
          if (data) {
            const earliestAsOf = extractEarliestAsOf(data, view);
            return json({ source: "DB", view, basis, ...(asof ? { asof } : {}), earliestAsOf, data });
          }
        }
      }
    } catch (err) {
      console.warn(`[market] Gold DB read failed for view '${view}': ${(err as Error).message}`);
    }
  }

  // Committed build-time snapshot fallback
  if (!snapshotFallbackEnabled(req)) {
    return json({
      source: "SNAPSHOT_DISABLED",
      view,
      basis,
      ...(asof ? { asof } : {}),
      earliestAsOf: null,
      data: null,
      detail: "Snapshot fallback is off by default. Add snapshot=1 or set MARKET_SNAPSHOT_FALLBACK=1 to enable committed snapshots.",
    });
  }
  const snapData = snapshotFor(view, basis);
  const earliestAsOf = extractEarliestAsOf(snapData, view);
  const filtered = asof ? filterSnapshotByAsOf(snapData, view, asof) : snapData;
  return json({ source: "SNAPSHOT", view, basis, ...(asof ? { asof } : {}), earliestAsOf, data: filtered });
}
