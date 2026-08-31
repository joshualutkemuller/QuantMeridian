export type CommandCenterSource = "DB" | "ERR";
export type CommandCenterSection = "markets" | "rates" | "volatility" | "domestic" | "global";
export type CommandCenterTone = "up" | "down" | "amber" | "neutral";
export type CommandCenterChangeMode = "pct" | "bps" | "points" | "absolute";
export type CommandCenterReturnHorizon = "1D" | "5D" | "MTD" | "1M" | "3M" | "QTD" | "YTD" | "1Y" | "3Y" | "5Y";

export interface CommandCenterReturn {
  value: number | null;
  startDate: string | null;
  endDate: string | null;
  tradingDays: number | null;
  annualized: boolean;
}

export interface CommandCenterPoint {
  date: string;
  value: number;
}

export interface CommandCenterMetric {
  id: string;
  label: string;
  short: string;
  section: CommandCenterSection;
  value: number;
  unit: string;
  asOf: string;
  realtimeStart: string | null;
  change: number | null;
  changePct: number | null;
  changeMode: CommandCenterChangeMode;
  marketReturns?: Record<CommandCenterReturnHorizon, CommandCenterReturn>;
  decimals: number;
  history: number[];
  historyDates: string[];
  tone: CommandCenterTone;
  source: "DB";
}

export interface CommandCenterCatalyst {
  id: string;
  name: string;
  date: string;
  daysOut: number;
  category: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
  representativeSeriesId: string | null;
  fetchedAt: string | null;
  source: "DB";
}

export interface CommandCenterPayload {
  source: CommandCenterSource;
  asOf: string | null;
  generatedAt: string;
  topline: CommandCenterMetric[];
  domesticRates: CommandCenterMetric[];
  volatility: CommandCenterMetric[];
  domesticHealth: CommandCenterMetric[];
  globalHealth: CommandCenterMetric[];
  highLevelMarkets: CommandCenterMetric[];
  catalysts: CommandCenterCatalyst[];
  missingSeries: string[];
  warnings: string[];
  error?: string;
}

export const EMPTY_COMMAND_CENTER: CommandCenterPayload = {
  source: "ERR",
  asOf: null,
  generatedAt: "",
  topline: [],
  domesticRates: [],
  volatility: [],
  domesticHealth: [],
  globalHealth: [],
  highLevelMarkets: [],
  catalysts: [],
  missingSeries: [],
  warnings: [],
};
