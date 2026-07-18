/**
 * macro_data_etl gold-table bridge.
 *
 * The Python ETL (`/macro_data_etl` in the rl_hub repo) lands global inflation
 * (World Bank), policy rates (BIS), and CME FedWatch probabilities into gold
 * tables and exports them to JSON via `macro-etl export`. Those JSON snapshots
 * are committed here under `src/data/etl/` and imported at build time so the
 * terminal renders them with zero configuration and no hydration drift.
 *
 * Run the ETL with network access (`macro-etl run --source all && macro-etl
 * fedwatch && macro-etl export …`) to refresh these with live values; the
 * shapes are identical, so nothing else changes.
 */

import fedProbabilitiesRaw from "./etl/fed_probabilities.json";
import countryLatestRaw from "./etl/country_macro_latest.json";
import inflationTimeseriesRaw from "./etl/inflation_timeseries.json";
import { CURRENT_TARGET, type FomcMeeting } from "./econRates";

// Effective fed funds trades a few bp inside the target midpoint; the ETL's
// FedProbabilityEngine anchors its rates on (mid + IORB spread).
const IORB_SPREAD = 0.08;

export interface EtlFedProbability {
  meeting_date: string;
  expected_rate: number;
  cut_prob: number;
  hold_prob: number;
  hike_prob: number;
  implied_move_bps: number;
  outcomes_json: string;
  price_source: "cme" | "fred_model" | "sim";
  as_of?: string;
  source_detail?: string;
  model_inputs_json?: string;
}

export interface EtlCountryMacro {
  country_iso3: string;
  country_name: string | null;
  region: string | null;
  flag: string | null;
  cpi_yoy: number | null;
  cpi_prior: number | null;
  cpi_trend: string | null;
  cpi_streak: number | null;
  policy_rate: number | null;
  rate_prior: number | null;
  rate_cycle: string | null;
  rate_streak: number | null;
  real_rate: number | null;
  vs_target: number | null;
  last_updated: string | null;
}

export type EtlInflationTimeseriesRow = { date: string } & Record<string, number | string | null>;

export const etlFedProbabilities: EtlFedProbability[] = fedProbabilitiesRaw as EtlFedProbability[];
export const etlCountryMacro: EtlCountryMacro[] = countryLatestRaw as EtlCountryMacro[];
export const etlInflationTimeseries: EtlInflationTimeseriesRow[] = inflationTimeseriesRaw as EtlInflationTimeseriesRow[];

/** True when an ETL snapshot is present and non-empty. */
export function hasEtlFedData(): boolean {
  return Array.isArray(etlFedProbabilities) && etlFedProbabilities.length > 0;
}

export function hasEtlCountryData(): boolean {
  return Array.isArray(etlCountryMacro) && etlCountryMacro.length > 0;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Days between a meeting date and the terminal's reference "today" (UTC). */
function daysFromToday(meetingDate: string, today = "2026-06-18"): number {
  const ms = Date.parse(meetingDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z");
  return Math.round(ms / 86400000);
}

function labelFor(meetingDate: string): string {
  const [y, m] = meetingDate.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * Convert ETL fed-probabilities into the terminal's `FomcMeeting[]` shape.
 *
 * The ETL outcomes ladder is in absolute *effective* rates; we rebase to the
 * per-meeting reference rate (chained from the prior meeting's expected rate)
 * to recover discrete bp moves, and convert implied/expected rates back to the
 * terminal's target-midpoint scale by removing the IORB spread.
 *
 * @param spotEffectiveRate - Live SOFR/EFFR from Gold DB benchmarks. When
 *   provided this replaces the static `CURRENT_TARGET.mid + IORB_SPREAD`
 *   anchor so the probability ladder is grounded in the actual effective rate.
 */
export function fomcFromEtl(spotEffectiveRate?: number): FomcMeeting[] {
  const rows = [...etlFedProbabilities].sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  let refRate = spotEffectiveRate ?? (CURRENT_TARGET.mid + IORB_SPREAD); // pre-first-meeting effective rate

  return rows.map((r) => {
    let ladder: Record<string, number> = {};
    try {
      ladder = JSON.parse(r.outcomes_json) as Record<string, number>;
    } catch {
      ladder = {};
    }

    const outcomes = Object.entries(ladder)
      .map(([rateStr, prob]) => {
        const rate = Number(rateStr);
        const move = Math.round((rate - refRate) / 0.25) * 25; // bps vs reference
        return { move, prob: Number(prob) };
      })
      .sort((a, b) => a.move - b.move);

    // Fall back to cut/hold/hike summary if the ladder was unparseable.
    const safeOutcomes =
      outcomes.length > 0
        ? outcomes
        : [
            { move: -25, prob: r.cut_prob },
            { move: 0, prob: r.hold_prob },
            { move: 25, prob: r.hike_prob },
          ].filter((o) => o.prob > 0);

    const ml = safeOutcomes.reduce((a, b) => (b.prob > a.prob ? b : a), safeOutcomes[0]);
    const mostLikely = ml.move === 0 ? "Hold" : ml.move < 0 ? `${Math.abs(ml.move)}bp Cut` : `${ml.move}bp Hike`;

    const impliedRate = Number((r.expected_rate - IORB_SPREAD).toFixed(3));
    refRate = r.expected_rate; // chain to next meeting

    return {
      date: r.meeting_date,
      label: labelFor(r.meeting_date),
      daysOut: daysFromToday(r.meeting_date),
      outcomes: safeOutcomes,
      impliedRate,
      mostLikely,
    };
  });
}

/** Implied policy path (target-mid scale) derived from the ETL meetings. */
export function impliedPathFromEtl(spotEffectiveRate?: number): { label: string; rate: number }[] {
  const nowRate = spotEffectiveRate != null ? spotEffectiveRate - IORB_SPREAD : CURRENT_TARGET.mid;
  return [{ label: "Now", rate: nowRate }, ...fomcFromEtl(spotEffectiveRate).map((m) => ({ label: m.label, rate: m.impliedRate }))];
}

/** Price source of the ETL FedWatch snapshot ("cme" live, "fred_model", or "sim"). */
export function etlFedSource(): "cme" | "fred_model" | "sim" | null {
  return etlFedProbabilities[0]?.price_source ?? null;
}

/** Futures-pricing date the FedWatch probabilities were derived from. */
export function etlFedAsOf(): string | null {
  return etlFedProbabilities[0]?.as_of ?? null;
}

/** Human-readable derivation note emitted by macro_data_etl for FedWatch rows. */
export function etlFedSourceDetail(): string | null {
  return etlFedProbabilities[0]?.source_detail ?? null;
}

export interface EtlFedModelInputs {
  method?: string;
  generated_at?: string;
  series_as_of?: Record<string, string>;
  spot_effective_rate?: number;
  target_low?: number;
  target_high?: number;
  short_rate_proxies?: Record<string, number | null>;
  pass_through?: number;
  note?: string;
}

/** Parsed model inputs when FedWatch is derived from the FRED model fallback. */
export function etlFedModelInputs(): EtlFedModelInputs | null {
  const raw = etlFedProbabilities[0]?.model_inputs_json;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EtlFedModelInputs;
  } catch {
    return null;
  }
}
