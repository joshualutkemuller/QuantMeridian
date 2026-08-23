import { Rng } from "@/lib/rng";

/**
 * Inflation explorer data — CPI, Core CPI, PCE, Core PCE down to item level.
 *
 * For every series we expose the monthly index reading, the MoM % change, the
 * YoY % change, and how much those % numbers changed vs the prior print
 * (momAccel / yoyAccel — i.e. acceleration / deceleration). Each item carries
 * its FRED id so it is drillable to a rolling-24-month live view.
 */

export type InflationGroup = "CPI" | "CORE_CPI" | "PCE" | "CORE_PCE";
export type InflationSubgroup = "headline" | "food" | "energy" | "housing" | "medical" | "transportation" | "goods" | "services" | "other";
export type SeasonalAdjustment = "SA" | "NSA";
export type ComponentLevel = "core" | "expanded";

export interface InflationComponentDef {
  id: string;
  label: string;
  group: "CPI" | "PCE";
  subgroup?: InflationSubgroup;
  seasonalAdjustment: SeasonalAdjustment;
  weight: number | null;
  baseYoY: number;
  includeInDefault: boolean;
  contributionEligible: boolean;
  preferredOver?: string;
}

export interface InflationItem {
  id: string; // FRED series id
  label: string;
  group: InflationGroup;
  kind: "HEADLINE" | "COMPONENT";
  weight: number | null; // % of basket (components), null when not verified
  index: number; // latest index level
  mom: number; // MoM %
  yoy: number; // YoY %
  priorMom: number;
  priorYoy: number;
  momAccel: number; // mom - priorMom
  yoyAccel: number; // yoy - priorYoy
  contribution: number | null; // weighted YoY contribution (pp)
  subgroup?: InflationSubgroup;
  seasonalAdjustment?: SeasonalAdjustment;
  contributionEligible: boolean;
}

// [fredId, label, group, weight%, baseYoY, baseIndex]
const HEADLINES: [string, string, InflationGroup, number][] = [
  ["CPIAUCSL", "CPI — All Items", "CPI", 2.6],
  ["CPILFESL", "Core CPI (ex Food & Energy)", "CORE_CPI", 3.0],
  ["PCEPI", "PCE Price Index", "PCE", 2.3],
  ["PCEPILFE", "Core PCE (ex Food & Energy)", "CORE_PCE", 2.6],
];

const component = (
  id: string,
  label: string,
  group: "CPI" | "PCE",
  subgroup: InflationSubgroup,
  weight: number | null,
  baseYoY: number,
  includeInDefault = true,
  contributionEligible = weight != null,
  seasonalAdjustment: SeasonalAdjustment = "SA",
  preferredOver?: string
): InflationComponentDef => ({
  id,
  label,
  group,
  subgroup,
  seasonalAdjustment,
  weight,
  baseYoY,
  includeInDefault,
  contributionEligible,
  preferredOver,
});

