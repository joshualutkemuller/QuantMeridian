# Live Data Readiness Assessment

Audit date: 2026-06-22. Scope: Vite + React terminal, market data pipeline, macro ETL, DataOps, Market Lens Studio, news NLP, and supporting static data.

## Executive verdict

The terminal is **not yet an institutional live-data platform**. It is a strong terminal prototype with partial live upgrade paths. The only consistently live-capable foundations are: FRED-backed economics APIs when `FRED_API_KEY` is present; market pipeline views when `MARKET_DB_URL`, `MARKET_DATA_DIR`, or `MARKET_PIPELINE_URL` are configured; and optional news/NLP services when provider keys or `NEWS_NLP_URL` are configured — and even these are reachable only in local development, because the `/api/*` handlers are served by a Vite dev plugin and are not deployed by a default `vite build` (see "API serving model: dev plugin vs. production deploy"). Most securities-finance, optimization, cash, prime, collateral, liquidity, alerting, sentiment, and copilot workflows are deterministic fixtures generated from seeded local functions.

The primary risk is **false-live perception**: global chrome says `LIVE`, DataOps fixtures report providers as live, and some modules label generated values as `FRED`, `YAHOO`, `LOCAL`, or `LIVE` without verifying an upstream observation at render time.

## Evidence-driven architecture facts

- The app is a Vite + React SPA (`react-router-dom`), not Next.js. It borrows Next-style file conventions — `src/app/**/route.ts` handlers and `[view]` dynamic segments — but these are served at dev time by a custom Vite plugin (`vite-plugins/dev-api.ts`) that mirrors file-system routing; there is no Next runtime.
- Navigation exposes 37 terminal routes/modules across markets, financing, optimization, economics, and intelligence. The route list is driven by `NAV`, not by provider readiness. `NAV` includes live-market labels as product language rather than proof of live connectivity.
- DataOps has two incompatible truths: fixture functions hardcode optimistic provider health and runs, while `/api/dataops/health` probes actual environment wiring.
- Market data has a credible four-step serving chain: DB, exported files, FastAPI, committed snapshots. This is the best live-readiness pattern in the codebase.
- Economics APIs follow an “always 200” pattern and fall back to simulated histories if FRED is unavailable or per-series fetches fail.
- Macro ETL ships committed JSON exports and has CME/IMF fallback logic; CME FedWatch can be deterministic when public CME access fails.
- News and social intelligence are explicitly deterministic unless external keys/services are configured.
- Internal books are not connected. Securities lending, prime finance, collateral, cash, reinvestment, liquidity, sources/uses, and most optimization outputs are seeded generated data.

## API serving model: dev plugin vs. production deploy

The `/api/*` endpoints in this audit are standard Web `Request → Response` handlers. They are served by one shared registry (`src/server/registry.ts`, built from `src/app/api/**/route.ts` via `import.meta.glob`) in both environments, so dev and a deployed build resolve `/api/*` identically.

