import { Rng } from "@/lib/rng";

/** Data health, lineage and provider-readiness console. */

export type ProviderStatus = "LIVE" | "CACHED" | "SIM" | "STALE" | "ERROR" | "FALLBACK_AVAILABLE";
export type ProviderName = "FRED" | "YAHOO" | "MACRO_ETL" | "INTELLIGENCE_FEEDS" | "NEWS" | "SOCIAL" | "NEWS_NLP" | "SYNTHETIC" | "LOCAL_BOOK";

export interface ProviderHealth {
  provider: ProviderName;
  status: ProviderStatus;
  coveragePct: number;
  freshnessMin: number;
  seriesCount: number;
  failedSeries: number;
  lastRun: string;
  upgradePath: string;
}

export interface ProviderRun {
  runId: string;
  provider: ProviderName;
  pipeline: "econ_api" | "market_data_pipeline" | "macro_data_etl" | "intelligence_feeds" | "news_feed" | "social_feed" | "news_nlp" | "terminal_fixture";
  started: string;
  completed: string;
  durationMs: number;
  status: "OK" | "PARTIAL" | "FAILED";
  requestedSeries: number;
  successSeries: number;
  failedSeries: number;
  rowsIngested: number;
  rowsRejected: number;
  freshnessMin: number;
  artifact: string;
}

export interface SeriesRunResult {
  runId: string;
  provider: ProviderName;
  seriesId: string;
  dataset: string;
  displayName: string;
  status: "SUCCESS" | "FAILED" | "STALE" | "FALLBACK";
  rows: number;
  asOf: string;
  latencyMs: number;
  message: string;
}

export interface ModuleCoverage {
  module: string;
  functionName: string;
  livePct: number;
  cachedPct: number;
  simPct: number;
  stalePct: number;
  readiness: number;
  blocker: string;
}

export type ModuleDataStatus = "LIVE" | "CACHED" | "SIM" | "STALE";

export interface ModuleDataItem {
  module: string;
  functionName: string;
  itemId: string;
  itemName: string;
  status: ModuleDataStatus;
  provider: ProviderName;
  dataset: string;
  lastRunId: string;
  asOf: string;
  freshnessMin: number;
  rows: number;
  note: string;
}

export interface DataQualityIssue {
  id: string;
  severity: "HIGH" | "MED" | "LOW";
  provider: ProviderName;
  dataset: string;
  check: string;
  detail: string;
  rowsImpacted: number;
  firstSeen: string;
  lastSeen: string;
  owner: string;
  remediation: string;
  sampleRows: string[];
  affectedSeries: string[];
}

export interface LineageRun {
  runId: string;
  source: ProviderName;
  dataset: string;
  rows: number;
  started: string;
  durationMs: number;
  status: "OK" | "PARTIAL" | "FAILED";
  completed: string;
  upstreamRunId: string;
  downstream: string[];
  artifact: string;
  qualityScore: number;
}

export interface DataOpsSummary {
  providersLive: number;
  totalProviders: number;
  averageCoverage: number;
  staleSeries: number;
  qualityIssues: number;
  productionReadyModules: number;
}

