# Module Data Audit & Test Plan

**Generated**: 2026-06-25
**Updated**: 2026-08-25 — Gold DB migration hardening (see `docs/features/GOLD_DB_MIGRATION_HANDOFF.md`)
**Scope**: All 38 modules — data sourcing, SIM vs live accuracy, bugs, provenance transparency

---

## Gold DB Migration Status (as of 2026-07-18)

The terminal has migrated from a 3-tier FRED→SNAPSHOT→SIM fallback chain to a single **Gold DB** source of truth for Tier A (series/econ/market/chart) routes. Tier A API routes now return Gold rows or explicit `ERR` empty states; the old silent FRED/SNAPSHOT/SIM ladder has been removed from those production paths and is enforced by `npm run check:gold-policy`.

| Tier | Scope | Status |
|------|-------|--------|
| **A** | Econ/market series — `econ/*`, `chart/*`, `market/*` | **Hardened** — Gold DB only in production Tier A routes; missing data returns explicit `ERR`; CI grep gate blocks fallback reintroduction |
| **B** | Live feeds — `news`, `social`, `polymarket`, `copilot`, `calendar` | **Exempt** — deliberate exceptions (non-series real-time feeds), documented per §7 D1 |
| **C** | Synthetic book — `economics/*` pages, Tier C data modules | **Wired** — `getMacroInputs()` / `useMacroInputs()` + `buildFallbackWithAnchors()` provide Gold-backed rate anchors; book stays synthetic |

### New routes added by migration
- `GET /api/econ/credit` — `gold.credit_spread_daily` + `gold.credit_spread_rolling`
- `GET /api/econ/funding` — `gold.funding_tape_daily` + `gold.funding_stress_daily`
- `GET /api/econ/inflation` — `gold.inflation_explorer` + `gold.inflation_contribution`
- `GET /api/econ/regime` — `gold.macro_regime_daily`
- `GET /api/econ/global` — `gold.global_inflation` + `gold.global_policy_rates`
- `GET /api/econ/macro-inputs` — Tier C macro context (benchmarks, curve, credit, funding, regime)
- `GET /api/ml` — ML outputs (recession probability, inflation forecast, factor scores, anomaly, attribution)

### Open items / Phase 6 prerequisites
- [x] Remove FRED/SNAPSHOT/SIM fallback imports from Tier A production routes (`src/app/api/econ`, `src/app/api/chart`, `src/app/api/market`)
- [x] Add policy gate: `npm run check:gold-policy` / `scripts/check-gold-db-policy.sh`
- [ ] Delete `src/data/econSnapshot.json`, `src/data/econSnapshot.ts`, `src/data/sentimentAaiiSnapshot.json` once tests/offline fixtures are replaced or explicitly retained
- [ ] Delete SIM generators from `src/data/econSeries.ts` (`getSeriesHistory*`, `getIndicators`, `Rng` usage) after all non-route callers are audited
- [x] Remove `src/lib/server/fred.ts` from Tier A prod path; keep only for documented exceptions/offline ingestion helpers
- [ ] Prune `simMode.tsx` — collapse provenance to DB + staleness (§8)
- [ ] Add `gold.release_calendar` to pipeline → wire `econ/calendar` (§12 decision)
- [ ] `gold.powerbi_catalog` join test: every Tier A module has ≥1 mapped Gold object

---

## Executive Summary (pre-migration baseline)

The terminal had a 3-tier data fallback: **FRED (live)** > **SNAPSHOT (committed real data)** > **SIM (deterministic Rng)**. Most economics modules are well-wired, but several systemic issues cause real data to be silently replaced by SIM even when live or snapshot data is available.

### Critical Bugs Found

