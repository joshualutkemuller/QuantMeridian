import { Rng } from "@/lib/rng";

export type QuiltAsset = string;

export interface QuiltCell {
  year: number;
  asset: QuiltAsset;
  proxyTicker?: string;
  displayName?: string;
  assetClass?: string;
  asOf?: string;
  returnPct: number;
  rank: number;
}

export interface QuiltYear {
  year: number;
  asOf?: string;
  cells: QuiltCell[];
}

export interface IndexDefinition {
  symbol: string;
  name: string;
  base: number;
  vol: number;
  drift: number;
}

export interface MonthlyReturnRow {
  month: string;
  values: Record<string, number | null>;
  monthAverage: number | null;
}

export interface IndexYearSummary {
  year: number;
  annualReturn: number | null;
  maxDrawdown: number | null;
  isYtd: boolean;
}

export interface IndexReturnMatrix {
  index: IndexDefinition;
  years: number[];
  ytdYear: number;
  rows: MonthlyReturnRow[];
  annualReturns: Record<string, number | null>;
  averageAnnualReturn: number;
  summaries: IndexYearSummary[];
}

export const QUILT_ASSETS: QuiltAsset[] = ["US Large Cap", "US Small Cap", "Intl Developed", "Emerging Markets", "US Bonds", "High Yield", "Commodities", "Gold", "REITs", "Cash"];

const QUILT_BASE: Record<string, { drift: number; vol: number; color: string }> = {
  "US Large Cap": { drift: 9.2, vol: 15, color: "#3B9DFF" },
  "US Small Cap": { drift: 8.4, vol: 22, color: "#7C3AED" },
  "Intl Developed": { drift: 6.4, vol: 17, color: "#14B8A6" },
  "Emerging Markets": { drift: 7.1, vol: 25, color: "#F59E0B" },
  "US Bonds": { drift: 3.8, vol: 7, color: "#60A5FA" },
  "High Yield": { drift: 5.8, vol: 10, color: "#F97316" },
  Commodities: { drift: 4.6, vol: 20, color: "#A16207" },
  Gold: { drift: 5.2, vol: 18, color: "#EAB308" },
  REITs: { drift: 7.0, vol: 20, color: "#EF4444" },
  Cash: { drift: 2.1, vol: 1.2, color: "#9CA3AF" },
};

export function quiltColor(asset: QuiltAsset): string {
  return QUILT_BASE[asset]?.color ?? ASSET_CLASS_COLORS[asset] ?? colorForTicker(asset);
}

const ASSET_CLASS_COLORS: Record<string, string> = {
  EQUITY: "#3B9DFF",
  BOND: "#60A5FA",
  CREDIT: "#F97316",
  COMMODITY: "#EAB308",
  VOLATILITY: "#EF4444",
  CURRENCY: "#9CA3AF",
};

