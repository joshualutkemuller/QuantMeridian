# Data Pipeline Overview

Date: 2026-06-22
Status: Phase 1 governance reference

This document explains exactly how data is populated today, which fallback tiers are used, which environment variables/API keys are required, and what remains to be built from a pipeline perspective. It complements the Live Data Readiness Assessment by turning the audit into an operational pipeline map.

## 1. End-to-end serving model

The terminal uses a provenance-first fallback chain:

1. **External provider or internal system** emits source observations.
2. **Domain pipeline/adapter** fetches, normalizes, quality-checks, and writes artifacts.
3. **Serving layer** exposes data through a Next.js route, Python FastAPI service, exported JSON, or committed snapshot.
4. **Frontend page/hook** renders the payload and displays a source/provenance badge.
5. **Fallback tier** renders deterministic or committed data when live config is absent.

The important governance rule for Phase 1 is that fallback availability is not live readiness. Synthetic data should be treated as `FALLBACK_AVAILABLE`, not a live provider.

## 2. Pipeline dependency graph

```text
FRED_API_KEY
  -> src/lib/server/fred.ts
  -> /api/econ/* and /api/chart/series
  -> ECON/CURV/INFL/CRDT/STAT/MGC/MOTN/FUND/SENT components
  -> fallback: deterministic econ histories

Yahoo/FRED/vendor keys
  -> market_data_pipeline connectors
  -> raw/silver/gold DuckDB + parquet + analytics_api_views + manifest
  -> one of MARKET_DB_URL, MARKET_DATA_DIR, MARKET_PIPELINE_URL
  -> /api/market/[view]
  -> MKT/SNAP/IRET/QUILT/MKC/LENS/HOME/DESK market surfaces
  -> fallback: committed src/data/market/*.json snapshots

World Bank/BIS/IMF/CME/FRED-style sources
  -> macro_data_etl extract/transform/quality/load
  -> macro_data_etl gold exports
  -> src/data/etl/*.json
  -> GCPI/GPOL/FOMC and selected economics pages
  -> fallback: committed gold JSON or deterministic CME probabilities

News/social provider keys
  -> src/lib/server/newsProviders.ts and socialProviders.ts
  -> /api/news and /api/social
  -> optional NEWS_NLP_URL scoring/clustering
  -> NEWS/SENT/AI context
  -> fallback: deterministic news/social fixtures and in-house lexicon

ANTHROPIC_API_KEY
  -> /api/copilot
  -> AI Copilot
  -> fallback: local keyword/canned responses over terminal context

Internal books/vendors
  -> not implemented yet
  -> SLAB/SQZ/PB/COLL/CASH/REINV/LIQ/SXU/OPT/DESK
  -> fallback: seeded TypeScript generators
```

## 3. Market data pipeline flow

### Population steps

1. Configure provider access and output target.
   - Minimum live-ish prototype: `FRED_API_KEY` plus Yahoo/yfinance availability.
   - Serving target: `MARKET_DB_URL`, `MARKET_DATA_DIR`, or `MARKET_PIPELINE_URL`.
2. Run ingestion: `PYTHONPATH=$PWD python -m market_data_pipeline.cli run --start YYYY-MM-DD`.
3. Connectors fetch macro/market observations.
4. Normalizers convert raw frames into canonical schemas.
5. Quality checks validate missing values, stale data, row counts, and schema shape.
6. Storage writes DuckDB/parquet tables and ingestion manifests.
7. Analytics builders materialize gold terminal views.
8. Serving is one of:
   - `publish-views` to a DB read through `MARKET_DB_URL`.
   - `export-views --out DIR` read through `MARKET_DATA_DIR`.
   - `serve --port 8000` read through `MARKET_PIPELINE_URL`.
9. Next.js `/api/market/[view]` resolves DB -> file export -> FastAPI -> committed snapshot.
10. Market pages render the response with provenance metadata.

### Required environment/config