| # | Severity | Module(s) | Issue |
|---|----------|-----------|-------|
| 1 | **HIGH** | HOME, MKT | Heatmap ticker mismatch — snapshot EQUITY cards are ETFs (SPY, QQQ) but `EQUITIES` in universe.ts are single stocks (AAPL, MSFT). Zero overlap; all cells get `sector: "Other"` and equal weight |
| 2 | **HIGH** | CASH, REINV | KPI strips computed from SIM data even when FRED rates are live — badge says "FRED" but headline numbers (blended rate, savings, net spread) are SIM-derived |
| 3 | **HIGH** | EML | `recessionProbFromSpread` treats T10Y2Y as bps but FRED reports percentage points (0.37 not 37). Recession probability always ~23% regardless of actual spread |
| 4 | **HIGH** | INFL | 26 CPI/PCE component series not in FRED_CATALOG or snapshot — item-level inflation data is permanently SIM without live FRED API |
| 5 | **HIGH** | GPOL | 14 policy rate series (IRSTCB01*, ECBDFR) not in catalog or snapshot — entire page is SIM-only without live FRED |
| 6 | **MEDIUM** | MKT | Heatmap and movers never use pipeline data (always SIM) despite HOME using `heatmapFromCards`/`moversFromCards` |
| 7 | **MEDIUM** | MKT | No FRED live overlay for index strip — only gets snapshot proxy prices, unlike HOME which layers FRED on top |
| 8 | **MEDIUM** | CRDT | `liveRung` checks `source === "FRED"` not `isRealEconSource()` — SNAPSHOT data doesn't upgrade rating curve despite OAS series being in snapshot |
| 9 | **MEDIUM** | ECON | Series Explorer always uses `getSeriesHistory()` (SIM) even when snapshot/FRED data exists |
| 10 | **MEDIUM** | EML | Z-score inversion in labor momentum model — `-(v-mean)/sd` flips the signal direction |
| 11 | **LOW** | HOME | `BTC: "IBIT"` in SNAP_MAP is dead — IBIT not in committed market snapshot |
| 12 | **LOW** | MKT | VIX mapped to VIXY (VIX futures ETF) — price differs significantly from VIX index |
| 13 | **LOW** | IRET | Badge shows "LIVE" even when selected index falls back to SIM matrix |
| 14 | **LOW** | GCPI | Australia CPI is quarterly — MoM calculation shows QoQ labeled as MoM |
| 15 | **LOW** | AI | No page-level ProvenanceBadge; "AI" label on responses but no LLM is invoked |

---

## Infrastructure Audit

### Snapshot Coverage

**Econ Snapshot**: 96 series committed with real FRED data (as of 2026-06-18 to 2026-06-24).

**32 catalog series missing from snapshot**:
- `ISM-MFG`, `ISM-SVC` (simOnly — intentionally excluded, licensing)
- `SP500`, `NASDAQCOM`, `DJIA` (newly added to catalog, not yet exported)
- `GOLDPMGBD228NLBM`, `DCOILWTICO` (newly added)
- `BGCR`, `TGCR` (overnight rates)
- 17 international CPI series (CP0000EZ19M086NEST, GBRCPIALLMINMEI, etc.)
- Alt-inflation measures (MEDCPIM159SFRB, PCETRIM12M159SFRB, STICKCPIM159SFRB, PCEPILFE_MOM)

**~40 series used by modules but NOT in catalog at all**:
- 26 CPI/PCE component series (CUSR0000SAH1, CPIUFDSL, DGDSRG3M086SBEA, etc.) — used by INFL
- 14 policy rate series (IRSTCB01USM156N, ECBDFR, etc.) — used by GPOL

**Market Snapshot**: 48 cards, all dated 2026-06-24. 6 asset classes (BOND, COMMODITY, CREDIT, CURRENCY, EQUITY, VOLATILITY). Zero null prices or returns.

### Stale Seed Values

| File | Field | Current Seed | Approximate Real Value | Staleness |
|------|-------|-------------|----------------------|-----------|
| universe.ts | SPY px | 597.4 | ~738 | ~24% |
| universe.ts | QQQ px | 512.8 | ~718 | ~40% |
| universe.ts | IWM px | 241.6 | ~298 | ~23% |
| universe.ts | ES1 px | 5,972 | ~7,383 | ~24% |
| universe.ts | GC1 px | 2,648 | ~3,350 | ~27% |
| universe.ts | EURUSD px | 1.0512 | ~1.147 | ~9% |
| universe.ts | BTC px | 104,250 | ~108,500 | ~4% |
| econSeries.ts | VIX level | 15.8 | ~19.5 | ~23% |

These affect SIM-generated positions, P&L, margin calculations in PB, COLL, and SLAB modules. They do NOT affect live/snapshot display values.

### Case Sensitivity

`heatmapFromCards` and `moversFromCards` now use `.toUpperCase()` — **safe**. No other case-sensitivity issues found across the codebase.

---

## Module-by-Module Audit

### MARKETS Group

