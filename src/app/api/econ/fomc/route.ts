import { json } from "@/lib/server/http";
import { goldStore } from "@/lib/server/goldStore";
import { buildFomcFromGold } from "@/lib/server/goldFomc";
import { getMacroInputs } from "@/data/macroInputs";
import { CURRENT_TARGET } from "@/data/econRates";
import { simFallbackEnabled } from "@/lib/server/fallbacks";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // Attempt to read FOMC probability data from Gold
  const store = goldStore();
  const goldFomc = store ? await buildFomcFromGold(store) : null;

  // If no Gold data and SIM is not enabled, fail gracefully
  if (!goldFomc && !simFallbackEnabled(req)) {
    return json({
      source: "ERR",
      meetings: [],
      path: [],
      currentTarget: CURRENT_TARGET,
      error: "No FOMC data available from Gold DB; enable SIM in the ribbon to use generated fallback data.",
    });
  }

  // Pull live effective rate from Gold DB benchmarks — SOFR is the primary
  // secured overnight rate; EFFR is the unsecured fallback.
  const macroInputs = await getMacroInputs();
  const spotEffectiveRate: number | undefined =
    macroInputs?.benchmarks?.["SOFR"] ?? macroInputs?.benchmarks?.["EFFR"] ?? undefined;

  // Use Gold data if available; fall back to empty data
  const meetings = goldFomc?.meetings ?? [];
  const path = goldFomc?.path ?? [{ label: "Now", rate: CURRENT_TARGET.mid }];

  const currentTarget =
    spotEffectiveRate != null
      ? { low: spotEffectiveRate - 0.125, high: spotEffectiveRate + 0.125, mid: spotEffectiveRate - 0.08 }
      : CURRENT_TARGET;

  return json({
    source: goldFomc ? "DB" : "SIM",
    asOf: goldFomc ? (await store!.asOf()).slice(-1)[0]?.observation_date ?? null : null,
    sourceDetail: goldFomc ? "FOMC probabilities from Gold pipeline" : null,
    spotEffectiveRate: spotEffectiveRate ?? null,
    goldAnchored: spotEffectiveRate != null,
    currentTarget,
    meetings,
    path,
  });
}