function colorForTicker(ticker: string): string {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) hash = (hash * 31 + ticker.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const sat = 58 + (hash % 18);
  const light = 52 + ((hash >> 4) % 12);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export function getAssetQuilt(): QuiltYear[] {
  const rng = new Rng("asset-quilt");
  const years = Array.from({ length: 11 }, (_, i) => 2016 + i);
  return years.map((year, yi) => {
    const cycle = Math.sin((yi + 1) * 0.9) * 5;
    const cells = QUILT_ASSETS.map((asset, ai) => {
      const b = QUILT_BASE[asset];
      const shock = rng.normal(0, 1) * b.vol + cycle * Math.cos(ai * 0.8);
      const crisis = year === 2022 && ["US Bonds", "US Large Cap", "REITs"].includes(asset) ? -12 : 0;
      const rebound = year === 2023 && ["US Large Cap", "US Small Cap", "High Yield"].includes(asset) ? 9 : 0;
      const ytdPenalty = year === 2026 && asset === "US Bonds" ? -4 : 0;
      return { year, asset, returnPct: Number((b.drift + shock + crisis + rebound + ytdPenalty).toFixed(1)), rank: 0 };
    })
      .sort((a, b) => b.returnPct - a.returnPct)
      .map((c, i) => ({ ...c, rank: i + 1 }));
    return { year, cells };
  });
}

export const INDEXES: IndexDefinition[] = [
  { symbol: "SPX", name: "S&P 500", base: 5975, drift: 0.75, vol: 4.2 },
  { symbol: "NDX", name: "Nasdaq 100", base: 21450, drift: 0.95, vol: 6.0 },
  { symbol: "RUT", name: "Russell 2000", base: 2380, drift: 0.62, vol: 5.8 },
  { symbol: "INDU", name: "Dow Jones Industrial Average", base: 43400, drift: 0.58, vol: 3.8 },
  { symbol: "EAFE", name: "MSCI EAFE Proxy", base: 2450, drift: 0.46, vol: 4.6 },
  { symbol: "EM", name: "MSCI Emerging Markets Proxy", base: 1080, drift: 0.52, vol: 6.4 },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COMPLETED_YTD_MONTHS = 6;

function monthlyReturns(index: IndexDefinition): Record<number, (number | null)[]> {
  const rng = new Rng(`index-return-${index.symbol}`);
  const out: Record<number, (number | null)[]> = {};
  for (let year = 2016; year <= 2026; year++) {
    const yearShock = rng.normal(0, 1) * index.vol * 0.8;
    out[year] = MONTHS.map((_, m) => {
      if (year === 2026 && m >= COMPLETED_YTD_MONTHS) return null;
      const seasonal = m === 8 ? -0.8 : m === 10 || m === 11 ? 1.0 : m === 0 ? 0.55 : 0;
      const crisis = year === 2022 ? -1.4 : year === 2020 && m < 3 ? -3.8 : 0;
      const rebound = year === 2020 && m >= 3 && m <= 7 ? 2.4 : year === 2023 ? 1.0 : 0;
      return Number((index.drift + seasonal + yearShock / 12 + rng.normal(0, 1) * index.vol + crisis + rebound).toFixed(2));
    });
  }
  return out;
}

function compound(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (!valid.length) return null;
  const ret = valid.reduce((a, v) => a * (1 + v / 100), 1) - 1;
  return Number((ret * 100).toFixed(2));
}

function maxDrawdown(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (!valid.length) return null;
  let level = 100;
  let peak = 100;
  let dd = 0;
  valid.forEach((v) => {
    level *= 1 + v / 100;
    peak = Math.max(peak, level);
    dd = Math.min(dd, level / peak - 1);
  });
  return Number((dd * 100).toFixed(2));
}

export function getIndexReturnMatrix(symbol: string): IndexReturnMatrix {
  const index = INDEXES.find((i) => i.symbol === symbol) ?? INDEXES[0];
  const years = Array.from({ length: 10 }, (_, i) => 2016 + i);
  const ytdYear = 2026;
  const allColumns = [...years, ytdYear];
  const monthly = monthlyReturns(index);
  const rows = MONTHS.map((month, m) => {
    const values: Record<string, number | null> = {};
    allColumns.forEach((year) => { values[String(year)] = monthly[year][m]; });
    const avgVals = years.map((year) => monthly[year][m]).filter((v): v is number => v !== null);
    return { month, values, monthAverage: Number((avgVals.reduce((a, v) => a + v, 0) / avgVals.length).toFixed(2)) };
  });
  const annualReturns: Record<string, number | null> = {};
  allColumns.forEach((year) => { annualReturns[String(year)] = compound(monthly[year]); });
  const fullYearAnnuals = years.map((year) => annualReturns[String(year)]).filter((v): v is number => v !== null);
  const averageAnnualReturn = Number((fullYearAnnuals.reduce((a, v) => a + v, 0) / fullYearAnnuals.length).toFixed(2));
  const summaries = allColumns.map((year) => ({ year, annualReturn: annualReturns[String(year)], maxDrawdown: maxDrawdown(monthly[year]), isYtd: year === ytdYear }));
  return { index, years, ytdYear, rows, annualReturns, averageAnnualReturn, summaries };
}
