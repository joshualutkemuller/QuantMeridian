# SIM-to-Live Data Upgrade Plan

> Comprehensive audit of every widget using deterministic simulation data that can be wired to existing market/economic pipelines.

**Created:** 2026-06-24
**Branch:** `claude/bold-noether-h3mc2l`

---

## Architecture Context

The terminal has a multi-tier data fallback: **LIVE** (API) > **DB** (DuckDB/Postgres) > **FILE** (exported JSON) > **SNAPSHOT** (committed JSON) > **ECON** (derived) > **SIM** (seeded RNG). Every widget renders SIM data immediately, then upgrades when a live source resolves.

**Existing live pipelines already in the codebase:**

| Pipeline | Env Variable | What It Serves |
|----------|-------------|----------------|
| **FRED API** | `FRED_API_KEY` | 150+ macro series (rates, inflation, labor, credit, housing, money, FX) |
| **market_data_pipeline** | `MARKET_PIPELINE_URL` | Equity/bond/commodity snapshots, cross-asset returns, regime scores, Bilello grid |
| **Local warehouse** | `MARKET_DB_URL` | DuckDB/Postgres `analytics_api_views` table |
| **Exported JSON** | `MARKET_DATA_DIR` | `mdp export-views` output files |
| **macro_data_etl** | Run Python ETL | World Bank CPI, BIS policy rates, CME FedWatch |
| **News providers** | Alpha Vantage / Marketaux / Reddit / SEC EDGAR keys | Headlines, social intel, filings |
| **Market Lens** | `MARKET_LENS_URL` | Python analytics engine for custom series |

---

## Upgrade Inventory

### Tier 1: Directly Wireable (existing hooks + FRED series exist)

These widgets use SIM data but the infrastructure to serve them live data already exists in the codebase. They need only to call existing hooks/API routes.

---

#### 1.1 Dashboard — Market Indices (`src/app/page.tsx`)

**Current:** `getIndices()` from `src/data/markets.ts` — seeded RNG quotes for SPX, NDX, VIX, DXY, 10Y, SOFR, Gold, Oil, BTC, etc.

**Live path:** Most index levels have direct FRED series:
| Index | FRED Series | Already in Catalog? |
|-------|------------|-------------------|
| VIX | `VIXCLS` | Yes |
| DXY | `DTWEXBGS` | Yes |
| UST 10Y | `DGS10` | Yes |
| SOFR | `SOFR` | Yes |
| Gold (proxy) | `GOLDPMGBD228NLBM` | Yes |
| Oil (WTI proxy) | `DCOILWTICO` | Yes |

SPX/NDX/RUT/BTC don't have FRED series but are in the `market_data_pipeline` snapshot (`useMarketView("market")`).

**Upgrade:** Create `useLiveIndices()` hook that:
1. Calls `useLiveSeriesSet()` for the 6 FRED-available indices
2. Falls back to `useMarketView("market")` for equity indices
3. Falls back to `getIndices()` SIM data for any gaps

**Widgets affected:**
- KPI strip (6 stats)
- Market Tape index row
- Sparkline charts per index

**Complexity:** Medium — need to merge two live sources + SIM fallback

---

#### 1.2 Dashboard — Sector Heatmap (`src/app/page.tsx`)

**Current:** `getHeatmap()` from `src/data/markets.ts` — seeded sector performance from synthetic quotes.

**Live path:** `useMarketView("market")` already returns sector-level returns from the pipeline. The `cards` array contains per-ticker YTD/1D/1W/1M returns when the pipeline is configured.

**Upgrade:** When `useMarketView("market")` returns data, derive heatmap from live snapshot cards. Fall back to SIM.

**Complexity:** Low — data shape is close, just need to map `SnapshotCard[]` to `HeatCell[]`

---

#### 1.3 Dashboard — Top Movers (`src/app/page.tsx`)

**Current:** `getMovers()` from `src/data/markets.ts` — top gainers/losers/volume from SIM quotes.

**Live path:** Same `useMarketView("market")` snapshot has 1D return per card. Sort by return to get gainers/losers.

**Upgrade:** Derive movers from live market snapshot cards. Volume data not available from pipeline (keep SIM for volume ranking).

**Complexity:** Low

---

#### 1.4 Markets Page — Full Quote Board (`src/app/markets/page.tsx`)

**Current:** `getQuotes()`, `getIndices()`, `getCandles()`, `getOrderBook()` all from `src/data/markets.ts` — fully synthetic.

**Live path already partially wired:** Page imports `useMarketView` and overlays live data on the Top Asset Class cards. But the main quote board, candle chart, and order book remain SIM.