export function getProviderHealth(): ProviderHealth[] {
  return [
    // Seed statuses are intentionally NOT "LIVE" — provider liveness is verified
    // at runtime by /api/dataops/health (the DataOps page overlays the real
    // probe and shows UNVERIFIED for any provider the probe hasn't confirmed).
    { provider: "FRED", status: "FALLBACK_AVAILABLE", coveragePct: 88, freshnessMin: 12, seriesCount: 142, failedSeries: 3, lastRun: "2026-06-18 09:10", upgradePath: "Keep as official macro source" },
    { provider: "YAHOO", status: "CACHED", coveragePct: 74, freshnessMin: 64, seriesCount: 96, failedSeries: 8, lastRun: "2026-06-18 08:18", upgradePath: "Replace with Polygon, Tiingo, FactSet or Bloomberg" },
    { provider: "MACRO_ETL", status: "FALLBACK_AVAILABLE", coveragePct: 82, freshnessMin: 180, seriesCount: 44, failedSeries: 2, lastRun: "2026-06-18 06:30", upgradePath: "Add BIS, IMF, CME browser fetch hardening" },
    { provider: "INTELLIGENCE_FEEDS", status: "SIM", coveragePct: 34, freshnessMin: 10, seriesCount: 7, failedSeries: 0, lastRun: "feed-chain probe pending", upgradePath: "Umbrella status for NEWS, SOCIAL, and NEWS_NLP live feed exceptions" },
    { provider: "NEWS", status: "SIM", coveragePct: 30, freshnessMin: 10, seriesCount: 4, failedSeries: 0, lastRun: "provider-chain probe pending", upgradePath: "Set one of ALPHAVANTAGE_API_KEY, MARKETAUX_API_KEY, FINNHUB_API_KEY, NEWSAPI_API_KEY" },
    { provider: "SOCIAL", status: "SIM", coveragePct: 25, freshnessMin: 10, seriesCount: 2, failedSeries: 0, lastRun: "provider-chain probe pending", upgradePath: "Set REDDIT_USER_AGENT or STOCKTWITS_ENABLED=1 / STOCKTWITS_ACCESS_TOKEN" },
    { provider: "NEWS_NLP", status: "SIM", coveragePct: 35, freshnessMin: 6, seriesCount: 12, failedSeries: 0, lastRun: "heuristic fallback", upgradePath: "Run the news_nlp FinBERT service and set NEWS_NLP_URL (else news/social providers + in-house lexicon)" },
    { provider: "LOCAL_BOOK", status: "SIM", coveragePct: 61, freshnessMin: 5, seriesCount: 38, failedSeries: 0, lastRun: "2026-06-18 09:17", upgradePath: "Connect custody, loan, margin and treasury books" },
    { provider: "SYNTHETIC", status: "FALLBACK_AVAILABLE", coveragePct: 100, freshnessMin: 0, seriesCount: 220, failedSeries: 0, lastRun: "deterministic", upgradePath: "Retain as explicit fallback provider; never count as live" },
  ];
}

