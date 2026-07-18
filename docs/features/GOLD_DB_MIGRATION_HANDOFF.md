# QIT Terminal → Gold DB: Data-Cutover Scope & Handoff

**Status:** Plan / handoff (not code). **Owner:** data-platform + terminal FE.
**Companion source of truth:** the sibling `fred-bronze-to-gold-pipeline`
project (Bronze→Silver→Gold medallion on Delta / SQLite). Its terminal-facing
plan is `fred-bronze-to-gold-pipeline/docs/handoffs/market_terminal_gold_views.md`
and its series audit is `.../docs/gap/market_terminal_series_gap.md`. Read those
alongside this one — this document is the **reverse** handoff: how the terminal
stops calling live APIs and reads **only** the pipeline's Gold layer.

---

## 1. Objective

Today every macro/market surface in the terminal resolves data through a
three-step fallback chain:

```
live FRED API  →  committed SNAPSHOT (JSON in src/data/*)  →  deterministic SIM
```

with parallel live chains for market prices (Yahoo / `market_data_pipeline`),
news, social, prediction markets, and the LLM copilot.

**We are removing the entire chain for series/economic data and replacing it
with a single source of truth: the Gold layer of `fred-bronze-to-gold-pipeline`.**
After this migration, a macro/market module has exactly one data path — a query
against a Gold table — and **no FRED key, no live HTTP, no committed snapshot,
and no SIM generator** in its production path. If the DB is unreachable the
module surfaces an explicit error/empty state; it does **not** silently fabricate.

