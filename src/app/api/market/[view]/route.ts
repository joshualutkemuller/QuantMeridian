import { json } from "@/lib/server/http";
import { readFile } from "fs/promises";
import path from "path";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";
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

/** FastAPI path for each terminal view (market_data_pipeline endpoints). */
const ENDPOINT: Record<MarketView, string> = {
  market: "/snapshot/market",
  "cross-asset": "/snapshot/cross-asset",
  rates: "/snapshot/rates",
  inflation: "/snapshot/inflation",
  regime: "/dashboard/regime",
  bilello: "/dashboard/bilello",
  "index-returns": "",
  eda: "/dashboard/eda",
};

/** Exported-JSON filename for each view (matches `mdp export-views`). */
const FILE_NAME: Record<MarketView, string> = {
  market: "market_snapshot.json",
  "cross-asset": "cross_asset.json",
  rates: "rates.json",
  inflation: "inflation.json",
  regime: "regime.json",
  bilello: "bilello.json",
  "index-returns": "index_returns.json",
  eda: "eda.json",
};

const PRICE_FILE_NAME: Partial<Record<MarketView, string>> = {
  market: "market_snapshot_price.json",
  "cross-asset": "cross_asset_price.json",
  regime: "regime_price.json",
  bilello: "bilello_price.json",
  "index-returns": "index_returns_price.json",
};

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

function dbView(view: MarketView, basis: ReturnBasis): string {
  return basis === "price" && view in PRICE_SNAPSHOTS ? `${view}:price` : view;
}

function snapshotFor(view: MarketView, basis: ReturnBasis): unknown {
  if (basis === "price" && view in PRICE_SNAPSHOTS) return PRICE_SNAPSHOTS[view as keyof typeof PRICE_SNAPSHOTS];
  return SNAPSHOTS[view];
}

/** Require an optional module at runtime without the bundler resolving it. */
function optionalRequire(name: string): any {
  try {
    // eslint-disable-next-line no-eval
    return (eval("require") as NodeRequire)(name);
  } catch {
    return null;
  }
}

/**
 * Read one view's JSON payload from the pipeline's `analytics_api_views` table.
 * Supports a local DuckDB file (`*.duckdb` / `duckdb:<path>`) or Postgres
 * (`postgres://…`). Drivers are optional — install `duckdb` or `pg` to use them.
 */