const CPI_COMPONENTS: InflationComponentDef[] = [
  component("CUSR0000SAH1", "Shelter", "CPI", "housing", 34.8, 3.9),
  component("CUSR0000SEHC", "Owners' Equiv. Rent", "CPI", "housing", 26.8, 4.1),
  component("CUSR0000SEHA", "Rent of Primary Residence", "CPI", "housing", 7.6, 3.8),
  component("CPIUFDSL", "Food", "CPI", "food", 13.4, 2.2),
  component("CUSR0000SAF11", "Food at Home", "CPI", "food", 8.1, 1.6),
  component("CUSR0000SEFV", "Food Away from Home", "CPI", "food", 5.3, 3.4),
  component("CPIENGSL", "Energy", "CPI", "energy", 6.8, -1.8),
  component("CUSR0000SETB01", "Gasoline", "CPI", "energy", 3.3, -4.2),
  component("CUSR0000SEHF01", "Electricity", "CPI", "energy", 2.5, 3.1),
  component("CPIMEDSL", "Medical Care", "CPI", "medical", 8.1, 3.0),
  component("CUSR0000SETA01", "New Vehicles", "CPI", "goods", 4.1, 0.4),
  component("CUSR0000SETA02", "Used Cars & Trucks", "CPI", "goods", 2.6, -1.9),
  component("CPIAPPSL", "Apparel", "CPI", "goods", 2.5, 0.7),
  component("CPITRNSL", "Transportation Services", "CPI", "transportation", 5.9, 4.6),
  component("CUSR0000SEMD", "Hospital Services", "CPI", "medical", 1.9, 4.0),
  component("CUSR0000SAS367", "Airline Fares", "CPI", "transportation", 0.8, -2.4),
  component("CPIRECSL", "Recreation", "CPI", "other", 5.2, 1.9),
  component("CUSR0000SAE1", "Education & Communication", "CPI", "other", 5.8, 1.2),

  // Phase 1 expanded SA national CPI additions. Weights are CPI-U relative
  // importance, U.S. city average, December 2025 (BLS table 1, 2024 weights).
  component("CUSR0000SAC", "Commodities", "CPI", "goods", 35.994, 0.8, false),
  component("CUSR0000SACL1E", "Core Goods", "CPI", "goods", 19.176, 0.4, false),
  component("CUSR0000SAF", "Food & Beverages", "CPI", "food", 14.539, 2.4, false),
  component("CUSR0000SAH", "Housing", "CPI", "housing", 44.469, 3.7, false),
  component("CUSR0000SAH2", "Fuels & Utilities", "CPI", "housing", 4.546, 2.2, false),
  component("CUSR0000SAM1", "Medical Care Commodities", "CPI", "medical", 1.489, 2.1, false),
  component("CUSR0000SAM2", "Medical Care Services", "CPI", "medical", 6.935, 3.4, false),
  component("CUSR0000SAS", "Services", "CPI", "services", 64.006, 3.6, false),
  component("CUSR0000SASLE", "Core Services ex Energy", "CPI", "services", 60.744, 3.7, false),
  component("CUSR0000SEHF02", "Utility Gas Service", "CPI", "energy", 0.773, -0.5, false),
  component("CUSR0000SAG", "Other Goods & Services", "CPI", "other", 2.902, 2.0, false),
];

const PCE_COMPONENTS: InflationComponentDef[] = [
  component("DGDSRG3M086SBEA", "Goods", "PCE", "goods", 33.5, 0.3),
  component("DSERRG3M086SBEA", "Services", "PCE", "services", 66.5, 3.4),
  component("DNRGRG3M086SBEA", "Energy Goods & Services", "PCE", "energy", 4.1, -1.6),
  component("DFXARG3M086SBEA", "Food", "PCE", "food", 7.6, 2.0),
  component("DHUTRC1M027SBEA", "Housing & Utilities", "PCE", "housing", 17.8, 3.7),
  component("DHLCRG3M086SBEA", "Health Care", "PCE", "medical", 16.9, 2.9),
  component("DTRSRC1M027SBEA", "Transportation", "PCE", "transportation", 3.2, 1.4),
  component("DRCARC1M027SBEA", "Recreation", "PCE", "other", 3.6, 2.1),
];

function makeItem(
  id: string,
  label: string,
  group: InflationGroup,
  kind: InflationItem["kind"],
  weight: number | null,
  baseYoY: number,
  meta?: Pick<InflationComponentDef, "subgroup" | "seasonalAdjustment" | "contributionEligible">
): InflationItem {
  const rng = new Rng(`infl-${id}`);
  const yoy = Number((baseYoY + rng.normal(0, 0.15)).toFixed(2));
  const priorYoy = Number((yoy - rng.normal(0, 0.18)).toFixed(2));
  const mom = Number((yoy / 12 + rng.normal(0, 0.12)).toFixed(2));
  const priorMom = Number((mom - rng.normal(0, 0.14)).toFixed(2));
  const index = Number((100 * Math.pow(1 + yoy / 100, 4) + rng.float(180, 230)).toFixed(2));
  const contribution = weight == null ? null : Number(((weight / 100) * yoy).toFixed(2));
  return {
    id, label, group, kind, weight,
    index, yoy, priorYoy, mom, priorMom,
    momAccel: Number((mom - priorMom).toFixed(2)),
    yoyAccel: Number((yoy - priorYoy).toFixed(2)),
    contribution,
    subgroup: meta?.subgroup,
    seasonalAdjustment: meta?.seasonalAdjustment,
    contributionEligible: meta?.contributionEligible ?? weight != null,
  };
}

