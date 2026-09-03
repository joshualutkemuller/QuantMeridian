import { readCommandCenterPayload } from "@/app/api/command-center/route";
import { buildMarketPublishingCandidates } from "@/lib/marketPublishing";
import { detectMaterialChangeCandidates } from "@/lib/materialChangeDetector";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * GET /api/market-publishing/candidates
 *
 * Gold/FRED-only editorial queue seed for MPUB. Missing data returns
 * unavailable candidate states instead of market-pipeline or fixture fallback.
 *
 * Merges two independent Gold-backed sources: the fixed template-coverage
 * checklist (Command Center observations + release calendar) and spec006's
 * material-change detector (category breadth, credit/funding stress, curve
 * regime — read directly, not through Command Center). Each fails closed on
 * its own; a problem with one does not hide a genuinely available result
 * from the other.
 */
export async function GET() {
  const [commandCenter, detectorCandidates] = await Promise.all([
    readCommandCenterPayload(),
    detectMaterialChangeCandidates(),
  ]);
  return json(buildMarketPublishingCandidates(commandCenter, detectorCandidates));
}