This is feasible with almost no new pipeline work because the Gold layer was
already built to mirror these modules (see §4). The pipeline already ingests
several thousand series (a superset of the terminal's 166-series catalog) and
has already added the 59 gap series + 75 equity tickers the terminal referenced.

---

## 2. Decisions locked (2026-07-17)

| # | Decision | Choice |
|---|---|---|
| D1 | **Non-series real-time feeds** (NEWS provider chain, SENT social, POLY Polymarket, AI copilot LLM) | **Out of scope — keep live.** These are not series data and are not in the pipeline. They remain on their existing live chains as *documented, deliberate exceptions* to the DB-only rule. See §7 (Tier B). |
| D2 | **Internal securities-finance book** (SLAB, PB, COLL, CASH, REINV, LIQ, SXU, OPT, DESK, SFE, SQZ, HOME, FCOST, UTIL) | **Wire macro inputs to the DB; keep the book synthetic.** Their curve/credit/funding/policy *inputs* come from Gold; the position/inventory/exposure/P&L book stays deterministic-synthetic (no external source of truth exists for a fictional book). See §7 (Tier C). |
| D3 | **DB backend** | **SQLite file for local/dev; Postgres or Databricks/Delta for deployment**, behind one connection abstraction (`GoldStore`). See §5. |

---

## 3. Current-state inventory (what we are ripping out)

### 3.1 The resolution chain, per route

Every `src/app/api/econ/*` route repeats the same pattern (verified across
`indicators`, `batch`, `series`, `benchmark`, `curve`, `curve-history`,
`inversions`, `stats`, `calendar`):

```ts
const live = fredEnabled();                 // FRED_API_KEY present?
if (live && !resolveFred(id).simOnly) {
  try { return await fredSeries(id, {...}); } catch { /* fall through */ }
}
const snap = getSnapshotObservations(id);   // committed JSON
if (snap) return snap;
return getSeriesHistory(id);                 // SIM (seeded RNG)
```

Files that implement or feed this chain, and their disposition:

| File | Role today | Disposition |
|---|---|---|
| [src/lib/server/fred.ts](../src/lib/server/fred.ts) | Live FRED client (JSON + CSV + Python fallbacks, TTL cache, probe) | **Remove from prod path.** Keep only if retained as an offline ingestion helper; not called by any route after cutover. |
| [src/data/econSeries.ts](../src/data/econSeries.ts) | 166-series `FRED_CATALOG`, `resolveFred` (units/scale/simOnly), `getSeriesHistory`/`getSeriesHistoryRaw` (SIM), `getIndicators` (SIM) | **Split:** keep `FRED_CATALOG` as the *client-side dimension* (labels/decimals/category) **or** replace it by reading `gold.dim_series`; delete the SIM generators (`getSeriesHistory*`, `getIndicators`, `RAW_LEVEL_ANCHORS`, `Rng` usage). |
| [src/data/econSnapshot.ts](../src/data/econSnapshot.ts) + `econSnapshot.json` | Committed FRED snapshot fallback | **Delete.** The DB is the snapshot now (with real point-in-time history the JSON never had). |
| `src/data/statsConfig.ts` (`simStatFull`), `econCurve.ts`, `econRates.ts`, `benchmarkRates.ts`, `creditSpreads.ts`, `yieldCurveAnalytics.ts`, `ratesRV.ts`, `inflation.ts`, `globalMacro.ts`, `macroRegime.ts` | Per-module SIM + on-the-fly TS analytics | **Analytics move server-side into Gold** (already precomputed). Terminal keeps only formatting/shaping. Delete SIM branches. |
| `src/lib/provenance.ts`, `simMode.tsx`, `useEcon.ts`, `useMarket.ts` | Provenance badges + client fallback-then-upgrade | **Simplify:** provenance collapses to `DB` + a `staleness_days`-driven `AGING`/`STALE` marker (§8). No more `FRED`/`SNAPSHOT`/`SIM` tri-state. |

### 3.2 Market-price path (already partly DB-capable)

`src/app/api/market/[view]/route.ts` **already** supports a DB read:
`readFromDb(MARKET_DB_URL, view)` against Postgres/DuckDB `analytics_api_views`,
and `readMarketObservations` against `market_series_observations`. This is the
template for the `GoldStore` abstraction — we generalize it, point it at the
Gold equity tables (`gold.equity_total_return_index`, `equity_return_daily`,
`index_constituents`), and drop the `MARKET_PIPELINE_URL` HTTP + JSON-file
fallbacks.

### 3.3 Env vars in play

`FRED_API_KEY`, `FRED_BASE_URL`, `FRED_PYTHON_*`, `MARKET_PIPELINE_URL`,
`MARKET_DB_URL`, `MARKET_DATA_DIR`, `MARKET_LENS_URL`, `CHART_DB_URL`,
`AAII_SENTIMENT_URL` → **all retired for series data** and replaced by a single
`MACRO_DB_URL` (+ optional Databricks vars). Kept: news/social/polymarket/LLM
keys (Tier B) — `ALPHAVANTAGE_API_KEY`, `MARKETAUX_API_KEY`, `FINNHUB_API_KEY`,
`NEWSAPI_API_KEY`, `REDDIT_USER_AGENT`, `STOCKTWITS_*`, `ANTHROPIC_API_KEY`.

---

## 4. The Gold layer is already shaped for these modules

The pipeline's `sql/50_gold.sql` / `60_views.sql` define tables whose grain and
columns map 1:1 to terminal surfaces. Key ones (see the pipeline DDL for full
column lists):

| Gold object | Grain | Serves terminal |
|---|---|---|
| `gold.dim_series` | 1 / series | **the presentation dimension** — `econ_category`, `polarity`, `default_transform` (`pc1`/`pch`/`chg`/`bps`/`level`), `scale`, `decimals`, `units`, `title`, `source`. This is `resolveFred` + `FRED_CATALOG` as data. |
| `gold.dim_date` | 1 / date | `is_recession` (USREC) shading, time intelligence |
| `gold.macro_indicator_dashboard` | 1 / series (latest) | **ECON** grid: latest/prior/change/`yoy_pct`/`zscore`/`percentile`/`surprise`/`staleness_days`/`realtime_start`/`direction_is_good` |
| `gold.macro_indicator_sparkline` | 1 / series × point | ECON 36-pt sparklines |
| `gold.macro_category_summary` | 1 / category | ECON breadth + surprise index |
| `gold.macro_feature_daily` / `fred_feature_transforms` | daily forward-filled / per-transform | any series drill, STAT inputs |
| `gold.fred_latest_observation` / `fred_point_in_time` / `v_latest_revised` / `v_point_in_time` | obs-level | 24m drill history, point-in-time queries |
| `gold.inflation_explorer` + `inflation_contribution` | 1 / item × month | **INFL** (item tree, MoM/YoY, accel, weight, contribution_pp, basket & SA/NSA toggles) |
| `gold.treasury_curve` + `treasury_curve_metrics` + `treasury_curve_rolling` | as-of × tenor / as-of | **CURV / YCURV** (level/slope/curvature/butterfly, move classification, recession overlay) |
| `gold.curve_spread_daily` + `spread_inversion_episode` + `curve_spread_rolling` | spread × date / episode | **CURV** spreads, z-scores, inversion episodes → recession lead-time |
| `gold.benchmark_rate_board` | 1 / rate | **BMRK / BRA** (trend, spread-to-benchmark, regime, z/percentile) |
| `gold.funding_tape_daily` + `funding_stress_daily` | metric × date / date | **FUND / FCOST** (corridor/balances/spreads + 0–100 stress gauge) |
| `gold.credit_spread_daily` + `credit_spread_rolling` | instrument × date | **CRDT** (OAS bps, change, percentile, stress episodes) |
| `gold.macro_regime_daily` | 1 / date | **REGIME / SFE** (5 pillar scores, named regime, confidence) |
| `gold.series_correlation` + `series_lead_lag` + `series_structural_breaks` | pair × window / pair × lag | **STAT / EDA** (correlation matrix, CCF, Granger, CUSUM/PELT) |
| `gold.yield_curve_ns_factors` | 1 / date | **RVOL / YCURV** (Nelson-Siegel factors) |
| `gold.global_inflation` + `global_policy_rates` | country × date | **GCPI / GPOL** |
| `gold.equity_total_return_index` + `equity_return_daily` + `index_constituents` + `equity_price_reconciliation` | ticker × date | **MKT / SNAP / QUILT / IRET / LENS / MKC** |
| `gold.recession_probability_daily` + `inflation_forecast` + `macro_factor_scores`/`loadings` + `macro_anomaly_scores` + `equity_factor_attribution`/`implied_return` | date / ticker × date | **EML** (ML Applications), **DESK/PB** factor overlays |
| `gold.fred_company_fundamentals` + `fred_company_ratios` + `v_company_ratio_ranks` | cik × concept × date | SEC fundamentals (future equity drilldowns) |
| `gold.powerbi_catalog` | 1 / gold object | **the object→module index** (has a `module` column) — use it to drive DATAOPS lineage and to assert coverage in tests |
| `gold.v_source_coverage` | source × series | **DATAOPS** freshness/coverage + provenance badges |

**Implication:** the terminal's per-module TypeScript analytics (z-scores,
spreads, regime scoring, curve metrics, correlation) are **already computed in
Gold, point-in-time-correct**. The migration is mostly *deletion* on the
terminal side — routes become thin `SELECT`s + shaping, not recomputation.