**Upgrade:**
- Quote board: overlay `useMarketView("market")` snapshot prices/returns onto the quote grid
- Candle chart: needs intraday data (not available from FRED/pipeline) — keep SIM or add Yahoo intraday
- Order book: no live source — keep SIM (proprietary data)

**Complexity:** Medium — partial overlay, candle/book stay SIM

---

#### 1.5 Liquidity — Early Warning Signals (`src/app/liquidity/page.tsx`)

**Current:** `getEarlyWarningSignals()` returns hardcoded objects with `source: "FRED"` and `source: "YAHOO"` labels but the values are static constants, not fetched.

**Existing FRED series that map directly:**
| Signal | FRED Series | In Catalog? |
|--------|------------|-------------|
| SOFR − EFFR spread | `SOFR`, `EFFR` | Yes |
| HY OAS 5d move | `BAMLH0A0HYM2` | Yes |

**Upgrade:** Call `useLiveSeriesSet(["SOFR", "EFFR", "BAMLH0A0HYM2"], "lin", 10)` and compute the signals from the latest observations. The shapes already declare their sources — just wire them.

**Complexity:** Low — 3 FRED calls, simple spread/delta math

---

#### 1.6 Global CPI — Country Inflation Table (`src/app/economics/global-cpi/page.tsx`)

**Current:** Page already calls `useLiveSeriesSet()` for all `fredId` values in `CPI_DEFS` and patches with `liveCountryCPI()`. **Already wired.**

**Gap:** The `liveCountryCPI()` function exists in `globalMacro.ts:137` but the page only uses it when ETL data is missing. With FRED_API_KEY set, this works end-to-end.

**Status:** Already upgraded — verify only.

---

#### 1.7 Policy Rates — Central Bank Rate Table (`src/app/economics/policy-rates/page.tsx`)

**Current:** Page already calls `useLiveSeriesSet()` for all `fredId` values in `RATE_DEFS`. **Already wired.**

**Gap:** 4 countries (China, India, Indonesia, South Africa) have no FRED ID — remain SIM. Could add BIS data via ETL.

**Status:** Mostly upgraded — 4 countries need ETL integration.

---

#### 1.8 Sentiment — VIX Fear/Greed Component (`src/app/sentiment/page.tsx`)

**Current:** Page calls `useLiveSeriesSet(["VIXCLS"], "lin", 252)` for VIX. But the composite fear/greed engine in `sentiment.ts` uses SIM for all market-based inputs (put/call, breadth, momentum, junk-bond demand).

**FRED series that could feed the composite:**
| Component | FRED Series | In Catalog? |
|-----------|------------|-------------|
| Junk Bond Demand | `BAMLH0A0HYM2` (HY OAS) | Yes |
| Market Momentum | (derived from SPX returns) | Via pipeline |
| Market Volatility | `VIXCLS` | Yes — already wired |
| Safe Haven Demand | `DGS10` minus `DGS2` (yield curve) | Yes |

**Upgrade:** Feed 3-4 FRED series into the fear/greed composite calculation. Replace SIM sub-scores with live data where available.

**Complexity:** Medium — need to refactor composite to accept live inputs

---

#### 1.9 Rates RV — Butterfly Spreads & Carry (`src/app/economics/curve/page.tsx`)

**Current:** `computeButterflies(snap)` and `computeCarryRoll(snap)` in `ratesRV.ts` take a `CurveSnapshot` and compute butterflies. The z-scores and percentiles are seeded random, but the butterfly value itself is computed from real yields when the curve is live.

**Gap:** z-scores use `rng.normal()` instead of computing from historical butterfly values. Historical data is available via `useCurveSnapshots()`.

**Upgrade:** When live curve history is available, compute rolling z-scores and percentiles from actual butterfly time series instead of random draws.

**Complexity:** Medium — pure math, no new API calls needed

---

#### 1.10 Macro Regime — Regime Scores (`src/app/economics/regime/page.tsx`)

**Current:** `getMacroRegime()` and playbooks from `macroRegime.ts` — seeded regime classification (growth/inflation quadrant).

**Live path:** The page could derive regime from live FRED indicators:
| Input | FRED Series |
|-------|------------|
| Growth | `GDPC1`, `PAYEMS`, `INDPRO` |
| Inflation | `CPIAUCSL`, `CPILFESL` |
| Policy | `DFF`, `DGS10`, `DGS2` |
| Credit | `BAMLC0A0CM`, `BAMLH0A0HYM2` |

**Upgrade:** Create a `computeLiveRegime()` function that takes the latest values of 8-10 FRED series and classifies into quadrants. Fall back to SIM regime when series aren't available.

