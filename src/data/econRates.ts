import { Rng } from "@/lib/rng";
import { FRED_CATALOG, resolveFred, type EconCategory } from "@/data/econSeries";

/**
 * Policy-rate expectations & economic calendar.
 *
 * Rate-hike/cut probabilities use the CME FedWatch methodology: implied
 * probabilities derived from 30-Day Fed Funds futures (CME: ZQ). A free public
 * futures feed isn't generally available, so the simulation encodes a plausible
 * easing path; the structure is wired so a futures source can replace it.
 */

export const CURRENT_TARGET = { low: 4.0, high: 4.25, mid: 4.125 };
const BP = 0.25;

export interface FomcMeeting {
  date: string;
  label: string;
  daysOut: number;
  /** probability distribution over outcomes relative to current at that meeting */
  outcomes: { move: number; prob: number }[]; // move in bps (negative = cut)
  impliedRate: number; // expected effective rate after meeting
  mostLikely: string;
}

/** Upcoming FOMC meetings with an easing bias path. */
export function getFomcMeetings(): FomcMeeting[] {
  const meetings: [string, string, number][] = [
    ["2026-07-29", "Jul 2026", 42],
    ["2026-09-16", "Sep 2026", 91],
    ["2026-10-28", "Oct 2026", 133],
    ["2026-12-09", "Dec 2026", 175],
    ["2027-01-27", "Jan 2027", 224],
    ["2027-03-17", "Mar 2027", 273],
  ];
  // cumulative expected cuts grow with horizon
  let cumExpected = 0;
  return meetings.map(([date, label, daysOut], i) => {
    const rng = new Rng(`fomc-${date}`);
    // probability of a 25bp cut rises then fades as terminal approaches
    const cutProb = Math.max(0.05, Math.min(0.82, 0.18 + i * 0.16 - Math.max(0, i - 3) * 0.12));
    const holdProb = 1 - cutProb - 0.04;
    const cut50 = 0.04 * (i >= 2 ? 1 : 0.3);
    const outcomes = [
      { move: -50, prob: Number(cut50.toFixed(3)) },
      { move: -25, prob: Number((cutProb).toFixed(3)) },
      { move: 0, prob: Number((Math.max(0.02, holdProb - cut50)).toFixed(3)) },
      { move: 25, prob: 0.02 },
    ];
    cumExpected += outcomes.reduce((a, o) => a + (o.move / 100) * o.prob, 0);
    const impliedRate = Number((CURRENT_TARGET.mid + cumExpected).toFixed(3));
    const ml = outcomes.reduce((a, b) => (b.prob > a.prob ? b : a));
    const mostLikely = ml.move === 0 ? "Hold" : ml.move < 0 ? `${Math.abs(ml.move)}bp Cut` : `${ml.move}bp Hike`;
    return { date, label, daysOut, outcomes, impliedRate, mostLikely };
  });
}

/** Implied policy path (expected effective fed funds rate over time). */
export function getImpliedPath(): { label: string; rate: number }[] {
  const m = getFomcMeetings();
  return [{ label: "Now", rate: CURRENT_TARGET.mid }, ...m.map((x) => ({ label: x.label, rate: x.impliedRate }))];
}

export interface PathSnapshot {
  asOf: string; // ISO date the path was priced
  label: string;
  startRate: number;
  terminalRate: number;
  cutsImplied: number; // 25bp-equivalent cuts to terminal
  path: { label: string; rate: number }[];
  color: string;
}

const PATH_HORIZONS = ["Spot", "+3M", "+6M", "+9M", "+12M", "+18M", "+24M"];

/**
 * How the market-implied policy path has evolved. Each snapshot is the forward
 * fed-funds path as priced on its `asOf` date, so users can see the path drift
 * (hawkish/dovish repricing) over time with the exact generation date surfaced.
 */
export function getPolicyPathHistory(): PathSnapshot[] {
  // asOf, label, then-current rate, then-priced terminal, color
  const defs: [string, string, number, number, string][] = [
    ["2026-06-17", "Today", 4.125, 3.35, "#FF8C00"],
    ["2026-06-10", "1 Week Ago", 4.125, 3.4, "#3B9DFF"],
    ["2026-05-17", "1 Month Ago", 4.125, 3.28, "#2ECC71"],
    ["2026-04-29", "Last FOMC (Apr 29)", 4.375, 3.42, "#A78BFA"],
    ["2026-03-17", "3 Months Ago", 4.375, 3.55, "#22D3EE"],
    ["2026-01-02", "Year Start", 4.625, 3.5, "#EC4899"],
    ["2025-12-17", "6 Months Ago", 4.625, 3.15, "#FFB400"],
  ];
  return defs.map(([asOf, label, startRate, terminalRate, color]) => {
    const path = PATH_HORIZONS.map((h, i) => {
      // smooth ease from start toward terminal across the horizon
      const f = i / (PATH_HORIZONS.length - 1);
      const ease = 1 - Math.pow(1 - f, 1.7);
      return { label: h, rate: Number((startRate + (terminalRate - startRate) * ease).toFixed(3)) };
    });
    return {
      asOf, label, startRate, terminalRate,
      cutsImplied: Number(((startRate - terminalRate) / 0.25).toFixed(1)),
      path, color,
    };
  });
}

