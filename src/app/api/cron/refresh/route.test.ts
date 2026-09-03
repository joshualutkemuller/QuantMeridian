import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  detectMaterialChangeCandidateGroups: vi.fn(),
  detectorStateStoreEnabled: vi.fn(),
  writeDetectorTransitions: vi.fn(),
}));

vi.mock("@/lib/materialChangeDetector", () => ({
  detectMaterialChangeCandidateGroups: mocks.detectMaterialChangeCandidateGroups,
}));

vi.mock("@/lib/server/detectorStateStore", () => ({
  detectorStateStoreEnabled: mocks.detectorStateStoreEnabled,
  writeDetectorTransitions: mocks.writeDetectorTransitions,
}));

function readyCandidate(id: string) {
  return { id, status: "ready" as const };
}

function unavailableCandidate(id: string) {
  return { id, status: "unavailable" as const };
}

async function readJson(response: Response) {
  return response.json();
}

describe("GET /api/cron/refresh — spec006 Phase 2 write path", () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ source: "DB", asOf: "2026-09-02" }), { status: 200 }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  test("skips the detector write cleanly when the state store isn't configured", async () => {
    mocks.detectorStateStoreEnabled.mockReturnValue(false);

    const body = await readJson(await GET(new Request("https://example.com/api/cron/refresh")));

    expect(body.detectorTransitions).toEqual({ skipped: "MPUB_STATE_DB_URL/MACRO_DB_URL not configured" });
    expect(mocks.detectMaterialChangeCandidateGroups).not.toHaveBeenCalled();
    expect(mocks.writeDetectorTransitions).not.toHaveBeenCalled();
  });

  test("runs the detector, writes transitions, and reports new/continuing/resolved plus per-group ok state", async () => {
    mocks.detectorStateStoreEnabled.mockReturnValue(true);
    mocks.detectMaterialChangeCandidateGroups.mockResolvedValue([
      { templateId: "category_breadth", ok: true, candidates: [readyCandidate("category-breadth-GROWTH")] },
      { templateId: "credit_stress", ok: true, candidates: [readyCandidate("credit-stress-CCC_OAS")] },
      { templateId: "funding_stress", ok: false, candidates: [unavailableCandidate("funding_stress-unavailable")] },
      { templateId: "curve_regime", ok: true, candidates: [] },
    ]);
    mocks.writeDetectorTransitions.mockResolvedValue([
      { candidateId: "category-breadth-GROWTH", changeType: "new", firstFlaggedAt: "2026-09-03T12:00:00.000Z" },
      { candidateId: "credit-stress-CCC_OAS", changeType: "continuing", firstFlaggedAt: "2026-08-20T00:00:00.000Z" },
      { candidateId: "funding-stress", changeType: "resolved", firstFlaggedAt: "2026-08-15T00:00:00.000Z" },
    ]);

    const body = await readJson(await GET(new Request("https://example.com/api/cron/refresh")));

    // ready-only ids are passed through per group — the unavailable candidate never becomes a "ready id".
    expect(mocks.writeDetectorTransitions).toHaveBeenCalledTimes(1);
    const [groupsArg] = mocks.writeDetectorTransitions.mock.calls[0];
    expect(groupsArg).toEqual([
      { templateId: "category_breadth", ok: true, readyIds: ["category-breadth-GROWTH"] },
      { templateId: "credit_stress", ok: true, readyIds: ["credit-stress-CCC_OAS"] },
      { templateId: "funding_stress", ok: false, readyIds: [] },
      { templateId: "curve_regime", ok: true, readyIds: [] },
    ]);

    expect(body.detectorTransitions).toMatchObject({
      ok: true,
      groupsOk: { category_breadth: true, credit_stress: true, funding_stress: false, curve_regime: true },
      new: ["category-breadth-GROWTH"],
      continuing: ["credit-stress-CCC_OAS"],
      resolved: ["funding-stress"],
    });
  });

  test("reports a failed write as ok:false without crashing the whole cron run", async () => {
    mocks.detectorStateStoreEnabled.mockReturnValue(true);
    mocks.detectMaterialChangeCandidateGroups.mockResolvedValue([
      { templateId: "category_breadth", ok: true, candidates: [] },
      { templateId: "credit_stress", ok: true, candidates: [] },
      { templateId: "funding_stress", ok: true, candidates: [] },
      { templateId: "curve_regime", ok: true, candidates: [] },
    ]);
    mocks.writeDetectorTransitions.mockRejectedValue(new Error("permission denied for table mpub_detector_state"));

    const body = await readJson(await GET(new Request("https://example.com/api/cron/refresh")));

    expect(body.ok).toBe(true); // the cache-warming half still completes
    expect(body.detectorTransitions).toEqual({ ok: false, error: "permission denied for table mpub_detector_state" });
  });

  test("still requires CRON_SECRET when set, before touching the detector at all", async () => {
    process.env.CRON_SECRET = "shh";
    mocks.detectorStateStoreEnabled.mockReturnValue(true);

    const response = await GET(new Request("https://example.com/api/cron/refresh"));

    expect(response.status).toBe(401);
    expect(mocks.detectMaterialChangeCandidateGroups).not.toHaveBeenCalled();
  });
});