#### HOME — Command Center
- **File**: `src/app/page.tsx`
- **Data flow**: `useLiveSeriesSet(INDEX_FRED_IDS)` for 9 FRED indices + `useMarketView("market")` for pipeline/snapshot cards + SIM fallbacks
- **Live**: VIX, DXY, UST10Y, SOFR, GC, CL via FRED; SPX, NDX, INDU via FRED (SP500, NASDAQCOM, DJIA); heatmap/movers from snapshot cards
- **Always SIM**: MOVE index (no FRED series), BTC (IBIT not in snapshot), SL/Prime/Collateral/Cash/Alert KPIs, desk revenue chart, optimization runs
- **Bugs**: (1) BTC→IBIT snapshot mapping is dead. (2) Heatmap cells all get `sector: "Other"` due to ETF/stock ticker mismatch (see Critical #1)
- **Badge**: Present, accurate for index data. Heatmap badge can be misleading (says SNAPSHOT but sectors are degraded)

#### MKT — Live Markets
- **File**: `src/app/markets/page.tsx`
- **Data flow**: `useMarketView("market", basis, asof)` for quote board + SIM fallbacks for heatmap/movers/candles/order book
- **Live**: Quote board merges pipeline cards via `cardsToQuotes()`. Index strip merges snapshot proxies (SPX→SPY, VIX→VIXY, DXY→UUP, GC→GLD)
- **Always SIM**: Heatmap (`getHeatmap()` — never calls `heatmapFromCards`), movers (`getMovers()` — never calls `moversFromCards`), candles, order book, correlation matrix
- **Bugs**: (1) Heatmap/movers never use pipeline data unlike HOME. (2) No FRED overlay for indices. (3) VIX→VIXY price mismatch (VIXY is a futures ETF, not the VIX level)
- **Badge**: Present but misleading — badge reflects pipeline source for quote board, but heatmap/movers are always SIM

#### SNAP — Market Snapshot
- **File**: `src/app/market-snapshot/page.tsx`
- **Data flow**: 5 `useMarketView` calls (market, cross-asset, rates, regime, bilello)
- **Live**: All views upgrade when pipeline API runs. Falls back to committed snapshot JSON (real data, not SIM)
- **Always SIM**: Nothing — entirely pipeline/snapshot driven
- **Bugs**: None
- **Badge**: Present, accurate

#### QUILT — Asset Quilt
- **File**: `src/app/asset-quilt/page.tsx`
- **Data flow**: `useMarketView("bilello")` → `quiltFromBilello()`, fallback to `getAssetQuilt()` SIM
- **Live**: When pipeline bilello data includes `asset_class_returns_by_year`
- **Always SIM**: Only if bilello view has no data
- **Bugs**: If pipeline sends rows without `series_id`, labels don't match `quiltColor()` mapping → all-gray cells
- **Badge**: Present, accurate

#### IRET — Index Returns
- **File**: `src/app/index-returns/page.tsx`
- **Data flow**: `useMarketView("index-returns")` with per-symbol matrix fallback to `getIndexReturnMatrix()`
- **Live**: When pipeline provides matrices for selected symbol
- **Bugs**: Badge shows "LIVE" even when the currently selected index's matrix falls back to SIM
- **Badge**: Present but can be inaccurate per-selection

#### LENS — Market Lens Studio
- **File**: `src/app/market-lens/page.tsx`
- **Data flow**: Custom `useLensData()` → `/api/market-lens` or fallback views + local engine
- **Live**: When Market Lens Python backend (`MARKET_LENS_URL`) is running
- **Bugs**: Minor — `analysisSource` shows "SNAPSHOT" before any analysis is run
- **Badge**: Custom Tag + explanatory banner. Accurate

#### MKC — Market Chart Studio
- **File**: `src/app/market-chart/page.tsx`
- **Data flow**: `ChartStudio` component with `MARKET_CATALOG`
- **Live**: Depends on ChartStudio internals (committed snapshots + FRED)
- **Badge**: Handled by ChartStudio

---

### FINANCE Group

#### SLAB — Securities Lending
- **File**: `src/app/securities-lending/page.tsx`
- **Data flow**: SIM inventory/loans/revenue + `useMarketView("market")` for live price overlay via `mergeLiveInventoryPrices()`
- **Live**: Market prices from pipeline update inventory `marketValue`
- **Always SIM**: Inventory positions, loan book, borrow demand, revenue, sankey flows
- **Bugs**: None
- **Badge**: Present, accurate

#### SQZ — Squeeze Radar
- **File**: `src/app/securities-lending/squeeze/page.tsx`
- **Data flow**: 100% SIM from `@/data/squeeze`
- **Live**: None
- **Bugs**: None
- **Badge**: Present, hardcoded SIM. Accurate

#### PB — Prime Finance
- **File**: `src/app/prime-finance/page.tsx`
- **Data flow**: 100% SIM from `@/data/primeFinance` + `@/data/marketConditions`
- **Live**: None
- **Bugs**: None. Stale universe.ts seed prices affect position realism
- **Badge**: Present, hardcoded SIM. Accurate

---

### OPTIMIZATION Group

#### COLL — Collateral Management
- **File**: `src/app/collateral/page.tsx`
- **Data flow**: 100% SIM from `@/data/collateral`
- **Live**: None
- **Bugs**: What-If savings calculation can produce negative values that display oddly
- **Badge**: Present, hardcoded SIM. Accurate

#### CASH — Cash Optimizer
- **File**: `src/app/cash-optimizer/page.tsx`
- **Data flow**: SIM base + `useLiveSeriesSet(["SOFR", "DFF", "DCPF3M"])` for FRED rate overlay via `mergeLiveFundingRates()`
- **Live**: FRED rates merged into 5 of 8 funding sources (Operating Cash, GC Repo, Term Repo, Reverse Repo, CP). 3 sources always SIM (SecLending Cash, Internal Funding, FX Swap)
- **Always SIM**: All volumes, uses, funding path, LCR/NSFR gauges, projected trend
- **Bugs**: **KPI strip uses `getCashSummary()` computed from SIM, not from live-merged sources. Badge says "FRED" but blended rate/savings KPIs are SIM.** (Critical #2)
- **Badge**: Present but partially misleading

#### REINV — Cash Reinvestment
- **File**: `src/app/reinvestment/page.tsx`
- **Data flow**: SIM base + `useLiveSeriesSet(["SOFR", "DGS3MO", "DCPF3M", "DGS6MO", "DGS1"])` for yield overlay via `mergeLiveYields()`
- **Live**: FRED yields merged into 7 instruments
- **Always SIM**: Summary KPIs (`getReinvestmentSummary()`) computed from SIM positions
- **Bugs**: **Same as CASH — KPIs from SIM, table from live. Inconsistency.** (Critical #2)
- **Badge**: Present but partially misleading

#### LIQ — Liquidity Stress
- **File**: `src/app/liquidity/page.tsx`
- **Data flow**: SIM base + `useLiveSeriesSet(["SOFR", "EFFR", "BAMLH0A0HYM2"])` for early warning signal overlay
- **Live**: FRED data merged into EWS signals only (SOFR-EFFR spread, HY OAS, repo vol z-score). Per-row source attribution
- **Always SIM**: Liquidity buckets, funding facilities, stress scenarios, summary KPIs
- **Bugs**: None
- **Badge**: Present, accurate — correctly scoped to EWS panel

#### SXU — Sources & Uses
- **File**: `src/app/sources-uses/page.tsx`
- **Data flow**: 100% SIM from `@/data/sourcesUses`
- **Live**: None
- **Bugs**: None
- **Badge**: Present, hardcoded SIM. Accurate

#### OPT — Optimization Center
- **File**: `src/app/optimization/page.tsx`
- **Data flow**: 100% SIM from `@/data/optimization`
- **Live**: None
- **Bugs**: "Run Optimization" button has no onClick handler (decorative)
- **Badge**: Present, hardcoded SIM. Accurate

---

### ECONOMICS Group

#### ECON — Macro Dashboard
- **File**: `src/app/economics/page.tsx`
- **Data flow**: `useEconSeries("DGS10")` + `useLiveIndicators()` for all ~100 catalog series
- **Live**: All 96 snapshot series + live FRED when available
- **Always SIM**: ISM-MFG, ISM-SVC (simOnly licensing). Series Explorer chart always uses `getSeriesHistory()` (SIM)
- **Bugs**: Series Explorer never uses real data even when available (Critical #9)
- **Badge**: Present, accurate

#### CURV — Treasury Curve Lab
- **File**: `src/app/economics/curve/page.tsx`
- **Data flow**: `useCurveSnapshots()`, `useInversions()` for all Treasury tenors + spreads
- **Live**: All DGS* tenors and spreads in snapshot and FRED
- **Always SIM**: Butterfly spreads, carry & roll computed client-side from curve data
- **Bugs**: None significant
- **Badge**: Present, accurate

#### INFL — Inflation Explorer
- **File**: `src/app/economics/inflation/page.tsx`
- **Data flow**: `useLiveSeriesSet(allIds, "lin", 15)` for headlines + 26 CPI/PCE components
- **Live**: Headlines (CPIAUCSL, CPILFESL, PCEPI, PCEPILFE) in snapshot and catalog
- **Always SIM**: **All 26 component-level series (CUSR0000SAH1, CPIUFDSL, DGDSRG3M086SBEA, etc.) not in catalog or snapshot** (Critical #4)
- **Bugs**: Without FRED API key, all item-level inflation data is fabricated
- **Badge**: Present, accurate (shows SIM when components are SIM)

#### GCPI — Global Inflation
- **File**: `src/app/economics/global-cpi/page.tsx`
- **Data flow**: `useLiveSeriesSet(fredIds, "lin", 26)` for 20 country CPI indices
- **Live**: All 20 series in catalog and snapshot
- **Bugs**: Australia quarterly CPI shown as MoM (actually QoQ)
- **Badge**: Present with per-row source. Accurate

#### GPOL — Global Policy Rates
- **File**: `src/app/economics/policy-rates/page.tsx`
- **Data flow**: `useLiveSeriesSet(fredIds, "lin", 36)` for 14 central bank rate series
- **Live**: 14 FRED IDs exist but **not in catalog or snapshot** (Critical #5)
- **Always SIM**: 4 countries (China, India, Indonesia, South Africa) have no FRED ID. Without API key, all 18 countries are SIM
- **Bugs**: Entire page is SIM-only without live FRED access
- **Badge**: Present, accurate

#### CRDT — Credit Spreads
- **File**: `src/app/economics/credit/page.tsx`
- **Data flow**: `useLiveSeriesSet([...OAS series])` for 12 credit FRED series
- **Live**: All 12 in catalog and snapshot
- **Always SIM**: Sector spreads, stress episodes, credit linkages, ETF divergences, haircut pressure
- **Bugs**: `liveRung` only accepts `source === "FRED"`, not SNAPSHOT — rating curve stays SIM on snapshot-only deployments despite data being available (Critical #8)
- **Badge**: Present, accurate

#### FOMC — Rate Probabilities
- **File**: `src/app/economics/rates/page.tsx`
- **Data flow**: ETL layer (`hasEtlFedData()`) or SIM fallback
- **Live**: When ETL gold data is available
- **Always SIM**: Without ETL data — meetings, implied path, dot plot
- **Bugs**: None significant
- **Badge**: Present, shows ETL or SIM. Accurate

#### CAL — Economic Calendar
- **File**: `src/app/economics/calendar/page.tsx`
- **Data flow**: `useEconCalendar()` → `/api/econ/calendar` or SIM
- **Always SIM**: All event data (prior, consensus, actual)
- **Bugs**: None
- **Badge**: Present, accurate

#### STAT — Statistical Analysis
- **File**: `src/app/economics/stats/page.tsx`
- **Data flow**: `useLiveSeriesSet` for 31 series via `useStatsData()`
- **Live**: All 31 series in catalog and snapshot
- **Always SIM**: Analytics computed client-side from data
- **Bugs**: None — well-architected
- **Badge**: Present, accurate

#### REGIME — Macro Regime
- **File**: `src/app/economics/regime/page.tsx`
- **Data flow**: `useLiveSeriesSet` for 7 series (DGS10, DGS2, DGS3MO, BAMLH0A0HYM2, SOFR, EFFR, CPILFESL)
- **Live**: All 7 in catalog and snapshot. Live data re-derives regime state
- **Always SIM**: Desk playbooks, transition probabilities, exposure matrix
- **Bugs**: Uses `ProvenanceBadge` while most econ pages use `SourceBadge` (cosmetic inconsistency)
- **Badge**: Present, accurate

#### EML — ML Applications
- **File**: `src/app/economics/ml/page.tsx`
- **Data flow**: `useLiveSeriesSet(["T10Y2Y","PCEPILFE","FEDFUNDS","NFCI","ICSA"])`
- **Live**: All 5 in catalog and snapshot
- **Bugs**: (1) **Unit mismatch** — recession model treats T10Y2Y as bps but FRED sends percentage points (Critical #3). (2) **Z-score inversion** — labor momentum signal direction is flipped (Critical #10)
- **Badge**: Present, accurate

#### SFE — Sec-Finance Economics
- **File**: `src/app/economics/sec-finance/page.tsx`
- **Data flow**: `useLiveSeriesSet` for repo rates (SOFR, EFFR, OBFR, BGCR, TGCR, FEDFUNDS)
- **Live**: All in catalog and snapshot
- **Always SIM**: Rate sensitivities, reinvestment ladder, macro linkages, factor links, P&L bridge
- **Bugs**: None
- **Badge**: Present (SourceBadge), accurate

#### FUND — Funding & Liquidity
- **File**: `src/app/economics/funding/page.tsx`
- **Data flow**: `useLiveSeriesSet(FUNDING_FRED_IDS)` for 12 series
- **Live**: IORB, EFFR, OBFR, SOFR, BGCR, TGCR, RRPONTSYD, WRESBAL, WALCL, DTB4WK, DTB3, DTB6 — all in catalog and snapshot
- **Always SIM**: FX cross-currency basis (XCCY_EUR/JPY/GBP), FRA-OIS
- **Bugs**: None
- **Badge**: Present, accurate

#### BMRK — Benchmark Rates
- **File**: `src/app/economics/benchmark/page.tsx`
- **Data flow**: `useLiveSeriesSet(BENCHMARK_FRED_IDS)` for 35 series
- **Live**: All 35 in catalog and snapshot
- **Always SIM**: Analytics computed client-side
- **Bugs**: None — solid
- **Badge**: Present, accurate

#### BRA — Rate Analysis Hub
- **File**: `src/app/economics/rate-analysis/page.tsx`
- **Data flow**: Reuses BENCHMARK_FRED_IDS + analytics from yield-curve, rate-vol, funding-cost, utilization
- **Live**: Same 35 benchmark series
- **Always SIM**: Utilization data from `getInventory()`
- **Bugs**: None (crash from `utilSnapshot.overall` was previously fixed)
- **Badge**: Present, accurate

#### UTIL — Utilization Analytics
- **File**: `src/app/economics/utilization/page.tsx`
- **Data flow**: BENCHMARK_FRED_IDS + `getInventory()` + `getSqueezeBoard()` + `getSectorHeat()`
- **Live**: Benchmark rates for overlay/correlation
- **Always SIM**: All lending inventory, squeeze, sector heat, utilization time series
- **Bugs**: None
- **Badge**: Present, accurate

#### YCURV — Yield Curve Analytics
- **File**: `src/app/economics/yield-curve/page.tsx`
- **Data flow**: BENCHMARK_FRED_IDS + yield curve analytics (shape, slopes, inversions, butterflies)
- **Live**: All Treasury tenors
- **Bugs**: None
- **Badge**: Present, accurate

#### RVOL — Rate Volatility
- **File**: `src/app/economics/rate-vol/page.tsx`
- **Data flow**: BENCHMARK_FRED_IDS + realized vol computation, surfaces, cones, regime
- **Live**: All 35 benchmark series
- **Bugs**: Minor — `handlePdf` dependency array references `source` but uses `anyReal` inline
- **Badge**: Present, accurate

#### FCOST — Funding Cost Monitor
- **File**: `src/app/economics/funding-cost/page.tsx`
- **Data flow**: BENCHMARK_FRED_IDS + tier costs, desk funding, term ladder, regime
- **Live**: All 35 benchmark series
- **Always SIM**: Tier definitions (spreads, haircuts) hardcoded
- **Bugs**: None
- **Badge**: Present, accurate

#### MOTN — Macro Motion Studio
- **File**: `src/app/economics/motion/page.tsx`
- **Data flow**: Delegates to `MotionStudio` component; user-selected series via `useLiveSeriesSet`
- **Live**: Any series the user selects
- **Badge**: Handled by MotionStudio

#### MGC — Macro Chart Studio
- **File**: `src/app/macro-chart/page.tsx`
- **Data flow**: `ChartStudio` with `MACRO_CATALOG`; defaults to DGS10, DGS2
- **Live**: Any FRED series selected
- **Badge**: Handled by ChartStudio

---

### DESK Group

#### DESK — Trading Desk
- **File**: `src/app/trading-desk/page.tsx`
- **Data flow**: 100% SIM from `@/data/trading` + `@/data/etrading` + `@/data/marketConditions`
- **Live**: None — no `useLiveSeriesSet` call
- **Bugs**: None structurally. Could benefit from FRED overlay for market conditions
- **Badge**: Present, hardcoded SIM. Accurate

---

### INTELLIGENCE Group

#### NEWS — News & Headlines
- **File**: `src/app/news/page.tsx`
- **Data flow**: `useNews()` → `/api/news` or `getHeadlines()` SIM; `useSocial()` → `/api/social` or SIM
- **Live**: Headlines via Alpha Vantage API when configured; social via Reddit/StockTwits API
- **Always SIM**: Without API keys — narratives, attention, signals, impact all SIM
- **Bugs**: None
- **Badge**: Present, accurate

#### SENT — Sentiment
- **File**: `src/app/sentiment/page.tsx`
- **Data flow**: SIM sentiment + `useLiveSeriesSet` for VIXCLS + `useSocial()` + AAII snapshot
- **Live**: VIXCLS percentile, social mood (when API configured), AAII committed snapshot
- **Always SIM**: NAAIM, behavioral indicators, contrarian signals, analog studies
- **Bugs**: None significant
- **Badge**: Present, accurate

#### AI — Copilot
- **File**: `src/app/copilot/page.tsx`
- **Data flow**: 100% SIM — local pattern-matcher, no external LLM
- **Live**: None
- **Bugs**: "AI" label implies LLM but it's a local heuristic engine. No page-level ProvenanceBadge
- **Badge**: **Missing** at page level

#### DATAOPS — Data Operations
- **File**: `src/app/dataops/page.tsx`
- **Data flow**: `useProviderHealth()` → `/api/dataops/health` for live probes; `useLiveRuns()` for run results; SIM fixtures for baseline
- **Live**: Provider health probes, live run ingestion results
- **Always SIM**: Module coverage matrix, data quality issues, lineage runs
- **Bugs**: Probe timestamp can show stale date if page not revisited (cached response from `fetchCache`)
- **Badge**: Custom provider status display (not ProvenanceBadge)

#### ALRT — Alert Center
- **File**: `src/app/alerts/page.tsx`
- **Data flow**: `useLiveSeriesSet(["VIXCLS","SOFR","BAMLH0A0HYM2","DGS10","T10Y2Y"])` for live alert evaluation
- **Live**: 5 FRED series — all in catalog and snapshot
- **Always SIM**: Base alert rules and historical alert log
- **Bugs**: None
- **Badge**: Present, accurate

---

## Recommended Fixes (Priority Order)

### P0 — Data Correctness

1. **Fix heatmap ticker mismatch** (Critical #1): `heatmapFromCards` should not look up ETF series_ids in the single-stock `EQUITIES` universe. Either map ETFs to sectors directly, or add ETF entries to universe.ts with correct sectors and market caps.

2. **Fix CASH/REINV KPI inconsistency** (Critical #2): `getCashSummary()` and `getReinvestmentSummary()` should accept live-merged sources/positions as input, or the page should recompute KPIs from the merged data.

3. **Fix EML unit mismatch** (Critical #3): Multiply T10Y2Y by 100 before feeding into `recessionProbFromSpread`, or change the sigmoid parameters to expect percentage points.

4. **Fix EML z-score inversion** (Critical #10): Remove the negation in labor momentum z-score calculation.

5. **Fix CRDT snapshot bypass** (Critical #8): Change `liveRung` guard from `source === "FRED"` to `isRealEconSource(source)`.

### P1 — Data Coverage

6. **Add 26 CPI/PCE component series to FRED_CATALOG** (Critical #4): `CUSR0000SAH1`, `CPIUFDSL`, etc. Then re-run `npm run export:econ-snapshot` to populate the snapshot.

7. **Add 14 policy rate series to FRED_CATALOG** (Critical #5): `IRSTCB01USM156N`, `ECBDFR`, etc. Then re-run snapshot export.

8. **Re-run `npm run export:econ-snapshot`**: After adding all missing series to the catalog, export a fresh snapshot to provide offline coverage.

### P2 — Consistency

9. **Wire MKT heatmap/movers to pipeline data** (Critical #6): Use `heatmapFromCards`/`moversFromCards` like HOME does.

10. **Add FRED overlay to MKT index strip** (Critical #7): Add `useLiveSeriesSet(INDEX_FRED_IDS)` + `mergeLiveIndices` to MKT page.

11. **Fix ECON Series Explorer** (Critical #9): Use `useEconSeries` or snapshot data instead of `getSeriesHistory`.

12. **Fix BTC/IBIT dead mapping** (Critical #11): Either add IBIT to market snapshot, or remove the BTC→IBIT entry from SNAP_MAP.

13. **Fix MKT VIX→VIXY mapping** (Critical #12): Map VIX to VIXCLS via FRED instead of VIXY ETF.

### P3 — Polish

14. **Update universe.ts seed prices**: SPY, QQQ, IWM, ES1, GC1, EURUSD are 20-40% stale.

15. **Add ProvenanceBadge to AI/Copilot page**.

16. **Fix IRET badge accuracy**: Show per-index source, not just the API-level source.

17. **Fix Australia quarterly CPI labeling in GCPI**: Show QoQ instead of MoM for quarterly-frequency countries.

18. **Standardize badge component**: Most econ pages use `SourceBadge`, REGIME uses `ProvenanceBadge`. Pick one.

---

## Test Matrix

### Tier 1 — Run with `FRED_API_KEY` set

| Test | Module | What to verify |
|------|--------|---------------|
| T1.1 | HOME | Ticker shows FRED badge + as-of date; indices show green dots; heatmap uses snapshot cards |
| T1.2 | MKT | Quote board shows pipeline source; verify heatmap still SIM (known issue) |
| T1.3 | ECON | Indicators show FRED source; KPIs reflect live values |
| T1.4 | CURV | Curve tenors show FRED; inversion timeline live |
| T1.5 | INFL | Headlines show FRED; verify components still SIM (known gap) |
| T1.6 | CRDT | OAS rungs show FRED; verify snapshot rungs stay SIM (known bug) |
| T1.7 | CASH | Table shows live rates; verify KPIs still SIM (known bug) |
| T1.8 | EML | T10Y2Y value from FRED; verify recession prob makes sense (known bug if not fixed) |
| T1.9 | BMRK | All 35 series show FRED |
| T1.10 | ALRT | Live alerts fire based on FRED thresholds |

### Tier 2 — Run without `FRED_API_KEY` (snapshot-only)

| Test | Module | What to verify |
|------|--------|---------------|
| T2.1 | HOME | Indices show SNAPSHOT source; heatmap renders from snapshot cards |
| T2.2 | ECON | Indicators show SNAPSHOT for 96 series, SIM for ISM/alt-inflation |
| T2.3 | GPOL | All countries show SIM (known — not in snapshot) |
| T2.4 | STAT | All 31 series show SNAPSHOT |
| T2.5 | FUND | 12 series show SNAPSHOT; FX basis shows SIM |

### Tier 3 — Run with no API, no snapshot (SIM-only)

| Test | Module | What to verify |
|------|--------|---------------|
| T3.1 | ALL | Every module renders without errors |
| T3.2 | ALL | Every module shows SIM badge |
| T3.3 | ALL | No NaN, undefined, or "." values in any display |

---

## Modules Summary Table

| Code | Module | Live Sources | SIM-Only? | Badge | Key Issue |
|------|--------|-------------|-----------|-------|-----------|
| HOME | Command Center | FRED + Pipeline | Partial | Yes | Heatmap sector degraded |
| MKT | Live Markets | Pipeline | Partial | Misleading | Heatmap/movers always SIM |
| SNAP | Market Snapshot | Pipeline | No | Yes | Clean |
| QUILT | Asset Quilt | Pipeline | Fallback | Yes | Clean |
| IRET | Index Returns | Pipeline | Fallback | Inaccurate | Badge doesn't track per-index |
| LENS | Market Lens | Python backend | Fallback | Yes | Clean |
| MKC | Market Chart | ChartStudio | Varies | Internal | Clean |
| SLAB | Securities Lending | Pipeline prices | Partial | Yes | Clean |
| SQZ | Squeeze Radar | None | **Yes** | Yes | By design |
| PB | Prime Finance | None | **Yes** | Yes | Stale seed prices |
| COLL | Collateral | None | **Yes** | Yes | Clean |
| CASH | Cash Optimizer | FRED rates | Partial | **Misleading** | KPIs don't use live rates |
| REINV | Reinvestment | FRED yields | Partial | **Misleading** | KPIs don't use live yields |
| LIQ | Liquidity Stress | FRED EWS | Partial | Yes | Clean |
| SXU | Sources & Uses | None | **Yes** | Yes | By design |
| OPT | Optimization | None | **Yes** | Yes | Button decorative |
| DESK | Trading Desk | None | **Yes** | Yes | Could use FRED |
| ECON | Macro Dashboard | FRED/Snapshot | Partial | Yes | Series Explorer always SIM |
| CURV | Curve Lab | FRED/Snapshot | No | Yes | Clean |
| INFL | Inflation | FRED headlines | Partial | Yes | **26 components not in catalog** |
| GCPI | Global Inflation | FRED/Snapshot | No | Yes | Australia QoQ as MoM |
| GPOL | Policy Rates | FRED only | **SIM w/o key** | Yes | **14 series not in catalog** |
| CRDT | Credit Spreads | FRED/Snapshot | Partial | Yes | Snapshot bypass bug |
| FOMC | Rate Probs | ETL | Fallback | Yes | Clean |
| CAL | Calendar | API | Fallback | Yes | Clean |
| STAT | Statistics | FRED/Snapshot | No | Yes | Clean |
| REGIME | Macro Regime | FRED/Snapshot | Partial | Yes | Clean |
| EML | ML Models | FRED/Snapshot | Partial | Yes | **Unit mismatch + z-score bug** |
| SFE | Sec-Finance Econ | FRED/Snapshot | Partial | Yes | Clean |
| FUND | Funding | FRED/Snapshot | Partial | Yes | Clean |
| BMRK | Benchmark Rates | FRED/Snapshot | No | Yes | Clean |
| BRA | Rate Analysis | FRED/Snapshot | Partial | Yes | Clean |
| UTIL | Utilization | FRED + SIM inv | Partial | Yes | Clean |
| YCURV | Yield Curve | FRED/Snapshot | No | Yes | Clean |
| RVOL | Rate Volatility | FRED/Snapshot | No | Yes | Clean |
| FCOST | Funding Cost | FRED/Snapshot | Partial | Yes | Clean |
| MOTN | Motion Studio | User-selected | Varies | Internal | Clean |
| MGC | Macro Chart | User-selected | Varies | Internal | Clean |
| NEWS | News | Alpha Vantage | Fallback | Yes | Clean |
| SENT | Sentiment | FRED + Social | Partial | Yes | Clean |
| AI | Copilot | None | **Yes** | **Missing** | No LLM, misleading label |
| DATAOPS | Data Ops | Health probes | Partial | Custom | Clean |
| ALRT | Alerts | FRED | Partial | Yes | Clean |