export const POLICY_PATH_HORIZONS = PATH_HORIZONS;

export interface DotPlotDot {
  year: string;
  rate: number;
  count: number;
}

/** Stylized FOMC Summary of Economic Projections "dot plot". */
export function getDotPlot(): { years: string[]; dots: DotPlotDot[]; median: Record<string, number> } {
  const years = ["2026", "2027", "2028", "Longer run"];
  const centers = [3.6, 3.1, 2.9, 2.9];
  const spreads = [0.55, 0.7, 0.6, 0.4];
  const dots: DotPlotDot[] = [];
  const rng = new Rng("dotplot");
  const median: Record<string, number> = {};
  years.forEach((year, yi) => {
    const levels = new Map<number, number>();
    for (let d = 0; d < 19; d++) {
      const r = Math.round((centers[yi] + rng.normal(0, spreads[yi])) / BP) * BP;
      levels.set(r, (levels.get(r) ?? 0) + 1);
    }
    [...levels.entries()].forEach(([rate, count]) => dots.push({ year, rate, count }));
    median[year] = Math.round(centers[yi] / BP) * BP;
  });
  return { years, dots, median };
}

export type EventImportance = "HIGH" | "MEDIUM" | "LOW";

export interface EconEvent {
  id: string;
  date: string;
  time: string;
  daysOut: number;
  name: string;
  category: string;
  importance: EventImportance;
  period: string;
  prior: string;
  consensus: string;
  actual: string | null;
  ticker?: string;
  source?: string;
}

export interface EventDef {
  name: string;
  category: string;
  time: string;
  importance: EventImportance;
  freq: "monthly" | "quarterly" | "weekly";
  releaseDay: number;
  baseValue: number;
  volatility: number;
  unit: string;
  fmt: (v: number) => string;
  fredId?: string;
  fredUnits?: string;
  fredScale?: number;
}

const pctFmt = (v: number) => `${v.toFixed(1)}%`;
const kFmt = (v: number) => `${Math.round(v)}k`;
const mFmt = (v: number) => `${v.toFixed(2)}M`;
const idxFmt = (v: number) => `${v.toFixed(1)}`;
const rngFmt = (lo: number, hi: number) => `${lo.toFixed(2)}-${hi.toFixed(2)}%`;

const bpsFmt = (v: number) => `${Math.round(v)}bps`;
const rateFmt = (v: number) => `${v.toFixed(2)}%`;
const tFmt = (v: number) => `$${v.toFixed(2)}T`;
const savFmt = (v: number) => `${v.toFixed(1)}%`;

