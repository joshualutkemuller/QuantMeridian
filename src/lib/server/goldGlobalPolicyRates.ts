/**
 * Global policy rates: reads gold.global_policy_rates, builds PolicyRate[] overlay.
 *
 * Replaces the macro_data_etl snapshot (etlMacro.ts etlPolicyRate).
 */

import { GoldStore } from "./goldStore";
import type { PolicyRate, Trend } from "@/data/globalMacro";

interface GoldPolicyRateRow {
  country: string;
  iso3: string;
  region: string;
  series_id: string;
  observation_date: string;
  policy_rate_pct: number | null;
  change_bps: number | null;
  last_move_bps: number | null;
  stance: string | null;
  real_rate_pct: number | null;
}

/**
 * Build PolicyRate overlay from gold.global_policy_rates.
 *
 * Takes a base (SIM) PolicyRate and overlays Gold data where available.
 * Returns null if Gold has no policy rate data.
 */
export async function buildGlobalPolicyRateFromGold(
  store: GoldStore,
  base: PolicyRate,
): Promise<PolicyRate | null> {
  const rows = await store.latest<GoldPolicyRateRow>("global_policy_rates");
  if (!rows.length) return null;

  // Find the row matching this country's ISO3
  const row = rows.find((r) => r.iso3 === base.iso3 ?? r.country === base.country);
  if (!row || row.policy_rate_pct == null) return null;

  const rate = Number(row.policy_rate_pct.toFixed(2));
  const priorRate =
    base.priorRate != null && row.change_bps != null
      ? Number((rate - row.change_bps / 100).toFixed(2))
      : base.priorRate;

  const lastMoveBps = row.last_move_bps != null ? Math.round(row.last_move_bps) : Math.round((rate - priorRate) * 100);

  const cycle: PolicyRate["cycle"] =
    row.stance === "hiking"
      ? "HIKING"
      : row.stance === "cutting"
        ? "CUTTING"
        : "HOLD";

  const realRate =
    row.real_rate_pct != null ? Number(row.real_rate_pct.toFixed(1)) : Number((rate - (base.rate - base.realRate)).toFixed(1));

  const bias: PolicyRate["bias"] = realRate > 1.5 ? "HAWKISH" : realRate < 0 ? "DOVISH" : "NEUTRAL";

  // Keep the SIM history as-is; Gold doesn't provide history
  const history = [...base.history.slice(0, -1), priorRate, rate].slice(-10);

  return {
    ...base,
    rate,
    priorRate,
    lastMoveBps,
    cycle,
    realRate,
    bias,
    history,
    source: "DB" as const,
    asOf: row.observation_date,
  };
}

/**
 * Batch overlay Gold data on a set of base (SIM) PolicyRate rows.
 * Returns the input unchanged for countries without Gold data.
 */
export async function overlayGoldPolicyRates(
  store: GoldStore,
  base: PolicyRate[],
): Promise<PolicyRate[]> {
  return Promise.all(
    base.map(async (b) => {
      const gold = await buildGlobalPolicyRateFromGold(store, b);
      return gold ?? b;
    }),
  );
}