const PROVIDER_SERIES: Record<ProviderName, { id: string; dataset: string; name: string }[]> = {
  FRED: [
    { id: "DGS10", dataset: "treasury_curve", name: "10-Year Treasury Constant Maturity" },
    { id: "DGS2", dataset: "treasury_curve", name: "2-Year Treasury Constant Maturity" },
    { id: "SOFR", dataset: "secured_rates", name: "Secured Overnight Financing Rate" },
    { id: "DFF", dataset: "policy_rates", name: "Effective Fed Funds Rate" },
    { id: "BAMLH0A0HYM2", dataset: "credit_spreads", name: "US HY OAS" },
    { id: "BAMLC0A4CBBB", dataset: "credit_spreads", name: "BBB OAS" },
    { id: "CPIAUCSL", dataset: "inflation", name: "Headline CPI" },
    { id: "PCEPILFE", dataset: "inflation", name: "Core PCE" },
    { id: "PAYEMS", dataset: "labor", name: "Nonfarm Payrolls" },
    { id: "RRPONTSYD", dataset: "liquidity", name: "Overnight Reverse Repo" },
  ],
  YAHOO: [
    { id: "SPY", dataset: "market_prices", name: "S&P 500 ETF" },
    { id: "QQQ", dataset: "market_prices", name: "Nasdaq 100 ETF" },
    { id: "IWM", dataset: "market_prices", name: "Russell 2000 ETF" },
    { id: "TLT", dataset: "market_prices", name: "20+ Year Treasury ETF" },
    { id: "HYG", dataset: "market_prices", name: "High Yield ETF" },
    { id: "LQD", dataset: "market_prices", name: "Investment Grade ETF" },
    { id: "GLD", dataset: "market_prices", name: "Gold ETF" },
    { id: "USO", dataset: "market_prices", name: "Crude Oil ETF" },
    { id: "UUP", dataset: "market_prices", name: "US Dollar ETF" },
    { id: "VIXY", dataset: "market_prices", name: "VIX Futures ETF" },
  ],
  MACRO_ETL: [
    { id: "country_macro_latest", dataset: "gold_macro", name: "Country Macro Latest" },
    { id: "inflation_timeseries", dataset: "gold_macro", name: "Global Inflation Timeseries" },
    { id: "policy_rate_timeseries", dataset: "gold_macro", name: "Policy Rate Timeseries" },
    { id: "real_rates", dataset: "gold_macro", name: "Real Rates" },
    { id: "fed_probabilities", dataset: "fedwatch", name: "FOMC Probability Ladder" },
    { id: "fed_probability_vintages", dataset: "fedwatch", name: "FedWatch Vintage Snapshots" },
  ],
  INTELLIGENCE_FEEDS: [
    { id: "news_feed", dataset: "intelligence_feeds", name: "NEWS Provider Chain" },
    { id: "social_feed", dataset: "intelligence_feeds", name: "SOCIAL Provider Chain" },
    { id: "news_nlp", dataset: "intelligence_feeds", name: "NEWS_NLP Service" },
  ],
  NEWS: [
    { id: "alpha_vantage_news", dataset: "provider_chain", name: "Alpha Vantage NEWS_SENTIMENT" },
    { id: "marketaux_news", dataset: "provider_chain", name: "Marketaux Financial News" },
    { id: "finnhub_news", dataset: "provider_chain", name: "Finnhub Market News" },
    { id: "newsapi_business", dataset: "provider_chain", name: "NewsAPI Business Headlines" },
  ],
  SOCIAL: [
    { id: "reddit_social", dataset: "social_provider_chain", name: "Reddit Market Subreddits" },
    { id: "stocktwits_social", dataset: "social_provider_chain", name: "StockTwits Trending Symbols" },
  ],
  LOCAL_BOOK: [
    { id: "collateral_assets", dataset: "desk_books", name: "Collateral Asset Schedule" },
    { id: "margin_calls", dataset: "desk_books", name: "Margin Call Book" },
    { id: "cash_sources", dataset: "desk_books", name: "Cash Sources" },
    { id: "cash_uses", dataset: "desk_books", name: "Cash Uses" },
    { id: "loan_book", dataset: "desk_books", name: "Securities Lending Loan Book" },
    { id: "reinvestment_positions", dataset: "desk_books", name: "Cash Reinvestment Positions" },
  ],
  NEWS_NLP: [
    { id: "news_scored", dataset: "silver_nlp", name: "Headline Sentiment (FinBERT)" },
    { id: "news_entities", dataset: "silver_nlp", name: "Entity / Ticker Extraction" },
    { id: "news_clusters", dataset: "gold_nlp", name: "Event Clusters" },
    { id: "social_sentiment", dataset: "silver_nlp", name: "Reddit / StockTwits Sentiment" },
  ],
  SYNTHETIC: [
    { id: "demo_universe", dataset: "fallback_generators", name: "Demo Security Universe" },
    { id: "demo_books", dataset: "fallback_generators", name: "Demo Desk Books" },
    { id: "demo_macro", dataset: "fallback_generators", name: "Demo Macro Series" },
    { id: "demo_optimization", dataset: "fallback_generators", name: "Demo Optimization Runs" },
    { id: "demo_alerts", dataset: "fallback_generators", name: "Demo Alerts" },
  ],
};