const EVENT_SERIES: EventDef[] = [
  // ── Inflation (HIGH) ──
  { name: "CPI (m/m)", category: "Inflation", time: "08:30", importance: "HIGH", freq: "monthly", releaseDay: 12, baseValue: 0.25, volatility: 0.15, unit: "%", fmt: pctFmt, fredId: "CPIAUCSL", fredUnits: "pch" },
  { name: "Core CPI (m/m)", category: "Inflation", time: "08:30", importance: "HIGH", freq: "monthly", releaseDay: 12, baseValue: 0.3, volatility: 0.1, unit: "%", fmt: pctFmt, fredId: "CPILFESL", fredUnits: "pch" },
  { name: "Core PCE (m/m)", category: "Inflation", time: "08:30", importance: "HIGH", freq: "monthly", releaseDay: 28, baseValue: 0.25, volatility: 0.1, unit: "%", fmt: pctFmt, fredId: "PCEPILFE", fredUnits: "pch" },
  { name: "PCE Price Index (m/m)", category: "Inflation", time: "08:30", importance: "HIGH", freq: "monthly", releaseDay: 28, baseValue: 0.2, volatility: 0.15, unit: "%", fmt: pctFmt, fredId: "PCEPI", fredUnits: "pch" },
  { name: "PPI (m/m)", category: "Inflation", time: "08:30", importance: "MEDIUM", freq: "monthly", releaseDay: 13, baseValue: 0.15, volatility: 0.2, unit: "%", fmt: pctFmt, fredId: "PPIACO", fredUnits: "pch" },
  { name: "Sticky CPI (y/y)", category: "Inflation", time: "08:30", importance: "MEDIUM", freq: "monthly", releaseDay: 12, baseValue: 3.2, volatility: 0.12, unit: "%", fmt: pctFmt, fredId: "STICKCPIM159SFRBATL" },
  { name: "Median CPI (ann.)", category: "Inflation", time: "08:30", importance: "MEDIUM", freq: "monthly", releaseDay: 12, baseValue: 3.3, volatility: 0.2, unit: "%", fmt: pctFmt, fredId: "MEDCPIM159SFRB" },
  { name: "Trimmed-Mean PCE (y/y)", category: "Inflation", time: "08:30", importance: "MEDIUM", freq: "monthly", releaseDay: 28, baseValue: 2.7, volatility: 0.12, unit: "%", fmt: pctFmt, fredId: "PCETRIM12M159SFRB" },
  { name: "5y Breakeven Inflation", category: "Inflation", time: "—", importance: "LOW", freq: "monthly", releaseDay: 15, baseValue: 2.34, volatility: 0.05, unit: "%", fmt: rateFmt, fredId: "T5YIE" },

  // ── Labor (HIGH/MEDIUM) ──
  { name: "Nonfarm Payrolls", category: "Labor", time: "08:30", importance: "HIGH", freq: "monthly", releaseDay: 5, baseValue: 180, volatility: 60, unit: "k", fmt: kFmt, fredId: "PAYEMS", fredUnits: "chg" },
  { name: "Unemployment Rate", category: "Labor", time: "08:30", importance: "HIGH", freq: "monthly", releaseDay: 5, baseValue: 4.2, volatility: 0.2, unit: "%", fmt: pctFmt, fredId: "UNRATE" },
  { name: "Initial Jobless Claims", category: "Labor", time: "08:30", importance: "MEDIUM", freq: "weekly", releaseDay: 4, baseValue: 230, volatility: 15, unit: "k", fmt: kFmt, fredId: "ICSA", fredScale: 0.001 },
  { name: "Continued Claims", category: "Labor", time: "08:30", importance: "MEDIUM", freq: "weekly", releaseDay: 4, baseValue: 1870, volatility: 40, unit: "k", fmt: kFmt, fredId: "CCSA", fredScale: 0.001 },
  { name: "JOLTS Job Openings", category: "Labor", time: "10:00", importance: "MEDIUM", freq: "monthly", releaseDay: 8, baseValue: 7.5, volatility: 0.4, unit: "M", fmt: mFmt, fredId: "JTSJOL", fredScale: 0.001 },
  { name: "JOLTS Quits Rate", category: "Labor", time: "10:00", importance: "MEDIUM", freq: "monthly", releaseDay: 8, baseValue: 2.0, volatility: 0.1, unit: "%", fmt: pctFmt, fredId: "JTSQUR" },
  { name: "JOLTS Hires Rate", category: "Labor", time: "10:00", importance: "LOW", freq: "monthly", releaseDay: 8, baseValue: 3.4, volatility: 0.1, unit: "%", fmt: pctFmt, fredId: "JTSHIR" },
  { name: "Avg Hourly Earnings (y/y)", category: "Labor", time: "08:30", importance: "HIGH", freq: "monthly", releaseDay: 5, baseValue: 3.9, volatility: 0.2, unit: "%", fmt: pctFmt, fredId: "CES0500000003", fredUnits: "pc1" },
  { name: "U-6 Underemployment", category: "Labor", time: "08:30", importance: "MEDIUM", freq: "monthly", releaseDay: 5, baseValue: 7.9, volatility: 0.15, unit: "%", fmt: pctFmt, fredId: "U6RATE" },
  { name: "Labor Force Participation", category: "Labor", time: "08:30", importance: "LOW", freq: "monthly", releaseDay: 5, baseValue: 62.4, volatility: 0.1, unit: "%", fmt: pctFmt, fredId: "CIVPART" },
  { name: "Avg Weekly Hours", category: "Labor", time: "08:30", importance: "LOW", freq: "monthly", releaseDay: 5, baseValue: 34.2, volatility: 0.1, unit: "hrs", fmt: idxFmt, fredId: "AWHAETP" },

  // ── Growth (HIGH) ──
  { name: "GDP (q/q ann.)", category: "Growth", time: "08:30", importance: "HIGH", freq: "quarterly", releaseDay: 27, baseValue: 2.2, volatility: 0.8, unit: "%", fmt: pctFmt, fredId: "A191RL1Q225SBEA" },

  // ── Activity (MEDIUM) ──
  { name: "Industrial Production (m/m)", category: "Activity", time: "09:15", importance: "MEDIUM", freq: "monthly", releaseDay: 16, baseValue: 0.2, volatility: 0.4, unit: "%", fmt: pctFmt, fredId: "INDPRO", fredUnits: "pch" },
  { name: "Capacity Utilization", category: "Activity", time: "09:15", importance: "LOW", freq: "monthly", releaseDay: 16, baseValue: 77.4, volatility: 0.4, unit: "%", fmt: pctFmt, fredId: "TCU" },
  { name: "Durable Goods Orders (m/m)", category: "Activity", time: "08:30", importance: "MEDIUM", freq: "monthly", releaseDay: 24, baseValue: 0.3, volatility: 1.2, unit: "%", fmt: pctFmt, fredId: "DGORDER", fredUnits: "pch" },
  { name: "Chicago Fed Activity", category: "Activity", time: "08:30", importance: "LOW", freq: "monthly", releaseDay: 22, baseValue: -0.05, volatility: 0.25, unit: "", fmt: (v) => v.toFixed(2), fredId: "CFNAI" },

  // ── Consumer (HIGH/MEDIUM) ──
  { name: "Retail Sales (m/m)", category: "Consumer", time: "08:30", importance: "HIGH", freq: "monthly", releaseDay: 15, baseValue: 0.2, volatility: 0.3, unit: "%", fmt: pctFmt, fredId: "RSAFS", fredUnits: "pch" },
  { name: "U. Mich Sentiment", category: "Consumer", time: "10:00", importance: "MEDIUM", freq: "monthly", releaseDay: 14, baseValue: 68, volatility: 3, unit: "", fmt: idxFmt, fredId: "UMCSENT" },
  { name: "Personal Saving Rate", category: "Consumer", time: "08:30", importance: "LOW", freq: "monthly", releaseDay: 28, baseValue: 4.4, volatility: 0.3, unit: "%", fmt: savFmt, fredId: "PSAVERT" },
  { name: "Light Vehicle Sales", category: "Consumer", time: "—", importance: "LOW", freq: "monthly", releaseDay: 3, baseValue: 16.1, volatility: 0.5, unit: "M", fmt: mFmt, fredId: "TOTALSA" },

  // ── Housing (MEDIUM/LOW) ──
  { name: "Housing Starts", category: "Housing", time: "08:30", importance: "MEDIUM", freq: "monthly", releaseDay: 17, baseValue: 1.38, volatility: 0.08, unit: "M", fmt: mFmt, fredId: "HOUST", fredScale: 0.001 },
  { name: "Building Permits", category: "Housing", time: "08:30", importance: "MEDIUM", freq: "monthly", releaseDay: 17, baseValue: 1.42, volatility: 0.05, unit: "M", fmt: mFmt, fredId: "PERMIT", fredScale: 0.001 },
  { name: "Existing Home Sales", category: "Housing", time: "10:00", importance: "MEDIUM", freq: "monthly", releaseDay: 21, baseValue: 4.05, volatility: 0.1, unit: "M", fmt: mFmt, fredId: "EXHOSLUSM495S", fredScale: 1e-6 },
  { name: "Case-Shiller Home Prices (y/y)", category: "Housing", time: "09:00", importance: "MEDIUM", freq: "monthly", releaseDay: 25, baseValue: 3.4, volatility: 0.4, unit: "%", fmt: pctFmt, fredId: "CSUSHPINSA", fredUnits: "pc1" },
  { name: "30Y Mortgage Rate", category: "Housing", time: "10:00", importance: "MEDIUM", freq: "weekly", releaseDay: 4, baseValue: 6.62, volatility: 0.08, unit: "%", fmt: rateFmt, fredId: "MORTGAGE30US" },
  { name: "Monthly Supply of New Homes", category: "Housing", time: "10:00", importance: "LOW", freq: "monthly", releaseDay: 25, baseValue: 8.9, volatility: 0.3, unit: "mos", fmt: idxFmt, fredId: "MSACSR" },

  // ── Policy (HIGH) — FOMC uses real meeting dates via getFomcMeetings(); excluded here ──

  // ── Money & Liquidity (MEDIUM/LOW) ──
  { name: "M2 Money Supply (y/y)", category: "Money", time: "—", importance: "LOW", freq: "monthly", releaseDay: 23, baseValue: 3.6, volatility: 0.3, unit: "%", fmt: pctFmt, fredId: "M2SL", fredUnits: "pc1" },
  { name: "Fed Balance Sheet", category: "Money", time: "16:15", importance: "LOW", freq: "weekly", releaseDay: 4, baseValue: 6.62, volatility: 0.03, unit: "$T", fmt: tFmt, fredId: "WALCL", fredScale: 1e-6 },
  { name: "Overnight Reverse Repo", category: "Money", time: "15:15", importance: "LOW", freq: "monthly", releaseDay: 1, baseValue: 470, volatility: 12, unit: "$B", fmt: (v) => `$${Math.round(v)}B`, fredId: "RRPONTSYD" },
  { name: "Chicago Fed Fin. Conditions", category: "Money", time: "08:30", importance: "LOW", freq: "weekly", releaseDay: 3, baseValue: -0.42, volatility: 0.05, unit: "", fmt: (v) => v.toFixed(2), fredId: "NFCI" },
  { name: "St. Louis Fed Fin. Stress", category: "Money", time: "—", importance: "LOW", freq: "weekly", releaseDay: 4, baseValue: -0.4, volatility: 0.08, unit: "", fmt: (v) => v.toFixed(2), fredId: "STLFSI4" },

  // ── Credit (MEDIUM) ──
  { name: "HY Credit Spread (OAS)", category: "Credit", time: "—", importance: "MEDIUM", freq: "monthly", releaseDay: 1, baseValue: 312, volatility: 12, unit: "bps", fmt: bpsFmt, fredId: "BAMLH0A0HYM2", fredScale: 100 },
  { name: "IG Corp Spread (OAS)", category: "Credit", time: "—", importance: "MEDIUM", freq: "monthly", releaseDay: 1, baseValue: 92, volatility: 5, unit: "bps", fmt: bpsFmt, fredId: "BAMLC0A0CM", fredScale: 100 },
  { name: "Bank Lending Standards (SLOOS)", category: "Credit", time: "—", importance: "MEDIUM", freq: "quarterly", releaseDay: 5, baseValue: 8.0, volatility: 3, unit: "net %", fmt: pctFmt, fredId: "DRTSCILM" },

  // Global central bank rates use real meeting schedules (injected in getEconEvents)

  // ── Global Inflation (MEDIUM/LOW) ──
  { name: "Euro Area CPI", category: "Inflation", time: "05:00", importance: "MEDIUM", freq: "monthly", releaseDay: 1, baseValue: 128.4, volatility: 0.35, unit: "idx", fmt: idxFmt, fredId: "CP0000EZ19M086NEST" },
  { name: "UK CPI", category: "Inflation", time: "02:00", importance: "MEDIUM", freq: "monthly", releaseDay: 15, baseValue: 138.0, volatility: 0.45, unit: "idx", fmt: idxFmt, fredId: "GBRCPIALLMINMEI" },
  { name: "Japan CPI", category: "Inflation", time: "—", importance: "LOW", freq: "monthly", releaseDay: 20, baseValue: 111.0, volatility: 0.25, unit: "idx", fmt: idxFmt, fredId: "JPNCPIALLMINMEI" },
  { name: "China CPI", category: "Inflation", time: "21:30", importance: "MEDIUM", freq: "monthly", releaseDay: 10, baseValue: 102.0, volatility: 0.25, unit: "idx", fmt: idxFmt, fredId: "CHNCPIALLMINMEI" },
  { name: "Canada CPI", category: "Inflation", time: "08:30", importance: "LOW", freq: "monthly", releaseDay: 18, baseValue: 162.0, volatility: 0.35, unit: "idx", fmt: idxFmt, fredId: "CANCPIALLMINMEI" },
  { name: "Germany CPI", category: "Inflation", time: "02:00", importance: "LOW", freq: "monthly", releaseDay: 28, baseValue: 127.0, volatility: 0.35, unit: "idx", fmt: idxFmt, fredId: "DEUCPIALLMINMEI" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

export interface EventHistoryPoint {
  date: string;
  period: string;
  actual: number;
  consensus: number;
  prior: number;
  surprise: number;
}

export interface EventSeriesHistory {
  name: string;
  category: string;
  importance: EventImportance;
  unit: string;
  points: EventHistoryPoint[];
}

function injectCBDates(
  events: EconEvent[], dates: [string, string][], name: string,
  time: string, importance: EventImportance, baseRate: number,
  todayMs: number, idStart: number,
) {
  const rng = new Rng(`cb-${name}`);
  let prev = baseRate;
  for (let i = 0; i < dates.length; i++) {
    const [dateStr, label] = dates[i];
    const d = new Date(dateStr + "T00:00:00Z");
    const daysOut = Math.round((d.getTime() - todayMs) / 86400000);
    if (daysOut < -365 || daysOut > 60) continue;
    const released = daysOut < 0;
    const rate = released ? prev + rng.float(-0.01, 0.01) : prev;
    events.push({
      id: `EV-CB-${idStart + i}`,
      date: dateStr,
      time,
      daysOut,
      name,
      category: "Policy",
      importance,
      period: label,
      prior: `${prev.toFixed(2)}%`,
      consensus: `${prev.toFixed(2)}%`,
      actual: released ? `${rate.toFixed(2)}%` : null,
    });
    if (released) prev = rate;
  }
}

export function getEconEvents(anchor?: Date): EconEvent[] {
  const rng = new Rng("events-v2");
  const base = anchor ?? new Date();
  const todayMs = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  const events: EconEvent[] = [];
  let idCounter = 0;

  for (const def of FULL_EVENT_SERIES) {
    const months = def.freq === "weekly" ? 14 : 13;
    let prevActual = def.baseValue;

    for (let m = -months; m <= 1; m++) {
      if (def.freq === "quarterly" && m % 3 !== 0) continue;

      const releaseDate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + m, def.releaseDay));
      if (def.freq === "weekly") {
        for (let w = 0; w < 4; w++) {
          const wDate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + m, 1 + w * 7 + def.releaseDay));
          const wMs = wDate.getTime();
          const daysOut = Math.round((wMs - todayMs) / 86400000);
          if (daysOut < -365 || daysOut > 21) continue;
          const dateStr = wDate.toISOString().slice(0, 10);
          const consensus = prevActual + rng.float(-def.volatility * 0.3, def.volatility * 0.3);
          const actual = consensus + rng.float(-def.volatility * 0.5, def.volatility * 0.5);
          const released = daysOut < 0;
          const periodLabel = `Wk ${wDate.toISOString().slice(5, 10)}`;
          events.push({
            id: `EV-${idCounter++}`,
            date: dateStr,
            time: def.time,
            daysOut,
            name: def.name,
            category: def.category,
            importance: def.importance,
            period: periodLabel,
            prior: def.fmt(prevActual),
            consensus: def.fmt(consensus),
            actual: released ? def.fmt(actual) : null,
          });
          if (released) prevActual = actual;
        }
        continue;
      }

      const relMs = releaseDate.getTime();
      const daysOut = Math.round((relMs - todayMs) / 86400000);
      if (daysOut < -365 || daysOut > 30) continue;
      const dateStr = releaseDate.toISOString().slice(0, 10);
      const periodMonth = (base.getUTCMonth() + m - 1 + 12) % 12;
      const periodYear = releaseDate.getUTCFullYear() + (base.getUTCMonth() + m - 1 < 0 ? -1 : 0);
      const period = def.freq === "quarterly"
        ? `${QUARTERS[Math.floor(periodMonth / 3)]} ${periodYear}`
        : `${MONTHS[periodMonth]}`;
      const consensus = prevActual + rng.float(-def.volatility * 0.3, def.volatility * 0.3);
      const actual = consensus + rng.float(-def.volatility * 0.5, def.volatility * 0.5);
      const released = daysOut < 0;

      events.push({
        id: `EV-${idCounter++}`,
        date: dateStr,
        time: def.time,
        daysOut,
        name: def.name,
        category: def.category,
        importance: def.importance,
        period,
        prior: def.fmt(prevActual),
        consensus: def.fmt(consensus),
        actual: released ? def.fmt(actual) : null,
      });
      if (released) prevActual = actual;
    }
  }

  // ── FOMC meetings from real schedule (not generic month-based) ──
  const FOMC_DATES: [string, string][] = [
    ["2025-01-29", "Jan 2025"], ["2025-03-19", "Mar 2025"], ["2025-05-07", "May 2025"],
    ["2025-06-18", "Jun 2025"], ["2025-07-30", "Jul 2025"], ["2025-09-17", "Sep 2025"],
    ["2025-10-29", "Oct 2025"], ["2025-12-10", "Dec 2025"],
    ["2026-01-28", "Jan 2026"], ["2026-03-18", "Mar 2026"], ["2026-04-29", "Apr 2026"],
    ["2026-06-17", "Jun 2026"], ["2026-07-29", "Jul 2026"], ["2026-09-16", "Sep 2026"],
    ["2026-10-28", "Oct 2026"], ["2026-12-09", "Dec 2026"],
  ];
  const rngFomc = new Rng("fomc-cal");
  let fomcPrev = CURRENT_TARGET.mid;
  for (const [dateStr, label] of FOMC_DATES) {
    const d = new Date(dateStr + "T00:00:00Z");
    const daysOut = Math.round((d.getTime() - todayMs) / 86400000);
    if (daysOut < -365 || daysOut > 60) continue;
    const released = daysOut < 0;
    const rate = released ? fomcPrev + rngFomc.float(-0.005, 0.005) : fomcPrev;
    const lo = rate - 0.125;
    const hi = rate + 0.125;
    const fmt = (v: number) => `${v.toFixed(2)}-${(v + 0.25).toFixed(2)}%`;
    events.push({
      id: `EV-FOMC-${idCounter++}`,
      date: dateStr,
      time: "14:00",
      daysOut,
      name: "FOMC Rate Decision",
      category: "Policy",
      importance: "HIGH",
      period: label,
      prior: fmt(fomcPrev - 0.125),
      consensus: fmt(lo),
      actual: released ? fmt(lo) : null,
    });
    if (released) fomcPrev = rate;
  }

  // ── ECB Governing Council rate decisions ──
  const ECB_DATES: [string, string][] = [
    ["2025-01-30", "Jan 2025"], ["2025-03-06", "Mar 2025"], ["2025-04-17", "Apr 2025"],
    ["2025-06-05", "Jun 2025"], ["2025-07-24", "Jul 2025"], ["2025-09-11", "Sep 2025"],
    ["2025-10-30", "Oct 2025"], ["2025-12-18", "Dec 2025"],
    ["2026-01-22", "Jan 2026"], ["2026-03-05", "Mar 2026"], ["2026-04-16", "Apr 2026"],
    ["2026-06-04", "Jun 2026"], ["2026-07-16", "Jul 2026"], ["2026-09-10", "Sep 2026"],
    ["2026-10-29", "Oct 2026"], ["2026-12-17", "Dec 2026"],
  ];
  injectCBDates(events, ECB_DATES, "ECB Rate Decision", "07:45", "HIGH", 2.75, todayMs, idCounter);
  idCounter += ECB_DATES.length;

  // ── Bank of England MPC decisions ──
  const BOE_DATES: [string, string][] = [
    ["2025-02-06", "Feb 2025"], ["2025-03-20", "Mar 2025"], ["2025-05-08", "May 2025"],
    ["2025-06-19", "Jun 2025"], ["2025-08-07", "Aug 2025"], ["2025-09-18", "Sep 2025"],
    ["2025-11-06", "Nov 2025"], ["2025-12-18", "Dec 2025"],
    ["2026-02-05", "Feb 2026"], ["2026-03-19", "Mar 2026"], ["2026-05-07", "May 2026"],
    ["2026-06-18", "Jun 2026"], ["2026-08-06", "Aug 2026"], ["2026-09-17", "Sep 2026"],
    ["2026-11-05", "Nov 2026"], ["2026-12-17", "Dec 2026"],
  ];
  injectCBDates(events, BOE_DATES, "BoE Rate Decision", "07:00", "MEDIUM", 4.50, todayMs, idCounter);
  idCounter += BOE_DATES.length;

  // ── Bank of Japan policy decisions ──
  const BOJ_DATES: [string, string][] = [
    ["2025-01-24", "Jan 2025"], ["2025-03-14", "Mar 2025"], ["2025-05-01", "May 2025"],
    ["2025-06-17", "Jun 2025"], ["2025-07-31", "Jul 2025"], ["2025-09-19", "Sep 2025"],
    ["2025-10-31", "Oct 2025"], ["2025-12-19", "Dec 2025"],
    ["2026-01-23", "Jan 2026"], ["2026-03-13", "Mar 2026"], ["2026-04-28", "Apr 2026"],
    ["2026-06-16", "Jun 2026"], ["2026-07-29", "Jul 2026"], ["2026-09-17", "Sep 2026"],
    ["2026-10-29", "Oct 2026"], ["2026-12-18", "Dec 2026"],
  ];
  injectCBDates(events, BOJ_DATES, "BoJ Rate Decision", "—", "MEDIUM", 0.50, todayMs, idCounter);
  idCounter += BOJ_DATES.length;

  // ── Bank of Canada rate decisions ──
  const BOC_DATES: [string, string][] = [
    ["2025-01-29", "Jan 2025"], ["2025-03-12", "Mar 2025"], ["2025-04-16", "Apr 2025"],
    ["2025-06-04", "Jun 2025"], ["2025-07-30", "Jul 2025"], ["2025-09-17", "Sep 2025"],
    ["2025-10-29", "Oct 2025"], ["2025-12-10", "Dec 2025"],
    ["2026-01-28", "Jan 2026"], ["2026-03-04", "Mar 2026"], ["2026-04-15", "Apr 2026"],
    ["2026-06-03", "Jun 2026"], ["2026-07-15", "Jul 2026"], ["2026-09-16", "Sep 2026"],
    ["2026-10-28", "Oct 2026"], ["2026-12-09", "Dec 2026"],
  ];
  injectCBDates(events, BOC_DATES, "BoC Rate Decision", "10:00", "LOW", 2.75, todayMs, idCounter);
  idCounter += BOC_DATES.length;

  // ── RBA cash rate decisions ──
  const RBA_DATES: [string, string][] = [
    ["2025-02-18", "Feb 2025"], ["2025-04-01", "Apr 2025"], ["2025-05-20", "May 2025"],
    ["2025-07-08", "Jul 2025"], ["2025-08-12", "Aug 2025"], ["2025-09-30", "Sep 2025"],
    ["2025-11-04", "Nov 2025"], ["2025-12-09", "Dec 2025"],
    ["2026-02-03", "Feb 2026"], ["2026-03-17", "Mar 2026"], ["2026-05-05", "May 2026"],
    ["2026-06-02", "Jun 2026"], ["2026-07-07", "Jul 2026"], ["2026-08-04", "Aug 2026"],
    ["2026-09-01", "Sep 2026"], ["2026-11-03", "Nov 2026"],
  ];
  injectCBDates(events, RBA_DATES, "RBA Rate Decision", "—", "LOW", 4.10, todayMs, idCounter);

  return events.sort((a, b) => a.daysOut - b.daysOut);
}

