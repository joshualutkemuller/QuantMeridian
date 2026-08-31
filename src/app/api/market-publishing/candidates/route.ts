import { readCommandCenterPayload } from "@/app/api/command-center/route";
import { buildMarketPublishingCandidates } from "@/lib/marketPublishing";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * GET /api/market-publishing/candidates
 *
 * Gold/FRED-only editorial queue seed for MPUB. Missing data returns
 * unavailable candidate states instead of market-pipeline or fixture fallback.
 */
export async function GET() {
  const commandCenter = await readCommandCenterPayload();
  return json(buildMarketPublishingCandidates(commandCenter));
}