export function getProviderRuns(): ProviderRun[] {
  const rng = new Rng("dataops-provider-runs");
  const defs: { provider: ProviderName; pipeline: ProviderRun["pipeline"]; runs: number; base: number; partialEvery?: number; failedEvery?: number }[] = [
    { provider: "FRED", pipeline: "econ_api", runs: 5, base: 9100, partialEvery: 4 },
    { provider: "YAHOO", pipeline: "market_data_pipeline", runs: 6, base: 9050, partialEvery: 2 },
    { provider: "MACRO_ETL", pipeline: "macro_data_etl", runs: 5, base: 9000, partialEvery: 3 },
    { provider: "INTELLIGENCE_FEEDS", pipeline: "intelligence_feeds", runs: 4, base: 8992 },
    { provider: "NEWS", pipeline: "news_feed", runs: 4, base: 8988 },
    { provider: "SOCIAL", pipeline: "social_feed", runs: 4, base: 8982 },
    { provider: "NEWS_NLP", pipeline: "news_nlp", runs: 4, base: 8975 },
    { provider: "LOCAL_BOOK", pipeline: "terminal_fixture", runs: 4, base: 8950 },
    { provider: "SYNTHETIC", pipeline: "terminal_fixture", runs: 4, base: 8900 },
  ];

  return defs.flatMap((d, providerIdx) =>
    Array.from({ length: d.runs }, (_, i) => {
      const requestedSeries = PROVIDER_SERIES[d.provider].length + rng.int(12, 38);
      const failedSeries = d.failedEvery && (i + 1) % d.failedEvery === 0 ? rng.int(3, 8) : d.partialEvery && (i + 1) % d.partialEvery === 0 ? rng.int(1, 4) : d.provider === "YAHOO" && i === 0 ? 8 : d.provider === "FRED" && i === 0 ? 3 : 0;
      const status: ProviderRun["status"] = failedSeries >= 6 ? "FAILED" : failedSeries > 0 ? "PARTIAL" : "OK";
      const startedHour = 9 - Math.min(i + providerIdx, 7);
      const minute = 8 + providerIdx * 6 + i * 5;
      const started = `2026-06-18 ${String(startedHour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const durationMs = rng.int(320, 8200);
      return {
        runId: `RUN-${d.base - i}`,
        provider: d.provider,
        pipeline: d.pipeline,
        started,
        completed: `2026-06-18 ${String(startedHour).padStart(2, "0")}:${String((minute + Math.ceil(durationMs / 1000 / 60)) % 60).padStart(2, "0")}`,
        durationMs,
        status,
        requestedSeries,
        successSeries: requestedSeries - failedSeries,
        failedSeries,
        rowsIngested: rng.int(900, 52000),
        rowsRejected: failedSeries ? rng.int(1, 160) : 0,
        freshnessMin: i * 55 + providerIdx * 9,
        artifact: `/data/${d.pipeline}/manifest/${d.provider.toLowerCase()}_${d.base - i}.json`,
      };
    })
  );
}

export function getSeriesRunResults(): SeriesRunResult[] {
  const rng = new Rng("dataops-series-results");
  const runs = getProviderRuns();
  return runs.flatMap((run) => {
    const base = PROVIDER_SERIES[run.provider];
    const expanded = [
      ...base,
      ...Array.from({ length: Math.max(0, Math.min(12, run.requestedSeries - base.length)) }, (_, i) => ({
        id: `${run.provider.slice(0, 3)}_${String(i + 1).padStart(3, "0")}`,
        dataset: base[i % base.length]?.dataset ?? "dataset",
        name: `${run.provider} adapter series ${i + 1}`,
      })),
    ];
    return expanded.map((s, i) => {
      const isFailed = i < run.failedSeries;
      const isFallback = !isFailed && run.provider === "SYNTHETIC";
      const stale = !isFailed && run.provider === "YAHOO" && run.status === "PARTIAL" && i % 5 === 0;
      return {
        runId: run.runId,
        provider: run.provider,
        seriesId: s.id,
        dataset: s.dataset,
        displayName: s.name,
        status: isFailed ? "FAILED" : stale ? "STALE" : isFallback ? "FALLBACK" : "SUCCESS",
        rows: isFailed ? 0 : rng.int(24, 6000),
        asOf: run.started.slice(0, 10),
        latencyMs: rng.int(40, 1800),
        message: isFailed
          ? run.provider === "YAHOO"
            ? "HTTP/cache miss after retry; retained prior snapshot"
            : run.provider === "FRED"
              ? "Missing observation in requested vintage window"
              : "Connector returned empty frame"
          : stale
            ? "Older than expected cache window"
            : isFallback
              ? "Deterministic fallback generated by design"
              : "Loaded and quality-checked",
      };
    });
  });
}

export function getModuleCoverage(): ModuleCoverage[] {
  return [
    { module: "HOME", functionName: "Command Center", livePct: 52, cachedPct: 18, simPct: 30, stalePct: 0, readiness: 72, blocker: "Needs persisted cross-desk KPI feed" },
    { module: "MKT", functionName: "Live Markets", livePct: 34, cachedPct: 42, simPct: 20, stalePct: 4, readiness: 61, blocker: "Yahoo cache is snapshot-backed" },
    { module: "SNAP", functionName: "Market Snapshot", livePct: 18, cachedPct: 58, simPct: 20, stalePct: 4, readiness: 60, blocker: "Run market_data_pipeline live service" },
    { module: "SLAB", functionName: "Securities Lending", livePct: 18, cachedPct: 20, simPct: 62, stalePct: 0, readiness: 48, blocker: "Loanet/EquiLend/DataLend rate feed" },
    { module: "PB", functionName: "Prime Finance", livePct: 22, cachedPct: 16, simPct: 62, stalePct: 0, readiness: 50, blocker: "Client financing and exposure books" },
    { module: "COLL", functionName: "Collateral Management", livePct: 28, cachedPct: 10, simPct: 58, stalePct: 4, readiness: 55, blocker: "Eligibility schedules and collateral pricing" },
    { module: "CASH", functionName: "Cash Optimizer", livePct: 34, cachedPct: 14, simPct: 48, stalePct: 4, readiness: 59, blocker: "Treasury source/use book" },
    { module: "REINV", functionName: "Cash Collateral Reinvestment", livePct: 36, cachedPct: 24, simPct: 40, stalePct: 0, readiness: 64, blocker: "Actual cash ladder and MMF/repo positions" },
    { module: "LIQ", functionName: "Liquidity & Funding Stress", livePct: 32, cachedPct: 12, simPct: 52, stalePct: 4, readiness: 58, blocker: "Treasury liquidity and margin forecast feed" },
    { module: "SXU", functionName: "Sources & Uses", livePct: 24, cachedPct: 12, simPct: 64, stalePct: 0, readiness: 49, blocker: "Internal inventory and borrow demand feed" },
    { module: "OPT", functionName: "Optimization Center", livePct: 12, cachedPct: 8, simPct: 80, stalePct: 0, readiness: 42, blocker: "Real solver service and persisted runs" },
    { module: "DESK", functionName: "Trading Desk", livePct: 20, cachedPct: 18, simPct: 62, stalePct: 0, readiness: 51, blocker: "Execution and trader scorecard source" },
    { module: "ECON", functionName: "Macro Dashboard", livePct: 86, cachedPct: 8, simPct: 6, stalePct: 0, readiness: 91, blocker: "None" },
    { module: "CURV", functionName: "Treasury Curve Lab", livePct: 90, cachedPct: 6, simPct: 4, stalePct: 0, readiness: 93, blocker: "None" },
    { module: "INFL", functionName: "Inflation Explorer", livePct: 84, cachedPct: 8, simPct: 8, stalePct: 0, readiness: 89, blocker: "Some item-level CPI fallback ids" },
    { module: "GCPI", functionName: "Global Inflation", livePct: 62, cachedPct: 24, simPct: 14, stalePct: 0, readiness: 77, blocker: "Country gaps need ETL refresh" },
    { module: "GPOL", functionName: "Global Policy Rates", livePct: 58, cachedPct: 24, simPct: 18, stalePct: 0, readiness: 74, blocker: "BIS/OECD coverage gaps" },
    { module: "CRDT", functionName: "Credit Spreads", livePct: 82, cachedPct: 10, simPct: 8, stalePct: 0, readiness: 87, blocker: "Counterparty overlay remains local" },
    { module: "FOMC", functionName: "Rate Probabilities", livePct: 0, cachedPct: 72, simPct: 28, stalePct: 0, readiness: 63, blocker: "CME feed using deterministic fallback" },
    { module: "CAL", functionName: "Economic Calendar", livePct: 76, cachedPct: 10, simPct: 14, stalePct: 0, readiness: 82, blocker: "Consensus/actual vendor feed" },
    { module: "STAT", functionName: "Statistical Analysis", livePct: 82, cachedPct: 12, simPct: 6, stalePct: 0, readiness: 88, blocker: "None" },
    { module: "REGIME", functionName: "Macro Regime Playbook", livePct: 62, cachedPct: 22, simPct: 16, stalePct: 0, readiness: 76, blocker: "Backtest and saved playbook overrides" },
    { module: "EML", functionName: "ML Applications", livePct: 26, cachedPct: 16, simPct: 58, stalePct: 0, readiness: 53, blocker: "Model training registry and feature store" },
    { module: "SFE", functionName: "Sec-Finance Economics", livePct: 44, cachedPct: 18, simPct: 38, stalePct: 0, readiness: 68, blocker: "Repo GC and specials vendor feed" },
    { module: "AI", functionName: "AI Copilot", livePct: 30, cachedPct: 20, simPct: 50, stalePct: 0, readiness: 57, blocker: "RAG index over real datasets" },
    { module: "DATAOPS", functionName: "Data Ops", livePct: 48, cachedPct: 28, simPct: 24, stalePct: 0, readiness: 71, blocker: "Wire to persisted manifests" },
    { module: "ALRT", functionName: "Alert Center", livePct: 36, cachedPct: 18, simPct: 46, stalePct: 0, readiness: 62, blocker: "Streaming rules and alert persistence" },
  ];
}

const MODULE_ITEM_NAMES: Record<string, string[]> = {
  HOME: ["Revenue KPI", "Utilization KPI", "Alert Stream", "Desk Heat Map", "Launchpad State", "Funding Pulse"],
  MKT: ["Equity Quotes", "ETF Quotes", "Fixed Income Proxies", "FX Proxies", "Commodity Proxies", "Volatility Proxies"],
  SNAP: ["Market Snapshot Cards", "Cross-Asset Returns", "Rates Dashboard", "Inflation Dashboard", "Regime Scores", "Best/Worst YTD"],
  SLAB: ["Inventory", "Loan Book", "Borrow Demand", "HTB Flags", "Revenue Waterfall", "Borrower Ranking"],
  PB: ["Client Exposures", "Financing Balances", "RoA Analytics", "Stress Scenarios", "Opportunity Queue", "VaR Inputs"],
  COLL: ["Margin Calls", "Collateral Assets", "Eligibility Rules", "Haircuts", "Concentration Limits", "Optimization Inputs"],
  CASH: ["Funding Sources", "Funding Uses", "Intraday Liquidity", "LCR Inputs", "NSFR Inputs", "Cheapest Funding Path"],
  REINV: ["Reinvestment Positions", "Tenor Ladder", "MMF Buckets", "Repo Buckets", "Fed Beta", "Policy Path Sensitivity"],
  LIQ: ["Stress Buckets", "Facilities", "Outflow Forecast", "Liquidity Signals", "Desk Heat Map", "Escalation Queue"],
  SXU: ["Source Nodes", "Use Nodes", "Internalization Edges", "Savings Estimates", "Allocation Heat Map", "Constraint Flags"],
  OPT: ["Solver Runs", "Dual Values", "Recommended Trades", "Constraint Matrix", "Before/After Allocation", "Runtime Metrics"],
  DESK: ["Trader Scorecards", "Execution Analytics", "Risk Analytics", "Position Concentration", "Slippage Inputs", "Fill Rates"],
  ECON: ["Headline Indicators", "Surprise Index", "Breadth", "Series Explorer", "Category Aggregates", "FRED History"],
  CURV: ["Treasury Tenors", "Curve Snapshots", "Spread Timeline", "Inversion History", "Term Funding Carry", "Scenario Overlays"],
  INFL: ["CPI Basket", "Core CPI", "PCE Basket", "Core PCE", "Contribution Waterfall", "Item Drilldowns"],
  GCPI: ["Country CPI", "Region Heat Map", "Trend Streaks", "Target Gaps", "ETL Snapshot", "Fallback Countries"],
  GPOL: ["Policy Rates", "Real Rates", "Central Bank Meetings", "Rate Cycles", "BIS/OECD Rows", "Fallback Countries"],
  CRDT: ["IG OAS", "HY OAS", "Rating Curve", "Sector Spreads", "Haircut Overlay", "Counterparty Overlay"],
  FOMC: ["FedWatch Probabilities", "Implied Path", "Policy Path Evolution", "Dot Plot", "Scenario Transmission", "Vintage Snapshot"],
  CAL: ["Release Dates", "Consensus", "Actuals", "Importance Tags", "Desk Sensitivities", "Pre/Post Moves"],
  STAT: ["FRED Series Window", "Correlation Matrix", "Granger Tests", "OLS Regression", "ADF Tests", "Study Packs"],
  REGIME: ["Growth Factor", "Inflation Factor", "Liquidity Factor", "Credit Factor", "Policy Factor", "Desk Playbooks"],
  EML: ["Recession Probit", "Inflation Nowcast", "Rate Path Model", "Regime HMM", "Feature Importance", "Model Registry"],
  SFE: ["Repo Complex", "Rate Sensitivities", "P&L Bridge", "Scenario Library", "Cash Reinvestment Link", "Macro Factor Links"],
  AI: ["Prompt Context", "Dataset Index", "Narrative Generator", "Recommendation Engine", "Chart Summaries", "Action Log"],
  DATAOPS: ["Provider Health", "Provider Runs", "Series Outcomes", "Quality Exceptions", "Lineage Runs", "Readiness Scores"],
  ALRT: ["Risk Alerts", "Ops Alerts", "Rules Engine", "Severity Filters", "Acknowledgements", "Streaming State"],
};

const STATUS_PROVIDERS: Record<ModuleDataStatus, ProviderName[]> = {
  LIVE: ["FRED", "MACRO_ETL", "SYNTHETIC"],
  CACHED: ["YAHOO", "MACRO_ETL", "FRED"],
  SIM: ["SYNTHETIC", "LOCAL_BOOK"],
  STALE: ["YAHOO", "FRED", "LOCAL_BOOK"],
};

function statusBuckets(m: ModuleCoverage): ModuleDataStatus[] {
  const total = 12;
  const raw: [ModuleDataStatus, number][] = [
    ["LIVE", m.livePct],
    ["CACHED", m.cachedPct],
    ["SIM", m.simPct],
    ["STALE", m.stalePct],
  ];
  const counts = raw.map(([status, pct]) => ({ status, count: Math.floor((pct / 100) * total), pct }));
  let remaining = total - counts.reduce((a, c) => a + c.count, 0);
  counts
    .map((c) => ({ ...c, frac: (c.pct / 100) * total - c.count }))
    .sort((a, b) => b.frac - a.frac)
    .forEach((c) => {
      if (remaining > 0) {
        const target = counts.find((x) => x.status === c.status);
        if (target) target.count += 1;
        remaining -= 1;
      }
    });
  return counts.flatMap((c) => Array.from({ length: c.count }, () => c.status));
}

export function getModuleDataItems(): ModuleDataItem[] {
  const rng = new Rng("dataops-module-items");
  return getModuleCoverage().flatMap((m) => {
    const names = MODULE_ITEM_NAMES[m.module] ?? [m.functionName];
    return statusBuckets(m).map((status, i) => {
      const providerChoices = STATUS_PROVIDERS[status];
      const provider = providerChoices[i % providerChoices.length];
      const name = names[i % names.length];
      const dataset = `${m.module.toLowerCase()}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
      return {
        module: m.module,
        functionName: m.functionName,
        itemId: `${m.module}-${String(i + 1).padStart(2, "0")}`,
        itemName: name,
        status,
        provider,
        dataset,
        lastRunId: provider === "YAHOO" ? "RUN-9050" : provider === "FRED" ? "RUN-9100" : provider === "MACRO_ETL" ? "RUN-9000" : provider === "LOCAL_BOOK" ? "RUN-8950" : "RUN-8900",
        asOf: status === "SIM" ? "deterministic" : "2026-06-18",
        freshnessMin: status === "LIVE" ? rng.int(0, 30) : status === "CACHED" ? rng.int(35, 240) : status === "STALE" ? rng.int(360, 1440) : 0,
        rows: status === "SIM" ? rng.int(20, 800) : rng.int(120, 24000),
        note:
          status === "LIVE"
            ? "Connected to current provider path"
            : status === "CACHED"
              ? "Using committed snapshot or adapter cache"
              : status === "STALE"
                ? "Outside freshness SLA; previous value retained"
                : "Deterministic fallback until source is wired",
      };
    });
  });
}