export function getInflationHeadlines(): InflationItem[] {
  return HEADLINES.map(([id, label, group, base]) => makeItem(id, label, group, "HEADLINE", 100, base, { subgroup: "headline", seasonalAdjustment: "SA", contributionEligible: false }));
}

function shiftMonth(date: string, delta: number): string {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const zeroBased = (year * 12) + (month - 1) + delta;
  const shiftedYear = Math.floor(zeroBased / 12);
  const shiftedMonth = (zeroBased % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}-01`;
}

/**
 * Recompute an inflation item from a live FRED *index-level* series (units=lin),
 * deriving the index reading, MoM %, YoY % and their accelerations. Falls back to
 * the simulation `base` if the history is too short. Used to take the explorer
 * fully live on the face values, not just the drill-down.
 */
export function liveInflationItem(base: InflationItem, obs: { date: string; value: number }[]): InflationItem {
  const pct = (a: number, b: number) => (b ? (a / b - 1) * 100 : 0);
  const byDate = new Map(obs.filter((o) => Number.isFinite(o.value)).map((o) => [o.date, o.value]));
  const latest = [...obs].reverse().find((o) => Number.isFinite(o.value));
  if (!latest) return base;

  const current = latest.value;
  const prevMonth = byDate.get(shiftMonth(latest.date, -1));
  const prevTwoMonths = byDate.get(shiftMonth(latest.date, -2));
  const yearAgo = byDate.get(shiftMonth(latest.date, -12));
  const prevMonthYearAgo = byDate.get(shiftMonth(latest.date, -13));
  if (prevMonth == null || prevTwoMonths == null || yearAgo == null || prevMonthYearAgo == null) return base;

  const mom = pct(current, prevMonth);
  const priorMom = pct(prevMonth, prevTwoMonths);
  const yoy = pct(current, yearAgo);
  const priorYoy = pct(prevMonth, prevMonthYearAgo);
  return {
    ...base,
    index: Number(current.toFixed(2)),
    mom: Number(mom.toFixed(2)),
    priorMom: Number(priorMom.toFixed(2)),
    yoy: Number(yoy.toFixed(2)),
    priorYoy: Number(priorYoy.toFixed(2)),
    momAccel: Number((mom - priorMom).toFixed(2)),
    yoyAccel: Number((yoy - priorYoy).toFixed(2)),
    contribution: base.weight == null ? null : Number(((base.weight / 100) * yoy).toFixed(2)),
  };
}

export function getInflationComponents(group: "CPI" | "PCE", level: ComponentLevel = "core"): InflationItem[] {
  const defs = group === "CPI" ? CPI_COMPONENTS : PCE_COMPONENTS;
  return defs
    .filter((def) => level === "expanded" || def.includeInDefault)
    .map((def) => makeItem(def.id, def.label, group === "CPI" ? "CPI" : "PCE", "COMPONENT", def.weight, def.baseYoY, def))
    .sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
}

export interface InflationSummary {
  cpiYoY: number;
  coreCpiYoY: number;
  pceYoY: number;
  corePceYoY: number;
  cpiMoM: number;
  coreCpiMoM: number;
  hottestComponent: { label: string; yoy: number };
  coolestComponent: { label: string; yoy: number };
  acceleratingCount: number;
  deceleratingCount: number;
}

export function getInflationSummary(): InflationSummary {
  const h = getInflationHeadlines();
  const comps = getInflationComponents("CPI");
  const sorted = [...comps].sort((a, b) => b.yoy - a.yoy);
  const get = (g: InflationGroup) => h.find((x) => x.group === g)!;
  return {
    cpiYoY: get("CPI").yoy,
    coreCpiYoY: get("CORE_CPI").yoy,
    pceYoY: get("PCE").yoy,
    corePceYoY: get("CORE_PCE").yoy,
    cpiMoM: get("CPI").mom,
    coreCpiMoM: get("CORE_CPI").mom,
    hottestComponent: { label: sorted[0].label, yoy: sorted[0].yoy },
    coolestComponent: { label: sorted[sorted.length - 1].label, yoy: sorted[sorted.length - 1].yoy },
    acceleratingCount: comps.filter((c) => c.yoyAccel > 0).length,
    deceleratingCount: comps.filter((c) => c.yoyAccel < 0).length,
  };
}
