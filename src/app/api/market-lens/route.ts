import { json } from "@/lib/server/http";
import { runMarketLens } from "@/data/marketLens";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

const LENS_URL = process.env.MARKET_LENS_URL || "";

interface GoldConstituentRow {
  ticker: string;
  name: string | null;
  asset_class: string | null;
  sector: string | null;
}

interface ViewDef {
  view_id: string;
  display_name: string;
  category: string;
  description: string;
  default_series: string[];
  default_tiles: string[];
  configurable_fields: string[];
  default_forward_windows: string[];
}

// Embedded view registry — used when the Python backend is not available
const VIEWS: ViewDef[] = [
  { view_id: "ath_forward_returns", display_name: "All-Time Highs → Forward Returns", category: "Event Studies", description: "What happens after an asset reaches a new all-time high?", default_series: ["SPY"], default_tiles: ["event_table", "forward_return_box", "cumulative_chart", "baseline_comparison"], configurable_fields: ["series", "forward_windows", "cooldown_days"], default_forward_windows: ["1W", "1M", "3M", "6M", "1Y"] },
  { view_id: "drawdown_analysis", display_name: "Drawdown Analysis", category: "Risk", description: "Detect and rank all drawdowns exceeding a threshold.", default_series: ["SPY"], default_tiles: ["drawdown_table", "drawdown_chart", "recovery_histogram"], configurable_fields: ["series", "threshold", "start_date"], default_forward_windows: ["1M", "3M", "6M", "1Y"] },
  { view_id: "vix_spike_study", display_name: "VIX Spike Event Study", category: "Event Studies", description: "What happens to equities when the VIX spikes above a threshold?", default_series: ["SPY"], default_tiles: ["event_table", "forward_return_box", "vix_overlay"], configurable_fields: ["series", "vix_threshold", "forward_windows", "cooldown_days"], default_forward_windows: ["1W", "1M", "3M", "6M", "1Y"] },
  { view_id: "largest_vix_increases", display_name: "Largest VIX Increases", category: "Event Studies", description: "The N largest VIX percentage increases over a configurable window.", default_series: ["SPY"], default_tiles: ["event_table", "forward_return_box", "vix_change_scatter"], configurable_fields: ["series", "change_period", "top_n", "forward_windows", "cooldown_days"], default_forward_windows: ["1W", "1M", "3M", "6M", "1Y"] },
  { view_id: "largest_vix_decreases", display_name: "Largest VIX Decreases", category: "Event Studies", description: "The N largest VIX percentage decreases.", default_series: ["SPY"], default_tiles: ["event_table", "forward_return_box", "vix_change_scatter"], configurable_fields: ["series", "change_period", "top_n", "forward_windows", "cooldown_days"], default_forward_windows: ["1W", "1M", "3M", "6M", "1Y"] },
  { view_id: "rolling_returns", display_name: "Rolling Return Distribution", category: "Returns", description: "Distribution of rolling returns across multiple horizons.", default_series: ["SPY"], default_tiles: ["histogram", "percentile_gauge", "rolling_chart", "statistics_table"], configurable_fields: ["series", "windows", "return_type"], default_forward_windows: ["1M", "3M", "6M", "1Y", "3Y", "5Y"] },
  { view_id: "monthly_seasonality", display_name: "Monthly Seasonality", category: "Patterns", description: "Average returns by calendar month. Sell in May analysis.", default_series: ["SPY"], default_tiles: ["seasonality_heatmap", "monthly_bar", "sell_in_may", "day_of_week"], configurable_fields: ["series", "start_date"], default_forward_windows: ["1M"] },
  { view_id: "cross_asset_correlation", display_name: "Cross-Asset Correlation", category: "Multi-Asset", description: "Rolling correlations between major asset classes.", default_series: ["SPY", "AGG", "GLD", "^VIX"], default_tiles: ["correlation_matrix", "rolling_corr_chart"], configurable_fields: ["series", "window", "start_date"], default_forward_windows: ["3M", "1Y"] },
  { view_id: "relative_strength", display_name: "Relative Strength Analysis", category: "Multi-Asset", description: "Relative performance of one asset vs a benchmark.", default_series: ["QQQ", "SPY"], default_tiles: ["relative_strength_chart", "excess_return_table"], configurable_fields: ["series", "benchmark", "start_date"], default_forward_windows: ["1M", "3M", "1Y"] },
  { view_id: "yield_curve_analysis", display_name: "Yield Curve Deep Dive", category: "Rates", description: "Treasury curve shape, slope history, and inversions.", default_series: ["DGS2", "DGS10", "T10Y2Y"], default_tiles: ["curve_chart", "slope_history", "inversion_events"], configurable_fields: ["tenors", "forward_windows"], default_forward_windows: ["3M", "6M", "1Y", "2Y"] },
  { view_id: "credit_spread_stress", display_name: "Credit Spread Stress", category: "Credit", description: "HY and IG spread analysis with stress indicators.", default_series: ["BAMLH0A0HYM2", "BAMLC0A0CM"], default_tiles: ["spread_gauge", "spread_history", "zscore_chart"], configurable_fields: ["spread_series", "threshold_bps", "forward_windows"], default_forward_windows: ["1M", "3M", "6M", "1Y"] },
  { view_id: "purchasing_power", display_name: "Purchasing Power Erosion", category: "Inflation", description: "Real vs nominal return comparison.", default_series: ["SPY", "CPIAUCSL"], default_tiles: ["purchasing_power_chart", "real_vs_nominal"], configurable_fields: ["asset_series", "cpi_series", "base_amount"], default_forward_windows: ["1Y", "5Y"] },
  { view_id: "volatility_regime", display_name: "Volatility Regime Analysis", category: "Risk", description: "VIX regime classification and asset performance.", default_series: ["SPY", "^VIX"], default_tiles: ["regime_chart", "regime_return_table", "rolling_vol"], configurable_fields: ["series", "vix_thresholds"], default_forward_windows: ["1W", "1M", "3M"] },
  { view_id: "rate_cycle_analysis", display_name: "Rate Cycle Impact", category: "Rates", description: "How do assets perform during Fed hiking and cutting cycles?", default_series: ["SPY", "FEDFUNDS"], default_tiles: ["cycle_timeline", "hiking_returns", "cutting_returns"], configurable_fields: ["asset_series", "rate_series", "threshold_bps"], default_forward_windows: ["3M", "6M", "1Y"] },
  { view_id: "asset_class_returns", display_name: "Asset Class Return Comparison", category: "Multi-Asset", description: "Side-by-side return comparison — Bilello-style.", default_series: ["SPY", "QQQ", "IWM", "EFA", "EEM", "AGG", "HYG", "GLD", "VNQ"], default_tiles: ["return_table", "bar_chart", "ranking_quilt"], configurable_fields: ["series", "windows"], default_forward_windows: ["1M", "3M", "6M", "1Y", "3Y", "5Y"] },
  { view_id: "ma_crossover_study", display_name: "Moving Average Crossover", category: "Patterns", description: "Golden cross/death cross event study.", default_series: ["SPY"], default_tiles: ["crossover_chart", "event_table", "forward_return_box"], configurable_fields: ["series", "ma_short", "ma_long", "forward_windows"], default_forward_windows: ["1W", "1M", "3M", "6M", "1Y"] },
  { view_id: "drawdown_recovery", display_name: "Drawdown Recovery Patterns", category: "Risk", description: "Recovery time analysis after major drawdowns.", default_series: ["SPY"], default_tiles: ["recovery_table", "recovery_chart"], configurable_fields: ["series", "threshold"], default_forward_windows: ["3M", "6M", "1Y", "2Y"] },
  { view_id: "inflation_surprise", display_name: "Inflation Surprise Impact", category: "Inflation", description: "CPI beat/miss event study.", default_series: ["SPY", "CPIAUCSL"], default_tiles: ["surprise_table", "forward_return_box"], configurable_fields: ["asset_series", "inflation_series", "forward_windows"], default_forward_windows: ["1W", "1M", "3M"] },
  { view_id: "zscore_extremes", display_name: "Z-Score Extreme Events", category: "Event Studies", description: "Event study when returns hit extreme z-scores.", default_series: ["SPY"], default_tiles: ["zscore_chart", "extreme_events", "forward_return_box"], configurable_fields: ["series", "z_threshold", "lookback", "forward_windows"], default_forward_windows: ["1W", "1M", "3M", "6M"] },
];