---

## 5. Connection contract (`GoldStore`)

### 5.1 One abstraction, three backends

Add `src/lib/server/goldStore.ts` — a server-only module (generalizing the
existing `readFromDb` in the market route). Dialect is detected from
`MACRO_DB_URL`:

```
MACRO_DB_URL=sqlite:./data/fred_local.db        # local/dev (pipeline `--local` output)
MACRO_DB_URL=postgres://user:pass@host/db        # deploy (pipeline Postgres publish)
# Databricks/Delta (deploy, Unity Catalog):
MACRO_DB_BACKEND=databricks
DATABRICKS_HOST=... DATABRICKS_HTTP_PATH=... DATABRICKS_TOKEN=...
MACRO_CATALOG=macro_prod                          # macro_dev | macro_test | macro_prod
```

Drivers are optional/lazy (`better-sqlite3` for local, `pg` for Postgres,
`@databricks/sql` for Delta) exactly like the current `optionalRequire` pattern,
so a runtime only needs the driver for its backend.

### 5.2 Table naming across backends

The pipeline writes the same logical tables under different physical names:

| Logical | SQLite (local) | Postgres / Delta |
|---|---|---|
| `gold.macro_indicator_dashboard` | `gold_macro_indicator_dashboard` | `gold.macro_indicator_dashboard` (Delta: `{catalog}.gold.…`) |
| `gold.dim_series` | `gold_dim_series` | `gold.dim_series` |

