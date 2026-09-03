import type {
  CommandCenterCatalyst,
  CommandCenterMetric,
  CommandCenterPayload,
  CommandCenterReturnHorizon,
} from "@/lib/commandCenter";

export type MarketPublishingSource = "DB" | "ERR";
export type MarketPublishingWorkspace = "Today" | "Chart Queue" | "Market Derbies" | "Macro And Volatility" | "Publish" | "Archive";
export type MarketPublishingPackageType =
  | "pre_market"
  | "post_release"
  | "market_close"
  | "weekend_week_in_markets"
  | "monthly_state_of_markets"
  | "quarterly_market_guide";
export type MarketPublishingCandidateStatus = "ready" | "unavailable";
export type MarketPublishingTemplateId =
  | "daily_scoreboard"
  | "market_derby"
  | "curve_watch"
  | "vol_credit_watch"
  | "macro_week_ahead"
  | "reserve_vix_claim_audit"
  | "earnings_valuation_gate"
  | "category_breadth"
  | "credit_stress"
  | "funding_stress"
  | "curve_regime";

export interface MarketPublishingCitation {
  source: "FRED/Economic Gold SQLite";
  seriesIds: string[];
  goldTables: string[];
  observationAsOf: string | null;
  transform: string;
  basis: string;
}

/** One component of a candidate's score, per spec004's Editorial Ranking contract — every score must be reproducible from its cited table/column/threshold. */
export interface MarketPublishingScoreBreakdown {
  component: string;
  value: number;
  goldTable: string;
  goldColumn: string;
  threshold: string;
}

export interface MarketPublishingCandidate {
  id: string;
  templateId: MarketPublishingTemplateId;
  title: string;
  summary: string;
  status: MarketPublishingCandidateStatus;
  score: number;
  workspace: MarketPublishingWorkspace;
  packageTypes: MarketPublishingPackageType[];
  source: MarketPublishingSource;
  dataAsOf: string | null;
  seriesIds: string[];
  citation: MarketPublishingCitation | null;
  unavailableReason?: string;
  warnings: string[];
  /** Present for detector-produced candidates (spec006); absent for the fixed template checklist above. */
  scoreBreakdown?: MarketPublishingScoreBreakdown[];
}

export interface MarketPublishingPackageDefinition {
  type: MarketPublishingPackageType;
  label: string;
  cadence: string;
  defaultCutoff: string;
  status: "draftable" | "partial" | "blocked";
  requiredTemplateIds: MarketPublishingTemplateId[];
  unavailableReason?: string;
}

export interface MarketPublishingDailyPayload {
  source: MarketPublishingSource;
  asOf: string | null;
  generatedAt: string;
  commandCenter: CommandCenterPayload;
  workspaces: MarketPublishingWorkspace[];
  packages: MarketPublishingPackageDefinition[];
  warnings: string[];
  error?: string;
}

export interface MarketPublishingCandidatesPayload {
  source: MarketPublishingSource;
  asOf: string | null;
  generatedAt: string;
  candidates: MarketPublishingCandidate[];
  warnings: string[];
  error?: string;
}

const WORKSPACES: MarketPublishingWorkspace[] = [
  "Today",
  "Chart Queue",
  "Market Derbies",
  "Macro And Volatility",
  "Publish",
  "Archive",
];