- **Development:** `npm run dev` mounts the registry through a thin Vite plugin (`vite-plugins/dev-api.ts`) via `ssrLoadModule`, preserving aliases and hot-reload. Routes work end-to-end.
- **Production — process host:** `npm run build` builds the client (`dist/`) **and** an SSR server bundle (`dist-server/`); `npm start` runs `src/server/index.ts`, a standalone Node server that serves `dist/` and mounts the same registry. Suits any host that runs a Node process (Render, Railway, Fly.io, a VM).
- **Production — Vercel:** `vercel.json` sets `framework: vite`, `buildCommand: npm run build:vercel` (client + a Vite-built handler bundle `dist-vercel/handler.js`), and a catch-all serverless function `api/[...path].ts` that adapts the Node request to a Web `Request` and calls the same `handleApiRequest`. Non-`/api` paths rewrite to `index.html` (SPA); `/api/*` hits the function. The daily warm-up cron (`/api/cron/refresh`) is registered under `crons`. The function imports the **Vite-built** bundle because Vercel's bundler resolves neither `@/` aliases nor `import.meta.glob`.
- Configured providers (`FRED_API_KEY`, `MARKET_DB_URL`, `MARKET_PIPELINE_URL`, …) are reachable in both production modes — verified locally: `/api/econ/curve` → `source:"SIM"`, `/api/market/market` → `source:"SNAPSHOT"` without keys, upgrading to live when configured. **A static-only `dist/` host (e.g. `vite preview`, plain CDN, or a Vercel project without this `vercel.json`/`api/` function) has no API layer and falls back to snapshots/fixtures.**
- **Resolved:** the previous gap (a plain `vite build` emitted only a static SPA, so every `/api/*` request 404'd in production and all API-backed modules silently degraded to fixtures regardless of env vars) is closed by both production paths above. The Next-only `next: { revalidate }` fetch option in `src/lib/server/fred.ts` (a no-op outside Next) has been removed; FRED caching uses the portable module-level TTL map.
- **Caveat:** the Vercel function relies on `buildCommand` producing `dist-vercel/handler.js` before functions are bundled (standard `vercel build` order). Optional DB drivers (`pg`, `duckdb`) are loaded via runtime `require` and are not traced into the function bundle, so on Vercel prefer `MARKET_PIPELINE_URL` (HTTP) over a direct `MARKET_DB_URL`. Set `CRON_SECRET` to lock the cron endpoint.

## Repository discovery inventory

### Frontend modules and data origins

"Dev live coverage" is the ceiling reachable under `npm run dev` with providers configured. **With `npm start` (the standalone server) deployed coverage now equals dev**, since the same route registry runs in production. The "Default-deploy coverage" column below describes the **static-only `dist/` host failure mode** (e.g. `vite preview` or a plain CDN with no API layer): rows whose data flows through `/api/*` drop to their snapshot/fixture fallback because no handler responds; rows fed by local imports or seeded fixtures are unaffected. "= dev" means the row has no `/api` dependency and behaves identically everywhere. See "API serving model" — deploy via `npm start`, not a static host, to keep the dev figures.

| Code | Route | Actual data origin | Endpoint/path | Dev live coverage | Default-deploy coverage | Simulation/staleness risk |
|---|---|---|---|---:|---|---|
| HOME | `/` | Aggregates local data modules and snapshots | local imports/snapshots (no `/api`) | 20% | = dev — pure local `@/data/*` imports, no `/api` calls | High: broad KPI surface from fixture domains |
| MKT | `/markets` | Market pipeline API chain | `/api/market/market` | 60% if configured; 0% otherwise | 0% — `/api` 404 → committed snapshot | Committed 2026-06-17 snapshot fallback |
| SNAP | `/market-snapshot` | Market pipeline snapshots | `/api/market/market`, cross-asset | 60% if configured | 0% — `/api` 404 → snapshot | Snapshot fallback can look current |
| QUILT | `/asset-quilt` | Market pipeline Bilello/quilt JSON/API | `/api/market/bilello` | 60% if configured | 0% — `/api` 404 → snapshot | Snapshot fallback |
| IRET | `/index-returns` | Market pipeline index returns | `/api/market/index-returns` | 60% if configured | 0% — `/api` 404 → snapshot | Snapshot fallback |
| LENS | `/market-lens` | Optional Market Lens backend else embedded config/snapshot | `/api/market-lens` | 35% | 0% — `/api` 404 → snapshot | Snapshot fallback flagged, but analysis can appear live |
| MKC | `/market-chart` | Chart API from catalog/econ/market histories | `/api/chart/series` | 45% | 0% — `/api/chart/series` 404; now shows an explicit `DATA UNAVAILABLE` notice + `ERR` badge instead of a silently blank chart | Synthetic chart histories when source is synthetic |
| SLAB | `/securities-lending` | Seeded domain generator | local `src/data/securitiesLending.ts` | 0% | = dev (local fixture) | Appears like loan/inventory book |
| SQZ | `/securities-lending/squeeze` | Seeded squeeze board | local `src/data/squeeze.ts` | 0% | = dev (local fixture) | Page labels SIM, but metrics look operational |
| PB | `/prime-finance` | Seeded hedge-fund/client exposures | local `src/data/primeFinance.ts` | 0% | = dev (local fixture) | High false-live risk |
| COLL | `/collateral` | Seeded margin/collateral book | local `src/data/collateral.ts` | 0% | = dev (local fixture) | High false-live risk |
| CASH | `/cash-optimizer` | Seeded treasury sources/uses | local `src/data/cash.ts` | 0% | = dev (local fixture) | High false-live risk |
| REINV | `/reinvestment` | Seeded reinvestment portfolio | local `src/data/reinvestment.ts` | 0% | = dev (local fixture) | High false-live risk |
| LIQ | `/liquidity` | Seeded liquidity ladder + partly macro labels | local `src/data/liquidity.ts` | 5% | = dev (local fixture) | Local/funding data are generated |
| SXU | `/sources-uses` | Seeded matching engine | local `src/data/sourcesUses.ts` | 0% | = dev (local fixture) | All matching is simulated |
| OPT | `/optimization` | Seeded solver runs/trades | local `src/data/optimization.ts` | 0% | = dev (local fixture) | No real solver persistence observed |
| DESK | `/trading-desk` | Local trading scorecards | local data | 10% | = dev (local fixture) | Mostly fixture analytics |
| ECON | `/economics` | FRED API overlay on simulated fallback | `/api/econ/indicators`, local histories | 55% with key | 0% — `/api` 404 → local SIM histories | History panel explicitly SIM |
| CURV | `/economics/curve` | FRED curve API else simulated curve | `/api/econ/curve`, `/curve-history` | 60% with key | 0% — `/api` 404 → simulated curve | Fallback silent at endpoint level except source field |
| INFL | `/economics/inflation` | Local econ series + market inflation snapshot | local/API | 45% | ≈0% live — API part 404, local series remain | Mixed static/sim/live |
| GCPI | `/economics/global-cpi` | Committed macro ETL JSON + live FRED overlay | `src/data/etl/*`, `/api/econ/batch`, drill `/api/econ/series` | 20% | ≈0% live — `/api` 404 (FRED overlay/drill); committed ETL JSON snapshot remains | ETL JSON is cached snapshot |
| GPOL | `/economics/policy-rates` | Committed macro ETL JSON + live FRED overlay | `policy_rate_timeseries.json`, `/api/econ/batch`, drill `/api/econ/series` | 20% | ≈0% live — `/api` 404 (FRED overlay/drill); committed ETL JSON snapshot remains | Cached/demo risk |
| CRDT | `/economics/credit` | FRED spreads if available + fallback constants | FRED/local | 55% | 0% — `/api` 404 → fallback constants | Fallback values used per series |
| FOMC | `/economics/rates` | Macro ETL Fed probabilities or deterministic fallback | `fed_probabilities.json`, CME ETL | 25% | = dev (local import, no `/api`) | CME fallback explicitly deterministic |
| CAL | `/economics/calendar` | FRED release/calendar approximation else SIM | `/api/econ/calendar` | 30% | 0% — `/api` 404 → SIM | No authoritative calendar provider |
| STAT | `/economics/stats` | FRED/SIM histories, client-side stats | `/api/econ/stats` | 50% | 0% — `/api` 404 → SIM histories | Computation OK; source mixed |
| REGIME | `/economics/regime` | Static regime model factors | local `macroRegime.ts` | 15% | = dev (local import, no `/api`) | Factors labelled FRED/YAHOO/LOCAL but values are hardcoded |
| EML | `/economics/ml` | Deterministic model outputs | local `econModels.ts` | 10% | = dev (local import, no `/api`) | ML outputs are not trained/live scored |
| SFE | `/economics/sec-finance` | Macro-to-sec-finance local model | local/API | 20% | ≈0% live — API part 404, local model remains | Desk impacts simulated |
| FUND | `/economics/funding` | Macro funding indicators + local desk data | local/API | 30% | ≈0% live — API part 404, local data remains | Actual funding books absent |
| MGC/MOTN | chart/motion routes | Econ/market chart series (`useChartSeries`) | `/api/chart/series` | 45% | 0% — `/api/chart/series` 404; now shows an explicit `DATA UNAVAILABLE` notice + `ERR` badge instead of a silently blank chart | Depends on upstream source per series |
| NEWS | `/news` | Optional providers else deterministic engine | `/api/news` | 20% | 0% — `/api` 404 → deterministic engine | Page states SIM by default |
| SENT | `/sentiment` | Deterministic survey/social + possible VIX/FRED | `/api/social`, FRED | 15% | 0% — `/api` 404 → deterministic | AAII/NAAIM/social are simulated |
| AI | `/copilot` | Optional LLM over local context else keyword fallback | `/api/copilot` | 15% | 0% — `/api` 404 → keyword fallback | Responses can summarize fixture data |
| DATAOPS | `/dataops` | Health probe + generated fixture runs/coverage | `/api/dataops/*`, `dataOps.ts` | 30% | ≈0% — health probe 404, fixtures are local | Fixture lineage is not source of truth |
| ALRT | `/alerts` | Seeded templates + sentiment-derived alerts | local `alerts.ts` | 0% | = dev (local fixture) | Operational alerts are simulated |

### Backend/API inventory

| API/service | Purpose | Upstreams | Refresh/update behavior | Readiness |
|---|---|---|---|---|
| `/api/market/[view]` | Serves market snapshots/views | DB, exported files, FastAPI, committed JSON | Request-time lookup; no scheduler in route handler | Best pattern by shape, but only served by the Vite dev plugin — not deployed in a default `vite build` (see "API serving model") |
| `/api/econ/*` | FRED-backed economics series, curve, indicators, stats, calendar | FRED if key, local simulated histories otherwise | Request-time fetch/cache behavior in server FRED library | Useful but fallback transparency must be stricter |
| `/api/dataops/health` | Actual runtime provider probe | env vars, service health URLs | Request-time probes | Good operational truth source |
| `/api/dataops/runs` | Lineage/runs | fixture data + optional manifests | mostly fixture | Not authoritative |
| `/api/news` | News provider chain + NLP | Alpha Vantage/Marketaux/Finnhub/NewsAPI/NLP optional | Request-time | Not production until keys/feed SLAs exist |
| `/api/social` | Social sentiment | none currently; SIM engine | Always 200 SIM in route | Not live |
| `/api/market-lens` | Market Lens backend proxy | `MARKET_LENS_URL` else snapshots | Request-time | Partial |
| `/api/chart/*` | Chart templates and series | local catalog/econ/market | Request-time | Partial |
| `market_data_pipeline` | Ingest FRED/Yahoo, quality, DuckDB, Parquet, API | FRED, Yahoo, Synthetic | scheduler jobs exist for daily/intraday | Solid prototype; live depends on env and running service |
| `macro_data_etl` | Macro ETL/gold exports | World Bank/BIS/IMF/CME/FRED-style catalog | CLI/pipeline, no verified running scheduler | Partial; committed snapshots stale risk |
| `news_nlp` | FinBERT/lexicon NLP service | transformer model, heuristics | service/CLI | Optional; fallback is lexicon/SIM |
| `market_lens_studio` | Analytics API/orchestrator | cached DuckDB/Yahoo/FRED adapters | service-driven | Partial; frontend falls back to snapshots |

### Data layer inventory

| Layer | Files/tables | Source | Freshness status |
|---|---|---|---|
| Committed market JSON | `src/data/market/*.json` | exported market pipeline views | mostly `2026-06-17`/`2026-06-18`; snapshot fallback |
| Committed macro ETL JSON | `src/data/etl/*.json` | macro ETL gold exports | mixed; inflation/policy time series begin in 2024, Fed probs as of `2026-06-18` |
| Static TS data modules | `src/data/*.ts` | seeded generators/static arrays | deterministic, not live |
| Market pipeline storage | DuckDB/parquet/archive modules | runtime pipeline output | credible but not guaranteed present |
| Macro ETL raw/bronze/silver/gold | `.gitkeep` dirs + loader code | runtime ETL output | directories empty in repo |
| News NLP storage | app settings/storage modules | runtime service | no committed live corpus |

## Provider inventory and DataOps audit

| Provider | Type | Live? | Connected? | Used? | Coverage | Last usage | Refresh | Fallback | Production ready? |
|---|---|---|---|---|---:|---|---|---|---|
| FRED | Official macro API | Conditional | `FRED_API_KEY` | Yes, econ APIs | Medium-high | request-time | API/cache | SIM histories | Partial |
| Yahoo | Unofficial market data | Conditional | market pipeline service/DB/export | Yes, market views | Medium | committed snapshots `2026-06-17` | scheduler exists in Python | synthetic/snapshot | Not institutional |
| CME | Fed Funds futures | Weak/conditional | macro ETL connector | FOMC probabilities | Low | committed `2026-06-18` | ETL | deterministic futures curve | No |
| World Bank/BIS/IMF | Macro/country | Partial | macro ETL connectors | global CPI/policy | Low-medium | committed JSON | ETL | IMF fallback | Partial |
| News providers | Alpha Vantage/Marketaux/Finnhub/NewsAPI | Conditional | env keys only | News route | Low | request-time if configured | request-time | deterministic news | No |
| Social providers | Reddit/StockTwits/X concept | Mostly no | route returns SIM | Sentiment/social | Very low | n/a | n/a | SIM | No |
| NEWS_NLP | NLP service | Conditional | `NEWS_NLP_URL` | News/copilot | Low-medium | request-time if configured | service | lexicon/SIM | Partial |
| Local/Internal books | Custody/loan/margin/treasury | No | none | Financing/optimization modules | 0 | n/a | n/a | seeded fixtures | No |
| Synthetic | deterministic generator | Yes as fallback only | always | everywhere | 100 as fallback | deterministic | n/a | n/a | Useful, but must never count as live |

## Lineage map by domain

```text
FRED_API_KEY -> src/lib/server/fred.ts -> /api/econ/* -> hooks/useEcon + economics pages -> SourceBadge/FRED or SIM
Yahoo/FRED -> market_data_pipeline ingestion -> DuckDB/parquet/exported JSON/FastAPI -> /api/market/[view] -> market pages
World Bank/BIS/IMF/CME -> macro_data_etl pipeline -> src/data/etl/*.json -> global CPI/policy/FOMC pages
NEWS provider keys -> src/lib/server/newsProviders.ts -> /api/news -> news page -> optional NEWS_NLP scoring
NEWS_NLP_URL -> news_nlp service -> /api/news or sentiment scoring -> news/copy layers
Seeded TS generators -> page imports -> UI tables/cards -> no storage, no upstream, no true as-of
DataOps fixtures -> src/data/dataOps.ts -> /api/dataops/runs/page -> apparent lineage, but not authoritative
```

## Freshness audit

- Market JSON snapshots expose `asof` and currently indicate `2026-06-17` or `2026-06-18`. This is acceptable as a cache label, but not proof that a scheduler is running today. **Now surfaced:** the market modules (MKT, SNAP, QUILT, IRET) pass `asof` to the provenance badge, which classifies it via `classifyFreshness` (`src/lib/provenance.ts`) and shows an amber `Nd` once data is aging and a red `STALE · Nd` once it is stale — independent of the source tier, so a live-but-unrefreshed pipeline or an old committed snapshot no longer reads as current.
- FRED economics pages can expose `DATA AS OF` from actual observations, but the fallback histories also produce dates and can be mistaken for real observations. **Now mitigated:** econ has a real-data fallback tier between live FRED and synthetic SIM — `src/data/econSnapshot.json`, populated by `npm run export:econ-snapshot` (needs a `FRED_API_KEY` + egress). The `/api/econ/{indicators,series,batch}` routes and the `useEcon` client hooks prefer it (labelled `SNAPSHOT`) over the seeded simulation, so a no-key / no-egress / static deploy shows real frozen FRED values instead of synthetic ones. Licensing-restricted `simOnly` series (e.g. ISM PMIs) are excluded and remain SIM. Curve/calendar series are not yet snapshotted (follow-up).
- Macro ETL pages expose `as_of` for Fed probabilities, but global time-series JSON does not carry a top-level processing timestamp.
- Seeded internal-book modules generally do not expose a real data observation date. Alerts use fixed generated timestamps around 2026-06-17 and should not be treated as live ops.
- DataOps fixture run timestamps are hardcoded around 2026-06-18; they are not evidence of actual runs.

## Data quality audit

Critical patterns:

1. **Always-200 fallback** keeps the UI resilient but can hide upstream failure unless every component displays source and fallback status prominently.
2. **Provider health fixtures** overstate live readiness and conflict with the real `/api/dataops/health` probe.
3. **Synthetic marked as LIVE** in DataOps can corrupt governance metrics. Synthetic should be `AVAILABLE` or `FALLBACK`, never `LIVE`.
4. **Per-series fallback** in economics can mix FRED and SIM in the same module; aggregate module-level badges are insufficient.
5. **Internal books absent** means finance modules have no reconciliation, no lineage, no permissions model, no controls, no QA rules, and no authoritative as-of.
6. **Unverified vendor SLAs**: Yahoo is useful for prototypes but not a production market-data source for institutional terminal workflows.

## Module-by-module readiness scoring

| Module | Purpose | Actual sources | Live % | Sim % | Readiness | Confidence | Lineage | Freshness | Transparency | Tech debt | Critical findings | Actions |
|---|---|---|---:|---:|---:|---:|---|---|---|---|---|---|
| HOME | Cross-terminal KPIs | mixed local + snapshots | 20 | 80 | 25 | 75 | D | D | C | D | Aggregates fixture-heavy modules | Critical: mark domains by source |
| MKT | Multi-asset monitor | market API chain | 60/0 | 40/100 | 55 | 85 | B | B/C | B | B | Good resolver, snapshot fallback | High: require env health in UI |
| SNAP | Cross-asset snapshot | market snapshots | 60/0 | 40/100 | 55 | 85 | B | B/C | B | B | same as MKT | High: source badges per card |
| QUILT | Asset-class returns | market Bilello | 60/0 | 40/100 | 55 | 80 | B | B/C | B | B | static if no pipeline | High |
| IRET | index returns | market JSON/API | 60/0 | 40/100 | 55 | 80 | B | B/C | B | B | static if no pipeline | High |
| LENS | analytics workspace | Lens backend or snapshots | 35 | 65 | 45 | 70 | C | C | B | C | backend optional | High: persist provenance per result |
| MKC | market charting | chart series API | 45 | 55 | 45 | 70 | C | C | C | C | synthetic histories possible | Medium |
| SLAB | lending inventory/book | seeded generator | 0 | 100 | 10 | 95 | F | F | C | F | no loan/custody data | Critical: integrate lending book |
| SQZ | squeeze radar | seeded generator | 0 | 100 | 10 | 95 | F | F | B | F | short interest/borrow fees absent | Critical: vendor feeds |
| PB | prime finance | seeded generator | 0 | 100 | 10 | 95 | F | F | D | F | no client/exposure feed | Critical |
| COLL | collateral | seeded generator | 0 | 100 | 10 | 95 | F | F | D | F | no margin/eligibility schedules | Critical |
| CASH | funding optimization | seeded generator | 0 | 100 | 10 | 95 | F | F | D | F | no treasury/cash ledger | Critical |
| REINV | cash collateral portfolio | seeded generator | 0 | 100 | 10 | 95 | F | F | D | F | no reinvestment book | Critical |
| LIQ | liquidity stress | seeded + labels | 5 | 95 | 15 | 90 | F | F | D | F | local funding generated | Critical |
| SXU | source/use matching | seeded generator | 0 | 100 | 10 | 95 | F | F | D | F | no optimization input feeds | Critical |
| OPT | solver run center | seeded solver runs | 0 | 100 | 10 | 95 | F | F | D | F | no solver/run artifact store | Critical |
| DESK | desk analytics | local generated | 10 | 90 | 20 | 85 | D | D | C | D | lacks execution/order feeds | High |
| ECON | macro dashboard | FRED + SIM overlay | 55 | 45 | 60 | 85 | B | B | B | C | mixed live/sim histories | High: per-metric provenance |
| CURV | yield curve | FRED + SIM | 60 | 40 | 65 | 85 | B | B | B | B | good fallback disclosure | Medium |
| INFL | inflation | FRED/static histories | 45 | 55 | 50 | 75 | C | C | C | C | item-level likely simulated | High |
| GCPI | global CPI | macro ETL JSON | 20 | 80 | 35 | 80 | C | D | C | C | cached snapshots only | High |
| GPOL | policy rates | macro ETL JSON | 20 | 80 | 35 | 80 | C | D | C | C | cached snapshots only | High |
| CRDT | credit spreads | FRED + fallbacks | 55 | 45 | 55 | 80 | B | B/C | C | C | fallback constants | High |
| FOMC | Fed probabilities | CME ETL JSON/fallback | 25 | 75 | 35 | 80 | C | C | C | D | CME fallback deterministic | Critical: real FedWatch/feed |
| CAL | economic calendar | FRED approximation/SIM | 30 | 70 | 35 | 75 | C | C | C | C | no calendar provider | High |
| STAT | statistics | FRED/SIM series | 50 | 50 | 55 | 80 | B | B/C | C | C | source mixing affects stats | High |
| REGIME | macro regime | hardcoded/static | 15 | 85 | 25 | 90 | D | F | D | D | labeled sources not actual fetches | Critical |
| EML | ML apps | deterministic outputs | 10 | 90 | 20 | 85 | D | F | D | D | no model registry/scoring data | Critical |
| SFE | sec-fin macro | macro + generated desk links | 20 | 80 | 25 | 80 | D | D | C | D | desk impacts simulated | High |
| FUND | funding/liquidity macro | mixed macro/local | 30 | 70 | 35 | 75 | C | C | C | D | internal funding absent | High |
| MGC/MOTN | macro chart/motion | econ series | 45 | 55 | 45 | 75 | C | C | C | C | chart provenance per series needed | Medium |
| NEWS | news intelligence | provider chain or SIM | 20 | 80 | 30 | 85 | D | D | B | C | default deterministic | Critical: ingest real feeds |
| SENT | sentiment | deterministic + FRED VIX possible | 15 | 85 | 25 | 85 | D | D | B | D | AAII/NAAIM/social absent | Critical |
| AI | copilot | optional LLM + local context | 15 | 85 | 30 | 80 | D | D | C | C | can reason over fake data | Critical: source-aware RAG guardrails |
| DATAOPS | governance console | probe + fixtures | 30 | 70 | 35 | 90 | D | D | C | D | fixture lineage misleading | Critical: replace fixtures with manifests |
| ALRT | alerts | seeded templates | 0 | 100 | 10 | 95 | F | F | D | F | not connected to event bus | Critical |

The "Live %" column is the dev ceiling. Verified per module by tracing each page's data hooks: in a default `vite build` deploy, every module whose render path calls `/api/*` (MKT, SNAP, QUILT, IRET via `useMarketView`; ECON, CURV, INFL, GCPI, GPOL, CRDT, CAL, STAT, SFE, FUND, SENT via the `useEcon`/`useStats` hooks → `/api/econ/*`; MKC, MGC/MOTN via `useChartSeries` → `/api/chart/series`; LENS, NEWS, AI, DATAOPS via their own fetches) drops to a live % of ≈0 because those handlers are not deployed; readiness/lineage/freshness grades should be read against that snapshot/fixture floor. The chart modules (MKC, MGC/MOTN) degrade hardest — their resolver has no client-side fallback, so charts render empty (ERR) rather than from a snapshot. Modules that import only local `@/data/*` (HOME, FOMC, REGIME, EML, DESK, ALRT, and the F-graded financing book SLAB/SQZ/PB/COLL/CASH/REINV/LIQ/SXU/OPT) make no `/api` calls and are unchanged by deploy. See "API serving model: dev plugin vs. production deploy."

## Live vs simulation master matrix

| Module class | Live | Partial | Simulated | Unknown | Estimated live |
|---|---:|---:|---:|---:|---:|
| Market pipeline modules | 0 | 5 | 0 | 0 | 60% when configured (dev); 0% in default deploy |
| Economics/FRED modules | 0 | 11 | 0 | 0 | 45-60% when key configured (dev); ≈0% live in default deploy (all `/api/econ/*`-served) |
| Macro ETL modules | 0 | 3 | 0 | 0 | 20-30% from cached exports; GCPI/GPOL also overlay live FRED via `/api/econ/batch` (lost in default deploy, ETL JSON remains); FOMC fully local |
| Financing/internal-book modules | 0 | 0 | 8 | 0 | 0-5% (local fixtures; unaffected by deploy) |
| Intelligence modules | 0 | 4 | 1 | 0 | 0-30% in dev; ≈0% live in default deploy (`/api`-served) |
| DataOps | 0 | 1 | 0 | 0 | 30% in dev; ≈0% live in default deploy (probe `/api` 404s) |

"Estimated live" reflects the dev environment; in a default `vite build` deploy the `/api`-served classes collapse to their fixture/snapshot floor. See "API serving model: dev plugin vs. production deploy."

## Readiness heatmap

| Module group | Data availability | Data quality | Freshness | Lineage | Observability | Production readiness |
|---|---:|---:|---:|---:|---:|---:|
| Market views | 70 | 65 | 60 | 75 | 60 | 55 |
| FRED economics | 70 | 70 | 70 | 70 | 55 | 60 |
| Macro ETL global/FOMC | 45 | 55 | 35 | 55 | 40 | 35 |
| Market Lens | 45 | 50 | 45 | 50 | 45 | 45 |
| News/NLP/social | 30 | 35 | 30 | 35 | 35 | 30 |
| Securities lending/PB/collateral/cash/liquidity | 10 | 20 | 5 | 10 | 15 | 10 |
| Optimization/alerts/copilot | 15 | 25 | 10 | 20 | 20 | 20 |
| DataOps governance | 35 | 30 | 25 | 25 | 45 | 35 |

These scores assume the dev environment where `/api/*` routes resolve. The "Production readiness" column in particular should be read against the serving gap: until the API handlers are actually deployed (see "API serving model: dev plugin vs. production deploy"), the `/api`-served groups (Market views, FRED economics, Market Lens, News/NLP/social, DataOps) serve only snapshots/fixtures in a default build.

## Provider coverage gap analysis

| Missing provider/feed | Blocks modules | Business impact | Complexity | Data quality lift |
|---|---|---|---|---|
| Internal stock loan book + inventory/custody | SLAB, SQZ, SXU, OPT | Very high | High | Very high |
| Borrow fee/utilization/vendor lending data (DataLend/IHS/EquiLend/Markit) | SLAB, SQZ | Very high | High | Very high |
| Short interest/exchange/FINRA | SQZ, SENT | High | Medium | High |
| Prime brokerage client/exposure/margin systems | PB, LIQ, CASH | Very high | High | Very high |
| Collateral eligibility, margin, triparty/custody feeds | COLL, LIQ, OPT | Very high | High | Very high |
| Treasury cash ledger/payment/settlement systems | CASH, LIQ, SXU | Very high | High | Very high |
| OCC/DTCC/NSCC/FICC settlement and margin data | COLL, CASH, LIQ | High | High | High |
| Repo market feed (BGC/ICAP/Bloomberg/Refinitiv/internal) | CASH, REINV, FUND | High | Medium-high | High |
| Fed/Treasury official liquidity series | FUND, LIQ, ECON | Medium | Low | Medium |
| CME official/licensed FedWatch/futures settlement | FOMC | Medium | Medium | High |
| Institutional market data (Bloomberg/Refinitiv/FactSet/Polygon/Tiingo) | MKT/SNAP/CHART | High | Medium | High |
| Economic calendar provider | CAL | Medium | Low-medium | High |
| AAII/NAAIM official survey feeds | SENT | Medium | Low-medium | High |
| Reddit/StockTwits/X licensed APIs | NEWS/SENT/SQZ | Medium | Medium | Medium-high |
| SEC EDGAR filing feed | NEWS/AI/REGIME | Medium | Medium | Medium |
| Model registry/training feature store | EML/AI | High | High | High |
| Solver artifact/run database | OPT | High | Medium | High |
| Alert/event bus | ALRT | High | Medium | High |
| Provider manifest registry | DATAOPS/all | Very high | Medium | Very high |
| Entitlements/audit logs | all production modules | Very high | High | Very high |

## False-live detection report

| Severity | Surface | Why it appears live | Reality | Fix |
|---:|---|---|---|---|
| ~~10~~ → 3 | Sidebar/status chrome | ~~Always-green `FEED LIVE` + fabricated `KAFKA 8.2k msg/s` / `WS 14 streams`~~ | **Fixed:** `StatusBar` now derives `FEED LIVE/PARTIAL/SIM` from the real `useProviderHealth` probe (same source as the `DATA x/y LIVE` badge), and the Kafka/WS telemetry is muted and labelled `· SIM`. Residual: copy still mentions streaming. | Remaining streaming language to be removed if no bus is added |
| 10 | DataOps provider fixtures | `getProviderHealth()` hardcodes FRED/MACRO_ETL as LIVE and synthetic as LIVE | `/api/dataops/health` may say SIM/CACHED | Remove fixture truth from production page |
| 10 | Internal-book modules | Tables show borrowers, margin, cash, alerts, optimization runs | Seeded `Rng` generators | Add `SIMULATED BOOK` watermark and block production use |
| 9 | Macro regime | Factors labelled FRED/YAHOO/LOCAL | Values are static arrays | Pull factors from source APIs or relabel simulated |
| 9 | EML | Model outputs labelled LIVE in data constants | No model scoring pipeline | Add model registry and input lineage |
| 8 | Market modules | Pipeline source badge can show SNAPSHOT/FILE/DB but users may interpret as live | Committed snapshots are stale caches | Add cache age and refresh manifest |
| 8 | FOMC | Rate probabilities show as-of | CME fallback can be deterministic | Show CME vs fallback per meeting |
| 8 | Copilot | Natural language responses sound authoritative | Context may be generated | Require source disclosures in every answer |
| 7 | Sentiment | Survey/social charts have recent dates | Deterministic weekly anchor | Label each component SIM unless real feed |
| 7 | Alerts | Streaming risk/ops alerts with timestamps | Seeded templates | Disable “streaming” language without event bus |

## Unused/wired-but-unused infrastructure

- `market_data_pipeline` includes storage, scheduler, quality, and FastAPI services; the Vite + React app only consumes it when env vars/service are configured and otherwise uses committed JSON.
- `macro_data_etl` includes connectors and medallion directories, but repo data directories are placeholders and frontend mainly consumes committed JSON exports.
- `market_lens_studio` includes rich analytics APIs/orchestrator; frontend falls back to embedded snapshots when `MARKET_LENS_URL` is absent.
- `news_nlp` can run FinBERT/lexicon services; default terminal behavior is heuristic/SIM without `NEWS_NLP_URL` or feed keys.
- Optional DB drivers are partial: `pg` is optional dependency; DuckDB is dynamically required but not declared in `package.json`, so DuckDB runtime path may silently fall through.
- DataOps lineage/run tables exist as fixture generators; they should become consumers of real pipeline manifests.

Potential value is high for market pipeline, macro ETL, Market Lens, and news NLP because they already define service contracts. Value is low for DataOps fixtures until replaced by real manifests.

## Prioritization ranking

Priority score = Business Value × Data Availability × Implementation Ease. Scores are relative 0-100.

| Rank | Module/provider work | Score | Reason |
|---:|---|---:|---|
| 1 | Replace DataOps fixtures with real manifests and health truth | 92 | Foundational governance, medium effort |
| 2 | Harden FRED economics provenance per metric | 86 | High availability, low-medium effort |
| 3 | Operationalize market pipeline deployment/export freshness | 84 | Existing architecture, high product value |
| 4 | Add market cache age/as-of manifest to all market views | 80 | Low effort, high trust gain |
| 5 | Connect official economic calendar | 74 | High UX value, tractable |
| 6 | Wire AAII/NAAIM feeds | 70 | Improves sentiment with modest effort |
| 7 | Run NEWS_NLP service + one real news provider | 68 | Converts NEWS from demo to partial live |
| 8 | Add CME/Fed funds futures robust feed | 65 | Fixes FOMC credibility |
| 9 | Build internal book ingestion contract/schema | 64 | Huge value, higher complexity |
| 10 | Solver artifact store for OPT | 60 | Needed before optimization features |
| 11 | Collateral/margin feed integration | 58 | High complexity, high value |
| 12 | Securities lending inventory/loan feed | 57 | High complexity, high value |
| 13 | Treasury cash ledger integration | 55 | High complexity, high value |
| 14 | Alert event bus and rules provenance | 52 | Medium complexity |
| 15 | Copilot source-aware guardrails | 50 | Prevents misinformation |

## Modules that should not receive new features yet

SLAB, SQZ, PB, COLL, CASH, REINV, LIQ, SXU, OPT, REGIME, EML, NEWS, SENT, AI, DATAOPS, and ALRT should not receive new functional features until source lineage, freshness, and simulation labeling are fixed.

## Modules ready for cautious expansion

MKT, SNAP, QUILT, IRET, ECON, CURV, STAT, and chart studios are ready for limited expansion only if every enhancement preserves source fields, observation dates, cache age, and fallback disclosure.

## Recommended 90-day plan

### Phase 1: Governance truth and visible provenance (Days 1-30)

Phase 1 execution has started in this branch. The operational flow and setup checklist now live in [Data Pipeline Overview](./DATA_PIPELINE_OVERVIEW.md).

- Replace DataOps fixture health/runs/lineage with real manifests from market pipeline, macro ETL, FRED API cache, news NLP, and provider probes.
- Change synthetic provider status from `LIVE` to `FALLBACK_AVAILABLE` everywhere. **Started:** the DataOps fixture provider and runtime health probe now report deterministic synthetic data as fallback-available, not live.
- Add module-level and row-level provenance contract: source, provider, observation date, processing timestamp, cache timestamp, fallback reason, and simulation flag.
- Add UI watermarks for simulated internal-book modules.
- Add tests that fail when a page renders operational terms without a provenance badge.

### Phase 2: Make the existing live paths production-grade (Days 31-60)

- Deploy or document market pipeline as required service; automate `mdp export-views` and publish freshness manifests.
- Harden FRED fetch/cache/error semantics and expose per-series fallback.
- Add official economic calendar provider.
- Replace CME deterministic fallback with licensed/robust futures settlement ingestion or clearly demote FOMC to simulation.
- Run NEWS_NLP and one real news provider in a controlled environment; log feed freshness and model version.

### Phase 3: Start internal-book integration before new features (Days 61-90)

- Define canonical schemas for stock loan inventory, loan book, borrow requests, prime exposures, margin calls, collateral assets, cash sources/uses, and liquidity ladders.
- Implement ingestion stubs that fail closed instead of silently generating data.
- Create reconciliation and quality checks: row counts, totals vs GL/books, stale thresholds, null limits, duplicate keys, and entitlement checks.
- Convert SLAB/PB/COLL/CASH/LIQ/SXU/OPT from seeded generators to adapter interfaces with explicit SIM mode.
- Add alert event bus backed by real quality/provider/business-rule events.

## Final conclusion

The codebase is closest to production readiness in market snapshots and FRED economics because those domains have real source adapters, explicit API boundaries, snapshots, and fallback labels. The codebase is furthest from readiness in securities finance and optimization, where UI sophistication masks the absence of upstream internal books and vendor feeds. Before any new features, the team should make DataOps authoritative, make simulation impossible to confuse with live data, and convert seeded internal-book domains into source-backed ingestion contracts.