| Variable | Required for | Notes |
|---|---|---|
| `FRED_API_KEY` | Macro series inside the market pipeline | Without it the pipeline can use synthetic macro fallback. |
| `MARKET_DB_URL` | Preferred DB serving path | Supports Postgres and DuckDB-style local paths depending on installed drivers. |
| `MARKET_DATA_DIR` | Exported JSON serving path | Points the Next app at `export-views` output. |
| `MARKET_PIPELINE_URL` | FastAPI serving path | Also enables DataOps service health probe. |
| `MARKET_CRON_*`, `CRON_SECRET`, `CRON_TARGET_URL` | Scheduled refresh | Needed for automated refresh rather than manual CLI runs. |

### Remaining work

- Decide the production market vendor path; Yahoo is prototype-grade.
- Run a scheduled ingestion/export/publish process and persist freshness manifests.
- Add cache-age/freshness display across all market views.
- Ensure DataOps consumes the same market manifest used by the serving layer.
- Add deployment docs for the chosen DB/file/service mode.

## 4. FRED economics pipeline flow

### Population steps

1. Set `FRED_API_KEY` in the Next.js runtime.
2. Economics API routes call the server FRED library at request time.
3. Responses are shaped into terminal cards, curves, statistics, calendars, or chart series.
4. If the key is missing or a series fetch fails, deterministic local histories are returned.
5. UI components should display per-series `FRED` vs `SIM` provenance.

### Required environment/config

| Variable | Required for | Notes |
|---|---|---|
| `FRED_API_KEY` | ECON, CURV, INFL, CRDT, STAT, FRED-backed charting, funding macro pieces, VIX sentiment input | Highest-ROI key because many modules already call FRED. |

### Remaining work

- Harden per-series fallback disclosure so mixed FRED/SIM panels cannot appear fully live.
- Persist request/cache metadata for DataOps rather than relying only on route-time probes.
- Add tests that fail when FRED-backed UI omits source or observation date.

## 5. Macro ETL pipeline flow

### Population steps

1. Run `macro_data_etl` extractors for global macro, policy rates, real rates, and CME/FedWatch data.
2. Transform raw source records into bronze/silver/gold outputs.
3. Apply quality gates.
4. Export gold JSON into `src/data/etl/*.json` for the terminal.
5. Economics pages import those committed JSON files.

### Required environment/config

Most public macro ETL sources do not use one universal key, but production use needs source-specific credentials/network access where applicable and a scheduled ETL runner.

### Remaining work

- Add top-level processing timestamps and run manifests to every gold export.
- Replace deterministic CME fallback with robust futures/FedWatch ingestion or label FOMC as simulation.
- Wire macro ETL manifests into `/api/dataops/runs`.
- Automate export refresh instead of relying on committed snapshots.

## 6. News, social, and NLP flow

### Population steps

1. Configure one or more headline providers.
2. Configure social providers for Reddit/StockTwits where available.
3. Optionally run `news_nlp` and set `NEWS_NLP_URL`.
4. `/api/news` fetches headlines, applies provider-native sentiment or in-house scoring, and optionally upgrades scoring/clustering through `news_nlp`.
5. NEWS and SENT render live provider data when present; otherwise deterministic fixtures remain.

### Required environment/config

| Variable | Required for | Notes |
|---|---|---|
| `ALPHAVANTAGE_API_KEY`, `MARKETAUX_API_KEY`, `FINNHUB_API_KEY`, `NEWSAPI_API_KEY` | Headline provider chain | First configured viable provider can populate NEWS. |
| `REDDIT_USER_AGENT` | Reddit/social fetches | User-agent gated. |
| `STOCKTWITS_ENABLED`, `STOCKTWITS_ACCESS_TOKEN` | StockTwits/social fetches | Enables NEWS social and SENT social components. |
| `NEWS_NLP_URL` | FinBERT/NER/clustering service | Upgrades heuristic sentiment and event clustering. |

### Remaining work