**Complexity:** Medium-High — regime classification logic needs to be written against real inputs

---

#### 1.11 News — Headlines & Clusters (`src/app/news/page.tsx`)

**Current:** Page already calls `useNews(60)` which hits `/api/news`. The API route has live provider integration coded but needs API keys.

**Live providers already coded in `/api/news/route.ts`:**
- Alpha Vantage (equity headlines)
- Marketaux (multi-source news)
- Reddit (via PRAW)
- SEC EDGAR (company filings)

**Upgrade:** No code changes needed — just set provider API keys. The fallback to SIM templates already works.

**Complexity:** Zero (config-only) — but document the env vars needed

---

#### 1.12 Funding — Desk Action Map Signals (`src/app/economics/funding/page.tsx`)

**Current:** `computeDeskSignals()` from `funding.ts` derives desk signals from the funding series. The series themselves already use `useLiveSeriesSet()` for FRED rates.

**Gap:** When live FRED data flows in, the desk signals auto-upgrade. **Already wired.**

**Status:** Already upgraded via the FRED funding series pipeline.

---

### Tier 2: Upgradeable with New Hook Plumbing

These widgets need new hooks or API route extensions, but the upstream data source exists.

---

#### 2.1 Securities Lending — Inventory & Loans (`src/app/securities-lending/page.tsx`)

**Current:** All data from `securitiesLending.ts` — seeded inventory, loans, borrow requests, revenue.

**Possible live sources:**
- `useMarketView("market")` could provide current prices for mark-to-market
- Lending fees, utilization, short interest need a borrow vendor (not in codebase)

**Upgrade:** Overlay live market prices on inventory `marketValue` column. Lending-specific data (fees, utilization) requires an external vendor — keep SIM.

**Complexity:** Low for price overlay; vendor integration needed for core lending data

---

#### 2.2 Squeeze Radar — Short Interest & Microstructure (`src/app/securities-lending/squeeze/page.tsx`)

**Current:** `getSqueezeBoard()` from `squeeze.ts` — synthetic short interest, fee momentum, options skew.

**Possible live sources:**
- Fee/utilization: already derived from `securitiesLending.ts` (SIM)
- Short interest: Yahoo Finance has short interest for US equities (not currently fetched)
- Options data: would need an options data provider

**Upgrade:** If Yahoo Finance short interest is added to the pipeline, could wire `shortInterestPct` and `daysToCover`. Other microstructure signals (options skew, ETF flow) need vendors.

**Complexity:** Medium — Yahoo short interest is feasible, options data is not

---

#### 2.3 Trading Desk — Execution Analytics (`src/app/trading-desk/page.tsx`)

**Current:** `getTraderScores()`, `getExecutions()`, `getDeskRisk()` from `trading.ts` — fully synthetic PnL, slippage, Greeks.

**Live path:** None — this is proprietary desk data. No public API provides trader-level PnL or execution quality metrics.

**Upgrade:** Not feasible from public pipelines. Would need OMS/EMS integration.

**Status:** Remains SIM (proprietary)

---

#### 2.4 Collateral — Margin & Haircuts (`src/app/collateral/page.tsx`)

**Current:** All data from `collateral.ts` — synthetic margin calls, haircut tables, optimization results.

**Possible live sources:**
- Haircut schedules could reference CCP published schedules (not in pipeline)
- Asset prices for mark-to-market could come from `useMarketView("market")`
- Treasury yields for UST haircut calibration from FRED

**Upgrade:** Limited — haircut tables are firm-specific. Could overlay live asset prices for market value column.

**Complexity:** Low for price overlay; core collateral data is proprietary

---

#### 2.5 Cash Optimizer — Funding Sources & Uses (`src/app/cash-optimizer/page.tsx`)

**Current:** `getFundingSources()`, `getFundingUses()`, `getCashSummary()` from `cash.ts` — synthetic funding rates.

**Live path for rates:**
| Rate | FRED Series |
|------|------------|
| Repo rate | `SOFR` |
| CP rate | `DCPF3M` (3M financial CP) |
| Fed Funds target | `DFF` |

**Upgrade:** Overlay live funding rates from FRED onto the `rateBps` column. Cash flows/balances remain SIM (proprietary).

**Complexity:** Low — 3 FRED series for rate columns

---

#### 2.6 Reinvestment — Assumption Curves (`src/app/reinvestment/page.tsx`)

**Current:** All from `reinvestment.ts` — synthetic reinvestment rates and maturity ladders.