const PACKAGES: MarketPublishingPackageDefinition[] = [
  {
    type: "pre_market",
    label: "Pre-Market Brief",
    cadence: "US business days before open",
    defaultCutoff: "latest approved Gold/FRED observations before generation",
    status: "partial",
    requiredTemplateIds: ["daily_scoreboard", "curve_watch", "vol_credit_watch", "macro_week_ahead"],
    unavailableReason: "Overnight futures and live pre-market trading are unavailable until an approved upstream Gold contract exists.",
  },
  {
    type: "post_release",
    label: "Post-Release Note",
    cadence: "After an approved Gold release update",
    defaultCutoff: "after Gold rows refresh for the represented release",
    status: "partial",
    requiredTemplateIds: ["macro_week_ahead"],
    unavailableReason: "Release actual/prior/revision templates still need a release-specific Gold value contract.",
  },
  {
    type: "market_close",
    label: "Market Close Wrap",
    cadence: "US business days after approved close data is available",
    defaultCutoff: "latest completed approved DB observation",
    status: "draftable",
    requiredTemplateIds: ["daily_scoreboard", "market_derby", "curve_watch", "vol_credit_watch"],
  },
  {
    type: "weekend_week_in_markets",
    label: "Weekend Week In Markets",
    cadence: "Weekly after Friday data is complete",
    defaultCutoff: "Friday/latest approved Gold close",
    status: "partial",
    requiredTemplateIds: ["daily_scoreboard", "market_derby", "curve_watch", "vol_credit_watch", "macro_week_ahead", "reserve_vix_claim_audit"],
  },
  {
    type: "monthly_state_of_markets",
    label: "Monthly State Of Markets And Economic Health",
    cadence: "Monthly after key month-end data is available",
    defaultCutoff: "month-end/latest approved Gold observations",
    status: "partial",
    requiredTemplateIds: ["daily_scoreboard", "market_derby", "curve_watch", "vol_credit_watch", "macro_week_ahead"],
  },
  {
    type: "quarterly_market_guide",
    label: "Quarterly Market Guide",
    cadence: "Quarterly after selected data cutoff",
    defaultCutoff: "quarter-end/latest approved Gold observations",
    status: "blocked",
    requiredTemplateIds: ["daily_scoreboard", "market_derby", "curve_watch", "vol_credit_watch", "macro_week_ahead", "earnings_valuation_gate"],
    unavailableReason: "Guide chapters can start, but earnings/valuation remains blocked until an approved Gold data contract exists.",
  },
];

const GOLD_OBSERVATION_TABLES = ["gold_fred_latest_observation"];
const GOLD_CALENDAR_TABLES = ["gold_release_calendar"];

function byId(metrics: CommandCenterMetric[]): Map<string, CommandCenterMetric> {
  return new Map(metrics.map((metric) => [metric.id, metric]));
}

export function citation(seriesIds: string[], asOf: string | null, transform: string, basis: string, goldTables = GOLD_OBSERVATION_TABLES): MarketPublishingCitation {
  return {
    source: "FRED/Economic Gold SQLite",
    seriesIds,
    goldTables,
    observationAsOf: asOf,
    transform,
    basis,
  };
}

function maxDate(values: Array<string | null | undefined>): string | null {
  return values.reduce<string | null>((best, value) => (value && (!best || value > best) ? value : best), null);
}

export function readyCandidate(args: Omit<MarketPublishingCandidate, "status" | "source" | "warnings"> & { warnings?: string[] }): MarketPublishingCandidate {
  return {
    ...args,
    status: "ready",
    source: "DB",
    warnings: args.warnings ?? [],
  };
}

export function unavailableCandidate(args: Omit<MarketPublishingCandidate, "status" | "source" | "score" | "citation" | "warnings"> & { unavailableReason: string; warnings?: string[] }): MarketPublishingCandidate {
  return {
    ...args,
    status: "unavailable",
    source: "ERR",
    score: 0,
    citation: null,
    warnings: args.warnings ?? [args.unavailableReason],
  };
}

