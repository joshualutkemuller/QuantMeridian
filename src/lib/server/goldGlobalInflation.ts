/**
 * Global inflation: reads gold.global_inflation, builds CountryInflation[] overlay.
 *
 * Replaces the macro_data_etl snapshot (etlMacro.ts etlCountryCPI).
 */

import { GoldStore } from "./goldStore";
import type { CountryInflation, Trend } from "@/data/globalMacro";

interface GoldInflationRow {
  country: string;
  iso3: string;
  region: string;
  series_id: string;
  observation_date: string;
  cpi_yoy_pct: number | null;
  change_pp: number | null;
  trend: string | null;
  streak: number | null;
  target_pct: number | null;
  vs_target_pp: number | null;
}

/**
 * Build CountryInflation overlay from gold.global_inflation.
 *
 * Takes a base (SIM) CountryInflation and overlays Gold data where available.
 * Returns null if Gold has no inflation data.
 */
export async function buildGlobalInflationFromGold(
  store: GoldStore,
  base: CountryInflation,
): Promise<CountryInflation | null> {
  const rows = await store.latest<GoldInflationRow>("global_inflation");
  if (!rows.length) return null;

  // Find the row matching this country's ISO3
  const row = rows.find((r) => r.iso3 === base.iso3 ?? r.country === base.country);
  if (!row || row.cpi_yoy_pct == null) return null;

  const yoy = Number(row.cpi_yoy_pct.toFixed(1));
  const priorYoy =
    base.priorYoy != null && row.change_pp != null
      ? Number((yoy - row.change_pp).toFixed(1))
      : base.priorYoy;

  const trend = (row.trend === "RISING" || row.trend === "FALLING" || row.trend === "FLAT"
    ? row.trend
    : "FLAT") as Trend;

  const target =
    row.target_pct != null && row.vs_target_pp != null
      ? Number((yoy - row.vs_target_pp).toFixed(1))
      : base.target;

  const vsTarget =
    row.vs_target_pp != null ? Number(row.vs_target_pp.toFixed(1)) : Number((yoy - base.target).toFixed(1));

  // Gold only provides annual data (World Bank); no monthly decomposition
  return {
    ...base,
    yoy,
    priorYoy,
    mom: null, // Gold data is annual, no monthly
    momDelta: null,
    yoyDelta: row.change_pp != null ? Number(row.change_pp.toFixed(2)) : Number((yoy - priorYoy).toFixed(2)),
    trend,
    streak: row.streak ?? (trend === "FLAT" ? 0 : 1),
    target,
    vsTarget,
    // Keep the SIM history if shorter than 2 points (Cold start); otherwise trust the SIM
    history: base.history,
    source: "DB" as const,
    asOf: row.observation_date,
  };
}

/**
 * Batch overlay Gold data on a set of base (SIM) CountryInflation rows.
 * Returns the input unchanged for countries without Gold data.
 */
export async function overlayGoldInflation(
  store: GoldStore,
  base: CountryInflation[],
): Promise<CountryInflation[]> {
  return Promise.all(
    base.map(async (b) => {
      const gold = await buildGlobalInflationFromGold(store, b);
      return gold ?? b;
    }),
  );
}