`GoldStore` owns this mapping: callers ask for a **logical** table name; the
store resolves it to `gold_<t>` (SQLite) or `<catalog>.gold.<t>` (Postgres/Delta).
Confirm the exact SQLite prefix against the pipeline's `LocalWarehouse` /
`local_store.py` (`{schema}_{table}`, per the pipeline README) before coding.

### 5.3 Interface (sketch)

```ts
export interface GoldStore {
  /** latest snapshot rows for a fact table, optional filter */
  latest<T>(table: string, where?: Record<string, unknown>): Promise<T[]>;
  /** observation history for a series/entity, ascending by date */
  history<T>(table: string, key: Record<string, unknown>, limit?: number): Promise<T[]>;
  /** point-in-time: rows as-known-on a given realtime date */
  asOf<T>(table: string, asOf: string, where?: Record<string, unknown>): Promise<T[]>;
  raw<T>(sql: string, params?: unknown[]): Promise<T[]>;   // escape hatch
  health(): Promise<{ ok: boolean; backend: string; latencyMs: number; detail: string }>;
}
```

### 5.4 Freshness & caching

Gold is batch-refreshed (daily/intraday by the pipeline job), not tick-live. A
short in-process TTL cache (reuse the `Map` cache pattern already in `fred.ts`)
keyed by `(table, where)` is sufficient. No per-request DB storm. The
`gold.v_source_coverage` view + each row's `staleness_days` drive the freshness
UI — the terminal never guesses freshness anymore.

### 5.5 No fallback — explicit failure

If a query returns zero rows or the connection fails, the route returns
`{ source: "DB", ok: false, error, rows: [] }` (HTTP 200 so the client renders a
clean empty state) and the module shows an explicit "no data / DB unreachable"
panel. There is **no SIM/snapshot fallback**. This is the core behavioral change
of the migration and must be enforced in review (grep gate, §11).

---

## 6. Route → Gold table mapping (Tier A — the core cutover)

Each terminal route below is rewritten to a `GoldStore` read. "Delete" = the
live/SIM branches removed.