- Pick a production headline provider and record SLA/entitlement constraints.
- Persist headline/social raw and scored outputs; current request-time behavior is not a full historical pipeline.
- Add AAII/NAAIM survey ingestion for SENT.
- Surface feed freshness, model version, and fallback reason in DataOps.

## 7. Market Lens and charting flow

### Population steps

1. Market Lens uses existing FRED/Yahoo adapters or an optional backend.
2. The terminal calls `/api/market-lens` or chart-series routes.
3. If no backend/store is configured, embedded snapshots/catalog-driven fallbacks render.

### Required environment/config

| Variable | Required for | Notes |
|---|---|---|
| `MARKET_LENS_URL` | External Market Lens backend | Enables service-backed analytics. |
| `CHART_DB_URL` | Chart series store | Optional persistence for charting workflows. |
| Market/FRED variables above | Underlying series | Lens/charting quality follows upstream market/econ quality. |

### Remaining work

- Persist provenance per chart/lens result, including transformed series lineage.
- Align chart cache/fallback semantics with the market and FRED contracts.

## 8. Internal book and optimization flow

### Current state

No live internal-book ingestion exists for lending, prime finance, collateral, cash, sources/uses, liquidity, solver runs, or operational alerts. These modules are populated by seeded TypeScript generators.

### Target population steps

1. Define canonical schemas for each book/domain.
2. Build read-only ingestion adapters for source systems or vendor files.
3. Land raw files/tables with immutable run IDs.
4. Normalize to canonical silver tables.
5. Reconcile totals against books/GL/source control totals.
6. Apply entitlement and masking rules.
7. Build gold aggregates used by terminal pages.
8. Persist solver inputs/outputs and alert events with lineage.
9. Fail closed when feeds are absent; do not silently promote generated data.

### Required integrations

| Domain | Needed source |
|---|---|
| Securities lending | Internal loan/inventory book plus DataLend/Astec/EquiLend/exchange short-interest vendor. |
| Prime finance | Client financing balances, exposures, margin, synthetic/stock borrow cost inputs. |
| Collateral | Eligibility schedules, collateral positions, haircuts, margin calls, pricing. |
| Cash/reinvestment/liquidity | Treasury ledger, sources/uses, repo/MMF positions, liquidity forecasts. |
| Optimization | Internal positions/constraints plus Gurobi or chosen solver service/license. |
| Alerts | Event bus fed by provider, quality, business-rule, and book events. |

## 9. Phase 1 pipeline checklist

- [x] Demote synthetic provider health from live to fallback-available.
- [x] Create this pipeline overview as the operational map.
- [ ] Replace DataOps fixture runs/lineage with real manifests from market pipeline, macro ETL, FRED cache, news NLP, and provider probes.
- [ ] Add one shared provenance contract with `source`, `provider`, `observationDate`, `processedAt`, `cachedAt`, `fallbackReason`, and `isSimulated`.
- [ ] Add watermarks for simulated internal-book modules.
- [ ] Add tests that fail when operational pages omit provenance badges.
- [ ] Publish a deployment/runbook for market pipeline scheduler + export/publish path.

## 10. Immediate setup sequence

1. Set `FRED_API_KEY` and verify `/api/dataops/health` reports FRED as live.
2. Choose market serving mode:
   - DB mode: set `MARKET_DB_URL` and run `publish-views`.
   - File mode: run `export-views --out ...` and set `MARKET_DATA_DIR`.
   - Service mode: run `market_data_pipeline.cli serve` and set `MARKET_PIPELINE_URL`.
3. Configure a scheduled refresh with `MARKET_CRON_*`, `CRON_SECRET`, and `CRON_TARGET_URL`.
4. Pick one news provider key and run smoke tests for `/api/news`.
5. Start `news_nlp` and set `NEWS_NLP_URL` if FinBERT/NER/clustering is required.
6. Decide AAII/NAAIM ingestion location for SENT.
7. Inventory internal source systems for lending, prime, collateral, cash, and optimization before adding more UI features.
