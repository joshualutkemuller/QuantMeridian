import { json } from "@/lib/server/http";
import { detectMaterialChangeCandidateGroups } from "@/lib/materialChangeDetector";
import { detectorStateStoreEnabled, writeDetectorTransitions, type DetectorGroupInput } from "@/lib/server/detectorStateStore";

/**
 * GET /api/cron/refresh  — daily cache warmer + spec006 Phase 2 transition write (Vercel Cron).
 *
 * Hits the FRED-backed econ routes and gold-DB market routes so server
 * caches are refreshed once a day even with no user traffic. When
 * `CRON_SECRET` is set, Vercel sends it as a Bearer token and this
 * endpoint requires it, so it can't be triggered publicly.
 *
 * Also runs spec006's material-change detector once and persists its
 * new/continuing/resolved transitions to `mpub_detector_state` — the ONLY
 * place that write happens. `GET /api/market-publishing/candidates` only
 * ever reads that state, never writes it, so concurrent page loads can't
 * race on it.
 *
 * Schedule lives in vercel.json.
 */
const ECON_TARGETS = [
  "/api/econ/curve-history?years=7",
  "/api/econ/curve",
  "/api/econ/indicators",
  "/api/econ/calendar",
];

const MARKET_TARGETS = [
  "/api/market/market",
  "/api/market/cross-asset",
  "/api/market/rates",
  "/api/market/inflation",
  "/api/market/regime",
  "/api/market/bilello",
  "/api/market/index-returns",
];

function baseUrl(req: Request): string {
  const host =
    process.env.CRON_TARGET_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;
  if (host) return host.startsWith("http") ? host : `https://${host}`;
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const base = baseUrl(req).replace(/\/$/, "");
  const startedAt = new Date().toISOString();
  const targets = [...ECON_TARGETS, ...MARKET_TARGETS];

  const results = await Promise.allSettled(
    targets.map(async (path) => {
      const r = await fetch(`${base}${path}`, { cache: "no-store", signal: AbortSignal.timeout(25000) });
      const body = await r.json().catch(() => ({}));
      return {
        path,
        status: r.status,
        source: body?.source ?? null,
        asOf: body?.asOf ?? body?.curve?.date ?? body?.data?.asof ?? body?.data?.cards?.[0]?.asof ?? null,
      };
    })
  );

  const warmed = results.map((res, i) =>
    res.status === "fulfilled"
      ? res.value
      : { path: targets[i], status: 0, error: res.reason instanceof Error ? res.reason.message : String(res.reason) }
  );

  let detectorTransitions: unknown = { skipped: "MPUB_STATE_DB_URL/MACRO_DB_URL not configured" };
  if (detectorStateStoreEnabled()) {
    try {
      const groups = await detectMaterialChangeCandidateGroups();
      const nowIso = new Date().toISOString();
      const input: DetectorGroupInput[] = groups.map((g) => ({
        templateId: g.templateId,
        ok: g.ok,
        readyIds: g.candidates.filter((c) => c.status === "ready").map((c) => c.id),
      }));
      const transitions = await writeDetectorTransitions(input, nowIso);
      detectorTransitions = {
        ok: true,
        groupsOk: Object.fromEntries(groups.map((g) => [g.templateId, g.ok])),
        new: transitions.filter((t) => t.changeType === "new").map((t) => t.candidateId),
        continuing: transitions.filter((t) => t.changeType === "continuing").map((t) => t.candidateId),
        resolved: transitions.filter((t) => t.changeType === "resolved").map((t) => t.candidateId),
      };
    } catch (err) {
      detectorTransitions = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return json({ ok: true, startedAt, finishedAt: new Date().toISOString(), warmed, detectorTransitions });
}
