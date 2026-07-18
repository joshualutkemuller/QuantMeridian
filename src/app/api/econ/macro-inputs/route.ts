import { json } from "@/lib/server/http";
import { getMacroInputs } from "@/data/macroInputs";

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
export async function GET() {
  const inputs = await getMacroInputs();
  return json(inputs);
}
