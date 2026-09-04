import { readCommandCenterPayload } from "@/app/api/command-center/route";
import { buildMarketPublishingCandidates, type MarketPublishingCandidate } from "@/lib/marketPublishing";
import { detectMaterialChangeCandidates } from "@/lib/materialChangeDetector";
import { json } from "@/lib/server/http";
import { readDetectorState } from "@/lib/server/detectorStateStore";

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
 *
 * Detector candidates are additionally annotated with `changeType`/
 * `firstFlaggedAt` from `mpub_detector_state` (spec006 Phase 2) — read-only
 * here. That state is written exactly once a day by `/api/cron/refresh`,
 * never by this route, so concurrent requests can't race on it. A state
 * read failure degrades to an unannotated candidate plus a warning, never
 * an unavailable candidate — the underlying Gold data is still good even
 * when we can't say whether it's new or continuing today.
 */
async function annotateWithTransitionState(candidates: MarketPublishingCandidate[]): Promise<MarketPublishingCandidate[]> {
  let state: Awaited<ReturnType<typeof readDetectorState>>;
  try {
    state = await readDetectorState();
  } catch (err) {
    const reason = `Transition state unavailable: ${(err as Error).message}`;
    return candidates.map((c) => (c.scoreBreakdown ? { ...c, warnings: [...c.warnings, reason] } : c));
  }
  return candidates.map((c) => {
    const row = state.get(c.id);
    if (!row) return c;
    return { ...c, changeType: row.changeType, firstFlaggedAt: row.firstFlaggedAt };
  });
}

export async function GET() {
  const [commandCenter, detectorCandidates] = await Promise.all([
    readCommandCenterPayload(),
    detectMaterialChangeCandidates(),
  ]);
  const annotated = await annotateWithTransitionState(detectorCandidates);
  return json(buildMarketPublishingCandidates(commandCenter, annotated));
}
