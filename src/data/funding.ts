/**
 * FUND — Funding & Liquidity Pulse (deterministic engine + derived analytics).
 *
 * The funding complex (overnight rates, balances, bills, FX basis) is rendered
 * from a fixed seed so the module is SSR-safe and works with no backend. Series
 * that exist on FRED (SOFR, EFFR, OBFR, IORB, BGCR/TGCR, RRP, reserves, balance
 * sheet, bills) are upgraded to live data in the page via `useLiveSeriesSet`
 * (the existing /api/econ/batch → FRED path); the rest (FX basis, FRA-OIS) stay
 * deterministic `SIM` until a BIS/pipeline feed is wired. All derived spreads
 * and the stress gauge are pure functions over the resolved series map, so they
 * work identically on live or simulated inputs.
 */
import { Rng } from "@/lib/rng";

export type FundingGroup = "Overnight" | "Balances" | "Bills" | "FX Basis";
export type FundingUnit = "%" | "$B" | "$T" | "bps";

export interface FundingDef {
  id: string;
  short: string;
  label: string;
  group: FundingGroup;
  unit: FundingUnit;
  decimals: number;
  hasFred: boolean; // upgradable to live FRED
  anchor: number; // current level
  vol: number; // daily sd (in the series' own units)
  drift: number; // gentle daily drift
}

/** The funding complex. FRED ids resolve live; FX-basis/FRA-OIS are SIM-only. */
export const FUNDING_SERIES: FundingDef[] = [
  // Overnight rates (corridor)
  { id: "IORB", short: "IORB", label: "Interest on Reserve Balances", group: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.9, vol: 0.004, drift: 0 },
  { id: "EFFR", short: "EFFR", label: "Effective Fed Funds Rate", group: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.83, vol: 0.006, drift: 0 },
  { id: "OBFR", short: "OBFR", label: "Overnight Bank Funding Rate", group: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.84, vol: 0.006, drift: 0 },
  { id: "SOFR", short: "SOFR", label: "Secured Overnight Financing Rate", group: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.82, vol: 0.02, drift: 0 },
  { id: "BGCR", short: "BGCR", label: "Broad General Collateral Rate", group: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.8, vol: 0.018, drift: 0 },
  { id: "TGCR", short: "TGCR", label: "Tri-Party General Collateral Rate", group: "Overnight", unit: "%", decimals: 2, hasFred: true, anchor: 4.79, vol: 0.018, drift: 0 },
  // Balances
  { id: "RRPONTSYD", short: "RRP", label: "Overnight Reverse Repo (take-up)", group: "Balances", unit: "$B", decimals: 0, hasFred: true, anchor: 470, vol: 18, drift: -0.4 },
  { id: "WRESBAL", short: "Reserves", label: "Reserve Balances at the Fed", group: "Balances", unit: "$T", decimals: 2, hasFred: true, anchor: 3.25, vol: 0.012, drift: -0.0006 },
  { id: "WALCL", short: "Fed B/S", label: "Fed Total Assets", group: "Balances", unit: "$T", decimals: 2, hasFred: true, anchor: 6.85, vol: 0.006, drift: -0.0008 },
  // Bills
  { id: "DTB4WK", short: "1M Bill", label: "4-Week T-Bill Yield", group: "Bills", unit: "%", decimals: 2, hasFred: true, anchor: 4.78, vol: 0.01, drift: 0 },
  { id: "DTB3", short: "3M Bill", label: "3-Month T-Bill Yield", group: "Bills", unit: "%", decimals: 2, hasFred: true, anchor: 4.7, vol: 0.012, drift: 0 },
  { id: "DTB6", short: "6M Bill", label: "6-Month T-Bill Yield", group: "Bills", unit: "%", decimals: 2, hasFred: true, anchor: 4.58, vol: 0.014, drift: 0 },
  // FX cross-currency basis (3M, bps) — SIM until BIS feed
  { id: "XCCY_EUR", short: "EUR Basis", label: "EURUSD 3M X-Ccy Basis", group: "FX Basis", unit: "bps", decimals: 0, hasFred: false, anchor: -14, vol: 1.6, drift: 0 },
  { id: "XCCY_JPY", short: "JPY Basis", label: "USDJPY 3M X-Ccy Basis", group: "FX Basis", unit: "bps", decimals: 0, hasFred: false, anchor: -28, vol: 2.4, drift: 0 },
  { id: "XCCY_GBP", short: "GBP Basis", label: "GBPUSD 3M X-Ccy Basis", group: "FX Basis", unit: "bps", decimals: 0, hasFred: false, anchor: -9, vol: 1.4, drift: 0 },
];