| Route | Reads today | New Gold source | Notes |
|---|---|---|---|
| `GET /api/econ/indicators` | FRED→SNAP→SIM over `FRED_CATALOG` | `gold.macro_indicator_dashboard` (+ `macro_indicator_sparkline` for `history`) | Columns already match `LiveIndicator`; map `zscore`/`percentile`/`surprise`/`staleness_days` straight through. |
| `GET /api/econ/batch` | per-id FRED→SNAP→SIM | `gold.fred_feature_transforms` (or `macro_feature_daily`) filtered by id + transform | `resolveFred(id).units` → `default_transform` from `dim_series`. |
| `GET /api/econ/series` | per-id FRED→SIM, 24m | `gold.fred_latest_observation` (levels) / `fred_feature_transforms` (transformed) | Point-in-time drill can use `v_point_in_time`. |
| `GET /api/econ/calendar` | `fredReleaseDates` + Finnhub + SIM | **See §7 Tier B-adjacent** — release *dates* aren't a Gold series. Option: pipeline adds a `gold.release_calendar` (FRED `/releases/dates` ingested); until then this route is a flagged exception or reads a pipeline-provided calendar table. **Decision needed (§12).** |
| `GET /api/econ/benchmark` | FRED→SNAP→SIM over `BENCHMARK_SERIES` | `gold.benchmark_rate_board` | trend/spread/regime/z precomputed — route just shapes. |
| `GET /api/econ/curve` | `fredLatest` per tenor → SNAP → SIM | `gold.treasury_curve` (latest as-of) | |
| `GET /api/econ/curve-history` | `fredSeries` per tenor → SNAP → SIM | `gold.treasury_curve` (as-of overlays) + `treasury_curve_metrics` | The "1M/3M/6M/1Y/2Y ago" overlays = distinct `as_of_date` rows. |
| `GET /api/econ/inversions` | `fredSeries` spreads + USREC → SIM | `gold.spread_inversion_episode` + `curve_spread_daily` | Inversion→recession lead-time is `spread_inversion_episode.recession_overlap`. |
| `GET /api/econ/stats` | `fredSeries` over `STAT_SERIES` → SNAP → SIM | `gold.series_correlation` + `series_lead_lag` + `series_structural_breaks` (precomputed pairs) **or** raw obs via `fred_feature_transforms` for interactive recompute | STAT is interactive; if arbitrary user pairs are needed beyond the curated `stats_pairs.yml`, read raw transformed obs from Gold and keep the *client-side* stat math, but with DB inputs only (no FRED). |
| `GET /api/chart/series?source=…` | FRED / marketLens / SNAP | `gold.fred_feature_transforms` (macro) / `gold.equity_total_return_index` (market) | Unifies MGC/MKC/LENS charting onto Gold. Retire `CHART_DB_URL`. |
| `GET /api/market/[view]` | `MARKET_DB_URL` / `MARKET_PIPELINE_URL` / JSON / SIM | `gold.equity_total_return_index` + `equity_return_daily` + `index_constituents` | Generalize existing `readFromDb`; drop HTTP + JSON + SIM branches. Basis (total/price) = `total_return_index` vs `price_return_index`. |
| `GET /api/market-lens` | `MARKET_LENS_URL` + local | `gold.equity_total_return_index` + `fred_feature_transforms` (cross-asset series build) | LENS engine math stays client/server-side; inputs from Gold. |
| `GET /api/dataops/health` | `fredProbe` + provider pings + `MARKET_*` | `GoldStore.health()` + `gold.v_source_coverage` (+ live Tier-B provider pings, unchanged) | DATAOPS becomes "is the Gold DB fresh?" for all Tier A/C. |
| `GET /api/dataops/runs` | `fetchPipelineManifest(MARKET_PIPELINE_URL)` | pipeline audit tables (`audit.etl_run` / `etl_series_run` / `data_quality_result`) via `GoldStore` | Real ingestion lineage from the pipeline's own audit schema. |

**New routes to add (surface existing Gold with no terminal equivalent yet):**
`/api/econ/regime` → `gold.macro_regime_daily`; `/api/econ/credit` →
`gold.credit_spread_daily`; `/api/econ/funding` → `gold.funding_tape_daily` +
`funding_stress_daily`; `/api/econ/inflation` → `gold.inflation_explorer` +
`inflation_contribution`; `/api/econ/global` → `gold.global_inflation` +
`global_policy_rates`; `/api/ml/*` → `gold.recession_probability_daily` /
`inflation_forecast` / `macro_factor_scores`. (Several currently compute in
client TS off `src/data/*.ts`; point them at these instead.)

---

## 7. Module tiering (all 45)

### Tier A — series-backed, full DB cutover (remove FRED/Yahoo/SNAP/SIM)

`ECON, CAL*, STAT, EDA, CURV, YCURV, RVOL, BMRK, BRA, FUND, CRDT, INFL, GCPI,
GPOL, REGIME, EML, MKT, SNAP, QUILT, IRET, LENS, MKC, MGC, MOTN`
(*CAL depends on the release-calendar decision, §12.*)

These read Gold **only**. Client hooks (`useEcon`, `useMarket`) drop the
"render SIM, then upgrade" pattern — they render DB or an empty/error state.

### Tier B — non-series live feeds, KEPT LIVE (documented exceptions, per D1)

`NEWS` (Alpha Vantage→Marketaux→Finnhub→NewsAPI + Reddit/StockTwits + optional
FinBERT), `SENT` (survey/social — **note:** its VIX component moves to
`gold` VIX series; the AAII/NAAIM survey + social stay live), `POLY`
(Polymarket Gamma API), `AI` (Anthropic copilot).