const PRESETS = [
  { preset_id: "bilello_classic", name: "Bilello Classic", description: "Cross-asset return comparison", tags: ["bilello", "cross-asset"] },
  { preset_id: "ath_spy", name: "S&P 500 All-Time Highs", description: "Forward returns after ATH", tags: ["ath", "spy"] },
  { preset_id: "vix_panic", name: "VIX Panic Events", description: "S&P 500 returns after VIX spikes above 30", tags: ["vix", "volatility"] },
  { preset_id: "credit_stress", name: "Credit Spread Monitor", description: "HY and IG spread analysis", tags: ["credit", "spreads"] },
  { preset_id: "sell_in_may", name: "Sell in May?", description: "Seasonal pattern test", tags: ["seasonality", "myth"] },
];

const CATALOG = [
  { series_id: "SPY", ticker: "SPY", display_name: "SPDR S&P 500 ETF", asset_class: "EQUITY", source: "yahoo" },
  { series_id: "QQQ", ticker: "QQQ", display_name: "Invesco QQQ Trust", asset_class: "EQUITY", source: "yahoo" },
  { series_id: "IWM", ticker: "IWM", display_name: "iShares Russell 2000 ETF", asset_class: "EQUITY", source: "yahoo" },
  { series_id: "DIA", ticker: "DIA", display_name: "SPDR Dow Jones ETF", asset_class: "EQUITY", source: "yahoo" },
  { series_id: "EFA", ticker: "EFA", display_name: "iShares MSCI EAFE ETF", asset_class: "EQUITY", source: "yahoo" },
  { series_id: "EEM", ticker: "EEM", display_name: "iShares MSCI EM ETF", asset_class: "EQUITY", source: "yahoo" },
  { series_id: "AGG", ticker: "AGG", display_name: "iShares Core US Agg Bond ETF", asset_class: "BOND", source: "yahoo" },
  { series_id: "HYG", ticker: "HYG", display_name: "iShares iBoxx HY Corp Bond ETF", asset_class: "BOND", source: "yahoo" },
  { series_id: "LQD", ticker: "LQD", display_name: "iShares iBoxx IG Corp Bond ETF", asset_class: "BOND", source: "yahoo" },
  { series_id: "GLD", ticker: "GLD", display_name: "SPDR Gold Shares", asset_class: "COMMODITY", source: "yahoo" },
  { series_id: "VNQ", ticker: "VNQ", display_name: "Vanguard Real Estate ETF", asset_class: "REIT", source: "yahoo" },
  { series_id: "^VIX", ticker: "^VIX", display_name: "CBOE Volatility Index", asset_class: "VOLATILITY", source: "yahoo" },
  { series_id: "DGS2", ticker: "DGS2", display_name: "2-Year Treasury Yield", asset_class: "RATE", source: "fred" },
  { series_id: "DGS10", ticker: "DGS10", display_name: "10-Year Treasury Yield", asset_class: "RATE", source: "fred" },
  { series_id: "BAMLH0A0HYM2", ticker: "BAMLH0A0HYM2", display_name: "ICE BofA US HY OAS", asset_class: "CREDIT", source: "fred" },
  { series_id: "CPIAUCSL", ticker: "CPIAUCSL", display_name: "CPI Urban All Items", asset_class: "MACRO", source: "fred" },
];