export const FUNDING_FRED_IDS = FUNDING_SERIES.filter((s) => s.hasFred).map((s) => s.id);
const BY_ID = new Map(FUNDING_SERIES.map((s) => [s.id, s]));

export interface Obs {
  date: string;
  value: number;
}
export type SeriesMap = Record<string, Obs[]>;

/** Fixed recent anchor so SIM dates look current and never drift across renders. */
const END_DATE = new Date("2026-06-19T00:00:00Z");

function businessDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date(END_DATE);
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

/** Deterministic daily history for a funding series, ending at the anchor level. */
function simSeriesFromDef(def: FundingDef | undefined, id: string, n: number): Obs[] {
  const dates = businessDates(n);
  if (!def) return dates.map((date) => ({ date, value: 0 }));
  const rng = new Rng(`fund-${id}`);
  // Build backwards from the anchor with mean-reverting noise so the latest = anchor.
  const vals: number[] = new Array(n);
  vals[n - 1] = def.anchor;
  for (let i = n - 2; i >= 0; i--) {
    const meanRevert = (def.anchor - vals[i + 1]) * 0.04;
    vals[i] = vals[i + 1] - def.drift + meanRevert + rng.normal(0, def.vol);
  }
  return dates.map((date, i) => ({ date, value: Number(vals[i].toFixed(def.decimals + 2)) }));
}

/** Deterministic daily history for a funding series, ending at the anchor level. */
export function simSeries(id: string, n = 260): Obs[] {
  return simSeriesFromDef(BY_ID.get(id), id, n);
}

/** All series as deterministic SIM histories (the fallback tier). */
export function buildFallback(n = 260): SeriesMap {
  const map: SeriesMap = {};
  for (const s of FUNDING_SERIES) map[s.id] = simSeries(s.id, n);
  return map;
}

/**
 * Same as buildFallback but uses Gold DB benchmark values where keys match a
 * funding series id (for example SOFR). Unknown keys are ignored.
 */
export function buildFallbackWithAnchors(overrides: Record<string, number>, n = 260): SeriesMap {
  const map: SeriesMap = {};
  for (const s of FUNDING_SERIES) {
    const anchor = overrides[s.id];
    map[s.id] = simSeriesFromDef(anchor != null ? { ...s, anchor } : s, s.id, n);
  }
  return map;
}

const latest = (obs: Obs[] | undefined): number | null => (obs && obs.length ? obs[obs.length - 1].value : null);
const prior = (obs: Obs[] | undefined): number | null => (obs && obs.length > 1 ? obs[obs.length - 2].value : null);

export function defOf(id: string): FundingDef | undefined {
  return BY_ID.get(id);
}

// ── Derived funding spreads (bps) ────────────────────────────────────────────

export interface SpreadRow {
  id: string;
  label: string;
  desc: string;
  valueBps: number | null;
  hist: number[]; // bps history for sparkline
  percentile: number | null; // 0-100 within own history
  stressHigh: boolean; // true = wide is stress
}

