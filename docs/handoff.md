# Market Terminal Handoff

**Updated:** 2026-08-28
**Branch:** `spec001_expand_cpi_component_coverage`
**Latest pushed commit:** `454ae4d` — `Wire econ calendar to Gold release calendar`

## Current Focus

The active workstreams are the Gold DB conversion, CPI component expansion, and
real NEWS provider wiring. Detailed source docs live in:

- `docs/features/GOLD_DB_MIGRATION_HANDOFF.md`
- `docs/gold-db/MODULE_DATA_AUDIT.md`
- `docs/specs/spec001/`
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

## Current Uncommitted Work

NEWS provider hardening is implemented locally but not yet committed:

- `src/lib/server/newsProviders.ts` now uses the documented provider priority:
  Alpha Vantage -> Marketaux -> Finnhub -> NewsAPI.
- `fetchLiveNews()` returns per-provider diagnostics: configured, ok, headline
  count, latency, and error.
- `src/app/api/news/route.ts` returns `ERR` when no provider returns headlines
  unless `sim=1` explicitly opts into generated demo headlines.
- `src/lib/useNews.ts` comments now describe the SIM-gated behavior.
- Tests were added:
  - `src/lib/server/newsProviders.test.ts`
  - `src/app/api/news/route.test.ts`

Validation for this uncommitted NEWS slice:

```bash
npm test -- src/lib/server/newsProviders.test.ts src/app/api/news/route.test.ts
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

1. Finish the CPI expanded weight pipeline handoff in the FRED/eco pipeline for
   the eight CPI rows that need weights.
2. Replace or explicitly retain legacy snapshot fixtures, then delete unused
   `econSnapshot`/SIM generator paths once non-route callers are audited.
3. Add the `gold.powerbi_catalog` join test so every Tier A module maps to at
   least one Gold object.
4. Continue CPI expansion from `docs/specs/spec001/`, keeping Market Terminal
   DB-only: no new external data source should be added here without explicit
   owner approval.
5. Commit the NEWS provider hardening slice after review, excluding the unrelated
   `TESTING_HANDOFF.md` move unless the owner confirms it should be included.
6. Add a DataOps-facing `/api/news` live smoke/diagnostics surface so provider
   health, winning provider, newest headline timestamp, and NLP enrichment are
   visible without opening the NEWS module.
