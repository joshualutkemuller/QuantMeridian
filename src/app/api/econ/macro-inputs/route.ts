import { json } from "@/lib/server/http";
import { getMacroInputs } from "@/data/macroInputs";
import { simFallbackEnabled } from "@/lib/server/fallbacks";

export const runtime = "nodejs";

/**
 * GET /api/econ/macro-inputs
 *
 * Tier C Gold DB macro context — benchmark rates, curve, credit spreads,
 * funding stress, and regime signal for synthetic-book modules.
 *
 * Returns SIM defaults (source: "SIM") when MACRO_DB_URL is not configured.
 * Never returns an error — Tier C modules always get a usable input set.
 */
export async function GET(req: Request) {
  const inputs = await getMacroInputs();
  if (inputs.source === "SIM" && !simFallbackEnabled(req)) {
    return json({
      source: "ERR",
      curve: {},
      benchmarks: {},
      funding: { stress_gauge: null, sofr_effr_spread_bps: null, ioer_effr_spread_bps: null },
      credit: { hy_oas_bps: null, ig_oas_bps: null },
      regime: { named_regime: null, confidence: null, growth_score: null, inflation_score: null, financial_conditions_score: null },
      indicators: {},
      asOf: null,
      error: "No Gold macro inputs available; enable SIM in the ribbon to use generated fallback data.",
    });
  }
  return json(inputs);
}
