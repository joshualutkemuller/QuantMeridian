import { readCommandCenterPayload } from "@/app/api/command-center/route";
import { buildMarketPublishingDaily } from "@/lib/marketPublishing";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * GET /api/market-publishing/daily
 *
 * Gold/FRED-only MPUB daily shell. This route composes from Command Center's
 * DB-only contract and never reaches into legacy market JSON, snapshots, or
 * synthetic module fallbacks.
 */
export async function GET() {
  const commandCenter = await readCommandCenterPayload();
  return json(buildMarketPublishingDaily(commandCenter));
}
