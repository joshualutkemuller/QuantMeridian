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
import { simFallbackEnabled } from "@/lib/server/fallbacks";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!hasEtlFedData()) {
    return simFallbackEnabled(req)
      ? json({ source: "SIM", meetings: [], path: [], currentTarget: CURRENT_TARGET })
      : json({ source: "ERR", meetings: [], path: [], currentTarget: CURRENT_TARGET, error: "No ETL/Fed data available; enable SIM in the ribbon to use generated fallback data." });
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