export function getEventSeriesHistory(seriesName?: string): EventSeriesHistory[] {
  const events = getEconEvents();
  const released = events.filter((e) => e.actual != null);
  const byName = new Map<string, EconEvent[]>();
  for (const e of released) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }

  const parseNum = (s: string | null): number | null => {
    if (!s) return null;
    const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    let v = parseFloat(m[0]);
    if (/k/i.test(s)) v *= 1;
    if (/M/i.test(s)) v *= 1;
    return isFinite(v) ? v : null;
  };

  const result: EventSeriesHistory[] = [];
  const names = seriesName ? [seriesName] : Array.from(byName.keys());

  for (const name of names) {
    const evts = byName.get(name);
    if (!evts?.length) continue;
    const def = FULL_EVENT_SERIES.find((d) => d.name === name);
    if (!def) continue;

    const points: EventHistoryPoint[] = [];
    for (const e of evts) {
      const a = parseNum(e.actual);
      const c = parseNum(e.consensus);
      const p = parseNum(e.prior);
      if (a == null || c == null) continue;
      points.push({
        date: e.date,
        period: e.period,
        actual: a,
        consensus: c,
        prior: p ?? a,
        surprise: a - c,
      });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    if (points.length >= 2) {
      result.push({ name, category: def.category, importance: def.importance, unit: def.unit, points });
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

const CATEGORY_MAP: Record<EconCategory, string> = {
  GROWTH: "Growth", INFLATION: "Inflation", LABOR: "Labor", RATES: "Rates",
  CREDIT: "Credit", HOUSING: "Housing", CONSUMER: "Consumer", MONEY: "Money",
  ACTIVITY: "Activity", FX: "FX",
};

const IMPORTANCE_BY_CAT: Record<EconCategory, EventImportance> = {
  GROWTH: "HIGH", INFLATION: "MEDIUM", LABOR: "MEDIUM", RATES: "LOW",
  CREDIT: "LOW", HOUSING: "LOW", CONSUMER: "MEDIUM", MONEY: "LOW",
  ACTIVITY: "LOW", FX: "LOW",
};

const FREQ_MAP: Record<string, EventDef["freq"]> = { D: "monthly", W: "weekly", M: "monthly", Q: "quarterly" };

function autoFmt(s: { unit: string; decimals: number }): (v: number) => string {
  if (s.unit === "%" || s.unit.includes("%")) return (v) => `${v.toFixed(s.decimals)}%`;
  if (s.unit === "bps") return (v) => `${Math.round(v)}bps`;
  if (s.unit.includes("$")) return (v) => `${v.toFixed(s.decimals)}`;
  if (s.unit === "index" || s.unit === "") return (v) => v.toFixed(s.decimals);
  return (v) => `${v.toFixed(s.decimals)}`;
}

const CB_FRED_IDS = new Set([
  "DFEDTARU", "ECBDFR", "IRSTCB01GBM156N", "IRSTCB01JPM156N",
  "IRSTCB01CAM156N", "IRSTCB01AUM156N", "IRSTCB01CHM156N",
  "IRSTCB01BRM156N", "IRSTCB01MXM156N", "IRSTCB01KRM156N",
  "IRSTCB01SEM156N", "IRSTCB01NOM156N", "IRSTCB01NZM156N",
  "IRSTCB01TRM156N",
]);

function buildFullEventSeries(): EventDef[] {
  const curated = [...EVENT_SERIES];
  const coveredFredIds = new Set(curated.filter((d) => d.fredId).map((d) => d.fredId));

  for (const s of FRED_CATALOG) {
    if (coveredFredIds.has(s.id)) continue;
    if (CB_FRED_IDS.has(s.id)) continue;
    if (s.freq === "D") continue; // daily market data — not scheduled releases
    const resolved = resolveFred(s.id);
    if (resolved.simOnly) continue;

    curated.push({
      name: s.label,
      category: CATEGORY_MAP[s.category] ?? s.category,
      time: "—",
      importance: IMPORTANCE_BY_CAT[s.category] ?? "LOW",
      freq: FREQ_MAP[s.freq] ?? "monthly",
      releaseDay: 15,
      baseValue: s.level,
      volatility: s.vol,
      unit: s.unit,
      fmt: autoFmt(s),
      fredId: s.id,
      fredUnits: resolved.units !== "lin" ? resolved.units : undefined,
      fredScale: resolved.scale !== 1 ? resolved.scale : undefined,
    });
  }

  return curated;
}

const FULL_EVENT_SERIES = buildFullEventSeries();

export const EVENT_SERIES_NAMES = FULL_EVENT_SERIES.map((d) => d.name);
export { FULL_EVENT_SERIES as EVENT_SERIES };
