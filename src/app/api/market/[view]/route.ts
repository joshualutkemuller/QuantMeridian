import { json } from "@/lib/server/http";
import { goldEnabled, goldStore, goldTable, goldParam, type GoldStore } from "@/lib/server/goldStore";
import { buildEdaFromGold } from "@/lib/server/goldEda";
import {
  SNAPSHOTS,
  type MarketView,
  type ReturnBasis,
  type SnapshotCard,
  type CrossAsset,
  type BilelloView,
  type IndexReturnsView,
  type IndexReturnMatrix,
  type RatesView,
  type InflationCard,
  type RegimeView,
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

// ---------------------------------------------------------------------------
// Gold DB builders for rates / inflation / regime
// ---------------------------------------------------------------------------

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

const TENOR_TO_SERIES: Record<string, string> = {
  "1M": "DGS1MO", "3M": "DGS3MO", "6M": "DGS6MO",
  "1Y": "DGS1", "2Y": "DGS2", "3Y": "DGS3", "5Y": "DGS5",
  "7Y": "DGS7", "10Y": "DGS10", "20Y": "DGS20", "30Y": "DGS30",
};

const TENOR_CHANGE_LABEL: Record<string, string> = {
  "1M": "1-Month", "3M": "3-Month", "6M": "6-Month",
  "1Y": "1-Year", "2Y": "2-Year", "3Y": "3-Year", "5Y": "5-Year",
  "7Y": "7-Year", "10Y": "10-Year", "20Y": "20-Year", "30Y": "30-Year",
};

const TENOR_ORDER = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];

interface GoldCurveHistoryRow {
  as_of_date: string;
  tenor?: string;
  tenor_label?: string;
  tenor_months?: number;
  yield_pct: number;
}

async function buildRatesFromGold(store: GoldStore): Promise<RatesView | null> {
  const today = new Date().toISOString().split("T")[0];
  const cutoff = addDays(today, -400); // covers 3M changes + YTD from Jan 1

  const rows = await store.raw<GoldCurveHistoryRow>(
    `SELECT as_of_date, tenor, tenor_label, tenor_months, yield_pct FROM ${goldTable("treasury_curve")} WHERE as_of_date >= ${goldParam(1)} ORDER BY as_of_date ASC`,
    [cutoff]
  );
  if (!rows.length) return null;

  // Group by tenor, collecting sorted date+yield pairs
  const byTenor = new Map<string, { dates: string[]; yields: number[] }>();
  for (const row of rows) {
    const tenor = row.tenor ?? row.tenor_label ?? "";
    if (!tenor) continue;
    const entry = byTenor.get(tenor) ?? { dates: [], yields: [] };
    entry.dates.push(row.as_of_date);
    entry.yields.push(row.yield_pct);
    byTenor.set(tenor, entry);
  }
  if (!byTenor.size) return null;

  const maxDate = rows[rows.length - 1].as_of_date;
  const d1 = addDays(maxDate, -1);
  const d7 = addDays(maxDate, -7);
  const d30 = addDays(maxDate, -30);
  const d90 = addDays(maxDate, -90);
  const ytdBase = `${maxDate.slice(0, 4)}-01-01`;

  function lookback(dates: string[], yields: number[], target: string): number | null {
    for (let i = dates.length - 2; i >= 0; i--) {
      if (dates[i] <= target) return yields[i];
    }
    return null;
  }

  function bps(latest: number, base: number | null): number | null {
    return base !== null ? Number(((latest - base) * 100).toFixed(1)) : null;
  }

  const curve: RatesView["curve"] = [];
  const changes: RatesView["changes"] = [];

  for (const tenor of TENOR_ORDER) {
    const entry = byTenor.get(tenor);
    if (!entry) continue;
    const { dates, yields } = entry;
    const seriesId = TENOR_TO_SERIES[tenor] ?? tenor;
    const label = TENOR_CHANGE_LABEL[tenor] ?? tenor;
    const latestYield = yields[yields.length - 1];

    if (dates[dates.length - 1] === maxDate) {
      curve.push({ series_id: seriesId, tenor, label: tenor, yield: Number(latestYield.toFixed(2)) });
    }

    changes.push({
      series_id: seriesId,
      label,
      latest: Number(latestYield.toFixed(2)),
      chg_1d_bps: bps(latestYield, lookback(dates, yields, d1)),
      chg_1w_bps: bps(latestYield, lookback(dates, yields, d7)),
      chg_1m_bps: bps(latestYield, lookback(dates, yields, d30)),
      chg_3m_bps: bps(latestYield, lookback(dates, yields, d90)),
      chg_ytd_bps: bps(latestYield, lookback(dates, yields, ytdBase)),
    });
  }

  if (!curve.length) return null;

  const twoY = byTenor.get("2Y");
  const tenY = byTenor.get("10Y");
  const threeM = byTenor.get("3M");
  const two_s_ten_s_bps = twoY && tenY
    ? Number(((tenY.yields[tenY.yields.length - 1] - twoY.yields[twoY.yields.length - 1]) * 100).toFixed(1))
    : null;
  const three_m_ten_y_bps = threeM && tenY
    ? Number(((tenY.yields[tenY.yields.length - 1] - threeM.yields[threeM.yields.length - 1]) * 100).toFixed(1))
    : null;

  return { asof: maxDate, curve, spreads: { two_s_ten_s_bps, three_m_ten_y_bps }, changes };
}

interface GoldInflationRow {
  series_id?: string | null;
  label?: string | null;
  name?: string | null;
  yoy?: number | null;
  yoy_pct?: number | null;
  prior_yoy?: number | null;
  prior_yoy_pct?: number | null;
  mom?: number | null;
  mom_pct?: number | null;
  trend?: string | null;
  as_of_date?: string | null;
  date?: string | null;
  observation_date?: string | null;
}

