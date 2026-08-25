# Market Terminal Handoff

**Updated:** 2026-08-25
**Branch:** `spec001_expand_cpi_component_coverage`
**Latest pushed commit:** `d1f738f` — `Harden Gold DB Tier A fallback policy`

## Current Focus

The active workstream is the Gold DB conversion and CPI component expansion.
Detailed source docs live in:

- `docs/features/GOLD_DB_MIGRATION_HANDOFF.md`
- `docs/gold-db/MODULE_DATA_AUDIT.md`
- `docs/specs/spec001/`
- `docs/gold-db/FRED_PIPELINE_CPI_COMPONENT_HANDOFF.md`

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

- `src/app/api/econ/calendar/route.ts` still uses FRED release-date calls until
  the pipeline adds `gold.release_calendar`.
- `src/app/api/econ/fomc/route.ts` and `src/app/api/econ/macro-inputs/route.ts`
  remain documented synthetic model/book exception paths.
- Snapshot fixture references may remain in tests/offline fixtures until the
  final fixture deletion pass.

## Last Validation

The latest hardening slice passed:

```bash
npm run check:gold-policy
npm test -- src/app/api/econ/indicators/route.test.ts src/lib/useEcon.test.ts src/lib/useMarket.test.ts src/lib/server/inflationCoverage.test.ts
npm run build:client
git diff --check
```

Only Vite's existing large-chunk warning appeared during the client build.

## Next Work

1. Add `gold.release_calendar` in the FRED/eco pipeline, then rewire
   `/api/econ/calendar` to remove the last live-FRED ECON exception.
2. Finish the CPI expanded weight pipeline handoff in the FRED/eco pipeline for
   the eight CPI rows that need weights.
3. Replace or explicitly retain legacy snapshot fixtures, then delete unused
   `econSnapshot`/SIM generator paths once non-route callers are audited.
4. Add the `gold.powerbi_catalog` join test so every Tier A module maps to at
   least one Gold object.
5. Continue CPI expansion from `docs/specs/spec001/`, keeping Market Terminal
   DB-only: no new external data source should be added here without explicit
   owner approval.