Rule: Tier B is the **only** place live external HTTP is allowed post-migration.
Each Tier-B route carries a header comment: *"Exception to DB-only policy —
non-series real-time feed, see GOLD_DB_MIGRATION_HANDOFF §7 D1."* The AI copilot's
*context* (the datasets it reasons over) must be sourced from Gold via
`GoldStore`, not from live FRED — only the LLM call itself is the live piece.

### Tier C — internal synthetic book, inputs wired to DB (per D2)

`HOME, SLAB, SQZ, PB, COLL, CASH, REINV, LIQ, SXU, OPT, DESK, SFE, FCOST, UTIL, ALRT`

The book (loans, inventory, exposures, positions, P&L) stays deterministic-
synthetic — there is no real book in any DB. But every **macro/rate input** these
modules consume must come from Gold, not SIM:

| Module | Macro inputs → Gold source |
|---|---|
| COLL | haircuts/eligibility stress ← `gold.credit_spread_daily`, `treasury_curve` |
| REINV | reinvestment ladder / policy path ← `gold.benchmark_rate_board`, `macro_regime_daily` |
| CASH / LIQ | funding curve, LCR/NSFR rate inputs ← `gold.funding_tape_daily`, `funding_stress_daily` |
| SFE | repo greeks, Fed-cut scenario stepper ← `gold.treasury_curve`, `benchmark_rate_board`, `macro_regime_daily` |
| FCOST | blended funding cost ← `gold.funding_tape_daily` corridor + spreads |
| SQZ | (book demand synthetic) + rate overlays ← `gold.benchmark_rate_board` |
| OPT | optimizer rate/curve/credit inputs ← curve/credit/funding Gold tables |
| HOME | cross-desk KPI macro tiles ← `gold.macro_indicator_dashboard` |
| ALRT | macro-triggered alerts ← thresholds over Gold facts (curve inversion, stress bucket) |

Deliverable for Tier C: a shared `src/data/macroInputs.ts` server helper that
pulls the handful of Gold facts these modules need, so book generators consume
**one** DB-sourced macro context object instead of importing SIM series.

---

## 8. Provenance & staleness after cutover

The tri-state `FRED | SNAPSHOT | SIM` provenance disappears. Replace with:

- `source: "DB"` on every Tier A/C payload (single value; `worstSource` becomes
  trivial or is deleted).
- Freshness derived from the row's `staleness_days` (Gold carries it) against the
  series frequency in `dim_series`: `FRESH` / `AGING` / `STALE`. This reuses the
  existing `AGING`/`STALE` marker UI; only the input changes.
- `realtime_start` on Gold rows powers a "vintage as of" tooltip — a capability
  the SNAPSHOT/SIM chain never had.
- Tier B keeps its own provider-health provenance (unchanged).

`src/lib/provenance.ts` + `simMode.tsx`: prune to the two-state (DB + staleness)
model. Delete `SIM`-mode toggles from the shell.

---

## 9. Series coverage — existing catalog first, then additions

### 9.1 Existing 166-series `FRED_CATALOG` (Phase 1 target)

Every id in `src/data/econSeries.ts::FRED_CATALOG` is already ingested by the
pipeline (the pipeline holds a superset — see the pipeline's gap doc §7). Phase 1
= confirm each catalog id has a `gold.dim_series` row with matching
`econ_category` / `polarity` / `default_transform` / `scale` / `decimals`, then
point the routes at Gold. The pipeline's `config/series_catalog.yml` is where any
missing tag is added.

**Reconciliation task:** produce a diff of `FRED_CATALOG` (166) vs
`gold.dim_series`. Any terminal id absent from `dim_series` → add a tag in the
pipeline's `series_catalog.yml` (no new ingestion — the raw series is already
present). Any transform/scale/decimals mismatch → align on `dim_series` as
canonical and delete the terminal's `resolveFred` override.

### 9.2 Additions already delivered by the pipeline (per its gap doc, 2026-07-17)

The pipeline has **already added and verified live** the 59 gap FRED series
(rates/curve/CPI components/PCE energy/labor/credit/market indices/global policy)
and 75 equity/ETF tickers the terminal referenced. So the "scope additions" step
is largely *consumption*, not ingestion:

- Market index levels (`VIXCLS`, `SP500`, `NASDAQCOM`, `DJIA`, `DCOILWTICO`) →
  now in `gold` via `market_indices.yml`; wire SENT's VIX and MKT/SNAP tiles to
  them.
- CPI components (`CPIUFDSL`, `CPIENGSL`, `CPIMEDSL`, …) → `gold.inflation_explorer`.
- Equity universe (sector SPDRs, factor ETFs, single names) → `gold.equity_*`.
- Global policy/CPI → `gold.global_policy_rates` / `global_inflation`.

### 9.3 Known residual gaps (carry as open items, §12)

- **PCE item level** — pipeline ships headline/core PCE only; item drill needs a
  BEA manifest (deferred there). INFL PCE-basket toggle shows headline/core until
  then.
- **Economic release calendar** (`/api/econ/calendar`) — release *dates* are not
  a Gold series; needs a pipeline `gold.release_calendar` or stays a flagged
  exception.
- **FOMC rate probabilities** (`FOMC` module, `macro_data_etl` FedProbabilityEngine)
  — depends on CME Fed Funds futures, which the pipeline has no connector for
  (its gap doc §4 confirms). **This module is neither Tier A-clean nor Tier B.**
  Decision needed (§12): keep its `macro_data_etl` computation (fed by Gold short
  rates), or defer.
- **GC−OIS / FRA−OIS funding spreads** — no OIS on FRED; FUND shows the
  SOFR/EFFR/IORB/bill spreads it can compute, flags the OIS ones as N/A.

---

## 10. Phased execution plan

**Phase 0 — Connection foundation.**
`GoldStore` module + `MACRO_DB_URL` wiring + `health()` + logical→physical table
mapping. Point the pipeline `--local` SQLite output at `data/fred_local.db`.
Acceptance: `GoldStore.health()` green against SQLite locally and Postgres in a
deploy preview; `SELECT count(*) FROM gold.dim_series` > 0.

**Phase 1 — ECON + drill (highest traffic).**
Rewrite `indicators`, `batch`, `series` → Gold. Delete `econSnapshot.*` and the
`getSeriesHistory*`/`getIndicators` SIM. Reconcile §9.1. Acceptance: ECON grid,
category breadth, 24m drill render from `gold.macro_indicator_dashboard` with
identical numbers to a live-FRED baseline snapshot (golden test).

**Phase 2 — Rates complex.**
`benchmark`, `curve`, `curve-history`, `inversions` → `gold.benchmark_rate_board`,
`treasury_curve*`, `curve_spread_daily`, `spread_inversion_episode`. Covers BMRK,
BRA, CURV, YCURV, RVOL (via `yield_curve_ns_factors`). Delete `ratesRV.ts`/
`econCurve.ts`/`yieldCurveAnalytics.ts` SIM branches.

**Phase 3 — Credit, Funding, Inflation, Regime.**
New routes `/api/econ/credit|funding|inflation|regime` → respective Gold tables.
Covers CRDT, FUND, FCOST, INFL, REGIME. Wire FCOST/COLL/CASH/REINV/SFE Tier-C
inputs (§7) via `macroInputs.ts`.

**Phase 4 — Markets + charting.**
`market/[view]`, `chart/series`, `market-lens` → `gold.equity_*` +
`fred_feature_transforms`. Covers MKT, SNAP, QUILT, IRET, LENS, MKC, MGC, MOTN.
Retire `MARKET_PIPELINE_URL`, `MARKET_DATA_DIR`, `MARKET_LENS_URL`, `CHART_DB_URL`.

**Phase 5 — Stats, EDA, ML, Global, DataOps.**
`stats` → `series_correlation`/`series_lead_lag`/`series_structural_breaks` (+
raw-obs path for interactive pairs); ML routes → `recession_probability_daily`/
`inflation_forecast`/`macro_factor_*`; GCPI/GPOL → `global_*`; DATAOPS →
`v_source_coverage` + pipeline `audit.*`.

**Phase 6 — Removal & hardening.**
Delete `src/lib/server/fred.ts` from the prod path, all `*Snapshot*` files, all
SIM generators for Tier A. Add the CI grep gate (§11). Update `ARCHITECTURE.md`,
`docs/DATA_PIPELINE_OVERVIEW.md`, `docs/MODULE_DATA_AUDIT.md`.