function diffBps(a: Obs[] | undefined, b: Obs[] | undefined): { value: number | null; hist: number[] } {
  if (!a || !b) return { value: null, hist: [] };
  const m = new Map(b.map((o) => [o.date, o.value]));
  const hist: number[] = [];
  for (const o of a) {
    const bv = m.get(o.date);
    if (bv != null) hist.push((o.value - bv) * 100);
  }
  return { value: hist.length ? hist[hist.length - 1] : null, hist };
}

function percentileOf(hist: number[], v: number | null): number | null {
  if (v == null || hist.length < 5) return null;
  const below = hist.filter((x) => x <= v).length;
  return Math.round((below / hist.length) * 100);
}

export function computeSpreads(map: SeriesMap): SpreadRow[] {
  const fraOis = map["FRA_OIS"]; // synthesized below if present
  const rows: { id: string; label: string; desc: string; a: string; b: string; stressHigh: boolean }[] = [
    { id: "sofr_effr", label: "SOFR − EFFR", desc: "Secured vs unsecured o/n; wide = repo pressure", a: "SOFR", b: "EFFR", stressHigh: true },
    { id: "sofr_iorb", label: "SOFR − IORB", desc: "Repo vs admin floor; rising toward 0 = tightening", a: "SOFR", b: "IORB", stressHigh: true },
    { id: "gc_ois", label: "GC − OIS", desc: "Tri-party GC vs fed funds; wide = collateral pressure", a: "TGCR", b: "EFFR", stressHigh: true },
    { id: "bill_ois", label: "Bill − OIS", desc: "3M bill vs fed funds; very negative = bill scarcity", a: "DTB3", b: "EFFR", stressHigh: false },
  ];
  const out = rows.map((r) => {
    const { value, hist } = diffBps(map[r.a], map[r.b]);
    return { id: r.id, label: r.label, desc: r.desc, valueBps: value, hist, percentile: percentileOf(hist, value), stressHigh: r.stressHigh };
  });
  // FRA-OIS is a standalone synthesized stress gauge (bps).
  if (fraOis) {
    const hist = fraOis.map((o) => o.value);
    const v = latest(fraOis);
    out.push({ id: "fra_ois", label: "FRA − OIS", desc: "Forward bank funding stress (3M)", valueBps: v, hist, percentile: percentileOf(hist, v), stressHigh: true });
  }
  return out;
}

/** Standalone FRA-OIS series (SIM) — added to the map for spreads + gauge. */
export function fraOisSeries(n = 260): Obs[] {
  const dates = businessDates(n);
  const rng = new Rng("fund-FRA_OIS");
  const anchor = 17; // bps
  const vals: number[] = new Array(n);
  vals[n - 1] = anchor;
  for (let i = n - 2; i >= 0; i--) vals[i] = Math.max(2, vals[i + 1] + (anchor - vals[i + 1]) * 0.05 + rng.normal(0, 1.3));
  return dates.map((date, i) => ({ date, value: Number(vals[i].toFixed(1)) }));
}

// ── Funding-stress gauge ─────────────────────────────────────────────────────

