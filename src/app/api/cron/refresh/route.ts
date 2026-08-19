import { json } from "@/lib/server/http";

/**
 * GET /api/cron/refresh  — daily cache warmer (Vercel Cron).
 *
 * Hits the FRED-backed econ routes and gold-DB market routes so server
 * caches are refreshed once a day even with no user traffic. When
 * `CRON_SECRET` is set, Vercel sends it as a Bearer token and this
 * endpoint requires it, so it can't be triggered publicly.
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

  return json({ ok: true, startedAt, finishedAt: new Date().toISOString(), warmed });
}
