import {
  Activity,
  LayoutDashboard,
  Landmark,
  Briefcase,
  Layers,
  Wallet,
  GitMerge,
  Cpu,
  LineChart,
  Bot,
  BellRing,
  Globe,
  Spline,
  Percent,
  CalendarClock,
  Sigma,
  BrainCircuit,
  Banknote,
  Flame,
  Globe2,
  Gavel,
  SquareStack,
  Gauge,
  Telescope,
  CandlestickChart,
  AreaChart,
  Clapperboard,
  Newspaper,
  Droplets,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { isModuleEnabled } from "@/lib/moduleConfig";

export interface NavItem {
  /** Bloomberg-style mnemonic command, e.g. "SLAB". */
  code: string;
  label: string;
  href: string;
  icon: LucideIcon;
  desc: string;
  group: "MARKETS" | "FINANCE" | "OPTIMIZATION" | "DESK" | "TRADING_ASSISTANT" | "ECONOMICS" | "INTELLIGENCE";
}

const ALL_NAV: NavItem[] = [
  { code: "HOME", label: "Command Center", href: "/", icon: LayoutDashboard, desc: "Cross-desk overview & KPIs", group: "MARKETS" },
  { code: "MKT", label: "Live Markets", href: "/markets", icon: Activity, desc: "Real-time multi-asset monitor", group: "MARKETS" },
  { code: "SNAP", label: "Market Snapshot", href: "/market-snapshot", icon: Gauge, desc: "Cross-asset returns, drawdowns & regime", group: "MARKETS" },
  { code: "QUILT", label: "Asset Quilt", href: "/asset-quilt", icon: SquareStack, desc: "Annual asset-class return rankings", group: "MARKETS" },
  { code: "IRET", label: "Index Returns", href: "/index-returns", icon: LineChart, desc: "Monthly index returns & drawdowns", group: "MARKETS" },
  { code: "LENS", label: "Market Lens Studio", href: "/market-lens", icon: Telescope, desc: "Configurable analytics workspace", group: "MARKETS" },
  { code: "MKC", label: "Market Chart Studio", href: "/market-chart", icon: CandlestickChart, desc: "Freeform technical market charting", group: "MARKETS" },
  { code: "MVOL", label: "Market Volatility", href: "/market-volatility", icon: Activity, desc: "VIX claim audits & volatility regimes", group: "MARKETS" },
  { code: "SLAB", label: "Securities Lending", href: "/securities-lending", icon: Landmark, desc: "Inventory, loan book & revenue", group: "FINANCE" },
  { code: "SQZ", label: "Squeeze Radar", href: "/securities-lending/squeeze", icon: Flame, desc: "Borrow demand, heat score & squeeze risk", group: "FINANCE" },
  { code: "PB", label: "Prime Finance", href: "/prime-finance", icon: Briefcase, desc: "Hedge fund financing & risk", group: "FINANCE" },
  { code: "COLL", label: "Collateral Mgmt", href: "/collateral", icon: Layers, desc: "Margin & collateral optimization", group: "OPTIMIZATION" },
  { code: "CASH", label: "Cash Optimizer", href: "/cash-optimizer", icon: Wallet, desc: "Treasury funding optimization", group: "OPTIMIZATION" },
  { code: "REINV", label: "Cash Reinvestment", href: "/reinvestment", icon: Banknote, desc: "Cash collateral yield ladder", group: "OPTIMIZATION" },
  { code: "LIQ", label: "Liquidity Stress", href: "/liquidity", icon: Wallet, desc: "Funding stress and survival ladder", group: "OPTIMIZATION" },
  { code: "SXU", label: "Sources & Uses", href: "/sources-uses", icon: GitMerge, desc: "Matching & internalization engine", group: "OPTIMIZATION" },
  { code: "OPT", label: "Optimization Center", href: "/optimization", icon: Cpu, desc: "Solver runs & impact analysis", group: "OPTIMIZATION" },
  { code: "DESK", label: "Trading Desk", href: "/trading-desk", icon: LineChart, desc: "Scorecards & execution analytics", group: "DESK" },
  { code: "TASSIST", label: "Trading Assistant", href: "/trading-assistant", icon: Bot, desc: "Bot selector, signals & paper trading", group: "TRADING_ASSISTANT" },
  { code: "ECON", label: "Macro Dashboard", href: "/economics", icon: Globe, desc: "FRED-connected economic analytics", group: "ECONOMICS" },
  { code: "CURV", label: "Treasury Curve Lab", href: "/economics/curve", icon: Spline, desc: "Curve shape, history & inversions", group: "ECONOMICS" },
  { code: "INFL", label: "Inflation Explorer", href: "/economics/inflation", icon: Flame, desc: "CPI/PCE to item level, MoM & YoY", group: "ECONOMICS" },
  { code: "GCPI", label: "Global Inflation", href: "/economics/global-cpi", icon: Globe2, desc: "CPI by country, trend & streaks", group: "ECONOMICS" },
  { code: "GPOL", label: "Global Policy Rates", href: "/economics/policy-rates", icon: Gavel, desc: "Central-bank rates & cycles", group: "ECONOMICS" },
  { code: "CRDT", label: "Credit Spreads", href: "/economics/credit", icon: SquareStack, desc: "IG/HY OAS deep dive & stress", group: "ECONOMICS" },
  { code: "FOMC", label: "Rate Probabilities", href: "/economics/rates", icon: Percent, desc: "Fed path & hike/cut odds", group: "ECONOMICS" },
  { code: "CAL", label: "Economic Calendar", href: "/economics/calendar", icon: CalendarClock, desc: "Releases & events", group: "ECONOMICS" },
  { code: "STAT", label: "Statistical Analysis", href: "/economics/stats", icon: Sigma, desc: "Correlations, regressions, regimes", group: "ECONOMICS" },
  { code: "REGIME", label: "Macro Regime", href: "/economics/regime", icon: BrainCircuit, desc: "Macro states to desk playbooks", group: "ECONOMICS" },
  { code: "EML", label: "ML Applications", href: "/economics/ml", icon: BrainCircuit, desc: "Recession, nowcast & rate models", group: "ECONOMICS" },
  { code: "SFE", label: "Sec-Finance Economics", href: "/economics/sec-finance", icon: Banknote, desc: "Rates → repo, funding & lending", group: "ECONOMICS" },
  { code: "FUND", label: "Funding & Liquidity", href: "/economics/funding", icon: Droplets, desc: "Repo, corridor, balances & funding stress", group: "ECONOMICS" },
  { code: "BMRK", label: "Benchmark Rates", href: "/economics/benchmark", icon: Activity, desc: "Daily rates — trend, status, comparison & regime", group: "ECONOMICS" },
  { code: "BRA", label: "Rate Analysis Hub", href: "/economics/rate-analysis", icon: Activity, desc: "Unified dashboard across all benchmark rate modules", group: "ECONOMICS" },
  { code: "UTIL", label: "Utilization Analytics", href: "/economics/utilization", icon: Gauge, desc: "Lending utilization, benchmark overlays & custom rate blends", group: "ECONOMICS" },
  { code: "YCURV", label: "Yield Curve Analytics", href: "/economics/yield-curve", icon: Spline, desc: "Daily curve shape, slope history & regime shifts", group: "ECONOMICS" },
  { code: "RVOL", label: "Rate Volatility", href: "/economics/rate-vol", icon: Activity, desc: "Realized vol surface, vol regimes & vol-of-vol", group: "ECONOMICS" },
  { code: "FCOST", label: "Funding Cost Monitor", href: "/economics/funding-cost", icon: Banknote, desc: "Blended borrowing costs by tier & desk attribution", group: "ECONOMICS" },
  { code: "MGC", label: "Macro Chart Studio", href: "/macro-chart", icon: AreaChart, desc: "Freeform economic & macro charting", group: "ECONOMICS" },
  { code: "EDA", label: "EDA / Lead-Lag", href: "/economics/eda", icon: Activity, desc: "Cross-correlation, Granger causality & regime breaks", group: "ECONOMICS" },
  { code: "MOTN", label: "Macro Motion Studio", href: "/economics/motion", icon: Clapperboard, desc: "Animate economic series over time", group: "ECONOMICS" },
  { code: "POLY", label: "Prediction Markets", href: "/polymarket", icon: TrendingUp, desc: "Event contract odds & probability curves", group: "INTELLIGENCE" },
  { code: "NEWS", label: "News & Signal Intel", href: "/news", icon: Newspaper, desc: "Market news, social & signal engine", group: "INTELLIGENCE" },
  { code: "SENT", label: "Investor Sentiment", href: "/sentiment", icon: Gauge, desc: "Survey + social fear/greed & positioning", group: "INTELLIGENCE" },
  { code: "AI", label: "AI Copilot", href: "/copilot", icon: Bot, desc: "Natural-language intelligence", group: "INTELLIGENCE" },
  { code: "DATAOPS", label: "Data Ops", href: "/dataops", icon: Cpu, desc: "Provider health and lineage", group: "INTELLIGENCE" },
  { code: "ALRT", label: "Alert Center", href: "/alerts", icon: BellRing, desc: "Streaming risk & ops alerts", group: "INTELLIGENCE" },
];

export const NAV: NavItem[] = ALL_NAV.filter((n) => isModuleEnabled(n.code));

export const NAV_GROUPS: { id: NavItem["group"]; label: string }[] = [
  { id: "MARKETS", label: "Markets" },
  { id: "FINANCE", label: "Financing" },
  { id: "OPTIMIZATION", label: "Optimization" },
  { id: "DESK", label: "Trading Desk" },
  { id: "TRADING_ASSISTANT", label: "Trading Assistant" },
  { id: "ECONOMICS", label: "Economics & Macro" },
  { id: "INTELLIGENCE", label: "Intelligence" },
];
