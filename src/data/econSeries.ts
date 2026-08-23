import { Rng } from "@/lib/rng";

/**
 * Economics data — FRED series catalog + headline macro indicators.
 *
 * Live mode: the /api/econ/* route handlers fetch real observations from FRED
 * (api.stlouisfed.org) when FRED_API_KEY is configured. This module is the
 * deterministic simulation layer that (a) renders instantly with zero config and
 * (b) is the fallback when no key / no network egress is available. Values are
 * anchored to a plausible mid-2026 macro regime (post-tightening normalization).
 */

export type EconCategory = "GROWTH" | "INFLATION" | "LABOR" | "RATES" | "CREDIT" | "HOUSING" | "CONSUMER" | "MONEY" | "ACTIVITY" | "FX";

export interface FredSeries {
  id: string; // FRED series id
  label: string;
  short: string;
  unit: string;
  category: EconCategory;
  freq: "D" | "W" | "M" | "Q";
  decimals: number;
  /** realistic latest level for the simulation layer */
  level: number;
  /** typical month/period change magnitude (for walk vol) */
  vol: number;
  /** "higher is better" for color semantics; null = neutral */
  bullish: boolean | null;
}

export const FRED_CATALOG: FredSeries[] = [
  // Growth / activity
  { id: "GDPC1", label: "Real GDP (SAAR)", short: "Real GDP", unit: "% q/q ann.", category: "GROWTH", freq: "Q", decimals: 1, level: 2.1, vol: 0.6, bullish: true },
  { id: "GDPNOW", label: "GDPNow Nowcast", short: "GDPNow", unit: "% q/q ann.", category: "GROWTH", freq: "Q", decimals: 1, level: 2.4, vol: 0.5, bullish: true },
  { id: "INDPRO", label: "Industrial Production", short: "Ind. Prod.", unit: "% m/m", category: "ACTIVITY", freq: "M", decimals: 1, level: 0.2, vol: 0.4, bullish: true },
  { id: "ISM-MFG", label: "ISM Manufacturing PMI", short: "ISM Mfg", unit: "index", category: "ACTIVITY", freq: "M", decimals: 1, level: 49.2, vol: 1.2, bullish: true },
  { id: "ISM-SVC", label: "ISM Services PMI", short: "ISM Svcs", unit: "index", category: "ACTIVITY", freq: "M", decimals: 1, level: 52.6, vol: 1.1, bullish: true },
  // Inflation
  { id: "CPIAUCSL", label: "CPI (headline, YoY)", short: "CPI", unit: "% y/y", category: "INFLATION", freq: "M", decimals: 1, level: 2.6, vol: 0.2, bullish: false },
  { id: "CPILFESL", label: "Core CPI (YoY)", short: "Core CPI", unit: "% y/y", category: "INFLATION", freq: "M", decimals: 1, level: 3.0, vol: 0.15, bullish: false },
  { id: "PCEPI", label: "PCE Price Index (YoY)", short: "PCE", unit: "% y/y", category: "INFLATION", freq: "M", decimals: 1, level: 2.3, vol: 0.15, bullish: false },
  { id: "PCEPILFE", label: "Core PCE (YoY)", short: "Core PCE", unit: "% y/y", category: "INFLATION", freq: "M", decimals: 1, level: 2.6, vol: 0.12, bullish: false },
  { id: "T5YIE", label: "5y Breakeven Inflation", short: "5y B/E", unit: "%", category: "INFLATION", freq: "D", decimals: 2, level: 2.34, vol: 0.05, bullish: null },
  { id: "CP0000EZ19M086NEST", label: "Euro Area CPI Index", short: "EA CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 128.4, vol: 0.35, bullish: false },
  { id: "GBRCPIALLMINMEI", label: "United Kingdom CPI Index", short: "UK CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 138.0, vol: 0.45, bullish: false },
  { id: "JPNCPIALLMINMEI", label: "Japan CPI Index", short: "JP CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 111.0, vol: 0.25, bullish: false },
  { id: "DEUCPIALLMINMEI", label: "Germany CPI Index", short: "DE CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 127.0, vol: 0.35, bullish: false },
  { id: "FRACPIALLMINMEI", label: "France CPI Index", short: "FR CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 119.0, vol: 0.3, bullish: false },
  { id: "ITACPIALLMINMEI", label: "Italy CPI Index", short: "IT CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 122.0, vol: 0.3, bullish: false },
  { id: "CANCPIALLMINMEI", label: "Canada CPI Index", short: "CA CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 162.0, vol: 0.35, bullish: false },
  { id: "CHNCPIALLMINMEI", label: "China CPI Index", short: "CN CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 102.0, vol: 0.25, bullish: false },
  { id: "INDCPIALLMINMEI", label: "India CPI Index", short: "IN CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 198.0, vol: 0.55, bullish: false },
  { id: "BRACPIALLMINMEI", label: "Brazil CPI Index", short: "BR CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 174.0, vol: 0.65, bullish: false },
  { id: "MEXCPIALLMINMEI", label: "Mexico CPI Index", short: "MX CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 139.0, vol: 0.45, bullish: false },
  { id: "AUSCPIALLQINMEI", label: "Australia CPI Index", short: "AU CPI", unit: "index", category: "INFLATION", freq: "Q", decimals: 2, level: 140.0, vol: 0.7, bullish: false },
  { id: "KORCPIALLMINMEI", label: "South Korea CPI Index", short: "KR CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 116.0, vol: 0.3, bullish: false },
  { id: "CHECPIALLMINMEI", label: "Switzerland CPI Index", short: "CH CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 107.0, vol: 0.2, bullish: false },
  { id: "ESPCPIALLMINMEI", label: "Spain CPI Index", short: "ES CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 122.0, vol: 0.35, bullish: false },
  { id: "TURCPIALLMINMEI", label: "Turkey CPI Index", short: "TR CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 2300.0, vol: 35.0, bullish: false },
  { id: "IDNCPIALLMINMEI", label: "Indonesia CPI Index", short: "ID CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 116.0, vol: 0.35, bullish: false },
  { id: "ZAFCPIALLMINMEI", label: "South Africa CPI Index", short: "ZA CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 118.0, vol: 0.45, bullish: false },
  { id: "SAUCPIALLMINMEI", label: "Saudi Arabia CPI Index", short: "SA CPI", unit: "index", category: "INFLATION", freq: "M", decimals: 2, level: 110.0, vol: 0.25, bullish: false },
  // Labor
  { id: "UNRATE", label: "Unemployment Rate", short: "U-3", unit: "%", category: "LABOR", freq: "M", decimals: 1, level: 4.3, vol: 0.1, bullish: false },
  { id: "PAYEMS", label: "Nonfarm Payrolls (chg)", short: "NFP", unit: "k m/m", category: "LABOR", freq: "M", decimals: 0, level: 138, vol: 60, bullish: true },
  { id: "ICSA", label: "Initial Jobless Claims", short: "Claims", unit: "k", category: "LABOR", freq: "W", decimals: 0, level: 233, vol: 14, bullish: false },
  { id: "CES0500000003", label: "Avg Hourly Earnings (YoY)", short: "AHE", unit: "% y/y", category: "LABOR", freq: "M", decimals: 1, level: 3.9, vol: 0.2, bullish: null },
  { id: "JTSJOL", label: "Job Openings (JOLTS)", short: "Openings", unit: "M", category: "LABOR", freq: "M", decimals: 1, level: 7.4, vol: 0.3, bullish: true },
  // Rates / money
  { id: "FEDFUNDS", label: "Effective Fed Funds Rate", short: "EFFR", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 4.08, vol: 0.02, bullish: null },
  { id: "SOFR", label: "SOFR", short: "SOFR", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.31, vol: 0.03, bullish: null },
  { id: "DGS2", label: "2-Year Treasury", short: "UST 2Y", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 3.74, vol: 0.04, bullish: null },
  { id: "DGS10", label: "10-Year Treasury", short: "UST 10Y", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.11, vol: 0.04, bullish: null },
  { id: "T10Y2Y", label: "10Y-2Y Spread", short: "2s10s", unit: "bps", category: "RATES", freq: "D", decimals: 0, level: 37, vol: 4, bullish: null },
  { id: "T10Y3M", label: "10Y-3M Spread", short: "3m10y", unit: "bps", category: "RATES", freq: "D", decimals: 0, level: -14, vol: 5, bullish: null },
  { id: "BAMLH0A0HYM2", label: "HY Credit Spread (OAS)", short: "HY OAS", unit: "bps", category: "RATES", freq: "D", decimals: 0, level: 312, vol: 12, bullish: false },
  // Consumer / housing / money
  { id: "RSAFS", label: "Retail Sales", short: "Retail", unit: "% m/m", category: "CONSUMER", freq: "M", decimals: 1, level: 0.3, vol: 0.4, bullish: true },
  { id: "UMCSENT", label: "U. Mich Consumer Sentiment", short: "Sentiment", unit: "index", category: "CONSUMER", freq: "M", decimals: 1, level: 68.4, vol: 2.5, bullish: true },
  { id: "HOUST", label: "Housing Starts", short: "Starts", unit: "M SAAR", category: "HOUSING", freq: "M", decimals: 2, level: 1.36, vol: 0.06, bullish: true },
  { id: "MORTGAGE30US", label: "30Y Mortgage Rate", short: "30Y Mtg", unit: "%", category: "HOUSING", freq: "W", decimals: 2, level: 6.62, vol: 0.08, bullish: false },
  { id: "M2SL", label: "M2 Money Supply (YoY)", short: "M2", unit: "% y/y", category: "MONEY", freq: "M", decimals: 1, level: 3.6, vol: 0.3, bullish: null },
  { id: "WALCL", label: "Fed Balance Sheet", short: "Fed B/S", unit: "$T", category: "MONEY", freq: "W", decimals: 2, level: 6.62, vol: 0.03, bullish: null },

  // ── Expanded rates / curve tenors ──
  { id: "DGS1MO", label: "1-Month Treasury", short: "UST 1M", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.3, vol: 0.03, bullish: null },
  { id: "DGS3MO", label: "3-Month Treasury", short: "UST 3M", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.25, vol: 0.03, bullish: null },
  { id: "DGS6MO", label: "6-Month Treasury", short: "UST 6M", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.15, vol: 0.03, bullish: null },
  { id: "DGS1", label: "1-Year Treasury", short: "UST 1Y", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 3.95, vol: 0.04, bullish: null },
  { id: "DGS5", label: "5-Year Treasury", short: "UST 5Y", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 3.8, vol: 0.04, bullish: null },
  { id: "DGS30", label: "30-Year Treasury", short: "UST 30Y", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.35, vol: 0.04, bullish: null },
  { id: "DFII10", label: "10Y Real Yield (TIPS)", short: "10Y Real", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 1.78, vol: 0.04, bullish: null },
  { id: "T10YIE", label: "10Y Breakeven Inflation", short: "10y B/E", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 2.32, vol: 0.04, bullish: null },
  { id: "T5YIFR", label: "5y5y Forward Inflation", short: "5y5y Fwd", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 2.41, vol: 0.04, bullish: null },
  { id: "DPRIME", label: "Bank Prime Loan Rate", short: "Prime", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 7.25, vol: 0.01, bullish: null },
  { id: "DGS20", label: "20-Year Treasury", short: "UST 20Y", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.45, vol: 0.04, bullish: null },
  { id: "DGS3", label: "3-Year Treasury", short: "UST 3Y", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 3.7, vol: 0.04, bullish: null },
  { id: "DGS7", label: "7-Year Treasury", short: "UST 7Y", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 3.95, vol: 0.04, bullish: null },

  // ── Credit spreads (ICE BofA OAS, displayed in bps) ──
  { id: "BAMLC0A0CM", label: "US IG Corp OAS", short: "IG OAS", unit: "bps", category: "CREDIT", freq: "D", decimals: 0, level: 92, vol: 5, bullish: false },
  { id: "BAMLC0A1CAAA", label: "AAA Corp OAS", short: "AAA", unit: "bps", category: "CREDIT", freq: "D", decimals: 0, level: 48, vol: 4, bullish: false },
  { id: "BAMLC0A2CAA", label: "AA Corp OAS", short: "AA", unit: "bps", category: "CREDIT", freq: "D", decimals: 0, level: 62, vol: 4, bullish: false },
  { id: "BAMLC0A3CA", label: "A Corp OAS", short: "A", unit: "bps", category: "CREDIT", freq: "D", decimals: 0, level: 84, vol: 5, bullish: false },
  { id: "BAMLC0A4CBBB", label: "BBB Corp OAS", short: "BBB", unit: "bps", category: "CREDIT", freq: "D", decimals: 0, level: 124, vol: 6, bullish: false },
  { id: "BAMLH0A1HYBB", label: "BB HY OAS", short: "BB", unit: "bps", category: "CREDIT", freq: "D", decimals: 0, level: 215, vol: 9, bullish: false },
  { id: "BAMLH0A2HYB", label: "B HY OAS", short: "B", unit: "bps", category: "CREDIT", freq: "D", decimals: 0, level: 348, vol: 12, bullish: false },
  { id: "BAMLH0A3HYC", label: "CCC & Lower OAS", short: "CCC", unit: "bps", category: "CREDIT", freq: "D", decimals: 0, level: 742, vol: 22, bullish: false },
  { id: "BAMLEMCBPIOAS", label: "EM Corp OAS", short: "EM Corp", unit: "bps", category: "CREDIT", freq: "D", decimals: 0, level: 218, vol: 10, bullish: false },
  { id: "BAMLC0A0CMEY", label: "US IG Corp Yield", short: "IG Yield", unit: "%", category: "CREDIT", freq: "D", decimals: 2, level: 5.18, vol: 0.05, bullish: null },
  { id: "BAMLH0A0HYM2EY", label: "US HY Corp Yield", short: "HY Yield", unit: "%", category: "CREDIT", freq: "D", decimals: 2, level: 7.62, vol: 0.08, bullish: null },

  // ── Expanded labor ──
  { id: "U6RATE", label: "U-6 Underemployment", short: "U-6", unit: "%", category: "LABOR", freq: "M", decimals: 1, level: 7.9, vol: 0.15, bullish: false },
  { id: "CIVPART", label: "Labor Force Participation", short: "LFPR", unit: "%", category: "LABOR", freq: "M", decimals: 1, level: 62.4, vol: 0.1, bullish: true },
  { id: "EMRATIO", label: "Employment-Population Ratio", short: "E/P", unit: "%", category: "LABOR", freq: "M", decimals: 1, level: 59.8, vol: 0.1, bullish: true },
  { id: "AWHAETP", label: "Avg Weekly Hours", short: "Hours", unit: "hrs", category: "LABOR", freq: "M", decimals: 1, level: 34.2, vol: 0.1, bullish: true },

  // ── Expanded inflation ──
  { id: "PPIACO", label: "PPI All Commodities (YoY)", short: "PPI", unit: "% y/y", category: "INFLATION", freq: "M", decimals: 1, level: 1.9, vol: 0.3, bullish: false },
  { id: "STICKCPIM159SFRBATL", label: "Sticky CPI (YoY)", short: "Sticky CPI", unit: "% y/y", category: "INFLATION", freq: "M", decimals: 1, level: 3.2, vol: 0.12, bullish: false },
  { id: "PCEPILFE_MOM", label: "Core PCE (MoM)", short: "Core PCE m/m", unit: "% m/m", category: "INFLATION", freq: "M", decimals: 2, level: 0.21, vol: 0.06, bullish: false },

  // ── Expanded activity / consumer / housing ──
  { id: "TCU", label: "Capacity Utilization", short: "Cap Util", unit: "%", category: "ACTIVITY", freq: "M", decimals: 1, level: 77.4, vol: 0.4, bullish: true },
  { id: "DGORDER", label: "Durable Goods Orders", short: "Dur Goods", unit: "% m/m", category: "ACTIVITY", freq: "M", decimals: 1, level: 0.3, vol: 1.2, bullish: true },
  { id: "PSAVERT", label: "Personal Saving Rate", short: "Saving", unit: "%", category: "CONSUMER", freq: "M", decimals: 1, level: 4.4, vol: 0.3, bullish: null },
  { id: "PCE", label: "Personal Consumption (YoY)", short: "PCE Spend", unit: "% y/y", category: "CONSUMER", freq: "M", decimals: 1, level: 5.1, vol: 0.3, bullish: true },
  { id: "TOTALSA", label: "Light Vehicle Sales", short: "Auto Sales", unit: "M SAAR", category: "CONSUMER", freq: "M", decimals: 1, level: 16.1, vol: 0.5, bullish: true },
  { id: "CSUSHPINSA", label: "Case-Shiller Home Px (YoY)", short: "Home Px", unit: "% y/y", category: "HOUSING", freq: "M", decimals: 1, level: 3.4, vol: 0.4, bullish: null },
  { id: "PERMIT", label: "Building Permits", short: "Permits", unit: "M SAAR", category: "HOUSING", freq: "M", decimals: 2, level: 1.42, vol: 0.05, bullish: true },
  { id: "EXHOSLUSM495S", label: "Existing Home Sales", short: "Home Sales", unit: "M SAAR", category: "HOUSING", freq: "M", decimals: 2, level: 4.05, vol: 0.1, bullish: true },

  // ── Money / financial conditions / FX ──
  { id: "NFCI", label: "Chicago Fed Fin. Conditions", short: "NFCI", unit: "index", category: "MONEY", freq: "W", decimals: 2, level: -0.42, vol: 0.05, bullish: false },
  { id: "DTWEXBGS", label: "Trade-Weighted USD (Broad)", short: "USD Broad", unit: "index", category: "FX", freq: "D", decimals: 2, level: 121.4, vol: 0.4, bullish: null },
  { id: "DEXUSEU", label: "USD / EUR", short: "EUR/USD", unit: "$", category: "FX", freq: "D", decimals: 4, level: 1.051, vol: 0.005, bullish: null },
  { id: "DEXJPUS", label: "JPY / USD", short: "USD/JPY", unit: "¥", category: "FX", freq: "D", decimals: 2, level: 156.3, vol: 0.5, bullish: null },
  { id: "VIXCLS", label: "CBOE VIX", short: "VIX", unit: "index", category: "MONEY", freq: "D", decimals: 1, level: 15.8, vol: 1.5, bullish: false },
  { id: "SP500", label: "S&P 500", short: "S&P 500", unit: "index", category: "MONEY", freq: "D", decimals: 0, level: 7357, vol: 30, bullish: true },
  { id: "NASDAQCOM", label: "Nasdaq Composite", short: "Nasdaq", unit: "index", category: "MONEY", freq: "D", decimals: 0, level: 22750, vol: 100, bullish: true },
  { id: "DJIA", label: "Dow Jones Industrial Average", short: "DJIA", unit: "index", category: "MONEY", freq: "D", decimals: 0, level: 45200, vol: 150, bullish: true },
  { id: "GOLDPMGBD228NLBM", label: "Gold Fixing Price (London PM)", short: "Gold", unit: "$/oz", category: "MONEY", freq: "D", decimals: 1, level: 3350, vol: 15, bullish: null },
  { id: "DCOILWTICO", label: "WTI Crude Oil", short: "WTI", unit: "$/bbl", category: "MONEY", freq: "D", decimals: 2, level: 68.7, vol: 1.0, bullish: null },

  // ── Funding & money markets (overnight rates, the corridor, the plumbing) ──
  { id: "EFFR", label: "Effective Fed Funds Rate (daily)", short: "EFFR (d)", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.08, vol: 0.01, bullish: null },
  { id: "OBFR", label: "Overnight Bank Funding Rate", short: "OBFR", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.09, vol: 0.01, bullish: null },
  { id: "IORB", label: "Interest on Reserve Balances", short: "IORB", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.15, vol: 0.005, bullish: null },
  { id: "BGCR", label: "Broad General Collateral Rate", short: "BGCR", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.29, vol: 0.02, bullish: null },
  { id: "TGCRRATE", label: "Tri-Party General Collateral Rate", short: "TGCR", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.28, vol: 0.02, bullish: null },
  { id: "SOFR30DAYAVG", label: "30-Day Average SOFR", short: "SOFR 30d", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.31, vol: 0.01, bullish: null },
  { id: "DFEDTARU", label: "Fed Funds Target Range — Upper", short: "Target Up", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.25, vol: 0.0, bullish: null },
  { id: "DFEDTARL", label: "Fed Funds Target Range — Lower", short: "Target Lo", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.0, vol: 0.0, bullish: null },
  { id: "DTB4WK", label: "4-Week T-Bill (secondary)", short: "Bill 1M", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.27, vol: 0.02, bullish: null },
  { id: "DTB3", label: "3-Month T-Bill (secondary)", short: "Bill 3M", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.2, vol: 0.02, bullish: null },
  { id: "DTB6", label: "6-Month T-Bill (secondary)", short: "Bill 6M", unit: "%", category: "RATES", freq: "D", decimals: 2, level: 4.08, vol: 0.02, bullish: null },

  // ── Liquidity balances & monetary aggregates ──
  { id: "RRPONTSYD", label: "Overnight Reverse Repo (take-up)", short: "RRP", unit: "$B", category: "MONEY", freq: "D", decimals: 0, level: 470, vol: 12, bullish: null },
  { id: "WRESBAL", label: "Reserve Balances at the Fed", short: "Reserves", unit: "$T", category: "MONEY", freq: "W", decimals: 2, level: 3.25, vol: 0.02, bullish: null },
  { id: "M1SL", label: "M1 Money Supply (YoY)", short: "M1", unit: "% y/y", category: "MONEY", freq: "M", decimals: 1, level: 2.1, vol: 0.3, bullish: null },
  { id: "BOGMBASE", label: "Monetary Base", short: "Base", unit: "$T", category: "MONEY", freq: "M", decimals: 2, level: 5.6, vol: 0.03, bullish: null },
  { id: "STLFSI4", label: "St. Louis Fed Financial Stress", short: "STLFSI", unit: "index", category: "MONEY", freq: "W", decimals: 2, level: -0.4, vol: 0.08, bullish: false },
  { id: "ANFCI", label: "Adjusted NFCI", short: "ANFCI", unit: "index", category: "MONEY", freq: "W", decimals: 2, level: -0.3, vol: 0.05, bullish: false },

  // ── Expanded inflation ──
  { id: "MEDCPIM159SFRB", label: "Median CPI (ann.)", short: "Median CPI", unit: "% ann.", category: "INFLATION", freq: "M", decimals: 1, level: 3.3, vol: 0.2, bullish: false },
  { id: "PCETRIM12M159SFRB", label: "Trimmed-Mean PCE (12m)", short: "Trim PCE", unit: "% y/y", category: "INFLATION", freq: "M", decimals: 1, level: 2.7, vol: 0.12, bullish: false },

  // ── Expanded labor ──
  { id: "JTSQUR", label: "Quits Rate (JOLTS)", short: "Quits", unit: "%", category: "LABOR", freq: "M", decimals: 1, level: 2.0, vol: 0.1, bullish: true },
  { id: "JTSHIR", label: "Hires Rate (JOLTS)", short: "Hires", unit: "%", category: "LABOR", freq: "M", decimals: 1, level: 3.4, vol: 0.1, bullish: true },
  { id: "CCSA", label: "Continued Jobless Claims", short: "Cont. Claims", unit: "M", category: "LABOR", freq: "W", decimals: 2, level: 1.87, vol: 0.04, bullish: false },

  // ── Expanded activity ──
  { id: "CFNAI", label: "Chicago Fed Nat'l Activity", short: "CFNAI", unit: "index", category: "ACTIVITY", freq: "M", decimals: 2, level: -0.05, vol: 0.25, bullish: true },
  { id: "NEWORDER", label: "Core Capital Goods Orders", short: "Cap Orders", unit: "% m/m", category: "ACTIVITY", freq: "M", decimals: 1, level: 0.3, vol: 0.6, bullish: true },

  // ── Expanded housing & consumer credit ──
  { id: "MSACSR", label: "Monthly Supply of New Homes", short: "Mos Supply", unit: "months", category: "HOUSING", freq: "M", decimals: 1, level: 8.9, vol: 0.3, bullish: false },
  { id: "MORTGAGE15US", label: "15Y Mortgage Rate", short: "15Y Mtg", unit: "%", category: "HOUSING", freq: "W", decimals: 2, level: 5.78, vol: 0.07, bullish: false },
  { id: "REVOLSL", label: "Revolving Consumer Credit (YoY)", short: "Rev Credit", unit: "% y/y", category: "CONSUMER", freq: "M", decimals: 1, level: 4.0, vol: 0.4, bullish: null },

  // ── Bank lending standards ──
  { id: "DRTSCILM", label: "Banks Tightening C&I (SLOOS)", short: "SLOOS C&I", unit: "net %", category: "CREDIT", freq: "Q", decimals: 1, level: 8.0, vol: 3, bullish: false },

  // ── Expanded FX ──
  { id: "DEXUSUK", label: "USD / GBP", short: "GBP/USD", unit: "$", category: "FX", freq: "D", decimals: 4, level: 1.27, vol: 0.006, bullish: null },
  { id: "DEXCAUS", label: "CAD / USD", short: "USD/CAD", unit: "C$", category: "FX", freq: "D", decimals: 4, level: 1.36, vol: 0.004, bullish: null },
  { id: "DEXCHUS", label: "CNY / USD", short: "USD/CNY", unit: "¥", category: "FX", freq: "D", decimals: 4, level: 7.18, vol: 0.01, bullish: null },
  { id: "DEXMXUS", label: "MXN / USD", short: "USD/MXN", unit: "MX$", category: "FX", freq: "D", decimals: 3, level: 17.1, vol: 0.08, bullish: null },

  // ── CPI component series (INFL module) ──
  { id: "CUSR0000SAH1", label: "CPI: Shelter", short: "Shelter", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 341, vol: 0.5, bullish: false },
  { id: "CUSR0000SEHC", label: "CPI: Owners' Equiv. Rent", short: "OER", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 340, vol: 0.4, bullish: false },
  { id: "CUSR0000SEHA", label: "CPI: Rent of Primary Residence", short: "Rent", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 410, vol: 0.5, bullish: false },
  { id: "CPIUFDSL", label: "CPI: Food", short: "Food", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 330, vol: 0.3, bullish: false },
  { id: "CUSR0000SAF11", label: "CPI: Food at Home", short: "Food@Home", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 310, vol: 0.3, bullish: false },
  { id: "CUSR0000SEFV", label: "CPI: Food Away from Home", short: "Food Out", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 390, vol: 0.4, bullish: false },
  { id: "CPIENGSL", label: "CPI: Energy", short: "Energy", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 265, vol: 2.5, bullish: false },
  { id: "CUSR0000SETB01", label: "CPI: Gasoline", short: "Gas", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 290, vol: 4.0, bullish: false },
  { id: "CUSR0000SEHF01", label: "CPI: Electricity", short: "Electric", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 320, vol: 1.0, bullish: false },
  { id: "CPIMEDSL", label: "CPI: Medical Care", short: "Medical", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 580, vol: 0.4, bullish: false },
  { id: "CUSR0000SETA01", label: "CPI: New Vehicles", short: "New Cars", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 173, vol: 0.2, bullish: false },
  { id: "CUSR0000SETA02", label: "CPI: Used Cars & Trucks", short: "Used Cars", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 193, vol: 1.5, bullish: false },
  { id: "CPIAPPSL", label: "CPI: Apparel", short: "Apparel", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 127, vol: 0.5, bullish: false },
  { id: "CPITRNSL", label: "CPI: Transportation Services", short: "Transport Svc", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 410, vol: 1.0, bullish: false },
  { id: "CUSR0000SEMD", label: "CPI: Hospital Services", short: "Hospital", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 480, vol: 0.4, bullish: false },
  { id: "CUSR0000SAS367", label: "CPI: Airline Fares", short: "Airfares", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 295, vol: 3.0, bullish: false },
  { id: "CPIRECSL", label: "CPI: Recreation", short: "Recreation", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 132, vol: 0.2, bullish: false },
  { id: "CUSR0000SAE1", label: "CPI: Education & Communication", short: "Edu/Comm", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 160, vol: 0.2, bullish: false },
  { id: "CUSR0000SAC", label: "CPI: Commodities", short: "Commodities", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 175, vol: 0.5, bullish: false },
  { id: "CUSR0000SACL1E", label: "CPI: Core Goods", short: "Core Goods", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 130, vol: 0.4, bullish: false },
  { id: "CUSR0000SAF", label: "CPI: Food & Beverages", short: "Food/Bvg", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 325, vol: 0.3, bullish: false },
  { id: "CUSR0000SAH", label: "CPI: Housing", short: "Housing", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 345, vol: 0.4, bullish: false },
  { id: "CUSR0000SAH2", label: "CPI: Fuels & Utilities", short: "Fuel/Util", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 280, vol: 1.0, bullish: false },
  { id: "CUSR0000SAM1", label: "CPI: Medical Care Commodities", short: "Med Goods", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 395, vol: 0.4, bullish: false },
  { id: "CUSR0000SAM2", label: "CPI: Medical Care Services", short: "Med Svcs", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 620, vol: 0.4, bullish: false },
  { id: "CUSR0000SAS", label: "CPI: Services", short: "Services", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 390, vol: 0.4, bullish: false },
  { id: "CUSR0000SASLE", label: "CPI: Core Services ex Energy", short: "Core Svcs", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 405, vol: 0.4, bullish: false },
  { id: "CUSR0000SEHF02", label: "CPI: Utility Gas Service", short: "Utility Gas", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 285, vol: 2.0, bullish: false },
  { id: "CUSR0000SAG", label: "CPI: Other Goods & Services", short: "Other G&S", unit: "index", category: "INFLATION", freq: "M", decimals: 1, level: 540, vol: 0.4, bullish: false },

  // ── PCE component series (INFL module) ──
  { id: "DGDSRG3M086SBEA", label: "PCE: Goods", short: "PCE Goods", unit: "% m/m", category: "INFLATION", freq: "M", decimals: 1, level: 0.1, vol: 0.3, bullish: false },
  { id: "DSERRG3M086SBEA", label: "PCE: Services", short: "PCE Svcs", unit: "% m/m", category: "INFLATION", freq: "M", decimals: 1, level: 0.3, vol: 0.1, bullish: false },
  { id: "DNRGRG3M086SBEA", label: "PCE: Energy Goods & Svc", short: "PCE Energy", unit: "% m/m", category: "INFLATION", freq: "M", decimals: 1, level: -0.5, vol: 2.0, bullish: false },
  { id: "DFXARG3M086SBEA", label: "PCE: Food", short: "PCE Food", unit: "% m/m", category: "INFLATION", freq: "M", decimals: 1, level: 0.2, vol: 0.2, bullish: false },
  { id: "DHUTRC1M027SBEA", label: "PCE: Housing & Utilities", short: "PCE Housing", unit: "% m/m", category: "INFLATION", freq: "M", decimals: 1, level: 0.4, vol: 0.1, bullish: false },
  { id: "DHLCRG3M086SBEA", label: "PCE: Health Care", short: "PCE Health", unit: "% m/m", category: "INFLATION", freq: "M", decimals: 1, level: 0.3, vol: 0.1, bullish: false },
  { id: "DTRSRC1M027SBEA", label: "PCE: Transportation", short: "PCE Transport", unit: "% m/m", category: "INFLATION", freq: "M", decimals: 1, level: 0.1, vol: 0.5, bullish: false },
  { id: "DRCARC1M027SBEA", label: "PCE: Recreation", short: "PCE Rec", unit: "% m/m", category: "INFLATION", freq: "M", decimals: 1, level: 0.2, vol: 0.2, bullish: false },

  // ── Global policy rate series (GPOL module) ──
  { id: "IRSTCB01USM156N", label: "US Federal Reserve Rate", short: "Fed Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 4.33, vol: 0.08, bullish: false },
  { id: "ECBDFR", label: "ECB Deposit Facility Rate", short: "ECB DFR", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 2.75, vol: 0.08, bullish: false },
  { id: "IRSTCB01GBM156N", label: "Bank of England Rate", short: "BoE Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 4.50, vol: 0.08, bullish: false },
  { id: "IRSTCB01JPM156N", label: "Bank of Japan Rate", short: "BoJ Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 0.50, vol: 0.04, bullish: false },
  { id: "IRSTCB01CAM156N", label: "Bank of Canada Rate", short: "BoC Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 2.75, vol: 0.08, bullish: false },
  { id: "IRSTCB01AUM156N", label: "RBA Cash Rate", short: "RBA Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 4.10, vol: 0.08, bullish: false },
  { id: "IRSTCB01CHM156N", label: "Swiss National Bank Rate", short: "SNB Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 0.25, vol: 0.08, bullish: false },
  { id: "IRSTCB01BRM156N", label: "Banco Central do Brasil Rate", short: "BCB Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 14.25, vol: 0.25, bullish: false },
  { id: "IRSTCB01MXM156N", label: "Banco de Mexico Rate", short: "Banxico Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 9.00, vol: 0.15, bullish: false },
  { id: "IRSTCB01KRM156N", label: "Bank of Korea Rate", short: "BoK Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 2.75, vol: 0.08, bullish: false },
  { id: "IRSTCB01SEM156N", label: "Riksbank Rate", short: "Riksbank", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 2.25, vol: 0.08, bullish: false },
  { id: "IRSTCB01NOM156N", label: "Norges Bank Rate", short: "Norges Bank", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 4.50, vol: 0.08, bullish: false },
  { id: "IRSTCB01NZM156N", label: "RBNZ Rate", short: "RBNZ Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 3.50, vol: 0.08, bullish: false },
  { id: "IRSTCB01TRM156N", label: "CBRT Rate (Turkey)", short: "CBRT Rate", unit: "%", category: "RATES", freq: "M", decimals: 2, level: 42.50, vol: 1.0, bullish: false },
];

export function seriesById(id: string): FredSeries | undefined {
  return FRED_CATALOG.find((s) => s.id === id);
}

/**
 * FRED unit correction. Raw FRED series are often index levels or totals, while
 * the terminal displays YoY %, MoM %, changes, bps, $T, etc. `resolveFred` maps
 * each series to the FRED `units` transform (pc1 = % YoY, pch = % MoM, chg =
 * level change, pca = compounded annual rate, lin = as-is) plus a display scale
 * factor. `simOnly` series have no usable FRED source (e.g. ISM PMIs were pulled
 * from FRED for licensing) and always render from the simulation.
 */
export interface FredResolved {
  units: string;
  scale: number;
  simOnly: boolean;
}

const FRED_OVERRIDE: Record<string, Partial<FredResolved>> = {
  // spreads & credit OAS: FRED returns percentage points, we display bps
  T10Y2Y: { units: "lin", scale: 100 },
  T10Y3M: { units: "lin", scale: 100 },
  BAMLH0A0HYM2: { units: "lin", scale: 100 },
  BAMLC0A0CM: { units: "lin", scale: 100 },
  BAMLC0A1CAAA: { units: "lin", scale: 100 },
  BAMLC0A2CAA: { units: "lin", scale: 100 },
  BAMLC0A3CA: { units: "lin", scale: 100 },
  BAMLC0A4CBBB: { units: "lin", scale: 100 },
  BAMLH0A1HYBB: { units: "lin", scale: 100 },
  BAMLH0A2HYB: { units: "lin", scale: 100 },
  BAMLH0A3HYC: { units: "lin", scale: 100 },
  BAMLEMCBPIOAS: { units: "lin", scale: 100 },
  // already-YoY rate series — do not re-transform
  STICKCPIM159SFRBATL: { units: "lin" },
  // rescaled levels
  PERMIT: { units: "lin", scale: 0.001 }, // thousands -> millions
  EXHOSLUSM495S: { units: "lin", scale: 1e-6 }, // count -> millions
  // synthetic convenience series (no direct FRED id)
  PCEPILFE_MOM: { simOnly: true },
  // growth as compounded annual rate
  GDPC1: { units: "pca" },
  GDPNOW: { units: "lin" }, // GDPNow is already an annualized %
  // level changes — FRED PAYEMS is already in thousands; chg yields the k m/m change
  PAYEMS: { units: "chg", scale: 1 },
  // rescaled levels
  ICSA: { units: "lin", scale: 0.001 }, // persons -> thousands
  JTSJOL: { units: "lin", scale: 0.001 }, // thousands -> millions
  HOUST: { units: "lin", scale: 0.001 }, // thousands -> millions
  WALCL: { units: "lin", scale: 1e-6 }, // $ millions -> $ trillions
  // percent-change transforms
  M2SL: { units: "pc1" },
  RSAFS: { units: "pch" },
  INDPRO: { units: "pch" },
  CES0500000003: { units: "pc1" },
  // licensing-restricted / synthetic ids -> simulation only
  "ISM-MFG": { simOnly: true },
  "ISM-SVC": { simOnly: true },
  SOFR: { units: "lin" },
  // ── Funding / money-market additions ──
  // FRED reports these as billions; the terminal displays trillions.
  WRESBAL: { units: "lin", scale: 0.001 },
  BOGMBASE: { units: "lin", scale: 0.001 },
  // continued claims: persons -> millions
  CCSA: { units: "lin", scale: 1e-6 },
  // already-rate series — do not re-transform
  MEDCPIM159SFRB: { units: "lin" },
  PCETRIM12M159SFRB: { units: "lin" },
  // percent-change transforms
  M1SL: { units: "pc1" },
  REVOLSL: { units: "pc1" },
  NEWORDER: { units: "pch" },
};

export function resolveFred(id: string): FredResolved {
  const s = seriesById(id);
  const o = FRED_OVERRIDE[id] ?? {};
  let units = o.units;
  if (!units) {
    if (s?.unit.includes("y/y")) units = "pc1";
    else if (s?.unit.includes("m/m")) units = "pch";
    else units = "lin";
  }
  return { units, scale: o.scale ?? 1, simOnly: o.simOnly ?? false };
}

export interface Observation {
  date: string; // ISO yyyy-mm-dd
  value: number;
}

/** Anchor date for the simulation ("today"). */
export const ECON_TODAY = new Date(Date.UTC(2026, 5, 17));

function stepMs(freq: FredSeries["freq"]): number {
  if (freq === "D") return 24 * 3600 * 1000;
  if (freq === "W") return 7 * 24 * 3600 * 1000;
  if (freq === "M") return 30 * 24 * 3600 * 1000;
  return 91 * 24 * 3600 * 1000;
}

/**
 * Deterministic observation history for a series, ending at its anchor `level`.
 * Builds a mean-reverting series backwards so the latest point matches `level`.
 */
export function getSeriesHistory(id: string, n = 120): Observation[] {
  const s = seriesById(id);
  if (!s) return [];
  const rng = new Rng(`econ-${id}`);
  const out: Observation[] = [];
  const step = stepMs(s.freq);
  // generate a path then rescale so the final value equals level
  const raw: number[] = [];
  let x = s.level;
  for (let i = 0; i < n; i++) {
    x = x - rng.normal(0, s.vol) - (s.bullish === null ? 0 : 0);
    raw.push(x);
  }
  raw.reverse();
  const shift = s.level - raw[raw.length - 1];
  for (let i = 0; i < n; i++) {
    const date = new Date(ECON_TODAY.getTime() - (n - 1 - i) * step);
    out.push({ date: date.toISOString().slice(0, 10), value: Number((raw[i] + shift).toFixed(s.decimals)) });
  }
  return out;
}

const RAW_LEVEL_ANCHORS: Record<string, number> = {
  CPIAUCSL: 315.5,
  CPILFESL: 320.2,
  PCEPI: 124.8,
  PCEPILFE: 126.5,
  M2SL: 21200,
  M1SL: 18400,
  RSAFS: 724,
  INDPRO: 104.2,
  CES0500000003: 35.5,
  REVOLSL: 1320,
  NEWORDER: 589,
  GDPC1: 23100,
};

/**
 * Synthetic raw index-level history for series that normally display as growth
 * rates (pc1/pch/pca). Uses a reasonable base level and walks it with small
 * monthly changes consistent with the series' displayed YoY rate. This prevents
 * the drill-through from computing "percent changes of percent changes" when
 * the SIM fallback is active (no snapshot, no FRED key).
 */
export function getSeriesHistoryRaw(id: string, n = 120): Observation[] | null {
  const s = seriesById(id);
  if (!s) return null;
  const anchor = RAW_LEVEL_ANCHORS[id];
  if (anchor == null) return null;

  const rng = new Rng(`econ-raw-${id}`);
  const step = stepMs(s.freq);
  const monthlyDrift = s.level / 1200;
  const raw: number[] = [];
  let x = anchor;
  for (let i = 0; i < n; i++) {
    x = x * (1 - monthlyDrift - rng.normal(0, 0.001));
    raw.push(x);
  }
  raw.reverse();
  const scale = anchor / raw[raw.length - 1];
  const out: Observation[] = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(ECON_TODAY.getTime() - (n - 1 - i) * step);
    out.push({ date: date.toISOString().slice(0, 10), value: Number((raw[i] * scale).toFixed(2)) });
  }
  return out;
}

export interface IndicatorRow {
  id: string;
  label: string;
  short: string;
  category: EconCategory;
  unit: string;
  value: number;
  prior: number;
  change: number;
  yoy: number;
  surprise: number; // actual - consensus, in unit terms
  spark: number[];
  bullish: boolean | null;
  decimals: number;
  asOf: string;
}

/** Headline macro dashboard rows derived from the catalog + simulated history. */
export function getIndicators(): IndicatorRow[] {
  return FRED_CATALOG.map((s) => {
    const rng = new Rng(`ind-${s.id}`);
    const hist = getSeriesHistory(s.id, 36);
    const value = hist[hist.length - 1].value;
    const prior = hist[hist.length - 2].value;
    const yoyBase = hist[Math.max(0, hist.length - 13)].value;
    const yoy = s.unit.includes("y/y") ? value : ((value - yoyBase) / (Math.abs(yoyBase) || 1)) * 100;
    return {
      id: s.id, label: s.label, short: s.short, category: s.category, unit: s.unit,
      value, prior, change: Number((value - prior).toFixed(s.decimals)),
      yoy: Number(yoy.toFixed(1)),
      surprise: Number(rng.normal(0, s.vol * 0.8).toFixed(s.decimals)),
      spark: hist.map((h) => h.value),
      bullish: s.bullish, decimals: s.decimals, asOf: hist[hist.length - 1].date,
    };
  });
}

export const ECON_CATEGORY_LABEL: Record<EconCategory, string> = {
  GROWTH: "Growth",
  INFLATION: "Inflation",
  LABOR: "Labor",
  RATES: "Rates & Curve",
  CREDIT: "Credit",
  HOUSING: "Housing",
  CONSUMER: "Consumer",
  MONEY: "Money & Fed",
  ACTIVITY: "Activity",
  FX: "FX & Dollar",
};