export function getDataQualityIssues(): DataQualityIssue[] {
  return [
    { id: "DQ-401", severity: "HIGH", provider: "YAHOO", dataset: "market_prices", check: "stale close", detail: "Seven ETF proxies are older than expected cache window.", rowsImpacted: 7, firstSeen: "2026-06-18 08:18", lastSeen: "2026-06-18 09:07", owner: "Market Data", remediation: "Refresh Yahoo adapter or switch snapshot to licensed EOD vendor.", sampleRows: ["TLT close as-of 2026-06-18 retained from cache", "HYG close exceeded 45m freshness SLA", "UUP retry exhausted after cache lookup"], affectedSeries: ["TLT", "HYG", "LQD", "UUP", "VIXY", "EEM", "VGK"] },
    { id: "DQ-402", severity: "MED", provider: "FRED", dataset: "credit_spreads", check: "missing observation", detail: "HY OAS has one missing print in the 20y window.", rowsImpacted: 1, firstSeen: "2026-06-18 09:10", lastSeen: "2026-06-18 09:10", owner: "Macro Data", remediation: "Backfill missing vintage or interpolate only for visual continuity.", sampleRows: ["BAMLH0A0HYM2 2026-06-17 null observation"], affectedSeries: ["BAMLH0A0HYM2"] },
    { id: "DQ-403", severity: "MED", provider: "LOCAL_BOOK", dataset: "collateral_assets", check: "synthetic source", detail: "Collateral schedules are fixture generated.", rowsImpacted: 42, firstSeen: "2026-06-18 09:17", lastSeen: "2026-06-18 09:17", owner: "Collateral Ops", remediation: "Map eligibility, concentration, and haircut schedules from collateral system.", sampleRows: ["UST_10Y schedule generated", "AGENCY_MBS eligibility generated", "EQUITY_ETF haircut generated"], affectedSeries: ["collateral_assets", "eligibility_rules", "haircut_schedules"] },
    { id: "DQ-404", severity: "LOW", provider: "MACRO_ETL", dataset: "fed_probabilities", check: "fallback curve", detail: "CME live settlements unavailable; deterministic futures curve used.", rowsImpacted: 6, firstSeen: "2026-06-18 06:30", lastSeen: "2026-06-18 06:30", owner: "Macro ETL", remediation: "Use browser-capable fetcher, licensed settlement file, or CME data agreement.", sampleRows: ["2026-07-29 price_source=sim", "2026-09-16 price_source=sim"], affectedSeries: ["fed_probabilities", "fed_probability_vintages"] },
    { id: "DQ-405", severity: "LOW", provider: "SYNTHETIC", dataset: "demo_books", check: "expected fallback", detail: "Offline fallback active for non-public desk books.", rowsImpacted: 220, firstSeen: "deterministic", lastSeen: "deterministic", owner: "Demo Runtime", remediation: "Retain as visible fallback until internal books are connected.", sampleRows: ["loan_book generated", "margin_calls generated", "optimization_runs generated"], affectedSeries: ["demo_books", "demo_optimization", "demo_alerts"] },
  ];
}