async function buildInflationFromGold(store: GoldStore): Promise<{ cards: InflationCard[] } | null> {
  const rows = await store.latest<GoldInflationRow>("inflation_explorer");
  if (!rows.length) return null;

  const cards: InflationCard[] = rows
    .filter((r) => r.series_id)
    .map((r) => ({
      series_id: r.series_id as string,
      label: r.label ?? r.name ?? (r.series_id as string),
      yoy: finiteNumber(r.yoy ?? r.yoy_pct),
      prior_yoy: finiteNumber(r.prior_yoy ?? r.prior_yoy_pct),
      mom: finiteNumber(r.mom ?? r.mom_pct),
      trend: r.trend ?? null,
      asof: r.as_of_date ?? r.date ?? r.observation_date ?? null,
    }));

  return cards.length ? { cards } : null;
}

interface GoldRegimeDailyRow {
  named_regime?: string | null;
  confidence?: number | null;
  growth_score?: number | null;
  inflation_score?: number | null;
  financial_conditions_score?: number | null;
  risk_on_off_score?: number | null;
  liquidity_score?: number | null;
  composite_score?: number | null;
  date?: string | null;
  observation_date?: string | null;
}

function regimeScoreLabel(score: number | null, labels: [string, string, string]): string {
  if (score === null) return labels[1];
  if (score >= 15) return labels[0];
  if (score <= -15) return labels[2];
  return labels[1];
}

async function buildRegimeFromGold(store: GoldStore): Promise<RegimeView | null> {
  const rows = await store.latest<GoldRegimeDailyRow>("macro_regime_daily");
  if (!rows.length) return null;

  const r = [...rows].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
  const asof = r.date ?? r.observation_date ?? "";
  const growth = r.growth_score ?? null;
  const inflation = r.inflation_score ?? null;
  const finCond = r.financial_conditions_score ?? null;
  const riskScore = r.risk_on_off_score ?? growth;
  const liquidityScore = r.liquidity_score ?? (finCond !== null ? -finCond : null);

  const scores = [growth, inflation, finCond].filter((s): s is number => s !== null);
  const compositeScore = r.composite_score ?? (scores.length ? scores.reduce((a, v) => a + v, 0) / scores.length : null);

  const namedRegime = r.named_regime ?? "UNKNOWN";
  const growthDesc = growth !== null && growth >= 10 ? "expansion" : growth !== null && growth <= -10 ? "contraction" : "flat";
  const inflDesc = inflation !== null && inflation >= 10 ? "elevated" : inflation !== null && inflation <= -10 ? "low" : "moderate";
  const narrative = `Regime: ${namedRegime}. Growth is ${growthDesc}, inflation is ${inflDesc}. Confidence: ${r.confidence != null ? r.confidence.toFixed(0) : "N/A"}%.`;

  return {
    asof,
    risk_on_off: { score: riskScore ?? 0, label: regimeScoreLabel(riskScore, ["RISK-ON", "NEUTRAL", "RISK-OFF"]) },
    inflation_pressure: { score: inflation ?? 0, label: regimeScoreLabel(inflation, ["ELEVATED", "MODERATE", "LOW"]) },
    growth_momentum: { score: growth ?? 0, label: regimeScoreLabel(growth, ["EXPANSION", "FLAT", "CONTRACTION"]) },
    liquidity: { score: liquidityScore ?? 0, label: regimeScoreLabel(liquidityScore, ["AMPLE", "NEUTRAL", "TIGHT"]) },
    composite: { score: compositeScore ?? 0, label: namedRegime },
    narrative,
  };
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
 * Reads market views from the Gold DB (MACRO_DB_URL) via goldStore.
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

  // 0c. Gold DB (MACRO_DB_URL) — rates: treasury curve + spreads + changes
  if (goldEnabled() && view === "rates") {
    try {
      const data = await buildRatesFromGold(goldStore());
      if (data) {
        return json({ source: "DB", view, basis, earliestAsOf: null, data });
      }
      console.warn("[market] Gold DB returned no curve rows for view 'rates'");
    } catch (err) {
      console.warn(`[market] Gold DB read failed for view 'rates': ${(err as Error).message}`);
    }
  }

  // 0d. Gold DB (MACRO_DB_URL) — inflation: inflation_explorer cards
  if (goldEnabled() && view === "inflation") {
    try {
      const data = await buildInflationFromGold(goldStore());
      if (data) {
        return json({ source: "DB", view, basis, earliestAsOf: null, data });
      }
      console.warn("[market] Gold DB returned no inflation_explorer rows for view 'inflation'");
    } catch (err) {
      console.warn(`[market] Gold DB read failed for view 'inflation': ${(err as Error).message}`);
    }
  }

  // 0e. Gold DB (MACRO_DB_URL) — regime: macro_regime_daily scores
  if (goldEnabled() && view === "regime") {
    try {
      const data = await buildRegimeFromGold(goldStore());
      if (data) {
        return json({ source: "DB", view, basis, earliestAsOf: null, data });
      }
      console.warn("[market] Gold DB returned no regime rows for view 'regime'");
    } catch (err) {
      console.warn(`[market] Gold DB read failed for view 'regime': ${(err as Error).message}`);
    }
  }

  return json({
    source: "ERR",
    view,
    basis,
    ...(asof ? { asof } : {}),
    earliestAsOf: null,
    data: null,
    error: goldEnabled() ? "No Gold DB market rows found." : "MACRO_DB_URL not configured.",
  });
}
