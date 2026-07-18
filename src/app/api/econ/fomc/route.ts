import { json } from "@/lib/server/http";
import { getMacroInputs } from "@/data/macroInputs";
import {
  fomcFromEtl,
  impliedPathFromEtl,
  hasEtlFedData,
  etlFedSource,
  etlFedAsOf,
  etlFedSourceDetail,
  etlFedModelInputs,
} from "@/data/etlMacro";
import { CURRENT_TARGET } from "@/data/econRates";

export const runtime = "nodejs";

export async function GET() {
  if (!hasEtlFedData()) {
    return json({ source: "SIM", meetings: [], path: [], currentTarget: CURRENT_TARGET });
  }

  // Pull live effective rate from Gold DB benchmarks — SOFR is the primary
  // secured overnight rate; EFFR is the unsecured fallback.
  const macroInputs = await getMacroInputs();
  const spotEffectiveRate: number | undefined =
    macroInputs?.benchmarks?.["SOFR"] ?? macroInputs?.benchmarks?.["EFFR"] ?? undefined;

  const meetings = fomcFromEtl(spotEffectiveRate);
  const path = impliedPathFromEtl(spotEffectiveRate);

  const fedPriceSource = etlFedSource();
  const currentTarget =
    spotEffectiveRate != null
      ? { low: spotEffectiveRate - 0.125, high: spotEffectiveRate + 0.125, mid: spotEffectiveRate - 0.08 }
      : CURRENT_TARGET;

  const modelInputs = fedPriceSource === "fred_model" ? etlFedModelInputs() : null;

  return json({
    source: macroInputs?.source ?? "SIM",
    fedPriceSource,
    asOf: etlFedAsOf(),
    sourceDetail: etlFedSourceDetail(),
    spotEffectiveRate: spotEffectiveRate ?? null,
    goldAnchored: spotEffectiveRate != null,
    currentTarget,
    modelInputs,
    meetings,
    path,
  });
}