**Live path:** Reinvestment rates should track live Treasury/money market rates:
| Curve | FRED Series |
|-------|------------|
| Short-term reinvestment | `DGS3MO`, `DGS6MO` |
| Medium-term | `DGS1`, `DGS2` |
| Long-term | `DGS5`, `DGS10` |

**Upgrade:** Feed live Treasury curve into reinvestment rate assumptions. Maturity ladder structure remains SIM.

**Complexity:** Low-Medium — map curve points to reinvestment rate inputs

---

#### 2.7 Prime Finance — Client Metrics (`src/app/prime-finance/page.tsx`)

**Current:** All from `primeFinance.ts` — synthetic client revenue, exposure, margin, financing.

**Live path:** No public API for prime brokerage client data. Could overlay live market prices for exposure mark-to-market via `useMarketView("market")`.

**Upgrade:** Limited to price overlay. Core PB data is proprietary.

**Complexity:** Low for price overlay; core data stays SIM

---

#### 2.8 Alerts — Threshold Monitoring (`src/app/alerts/page.tsx`)

**Current:** `getActiveAlerts()` from `alerts.ts` — synthetic alert triggers.

**Live path:** Several alert signals reference FRED-available metrics:
- "SOFR spike" → live SOFR from FRED
- "HY OAS blowout" → live OAS from FRED
- "VIX above threshold" → live VIX from FRED

**Upgrade:** Create `useLiveAlerts()` that computes threshold crossings from live FRED data. Alert definitions (thresholds, desk routing) remain configured, but trigger values become live.

**Complexity:** Medium — need alert engine that evaluates thresholds against live series

---

### Tier 3: Remains SIM (No Public Data Source)

These widgets produce data that is inherently proprietary or has no public equivalent:

| Page | Widget | Why It Stays SIM |
|------|--------|-----------------|
| Trading Desk | Trader Scorecards, Execution Blotter, Desk Risk | Proprietary OMS/EMS data |
| Trading Desk | E-Trading Analytics | Proprietary platform metrics |
| Optimization | Solver Runs, Duals, Recommended Trades | Internal optimization engine output |
| Sources & Uses | Source/Use Nodes, Match Engine | Proprietary fund accounting |
| Collateral | Margin Calls, Counterparty Exposure | Bilateral agreement data |
| Securities Lending | Loan Book, Borrow Requests | Bilateral/vendor-specific |
| Prime Finance | Client Revenue, Financing Opportunities | Proprietary PB data |
| Liquidity | Cash Buckets, Funding Facilities, Stress Scenarios | Proprietary treasury data |
| Dashboard | SL Revenue, Prime Revenue, Collateral Savings KPIs | Derived from proprietary modules |
| Copilot | All summary stats | Aggregates proprietary modules |

---

## Implementation Priority (Ranked by Impact)

| # | Item | Pages Affected | FRED/Pipeline | Complexity | Value |
|---|------|---------------|---------------|------------|-------|
| 1 | Dashboard live indices | Dashboard, Markets | FRED + Pipeline | Medium | High — first thing users see |
| 2 | Liquidity early warnings | Liquidity | FRED (3 series) | Low | High — risk-critical signals |
| 3 | Fear/greed live components | Sentiment | FRED (3-4 series) | Medium | Medium — composites become meaningful |
| 4 | Dashboard heatmap/movers | Dashboard | Pipeline | Low | Medium — visual credibility |
| 5 | Cash optimizer live rates | Cash Optimizer | FRED (3 series) | Low | Medium — rate accuracy matters |
| 6 | Reinvestment live curves | Reinvestment | FRED (6 series) | Low-Med | Medium — investment assumption accuracy |
| 7 | Markets quote overlay | Markets | Pipeline | Medium | Medium — main market view |
| 8 | Rates RV live z-scores | Curve | Curve history | Medium | Medium — RV signals |
| 9 | Macro regime live classification | Regime | FRED (8-10 series) | Med-High | Medium — regime drives playbooks |
| 10 | Alert live triggers | Alerts | FRED (5+ series) | Medium | Medium — operational alerting |
| 11 | SecLending price overlay | SecLending | Pipeline | Low | Low — price column only |
| 12 | Collateral/PF price overlay | Collateral, PF | Pipeline | Low | Low — mark-to-market only |
| 13 | Squeeze short interest | Squeeze | Yahoo (new) | Medium | Low — single column |

---

## Verification Criteria

For each completed item:
1. `npx tsc --noEmit` passes
2. `npx vite build` succeeds
3. Widget renders with SIM data when no API key is set (fallback preserved)
4. Widget upgrades to live data when `FRED_API_KEY` or `MARKET_PIPELINE_URL` is set
5. `ProvenanceBadge` correctly reflects the active data source