export interface GaugeComponent {
  label: string;
  contribution: number; // 0-100
  detail: string;
}
export interface FundingGauge {
  score: number; // 0-100
  regime: "Calm" | "Watch" | "Stressed";
  readThrough: string;
  components: GaugeComponent[];
  quarterEndDays: number;
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Days until the next quarter-end from the fixed anchor date. */
function daysToQuarterEnd(): number {
  const d = END_DATE;
  const y = d.getUTCFullYear();
  const ends = [new Date(Date.UTC(y, 2, 31)), new Date(Date.UTC(y, 5, 30)), new Date(Date.UTC(y, 8, 30)), new Date(Date.UTC(y, 11, 31)), new Date(Date.UTC(y + 1, 2, 31))];
  for (const e of ends) {
    const diff = Math.round((e.getTime() - d.getTime()) / 86_400_000);
    if (diff >= 0) return diff;
  }
  return 90;
}

export function computeGauge(map: SeriesMap): FundingGauge {
  const sofrEffr = diffBps(map["SOFR"], map["EFFR"]).value ?? 0; // bps, stress when high
  const fra = latest(map["FRA_OIS"]) ?? 17;
  const rrp = latest(map["RRPONTSYD"]) ?? 470; // $B, low = thin buffer
  const eurBasis = latest(map["XCCY_EUR"]) ?? -14; // more negative = stress
  const qe = daysToQuarterEnd();

  // Each component normalized to 0-100 stress.
  const cSofr = clamp((sofrEffr + 2) * 6); // ~ -2bps calm → 0; +15bps → ~100
  const cFra = clamp((fra - 8) * 2.5); // 8bps calm → 0; 48bps → 100
  const cRrp = clamp((600 - rrp) / 6); // $600B buffer → 0; $0 → 100
  const cBasis = clamp((-eurBasis - 8) * 3); // -8bps → 0; -41bps → ~100
  const cCal = clamp(qe <= 10 ? (10 - qe) * 10 : 0); // ramps in the last 10 days

  const components: GaugeComponent[] = [
    { label: "SOFR − EFFR", contribution: Math.round(cSofr), detail: `${sofrEffr >= 0 ? "+" : ""}${sofrEffr.toFixed(1)}bps` },
    { label: "FRA − OIS", contribution: Math.round(cFra), detail: `${fra.toFixed(1)}bps` },
    { label: "RRP buffer", contribution: Math.round(cRrp), detail: `$${rrp.toFixed(0)}B` },
    { label: "EUR x-ccy basis", contribution: Math.round(cBasis), detail: `${eurBasis.toFixed(0)}bps` },
    { label: "Quarter-end", contribution: Math.round(cCal), detail: `${qe}d out` },
  ];
  const score = Math.round(clamp(0.3 * cSofr + 0.25 * cFra + 0.2 * cRrp + 0.15 * cBasis + 0.1 * cCal));
  const regime = score >= 65 ? "Stressed" : score >= 35 ? "Watch" : "Calm";
  const readThrough =
    regime === "Stressed"
      ? "Funding markets tightening — expect GC to firm, financing spreads to widen, and specials to cheapen. Term out early."
      : regime === "Watch"
      ? "Funding conditions firming at the margin — watch GC and quarter-end pressure; reinvestment yields drifting."
      : "Funding ample and stable — GC soft, financing tight, reinvestment carry steady.";
  return { score, regime, readThrough, components, quarterEndDays: qe };
}

// ── Desk-action read-throughs ────────────────────────────────────────────────

export type FundingDesk = "Repo" | "Agency" | "Prime" | "Cash" | "Collateral" | "E-Trading";
export type DeskSignalTone = "Calm" | "Watch" | "Stress";
export type FundingSignalSource = "FRED" | "SIM";

export interface FundingDeskSignal {
  desk: FundingDesk;
  signal: string;
  score: number;
  tone: DeskSignalTone;
  driver: string;
  derivation: string;
  action: string;
  source: FundingSignalSource;
}

function toneFor(score: number): DeskSignalTone {
  if (score >= 70) return "Stress";
  if (score >= 40) return "Watch";
  return "Calm";
}

function sourceFor(ids: string[], liveIds?: Set<string>): FundingSignalSource {
  return ids.some((id) => liveIds?.has(id)) ? "FRED" : "SIM";
}

function trendDelta(obs: Obs[] | undefined, periods = 20): number | null {
  if (!obs || obs.length < 2) return null;
  const end = obs[obs.length - 1].value;
  const start = obs[Math.max(0, obs.length - 1 - periods)].value;
  return end - start;
}

function fundingAction(tone: DeskSignalTone, calm: string, watch: string, stress: string): string {
  if (tone === "Stress") return stress;
  if (tone === "Watch") return watch;
  return calm;
}

export function computeDeskSignals(map: SeriesMap, liveIds?: Set<string>): FundingDeskSignal[] {
  const sofrEffr = diffBps(map["SOFR"], map["EFFR"]).value ?? 0;
  const tgcrEffr = diffBps(map["TGCR"], map["EFFR"]).value ?? 0;
  const sofrIorb = diffBps(map["SOFR"], map["IORB"]).value ?? -10;
  const billOis = diffBps(map["DTB3"], map["EFFR"]).value ?? -10;
  const fra = latest(map["FRA_OIS"]) ?? 17;
  const rrp = latest(map["RRPONTSYD"]) ?? 470;
  const rrpDelta20 = trendDelta(map["RRPONTSYD"], 20) ?? 0;
  const reserves = latest(map["WRESBAL"]) ?? 3.25;
  const reservesDelta20 = trendDelta(map["WRESBAL"], 20) ?? 0;
  const eurBasis = latest(map["XCCY_EUR"]) ?? -14;
  const qe = daysToQuarterEnd();

  const repoScore = Math.round(clamp(sofrEffr * 3.5 + tgcrEffr * 2.5 + Math.max(0, sofrIorb + 8) * 4));
  const agencyScore = Math.round(clamp(repoScore * 0.45 + Math.max(0, -billOis) * 1.2 + Math.max(0, -rrpDelta20 / 5) + Math.max(0, 10 - qe) * 4));
  const primeScore = Math.round(clamp(repoScore * 0.35 + fra * 1.4 + Math.max(0, 3.1 - reserves) * 35 + Math.max(0, -eurBasis - 10) * 1.1));
  const cashScore = Math.round(clamp(Math.max(0, -billOis) * 1.6 + Math.max(0, -rrpDelta20 / 8) + Math.max(0, -reservesDelta20 * 90)));
  const collateralScore = Math.round(clamp(tgcrEffr * 3 + Math.max(0, -billOis) * 1.3 + Math.max(0, 600 - rrp) / 8));
  const etradingScore = Math.round(clamp(primeScore * 0.35 + collateralScore * 0.35 + fra * 0.8 + Math.max(0, 10 - qe) * 3));

  const repoTone = toneFor(repoScore);
  const agencyTone = toneFor(agencyScore);
  const primeTone = toneFor(primeScore);
  const cashTone = toneFor(cashScore);
  const collateralTone = toneFor(collateralScore);
  const etradingTone = toneFor(etradingScore);

  return [
    {
      desk: "Repo",
      signal: "GC pressure",
      score: repoScore,
      tone: repoTone,
      driver: `SOFR-EFFR ${sofrEffr.toFixed(1)}bps; TGCR-EFFR ${tgcrEffr.toFixed(1)}bps`,
      derivation: "Score blends SOFR-EFFR, TGCR-EFFR, and SOFR proximity to IORB; wider secured funding spreads raise stress.",
      action: fundingAction(repoTone, "Keep GC pricing normal.", "Watch term repo prints and avoid underpricing specials funding.", "Term out funding and widen repo/financing marks."),
      source: sourceFor(["SOFR", "EFFR", "TGCR", "IORB"], liveIds),
    },
    {
      desk: "Agency",
      signal: "Lending economics",
      score: agencyScore,
      tone: agencyTone,
      driver: `Bill-OIS ${billOis.toFixed(1)}bps; RRP 20d ${rrpDelta20.toFixed(0)}B; q-end ${qe}d`,
      derivation: "Score combines repo pressure, bill scarcity, RRP buffer change, and quarter-end proximity to flag reinvestment and specials pressure.",
      action: fundingAction(agencyTone, "Normal agency lending spread backdrop.", "Review GC-specials assumptions and cash reinvestment duration.", "Protect spread, recheck rebate floors, and source collateral early."),
      source: sourceFor(["SOFR", "EFFR", "DTB3", "RRPONTSYD"], liveIds),
    },
    {
      desk: "Prime",
      signal: "Financing pressure",
      score: primeScore,
      tone: primeTone,
      driver: `FRA-OIS ${fra.toFixed(1)}bps; reserves $${reserves.toFixed(2)}T; EUR basis ${eurBasis.toFixed(0)}bps`,
      derivation: "Score blends repo spread, bank funding stress, reserve buffer, and USD basis pressure as a proxy for prime financing tightness.",
      action: fundingAction(primeTone, "Keep client financing assumptions steady.", "Check concentrated balance-sheet users and term financing rolls.", "Widen financing, review margin sensitivity, and reduce balance-sheet concessions."),
      source: sourceFor(["SOFR", "EFFR", "WRESBAL"], liveIds),
    },
    {
      desk: "Cash",
      signal: "Reinvestment stance",
      score: cashScore,
      tone: cashTone,
      driver: `Bill-OIS ${billOis.toFixed(1)}bps; RRP 20d ${rrpDelta20.toFixed(0)}B; reserves 20d ${reservesDelta20.toFixed(2)}T`,
      derivation: "Score rises when bills richen versus OIS, RRP drains, or reserves fall; this can compress reinvestment optionality.",
      action: fundingAction(cashTone, "Leave reinvestment ladder unchanged.", "Keep optionality in overnight/short bills.", "Avoid reaching for term; prioritize liquidity over yield pickup."),
      source: sourceFor(["DTB3", "EFFR", "RRPONTSYD", "WRESBAL"], liveIds),
    },
    {
      desk: "Collateral",
      signal: "Scarcity risk",
      score: collateralScore,
      tone: collateralTone,
      driver: `TGCR-EFFR ${tgcrEffr.toFixed(1)}bps; Bill-OIS ${billOis.toFixed(1)}bps; RRP $${rrp.toFixed(0)}B`,
      derivation: "Score combines GC spread, bill scarcity, and remaining RRP liquidity buffer as a proxy for high-quality collateral tightness.",
      action: fundingAction(collateralTone, "Collateral schedule can stay standard.", "Pre-position HQLA and review haircut-sensitive exposures.", "Tighten collateral eligibility and escalate substitution requests early."),
      source: sourceFor(["TGCR", "EFFR", "DTB3", "RRPONTSYD"], liveIds),
    },
    {
      desk: "E-Trading",
      signal: "Liquidity stance",
      score: etradingScore,
      tone: etradingTone,
      driver: `Prime ${primeScore}/100; collateral ${collateralScore}/100; q-end ${qe}d`,
      derivation: "Score maps funding, collateral, bank funding, and calendar pressure into an execution-liquidity caution proxy.",
      action: fundingAction(etradingTone, "Normal participation and routing assumptions.", "Use more patient execution on funding-sensitive products.", "Reduce aggression, raise slippage assumptions, and monitor ETF/credit liquidity."),
      source: sourceFor(["SOFR", "EFFR", "TGCR", "WRESBAL"], liveIds),
    },
  ];
}

// ── Headline summary ─────────────────────────────────────────────────────────

export interface FundingSummary {
  sofr: number | null;
  sofrChg: number | null;
  sofrEffrBps: number | null;
  rrp: number | null;
  reserves: number | null;
  stress: number;
  regime: FundingGauge["regime"];
}

export function computeSummary(map: SeriesMap, gauge: FundingGauge): FundingSummary {
  const sofr = latest(map["SOFR"]);
  const sofrP = prior(map["SOFR"]);
  return {
    sofr,
    sofrChg: sofr != null && sofrP != null ? (sofr - sofrP) * 100 : null,
    sofrEffrBps: diffBps(map["SOFR"], map["EFFR"]).value,
    rrp: latest(map["RRPONTSYD"]),
    reserves: latest(map["WRESBAL"]),
    stress: gauge.score,
    regime: gauge.regime,
  };
}