async function proxyToBackend(path: string, method: string, body?: unknown): Promise<Response | null> {
  if (!LENS_URL) return null;
  try {
    const url = `${LENS_URL}${path}`;
    const opts: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (res.ok) return res;
  } catch {
    // backend not available
  }
  return null;
}

/** Validate that a backend GET payload has the shape the UI expects. */
function isValidGetShape(action: string, id: string, data: unknown): boolean {
  if (data == null) return false;
  if (action === "views" && id) return typeof data === "object" && "view_id" in (data as object);
  if (action === "views" || action === "presets") return Array.isArray(data);
  if (action === "catalog") return typeof data === "object" && Array.isArray((data as { entries?: unknown }).entries);
  return false;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "views";
  const id = searchParams.get("id") || "";
  const q = searchParams.get("q") || "";

  // Try Python backend first — but only trust a well-formed payload. Any error,
  // unreachable backend, or unexpected shape falls through to embedded data so
  // the UI never ends up with an empty/broken view library.
  if (LENS_URL) {
    let path = "/market-lens/views";
    if (action === "views" && id) path = `/market-lens/views/${id}`;
    else if (action === "presets" && id) path = `/market-lens/presets/${id}`;
    else if (action === "presets") path = "/market-lens/presets";
    else if (action === "catalog" && q) path = `/market-lens/catalog/search?q=${encodeURIComponent(q)}`;
    else if (action === "catalog") path = "/market-lens/catalog";

    try {
      const backendRes = await proxyToBackend(path, "GET");
      if (backendRes) {
        const data = await backendRes.json();
        if (isValidGetShape(action, id, data)) {
          return json({ source: "LIVE", data });
        }
      }
    } catch {
      // fall through to embedded data
    }
  }

  // Fallback to embedded data. `fallback: true` flags that the live backend was
  // configured but unavailable/invalid, so the UI can surface a clear notice.
  const fallback = Boolean(LENS_URL);
  if (action === "views" && id) {
    const view = VIEWS.find(v => v.view_id === id);
    if (!view) return json({ error: "View not found" }, { status: 404 });
    return json({ source: "SNAPSHOT", fallback, data: view });
  }
  if (action === "views") {
    return json({ source: "SNAPSHOT", fallback, data: VIEWS });
  }
  if (action === "presets") {
    return json({ source: "SNAPSHOT", fallback, data: PRESETS });
  }
  if (action === "catalog") {
    // Gold DB: enrich / replace embedded CATALOG with real index_constituents
    if (goldEnabled()) {
      try {
        const store = goldStore();
        const goldRows = await store.latest<GoldConstituentRow>("index_constituents");
        if (goldRows.length) {
          const goldEntries = goldRows.map((r) => ({
            series_id: r.ticker,
            ticker: r.ticker,
            display_name: r.name ?? r.ticker,
            asset_class: r.asset_class ?? "EQUITY",
            source: "gold",
            sector: r.sector ?? null,
          }));
          const filtered = q
            ? goldEntries.filter((c) => c.series_id.toUpperCase().includes(q.toUpperCase()) || c.display_name.toUpperCase().includes(q.toUpperCase()))
            : goldEntries;
          return json({ source: "DB", fallback, data: { total: filtered.length, entries: filtered } });
        }
      } catch (err) {
        console.warn("[market-lens] Gold DB catalog read failed:", (err as Error).message);
      }
    }
    const filtered = q
      ? CATALOG.filter(c => c.series_id.toUpperCase().includes(q.toUpperCase()) || c.display_name.toUpperCase().includes(q.toUpperCase()))
      : CATALOG;
    return json({ source: "SNAPSHOT", fallback, data: { total: filtered.length, entries: filtered } });
  }

  return json({ source: "SNAPSHOT", fallback, data: VIEWS });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Try Python backend
    const backendRes = await proxyToBackend("/market-lens/run", "POST", body);
    if (backendRes) {
      const data = await backendRes.json();
      return json({ source: "LIVE", data });
    }

    // Fallback: compute the analysis locally with the deterministic TypeScript
    // engine — same graceful-degradation pattern as /api/market/[view], so the
    // module renders real, configurable analytics with no backend configured.
    const data = await runMarketLens(body);
    return json({ source: "SNAPSHOT", data });
  } catch (e) {
    return json({ error: "Invalid request body" }, { status: 400 });
  }
}