Phases 1–5 are independently shippable (a module reads Gold or, until its phase
lands, keeps the old chain — no big-bang cutover).

---

## 11. Removal / enforcement checklist

- [ ] No Tier A/C route imports `@/lib/server/fred`, `getSnapshotObservations`,
      `getSeriesHistory`, `simStatFull`, or any `Rng`-based generator.
- [ ] `FRED_API_KEY`, `MARKET_PIPELINE_URL`, `MARKET_LENS_URL`, `CHART_DB_URL`,
      `MARKET_DATA_DIR`, `AAII_SENTIMENT_URL` removed from deploy config and
      `.env.example`; only `MACRO_DB_URL` (+ Databricks vars) + Tier-B keys remain.
- [ ] `econSnapshot.json` / `econSnapshot.ts` / `sentimentAaiiSnapshot.*` deleted
      (or the last kept only for the Tier-B AAII survey, explicitly).
- [ ] **CI grep gate:** fail the build if `fredSeries|fredLatest|getSeriesHistory|
      getSnapshotObservations` appears under `src/app/api/econ`, `.../market`,
      `.../chart` (Tier A dirs). Encodes "no fallback" as a test.
- [ ] Each Tier-B route has the "Exception to DB-only policy" header comment.
- [ ] `gold.powerbi_catalog` join test: every Tier A module has ≥1 mapped Gold
      object; every consumed Gold table exists in `dim_series`/catalog.

---

## 12. Open decisions & risks

1. **Economic release calendar (CAL).** Add `gold.release_calendar` to the
   pipeline (ingest FRED `/releases/dates`), or leave CAL as a flagged live
   exception? *Recommendation:* small pipeline add — keeps CAL in Tier A.
2. **FOMC rate probabilities.** No CME connector in the pipeline. Keep the
   `macro_data_etl` FedProbabilityEngine (its inputs fed from Gold short rates),
   or defer the module? *Recommendation:* keep FedProbabilityEngine as a
   compute-only module reading Gold rate series — it's model output, not a feed.
3. **PCE item level (INFL).** Ship INFL with CPI item tree + PCE headline/core
   now; add PCE items when the pipeline lands the BEA manifest. Accept the
   partial PCE drill in the interim? *Recommendation:* yes, ship partial.
4. **STAT interactivity.** Precomputed `stats_pairs` cover curated pairs; arbitrary
   user-selected pairs need a raw-obs-from-Gold + client-recompute path. Confirm
   the interactive surface stays (recompute on DB inputs) vs. restricting STAT to
   the curated set.
5. **International: FRED-mirror vs World Bank.** The pipeline can source global
   CPI/policy either via FRED country-mirror codes or World Bank. Pick one to
   standardize GCPI/GPOL on (pipeline gap doc flags this as a design choice).
6. **SQLite in serverless deploy.** A SQLite file works locally and in a single
   long-lived server, but not across serverless instances — hence Postgres/Delta
   for deploy (D3). Confirm the deploy target's DB so `GoldStore`'s prod driver is
   provisioned.
7. **Refresh SLA.** Gold is batch. Define acceptable staleness per module (daily
   for macro; intraday for funding/curve if the pipeline runs intraday) and set
   the `AGING`/`STALE` thresholds in §8 accordingly.

---

## 13. What this buys us

- **One data path per module** — no fallback ladder to reason about, debug, or
  mis-badge. If it renders, it came from the DB.
- **Point-in-time correctness for free** — Gold resolves ALFRED vintages; the
  terminal's z-scores/regimes/backtests stop using look-ahead latest-revised data.
- **Analytics computed once, server-side** — delete thousands of lines of
  on-the-fly TS math that duplicated (and could drift from) the pipeline.
- **Real lineage** — DATAOPS shows the pipeline's actual audit trail and coverage,
  not fixtures.
- **Deterministic deploys** — no FRED key, no rate limits, no CSV/Python
  fallbacks, no egress dependency for the core terminal.
