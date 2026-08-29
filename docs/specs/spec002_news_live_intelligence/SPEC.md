# Spec002: NEWS Live Intelligence Expansion

## Status

Draft

## Owner

Market terminal / intelligence feeds

## Background

The NEWS module is implemented and live-capable, but its active work has been
spread across completed feature docs and the master handoff. This spec is the
current implementation handoff for turning NEWS into an observable live
intelligence surface without adding any new Market Terminal data source unless
the owner explicitly approves it.

Existing source docs:

- `docs/features/completed/Feature Addition - NEWS Terminal Module (Market News & Signal Intelligence).md`
- `docs/features/completed/Feature Completion - NEWS NLP (Attention, Clusters, Signals).md`
- `docs/data/PLATFORM_DATA_CONNECTIVITY.md`
- `docs/data/DATA_PIPELINE_OVERVIEW.md`
- `docs/handoff.md`

## Current Implementation

### Headline Feed

- `/api/news` uses the existing provider chain:
  Alpha Vantage -> Marketaux -> Finnhub -> NewsAPI.
- `src/lib/server/newsProviders.ts` returns normalized headlines and
  provider-attempt diagnostics.
- Generated headlines are only exposed when `sim=1` explicitly opts into SIM.
- `/api/news/diagnostics` exposes a no-SIM smoke check with configured
  providers, attempts, winning provider, headline count, newest headline age,
  and `NEWS_NLP` health.

### Social Feed

- `/api/social` uses the existing Reddit / StockTwits provider chain.
- `src/lib/server/socialProviders.ts` returns aggregated social rows and
  provider-attempt diagnostics.
- Generated social rows are only exposed when `sim=1` explicitly opts into SIM.
- `/api/social/diagnostics` exposes a no-SIM smoke check with provider attempts,
  post volume, platform count, top ticker, and top theme.

### NLP / Clusters

- `/api/news` returns `clusterSource` and `nlp` runtime metadata.
- `NEWS_NLP_URL` upgrades headline sentiment and NEWS-6 clustering through the
  `news_nlp` service when available.
- Without `NEWS_NLP_URL`, NEWS-6 uses keyword clusters over the current tape and
  labels them accordingly.
- The NEWS page header and EVENTS view display whether clusters came from
  FinBERT, keyword fallback, or no clusters.

### DataOps

- `src/lib/server/intelligenceFeedManifest.ts` converts NEWS, SOCIAL, and
  NEWS_NLP diagnostics into DataOps-native runs, series outcomes, and lineage.
- `/api/dataops/health` reports `INTELLIGENCE_FEEDS`, `NEWS`, `SOCIAL`, and
  `NEWS_NLP`.
- `/api/dataops/runs` appends route-time intelligence feed manifests alongside
  Gold/market pipeline manifests.
- The NEWS page includes a compact diagnostics drawer for the raw NEWS/SOCIAL/NLP
  provider-attempt payloads.

## Goals

- Make live-feed availability obvious inside NEWS and DATAOPS.
- Keep provider-attempt diagnostics inspectable from the UI.
- Keep NEWS/SOCIAL/NEWS_NLP as documented Tier B live-feed exceptions to the
  Gold DB-only rule because they are non-series real-time feeds.
- Ensure every route either returns real rows or an explicit `ERR`, with SIM only
  behind explicit SIM mode.
- Establish this spec as the active NEWS handoff before expanding the module.

## Non-Goals

- Do not add a new headline, social, NLP, or event-study vendor from Market
  Terminal without explicit owner approval.
- Do not persist a historical news warehouse inside Market Terminal. Persistence
  belongs in the upstream pipeline once the owner approves the pipeline design.
- Do not make NEWS-4 market-impact magnitudes look live until an approved
  event-study dataset exists.
- Do not promote generated rows as live data.

## Completed

### Phase 1: Diagnostics Polish

- The NEWS diagnostics drawer fetches `/api/news/diagnostics` and
  `/api/social/diagnostics` directly when opened, so the raw payload includes
  fresh route-time smoke-check timestamps and provider attempts.
- The drawer supports refresh, copy-to-clipboard, JSON download, and Escape-key
  close behavior.
- Drawer summary counts read from the same raw diagnostics payload shown in the
  JSON body.

## Next Work

### Phase 2: NEWS_NLP Health Contract

Extend `news_nlp` `/health` to return separate version/status fields:

- sentiment model
- clustering model
- NER model
- lexicon fallback status
- loaded-device/runtime

Then surface those fields in:

- `/api/news`
- `/api/news/diagnostics`
- `/api/dataops/health`
- the NEWS diagnostics drawer

### Phase 3: Persistence Handoff

Create a separate upstream-pipeline handoff before any persistence work:

- raw headline table
- raw social post table
- scored headline table
- entity/ticker link table
- cluster membership table
- DataOps run/audit table

Market Terminal should consume that pipeline/database only after the schema and
source policy are approved.

### Phase 4: Event Impact

Define the approved data source and schema for NEWS-4 historical event studies.
Until then, keep NEWS-4 labelled as a curated historical model and do not treat
its magnitudes as live forecasts.

## Validation

Run these after NEWS changes:

```bash
npm test -- src/lib/server/newsProviders.test.ts src/app/api/news/route.test.ts src/app/api/news/diagnostics/route.test.ts src/app/api/social/diagnostics/route.test.ts src/app/api/dataops/runs/route.test.ts src/app/api/dataops/health/route.test.ts
npm run check:gold-policy
npm run build:client
npm run build:server
git diff --check
```

Known caveat: full `npm run typecheck` currently fails on the broader non-NEWS
Gold/market TypeScript backlog. NEWS-specific files should not appear in that
failure list.