function formatSigned(value: number | null | undefined, suffix: string, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}${suffix}`;
}

function marketReturn(metric: CommandCenterMetric, horizon: CommandCenterReturnHorizon): number | null {
  const value = metric.marketReturns?.[horizon]?.value;
  return value != null && Number.isFinite(value) ? value : null;
}

function firstAvailable<T>(items: T[], predicate: (item: T) => boolean): T | null {
  return items.find(predicate) ?? null;
}

export function buildMarketPublishingDaily(commandCenter: CommandCenterPayload): MarketPublishingDailyPayload {
  return {
    source: commandCenter.source,
    asOf: commandCenter.asOf,
    generatedAt: new Date().toISOString(),
    commandCenter,
    workspaces: WORKSPACES,
    packages: PACKAGES,
    warnings: commandCenter.warnings,
    error: commandCenter.error,
  };
}

/**
 * @param detectorCandidates Additive output from spec006's material-change
 *   detectors (`materialChangeDetector.ts`). Merged in regardless of
 *   `commandCenter`'s own source state — the detector reads different Gold
 *   tables and fails closed independently, so a Command Center outage
 *   should not hide a genuinely available detector candidate, and vice
 *   versa.
 */
export function buildMarketPublishingCandidates(
  commandCenter: CommandCenterPayload,
  detectorCandidates: MarketPublishingCandidate[] = []
): MarketPublishingCandidatesPayload {
  const generatedAt = new Date().toISOString();
  let candidates: MarketPublishingCandidate[];
  let baseError: string | undefined;

  if (commandCenter.source !== "DB") {
    candidates = [
      unavailableCandidate({
        id: "daily-scoreboard-unavailable",
        templateId: "daily_scoreboard",
        title: "Daily scoreboard unavailable",
        summary: "Gold/FRED Command Center data is unavailable.",
        workspace: "Today",
        packageTypes: ["pre_market", "market_close"],
        dataAsOf: commandCenter.asOf,
        seriesIds: [],
        unavailableReason: commandCenter.error ?? "No approved Gold/FRED observations are available.",
      }),
    ];
    baseError = commandCenter.error;
  } else {
    candidates = [];
    baseError = undefined;

  const marketMetrics = commandCenter.highLevelMarkets.filter((metric) => metric.source === "DB");
  const rateById = byId(commandCenter.domesticRates);
  const volById = byId(commandCenter.volatility);
  const domesticById = byId(commandCenter.domesticHealth);

  if (marketMetrics.length) {
    const spx = marketMetrics.find((metric) => metric.id === "SP500") ?? marketMetrics[0];
    candidates.push(readyCandidate({
      id: "daily-scoreboard",
      templateId: "daily_scoreboard",
      title: "Daily market scoreboard",
      summary: `${spx.short} latest ${spx.value.toFixed(spx.decimals)} as of ${spx.asOf}; 1D return ${formatSigned(marketReturn(spx, "1D"), "%", 2)}.`,
      score: 80,
      workspace: "Today",
      packageTypes: ["pre_market", "market_close", "weekend_week_in_markets", "monthly_state_of_markets", "quarterly_market_guide"],
      dataAsOf: maxDate(marketMetrics.map((metric) => metric.asOf)),
      seriesIds: marketMetrics.map((metric) => metric.id),
      citation: citation(marketMetrics.map((metric) => metric.id), maxDate(marketMetrics.map((metric) => metric.asOf)), "linked price/index returns", "1D, 5D, MTD, 1M, 3M, QTD, YTD, 1Y/3Y/5Y annualized on 252 trading days"),
    }));
  }

  const derbyMetrics = marketMetrics
    .map((metric) => ({ metric, oneDay: marketReturn(metric, "1D") }))
    .filter((row): row is { metric: CommandCenterMetric; oneDay: number } => row.oneDay != null)
    .sort((a, b) => b.oneDay - a.oneDay);
  if (derbyMetrics.length >= 2) {
    const best = derbyMetrics[0];
    const worst = derbyMetrics[derbyMetrics.length - 1];
    candidates.push(readyCandidate({
      id: "market-derby-1d",
      templateId: "market_derby",
      title: "One-day market derby",
      summary: `${best.metric.short} leads at ${formatSigned(best.oneDay, "%", 2)}; ${worst.metric.short} trails at ${formatSigned(worst.oneDay, "%", 2)}.`,
      score: Math.min(95, 60 + Math.abs(best.oneDay - worst.oneDay) * 4),
      workspace: "Market Derbies",
      packageTypes: ["market_close", "weekend_week_in_markets", "monthly_state_of_markets", "quarterly_market_guide"],
      dataAsOf: maxDate(derbyMetrics.map((row) => row.metric.asOf)),
      seriesIds: derbyMetrics.map((row) => row.metric.id),
      citation: citation(derbyMetrics.map((row) => row.metric.id), maxDate(derbyMetrics.map((row) => row.metric.asOf)), "geometrically linked return", "latest close versus prior available trading observation"),
    }));
  } else {
    candidates.push(unavailableCandidate({
      id: "market-derby-unavailable",
      templateId: "market_derby",
      title: "Market derby unavailable",
      summary: "At least two Gold/FRED market index rows with linked 1D returns are required.",
      workspace: "Market Derbies",
      packageTypes: ["market_close", "weekend_week_in_markets"],
      dataAsOf: commandCenter.asOf,
      seriesIds: marketMetrics.map((metric) => metric.id),
      unavailableReason: "Insufficient Gold-backed market return coverage.",
    }));
  }

  const dgs10 = rateById.get("DGS10");
  const curve = rateById.get("T10Y2Y");
  if (dgs10 && curve) {
    candidates.push(readyCandidate({
      id: "curve-watch",
      templateId: "curve_watch",
      title: "Treasury curve watch",
      summary: `10Y ${dgs10.value.toFixed(2)}%; 10Y-2Y ${curve.value.toFixed(0)} bps as of ${maxDate([dgs10.asOf, curve.asOf])}.`,
      score: Math.min(92, 58 + Math.abs(curve.value) / 5),
      workspace: "Macro And Volatility",
      packageTypes: ["pre_market", "market_close", "weekend_week_in_markets", "monthly_state_of_markets", "quarterly_market_guide"],
      dataAsOf: maxDate([dgs10.asOf, curve.asOf]),
      seriesIds: ["DGS10", "T10Y2Y"],
      citation: citation(["DGS10", "T10Y2Y"], maxDate([dgs10.asOf, curve.asOf]), "latest level and one-observation change", "yield percent and spread basis points"),
    }));
  }

  const vix = volById.get("VIXCLS");
  const hy = volById.get("BAMLH0A0HYM2");
  const ig = volById.get("BAMLC0A0CM");
  const financialConditions = firstAvailable(commandCenter.volatility, (metric) => metric.id === "NFCI" || metric.id === "STLFSI4");
  if (vix && (hy || ig || financialConditions)) {
    const peers = [vix, hy, ig, financialConditions].filter((metric): metric is CommandCenterMetric => metric != null);
    candidates.push(readyCandidate({
      id: "vol-credit-watch",
      templateId: "vol_credit_watch",
      title: "Volatility and credit stress watch",
      summary: `VIX ${vix.value.toFixed(1)} as of ${vix.asOf}; ${hy ? `HY OAS ${hy.value.toFixed(0)} bps` : financialConditions ? `${financialConditions.short} ${financialConditions.value.toFixed(financialConditions.decimals)}` : "credit peer available"}.`,
      score: Math.min(96, 55 + Math.max(0, vix.value - 12) + (hy ? Math.max(0, hy.value - 300) / 25 : 0)),
      workspace: "Macro And Volatility",
      packageTypes: ["pre_market", "market_close", "weekend_week_in_markets", "monthly_state_of_markets", "quarterly_market_guide"],
      dataAsOf: maxDate(peers.map((metric) => metric.asOf)),
      seriesIds: peers.map((metric) => metric.id),
      citation: citation(peers.map((metric) => metric.id), maxDate(peers.map((metric) => metric.asOf)), "latest level and one-observation change", "VIX index, OAS basis points, financial-conditions index"),
    }));
  }

  if (commandCenter.catalysts.length) {
    const next = commandCenter.catalysts[0];
    candidates.push(readyCandidate({
      id: "macro-week-ahead",
      templateId: "macro_week_ahead",
      title: "Macro week ahead",
      summary: `${next.name} on ${next.date}; ${commandCenter.catalysts.length} approved Gold calendar catalysts available.`,
      score: Math.min(90, 50 + commandCenter.catalysts.filter((catalyst) => catalyst.importance === "HIGH").length * 12 + commandCenter.catalysts.length),
      workspace: "Today",
      packageTypes: ["pre_market", "post_release", "weekend_week_in_markets", "monthly_state_of_markets"],
      dataAsOf: maxDate(commandCenter.catalysts.map((catalyst: CommandCenterCatalyst) => catalyst.date)),
      seriesIds: commandCenter.catalysts.map((catalyst) => catalyst.representativeSeriesId).filter((id): id is string => Boolean(id)),
      citation: citation(
        commandCenter.catalysts.map((catalyst) => catalyst.representativeSeriesId).filter((id): id is string => Boolean(id)),
        maxDate(commandCenter.catalysts.map((catalyst) => catalyst.date)),
        "release-calendar date selection",
        "upcoming HIGH/MEDIUM releases within the approved Gold calendar horizon",
        GOLD_CALENDAR_TABLES
      ),
    }));
  } else {
    candidates.push(unavailableCandidate({
      id: "macro-week-ahead-unavailable",
      templateId: "macro_week_ahead",
      title: "Macro week ahead unavailable",
      summary: "No upcoming approved Gold release-calendar rows are available.",
      workspace: "Today",
      packageTypes: ["pre_market", "weekend_week_in_markets"],
      dataAsOf: commandCenter.asOf,
      seriesIds: [],
      unavailableReason: "Gold release_calendar returned no upcoming HIGH/MEDIUM rows.",
    }));
  }

  const reserve = volById.get("WRESBAL");
  const spx = marketMetrics.find((metric) => metric.id === "SP500");
  if (reserve && vix && spx) {
    candidates.push(readyCandidate({
      id: "reserve-vix-claim-audit",
      templateId: "reserve_vix_claim_audit",
      title: "Reserve/VIX claim audit",
      summary: `Inputs available for WRESBAL, VIXCLS, and SP500 through ${maxDate([reserve.asOf, vix.asOf, spx.asOf])}; full stats resolve through MVOL.`,
      score: 70,
      workspace: "Macro And Volatility",
      packageTypes: ["weekend_week_in_markets", "monthly_state_of_markets"],
      dataAsOf: maxDate([reserve.asOf, vix.asOf, spx.asOf]),
      seriesIds: ["WRESBAL", "VIXCLS", "SP500"],
      citation: citation(["WRESBAL", "VIXCLS", "SP500"], maxDate([reserve.asOf, vix.asOf, spx.asOf]), "MVOL reserve-above-mean experiment", "+7D/+14D forward VIX and SPX outcomes from approved Gold observations"),
    }));
  }

  candidates.push(unavailableCandidate({
    id: "earnings-valuation-gate",
    templateId: "earnings_valuation_gate",
    title: "Earnings and valuation unavailable",
    summary: "Forward earnings, consensus, revisions, and valuation views are intentionally disabled for MPUB.",
    workspace: "Today",
    packageTypes: ["quarterly_market_guide"],
    dataAsOf: null,
    seriesIds: [],
    unavailableReason: "No approved upstream Gold contract exists for complete earnings estimates, revisions, calendar timing, or forward valuation.",
  }));
  }

  const merged = [...candidates, ...detectorCandidates];
  const sorted = merged.sort((a, b) => {
    if (a.status !== b.status) return a.status === "ready" ? -1 : 1;
    return b.score - a.score;
  });
  const anyReady = sorted.some((candidate) => candidate.status === "ready");

  return {
    source: anyReady ? "DB" : "ERR",
    asOf: commandCenter.asOf,
    generatedAt,
    candidates: sorted,
    warnings: commandCenter.warnings,
    error: anyReady ? undefined : (baseError ?? "No Gold-backed publishing candidates are currently available."),
  };
}
