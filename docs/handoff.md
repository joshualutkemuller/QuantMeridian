# Market Terminal Handoff

**Updated:** 2026-08-30
**Branch:** `news-expansion`
**Latest pushed branch commit:** `ba8cad7` — `Add structured NEWS_NLP health contract`

## Current Focus

The active workstreams are the NEWS persistence handoff, Gold DB conversion, and
CPI component expansion. Detailed source docs live in:

- `docs/features/GOLD_DB_MIGRATION_HANDOFF.md`
- `docs/gold-db/MODULE_DATA_AUDIT.md`
- `docs/specs/spec001/`
- `docs/specs/spec002_news_live_intelligence/`
- `docs/gold-db/FRED_PIPELINE_CPI_COMPONENT_HANDOFF.md`
- `docs/features/completed/Feature Addition - NEWS Terminal Module (Market News & Signal Intelligence).md`
- `docs/features/completed/Feature Completion - NEWS NLP (Attention, Clusters, Signals).md`

## Current State

Tier A production routes for econ, chart, and market data have been hardened to
read the Gold DB or return explicit `ERR`/empty states. The old silent fallback
ladder to live FRED, committed snapshots, and deterministic SIM has been removed
from those production paths.

The policy is enforced by:

```bash
npm run check:gold-policy
```

The gate scans `src/app/api/econ`, `src/app/api/chart`, and
`src/app/api/market` for forbidden fallback imports/calls and old
`MIGRATION FALLBACK` annotations.

Expected remaining exceptions:

- `src/app/api/econ/calendar/route.ts` now reads `gold.release_calendar`; CAL is
  no longer a live-FRED exception.
- `src/app/api/econ/fomc/route.ts` and `src/app/api/econ/macro-inputs/route.ts`
  remain documented synthetic model/book exception paths.
- Snapshot fixture references may remain in tests/offline fixtures until the
  final fixture deletion pass.

## Last Validation

The latest pushed Gold DB hardening slice passed:

```bash
npm run check:gold-policy
npm test -- src/app/api/econ/indicators/route.test.ts src/lib/useEcon.test.ts src/lib/useMarket.test.ts src/lib/server/inflationCoverage.test.ts
npm run build:client
git diff --check
```

Only Vite's existing large-chunk warning appeared during the client build.

## NEWS Status

NEWS provider hardening and live-intelligence diagnostics are pushed on
`news-expansion` through `ba8cad7`:

- `src/lib/server/newsProviders.ts` uses the documented provider priority:
  Alpha Vantage -> Marketaux -> Finnhub -> NewsAPI.
- `fetchLiveNews()` returns per-provider diagnostics: configured, ok, headline
  count, latency, and error.
- `src/app/api/news/route.ts` returns `ERR` when no provider returns headlines
  unless `sim=1` explicitly opts into generated demo headlines.
- `src/lib/useNews.ts` comments describe the SIM-gated behavior.

Completed NEWS work expands DataOps and module-facing diagnostics:

- `src/lib/server/newsDiagnostics.ts` wraps the provider chain plus NEWS_NLP
  health into one diagnostics object.
- `src/app/api/news/diagnostics/route.ts` exposes `/api/news/diagnostics?n=20`
  with provider attempts, winning provider, newest headline age, and NLP health.
- `src/app/api/dataops/health/route.ts` adds a distinct `providers.NEWS`
  status row so real headline availability is visible from DataOps.
- `src/data/dataOps.ts` adds NEWS fixture/run metadata so the DataOps provider
  table has a stable row before the live probe overlays it.
- `src/lib/useNews.ts` now preserves `/api/news` provider diagnostics, and
  `src/app/news/page.tsx` renders a compact provider-chain strip above the tape.
- `src/lib/server/socialProviders.ts` now emits Reddit/StockTwits attempt
  diagnostics; `src/app/api/social/diagnostics/route.ts` exposes the social
  smoke check without falling back to generated rows.
- `src/lib/server/intelligenceFeedManifest.ts` builds a shared
  NEWS/SOCIAL/NEWS_NLP DataOps manifest, and `src/app/api/dataops/runs/route.ts`
  appends those DataOps-shaped run/series/lineage rows under
  `INTELLIGENCE_FEEDS`.
- `src/app/api/dataops/health/route.ts` reports the umbrella
  `INTELLIGENCE_FEEDS` status plus separate `NEWS`, `SOCIAL`, and `NEWS_NLP`
  statuses.
- `/api/news` now returns `clusterSource` and `nlp` runtime metadata so
  `src/app/news/page.tsx` can label NEWS-6 as FinBERT clusters, keyword
  clusters, or no clusters, and show NLP health in the header.
- `src/app/news/page.tsx` includes a compact diagnostics drawer for inspecting
  the raw NEWS/SOCIAL/NLP provider-attempt payloads from the UI.
- The NEWS diagnostics drawer now supports direct smoke-check refresh, JSON
  copy/download, and Escape-key close.
- `news_nlp` `/health` now reports structured sentiment, clustering, NER,
  lexicon fallback, device, and runtime metadata; Market Terminal normalizes
  both the new shape and the legacy `{ model }` shape.
- `docs/specs/spec002_news_live_intelligence/SPEC.md` is the active NEWS spec
  for diagnostics, `NEWS_NLP` health, and future persistence handoffs.

Current NEWS priority:

- Create the upstream-pipeline persistence handoff before any historical storage
  work. The handoff should define raw headline, raw social post, scored
  headline, entity/ticker link, cluster membership, and DataOps audit/run
  tables. Market Terminal should remain a read-only consumer of the approved
  pipeline/database contract; do not add a new Market Terminal data source
  without explicit owner approval.

Validation for the NEWS slices:

```bash
npm test -- src/lib/server/newsProviders.test.ts src/app/api/news/route.test.ts src/app/api/news/diagnostics/route.test.ts src/app/api/social/diagnostics/route.test.ts src/app/api/dataops/runs/route.test.ts src/app/api/dataops/health/route.test.ts
npm run check:gold-policy
npm run build:client
npm run build:server
git diff --check
```

Known validation caveat: full `npm run typecheck` still fails on the existing
Gold hardening TypeScript backlog outside the NEWS changes.

Worktree caveat: `TESTING_HANDOFF.md` appears deleted at repo root with an
untracked replacement at `test/TESTING_HANDOFF.md`. That move was not part of
the Gold calendar or NEWS provider work and should be reviewed separately.

## Next Work

1. Create the NEWS upstream-pipeline persistence handoff from
   `docs/specs/spec002_news_live_intelligence/SPEC.md` Phase 3. This is the next
   NEWS priority and must happen before storage code or historical warehouse
   wiring.
2. Finish the CPI expanded weight pipeline handoff in the FRED/eco pipeline for
   the eight CPI rows that need weights.
3. Replace or explicitly retain legacy snapshot fixtures, then delete unused
   `econSnapshot`/SIM generator paths once non-route callers are audited.
4. Add the `gold.powerbi_catalog` join test so every Tier A module maps to at
   least one Gold object.
5. Continue CPI expansion from `docs/specs/spec001/`, keeping Market Terminal
   DB-only: no new external data source should be added here without explicit
   owner approval.