export function getLineageRuns(): LineageRun[] {
  const rng = new Rng("dataops-lineage");
  const defs: [ProviderName, string, LineageRun["status"], string[]][] = [
    ["FRED", "series_observations", "OK", ["ECON", "CURV", "CRDT", "STAT"]],
    ["YAHOO", "chart_daily", "PARTIAL", ["MKT", "SNAP", "REGIME"]],
    ["MACRO_ETL", "fed_probabilities", "OK", ["FOMC", "SFE", "REINV"]],
    ["MACRO_ETL", "policy_rates", "OK", ["GPOL", "GCPI"]],
    ["LOCAL_BOOK", "desk_books_fixture", "OK", ["COLL", "CASH", "LIQ", "OPT"]],
    ["SYNTHETIC", "fallback_generators", "OK", ["HOME", "SLAB", "PB", "DESK", "ALRT"]],
  ];
  return Array.from({ length: 7 }, (_, batch) =>
    defs.map(([source, dataset, status, downstream], i) => {
      const durationMs = rng.int(80, 4200);
      const hour = 9 - Math.min(batch, 8);
      const started = `2026-06-18 ${String(hour).padStart(2, "0")}:${String(12 + i * 7).padStart(2, "0")}`;
      const runStatus = batch % 5 === 4 && source === "YAHOO" ? "FAILED" : batch % 3 === 1 && source === "FRED" ? "PARTIAL" : status;
      return {
        runId: `RUN-${7800 - batch * 10 - i}`,
        source,
        dataset,
        rows: rng.int(180, 18000),
        started,
        completed: `2026-06-18 ${String(hour).padStart(2, "0")}:${String(13 + i * 7).padStart(2, "0")}`,
        durationMs,
        status: runStatus,
        upstreamRunId: `${source}-${dataset}-${7800 - batch * 10 - i}`,
        downstream,
        artifact: `/data/lineage/${source.toLowerCase()}_${dataset}_${7800 - batch * 10 - i}.json`,
        qualityScore: runStatus === "OK" ? rng.int(94, 100) : runStatus === "PARTIAL" ? rng.int(78, 91) : rng.int(34, 64),
      };
    })
  ).flat();
}

export function getDataOpsSummary(): DataOpsSummary {
  const providers = getProviderHealth();
  const modules = getModuleCoverage();
  const issues = getDataQualityIssues();
  return {
    providersLive: providers.filter((p) => p.status === "LIVE").length,
    totalProviders: providers.length,
    averageCoverage: providers.reduce((a, p) => a + p.coveragePct, 0) / providers.length,
    staleSeries: providers.reduce((a, p) => a + p.failedSeries, 0),
    qualityIssues: issues.filter((i) => i.severity !== "LOW").length,
    productionReadyModules: modules.filter((m) => m.readiness >= 75).length,
  };
}