async function readFromDb(dbUrl: string, view: string): Promise<unknown | null> {
  const isPg = /^postgres(ql)?:\/\//.test(dbUrl);
  if (isPg) {
    const pg = optionalRequire("pg");
    if (!pg) {
      console.warn("[market] MARKET_DB_URL is Postgres but the 'pg' driver isn't available in this runtime");
      return null;
    }
    const client = new pg.Client({ connectionString: dbUrl });
    try {
      await client.connect();
      const r = await client.query(
        "SELECT payload_json FROM analytics_api_views WHERE view = $1",
        [view]
      );
      if (!r.rows[0]?.payload_json) {
        console.warn(`[market] connected to Postgres, but analytics_api_views has no row for view '${view}' — run 'publish-views' to populate it`);
        return null;
      }
      return JSON.parse(r.rows[0].payload_json);
    } finally {
      await client.end().catch(() => {});
    }
  }

  // DuckDB file
  const duckdb = optionalRequire("duckdb");
  if (!duckdb) {
    console.warn("[market] MARKET_DB_URL is a DuckDB file but the 'duckdb' driver isn't installed (run `npm i duckdb`)");
    return null;
  }
  const file = dbUrl.replace(/^duckdb:/, "");
  const db = new duckdb.Database(file, duckdb.OPEN_READONLY ?? 1);
  const con = db.connect();
  try {
    const rows: any[] = await new Promise((resolve, reject) =>
      con.all(
        "SELECT payload_json FROM analytics_api_views WHERE view = ?",
        view,
        (err: Error | null, res: any[]) => (err ? reject(err) : resolve(res))
      )
    );
    if (!rows[0]?.payload_json) {
      console.warn(`[market] DuckDB opened, but analytics_api_views has no row for view '${view}' — run 'publish-views'/'export-views'`);
      return null;
    }
    return JSON.parse(rows[0].payload_json);
  } finally {
    db.close();
  }
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

async function readMarketObservations(dbUrl: string, basis: ReturnBasis, asof: string): Promise<MarketObservation[]> {
  if (!/^postgres(ql)?:\/\//.test(dbUrl)) return [];
  const pg = optionalRequire("pg");
  if (!pg) return [];
  const client = new pg.Client({ connectionString: dbUrl });
  try {
    await client.connect();
    const r = await client.query(
      `SELECT series_id, display_name, asset_class, source, date::text AS date, value
       FROM market_series_observations
       WHERE basis = $1 AND date <= $2
       ORDER BY series_id, date`,
      [basis, asof]
    );
    return r.rows.map((row: any) => ({ ...row, value: Number(row.value) })).filter((row: MarketObservation) => Number.isFinite(row.value));
  } finally {
    await client.end().catch(() => {});
  }
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

/** Read one view's JSON payload from a local directory of exported files. */
async function readFromDir(dir: string, view: MarketView, basis: ReturnBasis): Promise<unknown | null> {
  const filename = basis === "price" ? PRICE_FILE_NAME[view] ?? FILE_NAME[view] : FILE_NAME[view];
  try {
    const raw = await readFile(path.join(dir, filename), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
 * Resolves a market_data_pipeline view from the first configured source:
 *   1. MARKET_DB_URL    — local DuckDB file or Postgres `analytics_api_views`  → source "DB"
 *   2. MARKET_DATA_DIR  — directory of exported view JSON (`mdp export-views`) → source "FILE"
 *   3. MARKET_PIPELINE_URL — the running FastAPI service                       → source "LIVE"
 *   4. committed build-time snapshot, only when explicitly enabled             → source "SNAPSHOT"
 *
 * Always 200 with a `source` field so the UI renders uniformly and never blocks.
 */
export async function GET(req: Request, { params }: { params: { view: string } }) {
  const view = params.view as MarketView;
  if (!(view in SNAPSHOTS)) {
    return json({ error: `unknown view '${view}'` }, { status: 404 });
  }
  const basis = returnBasis(req);
  const asof = asOfDate(req);
  const viewKey = dbView(view, basis);

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

  // 0b. Gold DB (MACRO_DB_URL) — equity tables
  if (goldEnabled() && ["market", "cross-asset", "bilello", "index-returns"].includes(view)) {
    try {
      const store = goldStore();
      const [priceRows, totalRows] = await Promise.all([
        store.latest<GoldEquityRow>("equity_return_daily"),
        store.latest<GoldEquityRow>("equity_total_return_index"),
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

  // 1. local database (DuckDB file or Postgres)
  const dbUrl = process.env.MARKET_DB_URL;
  if (dbUrl) {
    try {
      if (asof && ["market", "cross-asset", "bilello", "index-returns"].includes(view)) {
        const rows = await readMarketObservations(dbUrl, basis, asof);
        const data = computedView(view, rows, basis);
        if (data) {
          const earliestAsOf = extractEarliestAsOf(data, view);
          return json({ source: "DB", view, basis, asof, earliestAsOf, data });
        }
      }
      const data = await readFromDb(dbUrl, viewKey);
      if (data) {
        const earliestAsOf = extractEarliestAsOf(data, view);
        return json({ source: "DB", view, basis, earliestAsOf, data });
      }
    } catch (err) {
      // Connection/auth/SSL/query failure — log it (the route otherwise falls
      // back to the snapshot silently, hiding why MARKET_DB_URL didn't work).
      console.warn(`[market] MARKET_DB_URL read failed for view '${viewKey}': ${(err as Error).message}`);
    }
  }

  // 2. local exported-file cache
  const dir = process.env.MARKET_DATA_DIR;
  if (dir) {
    const data = await readFromDir(dir, view, basis);
    if (data) {
      const earliestAsOf = extractEarliestAsOf(data, view);
      const filtered = asof ? filterSnapshotByAsOf(data, view, asof) : data;
      return json({ source: "FILE", view, basis, ...(asof ? { asof } : {}), earliestAsOf, data: filtered });
    }
  }

  // 3. live FastAPI service
  const base = process.env.MARKET_PIPELINE_URL;
  if (base && basis === "total" && ENDPOINT[view]) {
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}${ENDPOINT[view]}`, {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });
      if (r.ok) {
        const livePayload = await r.json();
        const earliestAsOf = extractEarliestAsOf(livePayload, view);
        const filtered = asof ? filterSnapshotByAsOf(livePayload, view, asof) : livePayload;
        return json({ source: "LIVE", view, basis, ...(asof ? { asof } : {}), earliestAsOf, data: filtered });
      }
      console.warn(`[market] MARKET_PIPELINE_URL returned HTTP ${r.status} for ${ENDPOINT[view]}`);
    } catch (err) {
      console.warn(`[market] MARKET_PIPELINE_URL fetch failed for ${ENDPOINT[view]}: ${(err as Error).message}`);
    }
  }

  // 4. committed build-time snapshot
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
