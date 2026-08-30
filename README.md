# QIT Terminal — Quant Intelligence Platform

A **Bloomberg-style operating system** for the securities finance business — unifying
**Securities Lending, Prime Finance, Collateral Optimization, Cash Optimization,
Cash Collateral Reinvestment, Liquidity & Funding Stress, Sources & Uses Matching,
Treasury & Funding Analytics, Borrow-Demand / Squeeze Radar, Macro Regime Playbooks,
Market News, Investor Sentiment, Prediction Markets, Market Volatility, DataOps/Lineage, and AI-driven
decision support** into a single dense, keyboard-driven, multi-monitor terminal —
**46 modules** in all.

Built to look and feel like the software that runs a multi-trillion-dollar book at
State Street, Goldman Sachs, Morgan Stanley, J.P. Morgan, BNY Mellon, Citi, UBS, or
BlackRock.

> **Design language:** black canvas (`#0A0A0A`), amber command accent (`#FF8C00`),
> green / red P&L semantics, tabular numerics, minimal whitespace, real-time streaming feel.

| | |
|---|---|
| ![Command Center](screenshots/home-dashboard.png) | ![Live Markets](screenshots/markets-overview.png) |
| ![Macro Dashboard](screenshots/macro-dashboard.png) | ![Optimization Center](screenshots/optimization-center.png) |

*30 full-resolution captures live in [`screenshots/`](screenshots/).*

---

## Planning Docs

- [`docs/roadmaps/FUTURE_FEATURE_ROADMAP.md`](docs/roadmaps/FUTURE_FEATURE_ROADMAP.md) is the main forward-looking product and engineering backlog.
- [`docs/roadmaps/MARKET_TERMINAL_ROADMAP.md`](docs/roadmaps/MARKET_TERMINAL_ROADMAP.md) is the broader platform review and roadmap reference.
- [`docs/handoff.md`](docs/handoff.md) tracks active workstream status and next implementation handoffs.
- [`docs/specs/`](docs/specs/) contains active feature/module specs, including `spec003` for the proposed Market Volatility module.

---

## Modules

| Code | Module | What it does |
|------|--------|--------------|
| `HOME` | **Command Center** | Cross-desk KPIs, revenue, heat map, live alert stream, module launchpad |
| `MKT`  | **Live Markets** | Multi-asset monitor — equities, ETFs, fixed income, futures, FX, commodities, crypto, vol. Quotes grid, candlesticks + VWAP, order flow, treemap heat map, movers |
| `SNAP` | **Market Snapshot** | Cross-asset "state of the market" served by the **`market_data_pipeline`** (FRED · Yahoo · pluggable vendors): returns/drawdown table (1D…5Y CAGR, 52w distance), Treasury curve + 2s10s/3m10y, regime scores (risk-on/off · growth · inflation · liquidity), cross-asset dashboard, best/worst YTD |
| `QUILT` | **Asset Quilt** | Annual cross-asset return "quilt" — every asset class ranked by yearly total return, Bilello-style, with leaders/laggards and dispersion |
| `IRET` | **Index Return Analytics** | Monthly index return matrix, calendar-year totals, and intra-year drawdowns (Yahoo-ready via the `market_data_pipeline`) |
| `LENS` | **Market Lens Studio** | Build/compare market & cross-asset series from the lens engine (committed snapshots + FRED) |
| `MKC`  | **Market Chart Studio** | Charting studio over market series (`/api/chart/series?source=market`) |
| `MVOL` | **Market Volatility** | Reserve-balances-versus-VIX claim audit using Gold DB `WRESBAL`/`VIXCLS`, base-rate lift, confidence bands, and claim-threshold diagnostics |
| `SLAB` | **Securities Lending** | Inventory (internal / beneficial owner / prime), loan book, borrow demand, HTB & specials, revenue analytics (waterfall, Sankey, by borrower/security/asset class) |
| `SQZ`  | **Squeeze Radar** | Borrow-demand / squeeze radar on the lending spine — composite heat score, fee×utilization quadrant (re-rate vs special), squeeze candidates, specials watch, sector heat, ALRT-ready heat-up alerts |
| `PB`   | **Prime Finance** | Gross/net/long/short exposure, top hedge-fund clients, financing revenue & RoA, VaR / stress testing, financing optimization opportunities |
| `COLL` | **Collateral Management** | IM/VM, excess/deficits, current vs optimized allocation, shadow prices, eligibility/concentration/haircut constraints, interactive what-if |
| `CASH` | **Cash Optimizer** | Treasury funding sources & uses, cheapest funding path, Sankey flow, LCR/NSFR, intraday liquidity stress |
| `REINV` | **Cash Collateral Reinvestment** | Reinvestment ladder, spread carry, WAL/tenor buckets, liquidity buffers, policy-path sensitivity, and collateral cash deployment scenarios |
| `LIQ`  | **Liquidity & Funding Stress** | Funding ladder, stress outflows, liquidity survival horizon, desk exposure heat map, scenario console, and escalation signals |
| `SXU`  | **Sources & Uses** | Matching engine network graph, internalization opportunities, funding savings, allocation heat map |
| `OPT`  | **Optimization Center** | Flagship — solver runs (Gurobi / OR-Tools / Pyomo), objective/runtime/status/duals, before-after comparison, recommended trades |
| `DESK` | **Trading Desk** | Trader scorecards, execution analytics (slippage / VWAP / TWAP / fill rates), risk analytics, position concentration |
| `ECON` | **Macro Dashboard** | FRED-connected economic indicators grouped by category, surprise index, breadth, live series explorer |
| `MGC`  | **Macro Chart Studio** | Charting studio over the **166-series FRED catalog** — build/compare/transform any series (`/api/chart/series`) |
| `MOTN` | **Macro Motion Studio** | Animated macro-series motion / racing-series visualizations over the FRED catalog |
| `FUND` | **Funding & Liquidity** | The funding tape — overnight corridor (IORB/EFFR/OBFR/SOFR/BGCR/TGCR), liquidity balances (RRP/reserves/Fed B-S), T-bills, FX-basis, funding spreads (SOFR−EFFR, SOFR−IORB, GC−OIS, bill−OIS, FRA−OIS), and a 0–100 quarter-end **funding-stress gauge** |
| `BMRK` | **Benchmark Rates** | 33-rate status board — trends, spreads, correlations, regime classification, and PDF export over the FRED → master JSON → snapshot → SIM fallback chain |
| `BRA`  | **Rate Analysis Hub** | Unified economics workflow aggregating Benchmark Rates, Yield Curve Analytics, Rate Volatility, Funding Cost, and Utilization Analytics |
| `YCURV` | **Yield Curve Analytics** | Daily curve construction, slope/curvature/butterfly history, curve regimes, and PDF export reusing the benchmark-rate series map |
| `RVOL` | **Rate Volatility** | Realized-vol surface, vol regimes, vol-of-vol, and term-structure analytics over Treasury/rate histories |
| `FCOST` | **Funding Cost Monitor** | Blended borrowing-cost monitor by counterparty tier with desk attribution — live benchmark inputs with modeled internal-book overlays |
| `UTIL` | **Utilization Analytics** | Aggregate securities-lending utilization analytics, benchmark-rate overlays, custom rate blends, sensitivity, and PDF export |
| `CURV` | **Treasury Curve Lab** | Multi-snapshot curve overlay (today vs 1M/3M/6M/1Y/2Y/pre-hiking/GFC), level/slope/curvature, point-in-time scrubber, **user-selectable spread** (10Y-2Y default + 10Y-3M, 30Y-5Y, 10Y-1Y, 5Y-2Y, 2Y-3M, 30Y-10Y), inversion → recession lead-time analysis, and term funding carry |
| `INFL` | **Inflation Explorer** | CPI / Core CPI / PCE / Core PCE to item level — index reading, MoM %, YoY %, and ΔMoM/ΔYoY acceleration; contribution waterfall; CPI/PCE basket toggle; every item drills to 24m |
| `GCPI` | **Global Inflation** | CPI YoY/MoM by country with trend-vs-prior, consecutive-print streaks, vs-target, heat map |
| `GPOL` | **Global Policy Rates** | Central-bank rates, cycles, real rates, streaks and next meetings by country |
| `CRDT` | **Credit Spreads** | IG/HY OAS deep dive — credit curve by rating (drillable), 18y IG-vs-HY history with stress episodes, sector spreads, valuation percentiles, stress table, collateral haircut impact, counterparty stress overlay, credit substitutions, and credit→sec-finance linkage |
| `FOMC` | **Rate Probabilities** | CME-FedWatch meeting hike/cut odds computed by the **`macro_data_etl` FedProbabilityEngine** (Fed Funds futures → day-weighted FOMC probabilities), **Policy Path Evolution** overlay, implied path, FOMC dot plot, and policy-path transmission into REINV/CASH/COLL/OPT |
| `CAL`  | **Economic Calendar** | Release stream (FRED release dates) with importance/category filters, beat/miss vs consensus, downstream desk sensitivity tags, and pre/post release factor-move summaries |
| `STAT` | **Statistical Analysis** | **Live FRED, up to 20y** — adjustable lookback (5/10/20Y/Max), transform (levels/Δ/YoY), Granger lag, rolling window & series selection; correlation matrix, **Granger causality** (F-test), OLS regression, ADF stationarity, rolling correlation, ACF, distributions & moments, plus desk-ready study packs |
| `EDA`  | **EDA / Lead-Lag Lab** | Exploratory lead-lag analytics from the `market_data_pipeline` gold `eda` view — cross-correlation (CCF) with best-lag detection, Granger causality, lagged OLS, and CUSUM/PELT change-point detection |
| `REGIME` | **Macro Regime Playbook** | Macro regime scoring across growth, inflation, liquidity, credit, and policy factors; playbook actions for collateral, reinvestment, lending, optimization, and funding desks |
| `EML`  | **ML Applications** | Recession probit (AUC 0.89), inflation nowcast, rate-path BVAR+LSTM, regime HMM, feature importances, model registry |
| `SFE`  | **Sec-Finance Economics** | Differentiator — repo complex, rate sensitivities ("greeks for the book") with a Fed-cut scenario stepper, cash-collateral reinvestment ladder, macro factor links, P&L bridge, shared scenario library, and macro→business linkage |
| `NEWS` | **News & Signal Intel** | Market news + social + signal engine — headline tape, narrative monitor, social intelligence, market-impact, attention heatmap, event clusters, and a signal engine. Live via a provider chain (Alpha Vantage → Marketaux → Finnhub → NewsAPI) + Reddit/StockTwits social, with optional FinBERT NLP |
| `SENT` | **Investor Sentiment** | Survey + social fear/greed & positioning — AAII bull/bear, NAAIM exposure, an explainable 0–100 Sentiment Index, contrarian signals + historical analogs, survey-vs-social divergence, and a per-ticker drill cross-linked to `SQZ`. VIX component live via FRED |
| `POLY` | **Prediction Markets** | Polymarket boards — markets, events, movers, and category views with probability sparklines and volume analytics. Live via the public **Polymarket Gamma API** (`/api/polymarket/markets·events·history`), deterministic SIM fallback |
| `AI`   | **AI Copilot** | Built-in "Bloomberg GPT" — natural-language Q&A over every dataset, with narratives, tables, charts, and recommended actions |
| `DATAOPS` | **Data Ops** | Provider health, data lineage, SLA/quality scores, freshness monitoring, fallback status, and scaling hooks for FRED, Yahoo, `macro_data_etl`, `news_nlp`, and future licensed feeds |
| `ALRT` | **Alert Center** | Streaming risk & ops alerts with severity/category filters and a rules engine |

---

## Economic & Macro modules — detailed reference

This is the deep-dive spec for every module in the **Economics & Macro** navigation group
(`src/lib/nav.ts`, group `ECONOMICS`) — **22 modules** — plus the three macro-adjacent
**Markets** surfaces (`SNAP`/`QUILT`/`IRET`) that are FRED/pipeline-fed. Each entry lists the
**route**, the **data module** that computes it, the **FRED series / upstream** it draws on, the
**analytics it produces**, the **API endpoints**, and its **live-vs-sim provenance**. Everything
runs offline against a deterministic, seeded simulation and transparently upgrades to live FRED
(and, where noted, the `macro_data_etl` / `market_data_pipeline` companions) — the resolution
order per series is always **live FRED → committed SNAPSHOT → SIM**.

> **Shared foundation.** All rates/macro modules read the **166-series FRED catalog**
> (`src/data/econSeries.ts`, `FRED_CATALOG`) categorised as `GROWTH · INFLATION · LABOR · RATES ·
> CREDIT · HOUSING · CONSUMER · MONEY · ACTIVITY · FX`. Each series carries a units hint that
> `resolveFred()` maps to the correct FRED transform (`pc1` YoY for CPI, `pch` MoM for retail,
> `chg` for payrolls, bps ×100 for OAS/spreads, $T scaling for Fed balance-sheet). Client hooks
> `useEcon`/`useMarket` render the fallback instantly, then upgrade; the `ProvenanceBadge`
> (+ `AGING`/`STALE` staleness marker) always reflects what's actually shown, and multi-series
> panels aggregate to the **worst source present** (`worstSource`, `src/lib/provenance.ts`).

### Macro overview & indicators

- **`ECON` — Macro Dashboard** — `/economics` · `src/data/econSeries.ts`
  - The FRED landing page. `getIndicators()` derives, per catalog series: latest **value**,
    **prior**, absolute **change**, **YoY**, a **surprise** (actual − consensus in unit terms),
    a 36-point **sparkline**, and a `bullish` polarity flag.
  - Indicators are grouped by the 10 `EconCategory` buckets with a **surprise index** and
    **breadth** roll-ups, plus a live series explorer; every card drills to a 24-month history.
  - **API:** `/api/econ/indicators` (dashboard rows), `/api/econ/batch` (raw multi-series),
    `/api/econ/series` (24m history per id). **Provenance:** 🟢 Live (units-corrected) with `FRED_API_KEY`.

- **`CAL` — Economic Calendar** — `/economics/calendar` · `src/data/econRates.ts` + `econEnhancements.ts`
  - Release stream built from **real FRED release dates** with **importance** (`HIGH/MEDIUM/LOW`)
    and **category** filters, **beat/miss vs consensus**, downstream **desk-sensitivity tags**
    (`getCalendarSensitivity` → `Rates P&L · Haircut Risk · Borrow Demand · Funding Liquidity ·
    Margin Risk`), and pre/post-release **factor-move summaries** (`getReleaseMoveSummaries`).
  - **API:** `/api/econ/calendar`. **Provenance:** 🟢 Live release dates; sensitivities/factor moves computed.

- **`STAT` — Statistical Analysis** — `/economics/stats` · `src/data/statsConfig.ts` + `econModels.ts`
  - **Live FRED up to 20y** over a **32-series** study universe (`STAT_SERIES`) with adjustable
    lookback (5/10/20Y/Max), transform (levels / Δ / YoY), a Granger lag, and rolling window.
  - Produces a **correlation matrix**, **Granger causality** (F-test), **OLS regression**
    (`getRegression`, default `T10Y2Y → BAMLH0A0HYM2`), **ADF stationarity**, **rolling
    correlation**, **ACF**, and **distribution/moments** (`getDistribution` — mean, sd, skew,
    latest z-score), plus packaged desk-ready **study packs** (`getStatStudyPacks`).
  - **API:** `/api/econ/stats`, `/api/econ/batch`. **Provenance:** 🟢 Live (incrementally cached).

- **`EDA` — EDA / Lead-Lag Lab** — `/economics/eda` · `market_data_pipeline` gold `eda` view
  - Exploratory lead-lag analytics over the committed pipeline view (`src/data/market/eda.json`):
    **cross-correlation (CCF)** with best-lag detection, **Granger causality**, **lagged OLS**, and
    **CUSUM/PELT change-point** detection. **Provenance:** 🔵 Pipeline snapshot (refreshable via the pipeline analytics stage).

### Rates, curve & funding

- **`CURV` — Treasury Curve Lab** — `/economics/curve` · `src/data/econCurve.ts` + `ratesRV.ts`
  - Assembles **real point-in-time curves** from each tenor's full daily FRED history
    (`DGS1MO…DGS30`): overlays Today vs 1M/3M/6M/1Y/2Y ago (each with its real `AS OF` date) plus
    deep reference curves (Pre-Hiking 2021, GFC 2009). Computes **level/slope/curvature**
    (`getCurveMetrics`), a **user-selectable spread** (10Y-2Y default + 10Y-3M, 30Y-5Y, 10Y-1Y,
    5Y-2Y, 2Y-3M, 30Y-10Y via `SPREAD_DEFS`), **live-detected inversions** for every spread from
    daily history + `USREC` (`detectInversions`, inversion → recession lead-time), butterflies
    and spread z-scores (`ratesRV.ts`: `computeButterflies`, `computeSpreadZScores`,
    `computeCarryRoll`, `classifyCurveMove` → Bull/Bear Steepener/Flattener), and term funding carry.
  - **API:** `/api/econ/curve`, `/api/econ/curve-history` (cached 6h), `/api/econ/inversions`. **Provenance:** 🟢 Live curves & inversions; deep reference curves curated.

- **`YCURV` — Yield Curve Analytics** — `/economics/yield-curve` · `src/data/yieldCurveAnalytics.ts`
  - Daily curve construction over **9 tenors** (`buildCurveHistory`), **curve-shape metrics**
    (`computeCurveShape` — slope/curvature/butterfly), **regime classification**
    (`classifyCurveRegime` → e.g. Bull/Bear Steepen/Flatten, Twist), **inversion segments**
    (`findInversions`), **curve diffs**, curve correlation, and **PDF export** — reusing the
    benchmark-rate series map. **Provenance:** 🟢 Live/real fallback (FRED → master JSON → snapshot → SIM).

- **`RVOL` — Rate Volatility** — `/economics/rate-vol` · `src/data/rateVolatility.ts`
  - **Realized-vol surface** across windows (5/10/20/60/120d, `computeRealizedVol`), **vol regimes**
    (`classifyVolRegime` → Low Vol / Normal / Elevated / Vol Storm), **vol cones**
    (`computeVolCone`), **vol-of-vol** (`computeVolOfVol`), **cross-asset vol** and vol correlation,
    plus PDF export over Treasury/rate histories. **Provenance:** 🟢 Live/real fallback.

- **`BMRK` — Benchmark Rates** — `/economics/benchmark` · `src/data/benchmarkRates.ts`
  - **43-rate status board** across 7 categories (`Overnight · Treasury · Credit · Swap · Mortgage ·
    Commodity · International`). Computes **trend metrics** (`computeTrend`), **spread pairs**
    (`SPREAD_PAIRS` / `computeAllSpreads`), a **status board** (`elevated/normal/depressed`),
    **rolling correlations** (`computeCorrelation`), and **regime classification** (`classifyRegime`
    → Tightening / Restrictive / Easing / Accommodative / Neutral), with PDF export.
  - **API:** `/api/econ/benchmark`. **Provenance:** 🟢 Live/real fallback over FRED → master JSON → committed snapshot → deterministic SIM.

- **`BRA` — Rate Analysis Hub** — `/economics/rate-analysis`
  - Unified economics workflow aggregating **Benchmark Rates + Yield Curve Analytics + Rate
    Volatility + Funding Cost + Utilization Analytics** into one dashboard over the shared
    benchmark-rate data contract. **Provenance:** 🟡 Composite of the above.

- **`FUND` — Funding & Liquidity** — `/economics/funding` · `src/data/funding.ts`
  - The funding tape over a **22-series** set (`FUNDING_SERIES`, groups `Overnight · Balances ·
    Bills · FX Basis`): overnight corridor (`IORB/EFFR/OBFR/SOFR/BGCR/TGCR`), liquidity balances
    (`RRPONTSYD/WRESBAL/WALCL`, incl. WRESBAL $B→$T scaling), T-bills, funding **spreads**
    (`computeSpreads` — SOFR−EFFR, SOFR−IORB, GC−OIS, bill−OIS, FRA−OIS), **per-desk signals**
    (`computeDeskSignals` → Calm/Watch/Stress per Repo/Agency/Prime/Cash/Collateral/E-Trading),
    and a **0–100 quarter-end funding-stress gauge** (`computeGauge`).
  - **API:** `/api/econ/batch`. **Provenance:** 🟢 Live (12/16 FRED); FX-basis & FRA-OIS SIM pending a BIS feed; gauge derived.

- **`FCOST` — Funding Cost Monitor** — `/economics/funding-cost` · `src/data/fundingCost.ts`
  - Blended borrowing-cost monitor by **credit tier** (`Sovereign · Secured · AA · A · BBB · HY`,
    `computeTierCosts`) with **per-desk attribution** (`computeDeskFunding` across SLAB/COLL/CASH/
    REINV/PB/REPO), a **term-funding ladder** (`computeTermLadder`), **tier spreads**
    (`computeTierSpreads`), and a **funding-regime classifier** (`classifyFundingRegime` →
    Tight/Normal/Wide/Stress). **Provenance:** 🟡 Derived from live/sim benchmark rates with modeled internal-book overlays.

- **`FOMC` — Rate Probabilities** — `/economics/rates` · `src/data/econRates.ts` + `macro_data_etl`
  - **CME-FedWatch** meeting hike/cut odds from the `macro_data_etl` **FedProbabilityEngine**
    (30-Day Fed Funds futures → day-weighted FOMC probabilities), with **Policy-Path Evolution**
    overlay (`getPolicyPathHistory`), **implied path** (`getImpliedPath`), the **FOMC dot plot**
    (`getDotPlot`), current target `{low, high, mid}`, and policy-path transmission into
    REINV/CASH/COLL/OPT (`getPolicyTransmission`). **Provenance:** 🔵 ETL (FedWatch); live CME with network, else deterministic fallback curve.

### Inflation

- **`INFL` — Inflation Explorer** — `/economics/inflation` · `src/data/inflation.ts`
  - **CPI / Core CPI / PCE / Core PCE** to item level (`InflationGroup`): index reading, **MoM %**,
    **YoY %**, and **ΔMoM/ΔYoY acceleration** (`liveInflationItem`), a **contribution waterfall**,
    a CPI/PCE **basket toggle** (`getInflationComponents`), and a summary (`getInflationSummary`);
    every item drills to 24 months. **Provenance:** 🟢 Live (index → derived MoM/YoY/accel), per-item fallback to sim.

- **`GCPI` — Global Inflation** — `/economics/global-cpi` · `src/data/globalMacro.ts`
  - **CPI YoY/MoM by country** (`getGlobalCPI`) with trend-vs-prior (`RISING/FALLING/FLAT`),
    consecutive-print **streaks**, **vs-target**, and a heat map, across `AMER/EMEA/APAC` regions.
    Live via **OECD-on-FRED** CPI (`liveCountryCPI`) or the `macro_data_etl` World Bank feed
    (`etlCountryCPI`). **Provenance:** 🟢 Live (most countries), per-country fallback to sim.

### Global policy & credit

- **`GPOL` — Global Policy Rates** — `/economics/policy-rates` · `src/data/globalMacro.ts`
  - Central-bank policy rates by country (`getGlobalPolicyRates`): current rate, **cycle**
    (hiking/cutting/hold), **real rates**, hike/cut **streaks**, and **next meeting** dates. Live via
    FRED OECD/ECB series (`livePolicyRate`) or the ETL BIS `WS_CBPOL` feed (`etlPolicyRate`).
    **Provenance:** 🟡 Partial live.

- **`CRDT` — Credit Spreads** — `/economics/credit` · `src/data/creditSpreads.ts` + `econEnhancements.ts`
  - IG/HY **OAS** deep dive: **credit curve by rating** (`getCreditCurve`, drillable), **18y IG-vs-HY
    history** with stress episodes (`getSpreadHistory`, `getStressEpisodes`), **sector spreads**
    (`getSectorSpreads`), **spread decomposition** (`getSpreadDecomposition`), **credit betas**
    (`getCreditBetas`), **ETF divergences** (`getEtfDivergences`), valuation percentiles, and a
    **credit → sec-finance linkage** — **collateral haircut impact** (`getCreditHaircutImpacts`),
    **counterparty stress overlay** (`getCounterpartyCreditOverlays`), and **credit substitutions**
    (`getCreditSubstitutions`). ICE BofA OAS FRED ids are real. **Provenance:** 🟢 Live (rating curve + IG/HY); linkage analytics computed.

### Regime & models

- **`REGIME` — Macro Regime Playbook** — `/economics/regime` · `src/data/macroRegime.ts`
  - Regime scoring across **growth, inflation, liquidity, credit, and policy** factors
    (`getRegimeFactors`, merged with live FRED via `mergeLiveRegimeFactors` over
    `DGS10/DGS2/DGS3MO/BAMLH0A0HYM2/SOFR/EFFR/CPILFESL`), a **named-regime** classifier
    (`getNamedRegime` → Goldilocks / Reflation / Stagflation / Growth Scare / Liquidity Squeeze /
    Policy Easing), **regime transitions** and **exposures**, **impulse scores**, and **desk
    playbooks** (`getDeskPlaybooks`, `getCrossDeskPlaybooks`) mapping the state to actions for
    collateral, reinvestment, lending, optimization, and funding. **Provenance:** 🟡 Partial live/sim.

- **`EML` — ML Applications** — `/economics/ml` · `src/data/econModels.ts`
  - Model outputs (not a feed): **recession probit** (AUC 0.89), **inflation nowcast**,
    **rate-path BVAR+LSTM**, **regime HMM**, feature importances, and a **model registry**
    (`getMLModels`). **Provenance:** 🔴 Sim / model.

### Securities-finance economics

- **`SFE` — Sec-Finance Economics** — `/economics/sec-finance` · `src/data/econModels.ts` + `econEnhancements.ts`
  - The differentiator that ties macro to the book: **repo complex** (`getRepoRates`,
    `liveRepoRow` off live SOFR), **rate sensitivities** ("greeks for the book",
    `getRateSensitivities`) with a **Fed-cut scenario stepper**, a **cash-collateral reinvestment
    ladder** (`getReinvestmentLadder`), **macro factor links** (`getMacroLinkages`,
    `getSfeFactorLinks`), a **P&L bridge** (`getSfePnlBridge`), and a **shared scenario library**
    (`getSfeScenarioLibrary`). **Provenance:** 🟡 Partial live (SOFR/EFFR/IORB/RRP + Fed backdrop live; sensitivities/P&L/scenarios curated).

- **`UTIL` — Utilization Analytics** — `/economics/utilization` · `src/data/utilizationAnalytics.ts`
  - Aggregate securities-lending **utilization** analytics grouped by
    `sector/assetClass/classification(GC·WARM·SPECIAL·HTB)/source` (`computeUtilizationSnapshot`),
    a **utilization time series**, **custom rate blends** (`PRESET_BLENDS` + user blends via
    `computeBlend`/`validateBlend`), **benchmark-rate overlays** (`normalizeForOverlay`),
    **rate↔utilization correlation** and **sensitivity** (`computeRateUtilCorrelation`,
    `computeRateSensitivity`), and PDF export. **Provenance:** 🟡 Internal-book model + rate overlays.

### Charting & motion

- **`MGC` — Macro Chart Studio** — `/macro-chart` · unified chart resolver
  - Freeform charting studio over the **166-series FRED catalog** — build/compare/transform any
    series via `/api/chart/series?source=econ`. **Provenance:** 🟢 Live per series.

- **`MOTN` — Macro Motion Studio** — `/economics/motion`
  - Animated macro-series **racing/motion** visualizations over the FRED catalog. **Provenance:** 🟢 Live per series.

### Macro-adjacent Markets surfaces (FRED / pipeline-fed)

- **`SNAP` — Market Snapshot** — `/market-snapshot` · `market_data_pipeline`
  - Cross-asset "state of the market": returns/drawdown table (1D…5Y CAGR, 52w distance), Treasury
    curve + 2s10s/3m10y, **regime scores** (risk-on/off · growth · inflation · liquidity), and
    best/worst YTD. **Provenance:** 🔵 pipeline (FRED · Yahoo · pluggable vendors).
- **`QUILT` — Asset Quilt** — `/asset-quilt` — annual cross-asset return "quilt" (Bilello-style), leaders/laggards, dispersion. 🔵 pipeline.
- **`IRET` — Index Return Analytics** — `/index-returns` — monthly index return matrix, calendar-year totals, intra-year drawdowns. 🔵 pipeline.

---

## Live economic data (FRED + Gold DB)

The **Economics & Macro** modules now read from a **single primary source: the Gold DB**
(`fred-bronze-to-gold-pipeline`). This is the **production-target data path** as of 2026-07-17.
See `docs/features/GOLD_DB_MIGRATION_HANDOFF.md` for the full migration scope and design decisions.

**Resolution order (Tier A — series/economic data):**

1. **🔵 Gold DB** (`MACRO_DB_URL`) — **THE PRIMARY SOURCE** — the `fred-bronze-to-gold-pipeline` Gold layer.
   Set `MACRO_DB_URL=sqlite:./data/fred_local.db` (local) or `MACRO_DB_URL=postgres://…` (deploy).
   All macro indicator analytics (z-scores, percentiles, surprises, staleness), curve metrics,
   credit/funding/inflation/regime are **precomputed in Gold**. Routes become thin `SELECT`s.
   Panels show a green **LIVE · DB** badge. **This is the only data path in production.**
   When Gold DB is unavailable, the module shows an explicit error or empty state (no fallback).
2. **🟢 Live FRED API** (`FRED_API_KEY`) — **Legacy fallback only** — used when `MACRO_DB_URL` is not configured.
   Fetches live observations from `api.stlouisfed.org` (cached 10 min). Panels show **LIVE · FRED**.
   Not part of the production path after Gold DB migration (2026-07-17).
3. **⚪ Committed snapshot** — **Deprecated after Gold DB migration.** Use Gold DB instead.
   Previously: run `npm run export:econ-snapshot` to capture frozen FRED observations
   into `src/data/econSnapshot.json`. Panels show **SNAPSHOT**.
4. **⚪ Deterministic SIM** — **Deprecated after Gold DB migration.** Use Gold DB instead.
   Previously: seeded simulation anchored to a plausible mid-2026 macro regime. Panels show **SIM**.

**Tier B (kept live — deliberate exceptions):** NEWS, SENT social/survey, Polymarket, AI copilot.
These are non-series real-time feeds not in the pipeline. Each route carries a documented exception comment.

```bash
# PRIMARY (2026-07-17+): Gold DB (local SQLite — from fred-bronze-to-gold-pipeline):
MACRO_DB_URL=sqlite:./data/fred_local.db npm run dev

# PRIMARY (2026-07-17+): Gold DB (Postgres deploy):
MACRO_DB_URL=postgres://user:pass@host/db npm run dev

# LEGACY FALLBACK (when Gold DB is not configured — for backward compatibility):
FRED_API_KEY=your_key_here npm run dev
# Get a free key: https://fred.stlouisfed.org/docs/api/api_key.html
```

**Data as-of dates.** Rates/macro modules show a **`DATA AS OF <date>`** pill in the header
so freshness is never ambiguous. The **Treasury Curve Lab** assembles **real point-in-time curves** —
it queries Gold for each tenor's full daily history, then builds the curve as-of Today and 1M/3M/6M/1Y/2Y ago
from the actual Gold observations (the point-in-time scrubber shows each curve's real `AS OF` date).
The deep reference curves (Pre-Hiking 2021, GFC 2009), inversion history and term carry remain
precomputed in Gold. The **Macro Dashboard** shows the most recent observation date across live
indicators, and **Rate Probabilities** shows the Fed-funds-futures pricing date the FedWatch odds
were derived from. With `MACRO_DB_URL` configured, all data is current with the DB refresh cadence.

```bash
# Set MACRO_DB_URL for live data via Gold DB:
MACRO_DB_URL=sqlite:./data/fred_local.db npm run dev
# Deployed: add MACRO_DB_URL as a project env var (Vercel), or your process host's env.

# (Legacy: FRED_API_KEY is only used if MACRO_DB_URL is not set)
```

### AI Copilot (optional Claude integration)

The **AI Copilot** (`AI`) answers natural-language questions over the securities-finance
desks, and is **optional and resilient** the same way:

- **With a key** — set `ANTHROPIC_API_KEY`. The `/api/copilot` route hands Claude
  (`claude-opus-4-8`) a factual snapshot of the live desk data (securities-lending revenue,
  borrower/security rankings, collateral savings, funding costs, internalization, hard-to-borrow)
  and Claude answers **from those figures only**. Answers carry a green **Claude** badge; the
  charts and tables are still computed deterministically from the real desk data.
- **Without a key** — the Copilot falls back to its **deterministic keyword engine** over the
  same datasets (amber **Local engine** badge). Fully functional offline.

```bash
ANTHROPIC_API_KEY=your_key_here npm run dev
# Deployed: add ANTHROPIC_API_KEY as a project env var (Vercel), or your process host's env.
```

**Daily refresh (cron).** FRED data is fetched on-access and cached (curve history 6h,
indicators 10 min), so a busy site is always fresh — but to guarantee the curve/rates refresh
**once a day even with no traffic**, `vercel.json` registers a cron that hits
`/api/cron/refresh` daily at 12:00 UTC. (On a `npm start` process host, point any external
scheduler — OS cron, GitHub Actions, etc. — at `/api/cron/refresh` instead.) That endpoint re-pulls and re-warms the FRED-backed
econ routes (`curve-history`, `curve`, `indicators`, `calendar`) plus the market-data bridge
routes (`/api/market/*`). If `MARKET_PIPELINE_URL` is configured, cron first POSTs to the
pipeline's `/ingestion/run` endpoint with a recent start date so Yahoo-backed market data
refreshes once per day without repeatedly backfilling full history. Tune that window with
`MARKET_CRON_LOOKBACK_DAYS` (default 14), pin it with `MARKET_CRON_START_DATE`, or disable
the ingestion POST with `MARKET_CRON_INGESTION=0`. Historical Treasury yields are immutable,
so each refresh only advances the recent tail. Set a **`CRON_SECRET`** project env var to
lock the endpoint down — Vercel sends it as a Bearer token and the route rejects any request
without it (returns the warm summary on success).

### Data provenance — what's live vs. simulated (post-Gold DB migration)

**Post-2026-07-17 architecture:** All **economic/macro modules** (`ECON`, `CURV`, `INFL`, `GCPI`, `GPOL`, `CRDT`, `FOMC`, `CAL`, `STAT`, `REGIME`, `EML`, `SFE`, `FUND`, `BMRK`, `BRA`, `UTIL`, `YCURV`, `RVOL`, `FCOST`, `MGC`, `EDA`, `MOTN`) read **exclusively from the Gold DB** (`MACRO_DB_URL`). The Market Volatility module (`MVOL`) also reads its FRED-published reserve/VIX inputs exclusively from Gold DB. When Gold DB is configured, these modules show a green **LIVE · DB** badge; when not configured, they fall back to the committed snapshot (amber **SNAPSHOT** badge) or error state. There is **no fallback chain** anymore — the old FRED → SNAPSHOT → SIM fallback is retired.

The table below shows the **real-world data source** each module ultimately draws from (FRED, World Bank, BIS, CME, Yahoo, etc.), not the technical path to get it. The technical path is now **always** Gold DB for economic modules:

| Module | Source | Notes |
|--------|--------|-------|
| Macro Dashboard (ECON) | 🟢 FRED | 166-series catalog, units-corrected; read from Gold DB |
| Treasury Curve Lab (CURV) | 🟢 FRED | Daily tenors, inversions detected from FRED history; read from Gold DB |
| Economic Calendar (CAL) | 🟢 FRED | Real release dates and surprise data; read from Gold DB |
| Inflation Explorer (INFL) | 🟢 FRED | CPI/PCE index and component series; read from Gold DB |
| Global Inflation (GCPI) | 🟢 OECD-on-FRED + World Bank | Per-country CPI via FRED or ETL; read from Gold DB |
| Credit Spreads (CRDT) | 🟢 FRED (ICE BofA OAS) | Rating curves and stress episodes; read from Gold DB |
| Statistical Analysis (STAT) | 🟢 FRED | 32-series study universe up to 20y history; read from Gold DB |
| Macro Regime Playbook (REGIME) | 🟢 FRED/Yahoo | Growth/inflation/liquidity/credit/policy factors; read from Gold DB |
| Sec-Finance Economics (SFE) | 🟢 FRED | SOFR/EFFR/IORB/RRP + Fed rates; read from Gold DB |
| Funding & Liquidity (FUND) | 🟢 FRED (12 series) + BIS | Corridor, balances, bills; FX-basis pending BIS feed; read from Gold DB |
| Benchmark Rates (BMRK) | 🟢 FRED | 33-rate status board across 7 categories; read from Gold DB |
| Yield Curve Analytics (YCURV) | 🟢 FRED | Daily curve shape, slope history, regime shifts; read from Gold DB |
| Rate Volatility (RVOL) | 🟢 FRED | Realized-vol surface and vol regimes; read from Gold DB |
| Market Volatility (MVOL) | 🟢 FRED + CBOE via FRED | `WRESBAL`/`VIXCLS` reserve-VIX claim audit; read from Gold DB |
| Funding Cost Monitor (FCOST) | 🟡 FRED-derived rates | Blended borrowing costs by tier; read from Gold DB |
| Utilization Analytics (UTIL) | 🟡 Internal-book + FRED rates | Lending utilization, rate overlays; read from Gold DB |
| Rate Analysis Hub (BRA) | 🟡 Composite (BMRK + YCURV + RVOL + FCOST + UTIL) | Unified rate workflow; read from Gold DB |
| ML Applications (EML) | 🔴 Sim/model | Recession probit, inflation nowcast, rate-path models |
| Squeeze Radar (SQZ) | 🔴 Sim (lending spine) | utilization/fee + synthesized SI/DTC; needs vendor feed |
| Liquidity & Funding Stress (LIQ) | 🔴 Sim / local model | Stress ladder designed for FRED/Yahoo inputs |
| **Tier B — non-series feeds (kept live):**| | |
| News & Signal Intel (NEWS) | 🟡 Provider chain | Alpha Vantage → Marketaux → Finnhub → NewsAPI + FinBERT NLP |
| Investor Sentiment (SENT) | 🟡 FRED (VIX) + social | Reddit, StockTwits, AAII/NAAIM survey |
| Rate Probabilities (FOMC) | 🔵 CME + World Bank + BIS | `macro_data_etl` FedWatch engine (CME futures → FOMC odds) |
| EDA / Lead-Lag Lab (EDA) | 🔵 Pipeline | `market_data_pipeline` gold `eda` view |
| Prediction Markets (POLY) | 🟡 Polymarket Gamma API | Live Gamma + volume analytics; no auth |
| Data Ops (DATAOPS) | 🟡 Ops metadata | Local provider health/lineage snapshot |
| AI Copilot (AI) | 🟡 Live desk data | Claude Q&A over securities-finance book + macro inputs |

**Legend:** 
- 🟢 = FRED / live real-world data sourced via Gold DB (Tier A)
- 🔵 = ETL-fed via macro_data_etl or market_data_pipeline (Tier B)
- 🟡 = Partial live (external APIs or internal fixtures, kept live by design as exceptions to Gold DB–only rule)
- 🔴 = Simulation / model output (no external source of truth)
- **Note:** Internal-book modules (SLAB, SQZ, PB, COLL, CASH, REINV, LIQ, SXU, OPT, DESK) wire their macro *inputs* from Gold DB but keep their position/inventory/P&L books synthetic (no external book exists for a fictional trading desk).

### Ongoing integration log

Use this section as the running handoff log whenever a feature moves from planning into the integrated terminal. Keep each entry dated, list the module codes affected, and update the module count / provenance table above at the same time.

#### 2026-07-17 — Gold DB migration: DB-first economics & macro (all 22 economic modules)

- **Gold DB (fred-bronze-to-gold-pipeline) is now the primary Tier A data source** for all series/economic data — replacing the live FRED API, committed snapshots, and SIM generators.
  Economics and macro modules now read from a single source: queries against Gold tables (Tier A), with explicit empty/error states when DB is unavailable (no more silent fallback chains).
- **Data resolution is simplified:** `MACRO_DB_URL` (local SQLite for dev, Postgres/Databricks for deployment) → on failure, no fallback (explicit empty state).
- **FRED_API_KEY is now a legacy env var** — only used when `MACRO_DB_URL` is not configured (backward compatibility); not part of the production path.
- **Environment variable consolidation:** the single `MACRO_DB_URL` replaces `FRED_API_KEY`, `FRED_PYTHON_*`, `FRED_BASE_URL` for economic data; market-price feeds and news/social/Polymarket/LLM (Tier B) remain on their live chains.
- **Affected modules:** all 22 ECONOMICS modules (`ECON`, `CURV`, `INFL`, `GCPI`, `GPOL`, `CRDT`, `FOMC`, `CAL`, `STAT`, `REGIME`, `EML`, `SFE`, `FUND`, `BMRK`, `BRA`, `UTIL`, `YCURV`, `RVOL`, `FCOST`, `MGC`, `EDA`, `MOTN`).
- See `docs/features/GOLD_DB_MIGRATION_HANDOFF.md` for the full scope, design decisions, and implementation roadmap. CI gate ensures all routes hit Gold before merge.

#### 2026-07-02 — Prediction markets, EDA lab, module toggles, test suite & CI

- Added **Prediction Markets (`POLY`)** — Polymarket market/event/mover/category boards served
  live from the public **Gamma API** via `/api/polymarket/{markets,events,history}` with a
  deterministic SIM fallback (see `docs/POLYMARKET_INTEGRATION_HANDOFF.md`).
- Added the **EDA / Lead-Lag Lab (`EDA`)** at `/economics/eda` — CCF/Granger/lagged-OLS/
  change-point analytics rendered from the `market_data_pipeline` gold `eda` view.
- Added **module toggles**: `settings/modules.config.json` + `src/lib/moduleConfig.ts` let you
  enable/disable any of the 46 modules — disabled modules disappear from navigation and routing.
- Hardened **data provenance**: `worstSource` badge aggregation, provenance badges on the
  DataOps and Market Lens pages, staleness markers, and provenance/source-resolution unit tests.
- Added the **test suite & CI**: Vitest unit tests, a **Playwright E2E smoke suite**
  (`test/smoke.spec.ts` — 45 pages checked for JS errors, headers, and `undefined`/`NaN`
  leaks), and `.github/workflows/ci.yml` running typecheck → lint → unit tests → build → E2E
  on every push/PR. Plan and status live in `TESTING_HANDOFF.md`.
- Added a **`screenshots/` gallery** — 30 full-resolution module captures for docs/marketing.

#### 2026-06-25 — Benchmark-rate analysis suite integrated

- Added the **Benchmark Rates (`BMRK`)** page with 33 rate series, trend metrics, spread analysis, correlations, status board, regime classification, and PDF export.
- Added the **Rate Analysis Hub (`BRA`)** as a unified workflow over the benchmark-rate family.
- Added **Yield Curve Analytics (`YCURV`)**, **Rate Volatility (`RVOL`)**, **Funding Cost Monitor (`FCOST`)**, and **Utilization Analytics (`UTIL`)**; these reuse the benchmark-rate data contract and the FRED → master JSON → snapshot → SIM fallback model.
- Moved completed feature/handoff docs into `docs/completed/` and `docs/features/completed/`; active planning docs remain in place.

#### Earlier roadmap implementation update

The `roadmap_feature_implementation` branch expanded the terminal from 22 to 26
modules and added the first collateral-adjacent macro workflow layer:

- **#5 — Cash Collateral Reinvestment (`REINV`)**: reinvestment ladder, spread carry,
  WAL/tenor buckets, policy-path sensitivity, and liquidity buffer analytics.
- **#6 — Liquidity & Funding Stress (`LIQ`)**: stress ladder, desk funding heat map,
  survival horizon, liquidity signals, and scenario console.
- **#9 — Macro Regime Playbook (`REGIME`)**: growth/inflation/liquidity/credit/policy
  regime scoring with desk actions for collateral, reinvestment, lending, and funding.
- **#10 — Data Ops (`DATAOPS`)**: provider health, freshness, quality, lineage, SLA,
  and fallback status for FRED/Yahoo/local sources.
- **Economic & Macro enhancements**: `src/data/econEnhancements.ts` now feeds the
  enhanced SFE, STAT, CRDT, CURV/FOMC, and CAL experiences with shared scenario,
  sensitivity, study-pack, and desk-impact data.

These additions are intentionally adapter-ready: they run locally with deterministic
fixtures today, can use free **FRED** and **Yahoo Finance/yfinance** style inputs, and
can later scale to licensed feeds, internal books, optimizer outputs, and the
`market_data_pipeline` quality/lineage tables without changing the terminal UX.

**Since then** the terminal has grown to **46 modules**, adding the charting studios
(`MGC`/`MOTN`/`LENS`/`MKC`), **Funding & Liquidity (`FUND`)** and **Squeeze Radar
(`SQZ`)**, the **News (`NEWS`)** + **Investor Sentiment (`SENT`)** intelligence
layer, the benchmark-rate analysis suite (`BMRK`/`BRA`/`YCURV`/`RVOL`/`FCOST`/`UTIL`),
the **EDA / Lead-Lag Lab (`EDA`)**, and **Prediction Markets (`POLY`)** — backed by an
expanded **166-series FRED catalog**, a news provider chain
(Alpha Vantage / Marketaux / Finnhub / NewsAPI), Reddit/StockTwits social, the
**`news_nlp`** FinBERT NLP stage, and the Polymarket Gamma API. See
`docs/PLATFORM_DATA_CONNECTIVITY.md` for the full live-vs-simulated map.

---

## Global macro pipeline (`macro_data_etl`)

The **Rate Probabilities** module is fed by a companion **Python ETL** (in the
`rl_hub` repo under `/macro_data_etl`) that ingests global macro data from free
public sources and lands it through a raw → bronze → silver → gold medallion
architecture:

- **World Bank** — Global Inflation (CPI YoY by country)
- **BIS** — `WS_CBPOL` central-bank policy rates
- **IMF** — DataMapper fallback for gaps
- **CME** — 30-Day Fed Funds futures → **FOMC hike/cut probabilities** via a
  `FedProbabilityEngine` that replicates the CME FedWatch day-weighting
  methodology (with the standard next-month switchover for late-month meetings)

The ETL exports its gold tables to JSON (`macro-etl export`); a snapshot lives in
`src/data/etl/` and is imported at build time, so the terminal renders it with
**zero configuration and no hydration drift**. Panels show a blue **ETL · MACRO**
badge. CME blocks non-browser clients, so when the engine can't reach live
settlements it uses a deterministic fallback futures curve (flagged in the
tooltip) — run `macro-etl run --source all && macro-etl fedwatch` with network
access to refresh with live values. The shapes are identical, so no terminal
code changes when the data goes live.

```bash
# in the rl_hub repo
cd macro_data_etl && pip install -e .
macro-etl run --source all          # World Bank + BIS → gold
macro-etl fedwatch                  # CME futures → FOMC probabilities
macro-etl export fed_probabilities  # JSON for the terminal
```

---

## Market data pipeline (`market_data_pipeline`)

The **Market Snapshot** / **Live Markets** / **Asset Quilt** / **Index Returns**
market surfaces are served by a second Python service (in
this repo under `/market_data_pipeline`): a production market + macro pipeline
that ingests **FRED** (official macro) and **Yahoo/yfinance** (prototype-grade
market, replaceable vendor interface), lands a raw → bronze → silver → gold
medallion warehouse (DuckDB + Parquet, Polars transforms), validates it, and
serves terminal "cards" over **FastAPI**.

The pipeline's gold views are exported to JSON and committed under
`src/data/market/`, imported at build time so the module renders with **zero
config**. At runtime, `/api/market/[view]` resolves the data from the first
configured source — so the terminal can read a **local cached database or file**
instead of (or before) calling the FastAPI service:

| Priority | Env var | Source | Badge |
|----------|---------|--------|-------|
| 1 | `MARKET_DB_URL` | local **DuckDB file** (`/path/market.duckdb`) or **Postgres** (`postgres://…`) — reads the `analytics_api_views` table | `LIVE · DB` |
| 2 | `MARKET_DATA_DIR` | directory of **exported view JSON** (`mdp export-views`) read fresh per request | `LIVE · FILE` |
| 3 | `MARKET_PIPELINE_URL` | the running **FastAPI service** | `LIVE · PIPELINE` |
| 4 | *(none)* | committed build-time **snapshot** | `PIPELINE · SNAPSHOT` |

Each source degrades gracefully to the next (a missing file, an unreachable
service, or an absent DB driver just falls through), so the module always
renders — on Vercel included. The DB drivers are loaded lazily at runtime, so:
- **Postgres** (`pg`) ships as an `optionalDependency` — pure JS, no build cost,
  the realistic cloud/Vercel `MARKET_DB_URL` target.
- **DuckDB** (`duckdb`) is a *native* build, deliberately **kept out of the
  default install** so cloud builds stay fast. For the local DuckDB-file path,
  install it yourself once: `npm i duckdb`.

```bash
# in this repo
python -m pip install polars duckdb pyarrow httpx tenacity pydantic pydantic-settings pyyaml fastapi "uvicorn[standard]" apscheduler structlog
PYTHONPATH=$PWD python -m market_data_pipeline.cli run --offline   # synthetic, no keys/network
FRED_API_KEY=… PYTHONPATH=$PWD python -m market_data_pipeline.cli run   # live FRED + Yahoo

# (***) read the local fred macro medallion pipeline
MACRO_DB_URL="sqlite:/Users/joshualutkemuller/Documents/Quant Sandbox/fred-bronze-to-gold-pipeline/fred_local.db" npm run dev

# (a) read a local DuckDB cache file — no service needed:
MARKET_DB_URL=$PWD/data/market.duckdb npm run dev      # (npm i duckdb once)

# (b) read a local exported-file cache — no driver needed:
python -m market_data_pipeline.cli export-views --out ./data/export
MARKET_DATA_DIR=$PWD/market_data_pipeline/data/export npm run dev

# (c) stream live from the FastAPI service:
python -m market_data_pipeline.cli serve --port 8000
MARKET_PIPELINE_URL=http://localhost:8000 npm run dev
```

**Vercel/Postgres live-ish setup.** The cloud path is `MARKET_DB_URL=postgres://...`.
The app's `/api/market/[view]` handler reads Postgres directly, while the Python pipeline
publishes the six compact terminal views into the `analytics_api_views` table after each
refresh. (On Vercel serverless, prefer `MARKET_PIPELINE_URL` — the `pg` driver is loaded via
runtime `require` and isn't traced into the function bundle; a `npm start` process host has no
such limit.)

1. Create a managed Postgres database (Vercel Postgres, Neon, Supabase, etc.).
2. Add `MARKET_DB_URL=postgres://...` to Vercel project env vars.
3. Add GitHub repo secrets `MARKET_DB_URL` and optional `FRED_API_KEY`.
4. Use the included `.github/workflows/market-data-refresh.yml` workflow to run
   daily after the US close. It refreshes DuckDB from Yahoo/FRED, then runs
   `publish-views` to upsert Postgres.

Manual publish flow:

```bash
python -m pip install "psycopg[binary]" yfinance
START_DATE=$(python -c "from datetime import date,timedelta; print(date.today()-timedelta(days=14))")
PYTHONPATH=$PWD python -m market_data_pipeline.cli run --start "$START_DATE"
MARKET_DB_URL=postgres://... PYTHONPATH=$PWD python -m market_data_pipeline.cli publish-views
```

The publisher creates `analytics_api_views` if it does not exist. Once populated,
`/api/market/market` should return `"source":"DB"` from Vercel. Return-bearing
views default to **total return** (`adj_close`) and also publish **price return**
variants (`?basis=price`) from raw close. The app exposes that switch on Market
Snapshot, Live Markets, Asset Quilt, and Index Returns.

**Does running locally refresh the cache from Yahoo?** Yes. `mdp run` (without
`--offline`, `MDP_ALLOW_YAHOO=1` by default) pulls **~10y of daily history per
symbol from Yahoo** — using the `yfinance` library if installed
(`pip install -e ".[yahoo]"`), otherwise the public Yahoo chart endpoint — and
**upserts it into the DuckDB**, rebuilds the analytics, and re-materializes the
`analytics_api_views` table the terminal reads. FRED macro refreshes the same
way when `FRED_API_KEY` is set. For a continuous refresh on a cadence run
`mdp schedule` (market-close · macro-daily · controlled intraday). Yahoo is
unofficial/best-effort and may rate-limit; the scheduled market jobs request only a recent
tail (`MDP_MARKET_REFRESH_LOOKBACK_DAYS`, default 14) and use the configured throttle
(`yahoo_rate_limit`, default 1 request/sec). If a pull returns nothing the
pipeline falls back to the deterministic synthetic source for that run (recorded
in `ingestion_manifest.response_status`) so the cache never ends up empty.

See `market_data_pipeline/README.md` for the full architecture, the 13-table
schema (incl. the `analytics_api_views` serving table), the endpoint list, and
`docs/example_payloads.json`.

---

## News, social & NLP (`NEWS` · `SENT`)

The **News & Signal Intelligence** and **Investor Sentiment** modules render from a
deterministic engine and upgrade to live feeds — same provenance-first contract as
the rest of the terminal.

**Headlines** — `/api/news` tries a **provider chain** and returns the first that
yields data, else SIM. Set any one key:

```bash
ALPHAVANTAGE_API_KEY=…   # Alpha Vantage NEWS_SENTIMENT (sentiment + tickers) — primary
MARKETAUX_API_KEY=…      # Marketaux /news/all (entity sentiment)
FINNHUB_API_KEY=…        # Finnhub /news
NEWSAPI_API_KEY=…        # NewsAPI.org /top-headlines
```

With a key the **headline tape, narrative monitor, attention heatmap, and header
KPIs recompute from the live tape**; the badge shows the provider name.

**Social** — `/api/social` aggregates Reddit + StockTwits into the social view
(NEWS-3) and feeds SENT:

```bash
REDDIT_USER_AGENT="your-app/1.0"   # enables Reddit (Reddit mandates a UA)
STOCKTWITS_ENABLED=1               # or STOCKTWITS_ACCESS_TOKEN=…
```

**NLP layering (sentiment).** Resolved best → fallback, each flipping the badge:
**provider-native** (Alpha Vantage / Marketaux) → **FinBERT** (the `news_nlp`
service via `NEWS_NLP_URL`) → **in-house heuristic** (a negation-aware finance
lexicon, `src/lib/server/sentimentNlp.ts`) → **SIM**.

```bash
# scaffolded Python stage — FinBERT sentiment + spaCy NER + event clustering
cd news_nlp && pip install -e ".[nlp]" && python -m spacy download en_core_web_sm
news-nlp serve --port 8088          # POST /score · GET /headlines · /health
NEWS_NLP_URL=http://localhost:8088 npm run dev   # → /api/news re-scores with FinBERT
```

The `news_nlp` package installs/imports on a lexicon fallback without the model
stack and surfaces in **DATAOPS** under the `NEWS_NLP` provider. See
`news_nlp/README.md` and `docs/PLATFORM_DATA_CONNECTIVITY.md` for the full
data-connectivity map across all 46 modules.

---

## Keyboard workflow

| Shortcut | Action |
|----------|--------|
| `⌘K` / `Ctrl+K` or `/` | Open the command line — type a mnemonic (`SLAB`, `PB`, `OPT`…) or a ticker (`NVDA`, `GME`) |
| `Alt + 1…0` | Jump straight to a module |
| `↑ ↓` then `↵` | Navigate / open command-line results |
| Column headers | Click to sort any grid |

---

## Tech stack

**This build** is a **Vite + React single-page app** over **deterministic, seeded data
generators**, so all 46 modules render with **zero configuration** — no database, no required
keys. The `/api/*` endpoints are standard Web `Request → Response` handlers in `src/app/api/**`,
served from **one shared route registry** (`src/server/registry.ts`) in every environment (see
"How `/api/*` is served"). Optional live integrations include FRED for economics (166-series
catalog), the committed/exported `macro_data_etl` FedWatch snapshot, the pluggable
FRED/Yahoo-backed `market_data_pipeline`, a news provider chain (Alpha Vantage / Marketaux /
Finnhub / NewsAPI) + Reddit/StockTwits social, and the `news_nlp` FinBERT stage — each degrading
gracefully through a **live → committed-snapshot → simulation** fallback chain (with an honest
provenance badge) when no key/service is present.

- **Vite 5 · React 18 · react-router-dom · TypeScript (strict) · Tailwind CSS** (not Next.js —
  the `src/app/**/route.ts` / `[view]` conventions are Next-style but served by our own registry)
- **Zero-dependency SVG chart library** (sparklines, line/area, bars, candlesticks + VWAP,
  treemaps, Sankey, network graphs, revenue waterfalls, correlation matrices, donuts, gauges,
  heat grids, yield curves, scatter/regression plots)
- **AG-Grid-style sortable data grids** built from scratch for density and speed
- **Optional live data:** FRED via server-side route handlers (`FRED_API_KEY`) and
  `market_data_pipeline` via `MARKET_PIPELINE_URL` for FRED/Yahoo-backed market cards
- **Provenance & freshness:** every data surface carries a `ProvenanceBadge`
  (`FRED`/`DB`/`FILE`/`SNAPSHOT`/`ETL`/`SIM`) plus a staleness marker (`AGING`/`STALE`) derived
  from the data's `asOf` date; multi-series panels aggregate to the **worst source present**
  (`worstSource`) — see `docs/LIVE_DATA_READINESS_ASSESSMENT.md` for the full audit
- **Module toggles:** `settings/modules.config.json` switches any module on/off —
  disabled modules are removed from the sidebar, command palette, and routing
  (`src/lib/moduleConfig.ts`)

**Production architecture** (what the demo simulates) — see `ARCHITECTURE.md`:
- Backend: **Python · FastAPI**, analytics in **Pandas / Polars / NumPy**
- Optimization: **OR-Tools · Gurobi · Pyomo**
- Streaming: **WebSockets · Kafka**; storage: **PostgreSQL · TimescaleDB**
- Auth: **SSO · Active Directory · RBAC**

---

## How `/api/*` is served (dev · production · Vercel)

The app is a Vite SPA, so the `/api/*` route handlers (`src/app/api/**/route.ts`) need a
runtime. All environments mount the **same registry** (`src/server/registry.ts`, built from
those handlers via `import.meta.glob`), so dev and prod resolve `/api/*` identically — there is
no second source of truth:

| Environment | How it runs | Command |
|-------------|-------------|---------|
| **Dev** | Vite plugin (`vite-plugins/dev-api.ts`) mounts the registry via `ssrLoadModule` (keeps HMR) | `npm run dev` |
| **Standalone server** (Render / Railway / Fly.io / VM / local) | `src/server/index.ts` — a Node server serving `dist/` **and** `/api/*` from one process | `npm run build && npm start` |
| **Vercel** | `api/[...path].ts` serverless function adapts the request to the registry; `vercel.json` sets `framework: vite` + the cron | merge → deploy (Framework Preset = **Vite**) |

> ⚠️ A **static-only** host (plain `vite preview`, a CDN, or a Vercel project *without* this
> `vercel.json`/`api/` function) serves the SPA but **no API** — so every module silently falls
> back to its committed snapshot/simulation. Use `npm start` or the Vercel function, not a static host.

### Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Vite dev server + live `/api/*` at `http://localhost:3000` |
| `npm run build` | Build client → `dist/` **and** the standalone server → `dist-server/` |
| `npm run build:vercel` | Client + the Vite-built handler bundle (`dist-vercel/handler.js`) the Vercel function imports |
| `npm start` | Run the standalone production server (`dist-server/index.js`) |
| `npm run export:econ-snapshot` | Capture real FRED series into `src/data/econSnapshot.json` (needs `FRED_API_KEY` + egress) |
| `npm run refresh:fred-master` | Incrementally refresh local `data/master/fred/*.json` real-data cache files (needs `FRED_API_KEY` + egress) |
| `npm run refresh:aaii-sentiment` | Refresh the AAII sentiment snapshot used by `SENT` when network access is available |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` (strict type-check doubles as the lint gate) |
| `npm run test` / `npm run test:watch` | Vitest unit tests (run once / watch mode) |
| `npx playwright test test/smoke.spec.ts` | Playwright E2E smoke suite (starts its own Vite dev server) |

### Testing & CI

- **Unit tests (Vitest)** — provenance/freshness contracts (`src/lib/provenance.test.ts`),
  hook fallback chains (`src/lib/useEcon.test.ts`, `src/lib/useMarket.test.ts`), market data
  invariants (`src/data/markets.test.ts`), charting math (`src/lib/charting/*.test.ts`), and
  badge-coverage / snapshot-staleness audits (`src/tests/`).
- **E2E smoke suite (Playwright)** — `test/smoke.spec.ts` visits all 45 routed pages and
  asserts each loads without JS errors, renders its header, and leaks no `undefined`/`NaN`
  into primary content. `playwright.config.ts` boots the Vite dev server automatically.
- **CI (`.github/workflows/ci.yml`)** — every push/PR runs type-check → lint → unit tests →
  build, then the E2E smoke job (with the Playwright report uploaded as an artifact).
  `market-data-refresh.yml` separately drives the daily Yahoo/FRED → Postgres refresh.
- The overall test plan and provenance-audit checklist live in `TESTING_HANDOFF.md`.

### Diagnostics

- **`/api/dataops/health`** — probes each provider; the `FRED` entry makes one real call and
  reports `LIVE` (reachable), `SIM` (no key in this runtime), or `ERROR` with the exact reason
  (HTTP status / network error). Fastest way to see why econ is `SIM`.
- **`/api/_ping`** (Vercel only) — a zero-dependency function that returns `{ fredKeyPresent, … }`,
  to confirm serverless functions run and the env var is bound on a deployment.

---

## Run locally

The terminal is a **Vite + React** SPA — **zero config, no database, no keys**.
All 46 modules render offline; Gold-only modules show explicit empty/error states when the database is absent. For live economics/macro data,
set `MACRO_DB_URL` to read from Gold DB (the **production data path as of 2026-07-17**).

```bash
npm install                 # first time only
npm run dev                 # → http://localhost:3000  (serves the app + live /api/*)
```

Requirements: **Node 20+** (global `fetch` + the `undici` proxy support).

Production build & serve (the standalone server runs the SPA **and** `/api/*`):

```bash
npm run build && npm start  # → http://localhost:3000
```

**Optional — live economics data via Gold DB (2026-07-17+).** Set `MACRO_DB_URL` and all economic modules
switch to use live data from the Gold layer; without it they use the committed snapshot/SIM:

```bash
# Gold DB (local SQLite — from fred-bronze-to-gold-pipeline):
MACRO_DB_URL=sqlite:./data/fred_local.db npm run dev

# Gold DB (Postgres deployment):
MACRO_DB_URL=postgres://user:pass@host/db npm run dev
```

**Legacy option — live FRED (fallback when Gold DB not configured).** Set `FRED_API_KEY` and the economics modules
switch from amber `SIM` to green `LIVE · FRED` (only when `MACRO_DB_URL` is not set):

```bash
FRED_API_KEY=your_key_here npm run dev
# free key: https://fred.stlouisfed.org/docs/api/api_key.html
```

**Behind a corporate proxy / VPN?** If the browser can reach FRED but the app
still shows `SIM` (the server terminal logs `[fred] network error …`), Node's
`fetch` is ignoring your system proxy. Point it at the proxy explicitly — every
server-side fetch (FRED, market pipeline, news) then routes through it:

```bash
FRED_PROXY_URL=http://your-proxy:port FRED_API_KEY=your_key_here npm run dev
# (standard HTTPS_PROXY / HTTP_PROXY are also honoured)
# alternate FRED endpoint/mirror: set FRED_BASE_URL=https://…
# TLS-intercepting proxy? add NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem
```

Or, instead of env vars, drop a **`.proxy` file** in the project root (gitignored)
— useful for `npm start`, where Vite's `.env` loader doesn't run:

```
# .proxy  (dotenv-style; .env is also read as a last resort)
HTTPS_PROXY=http://your-proxy:port
HTTP_PROXY=http://your-proxy:port
```

Resolution order is: proxy env vars → `.proxy` file → `.env` file → direct. The
server terminal logs which one it used (`[proxy] server fetch routed through …`).

Verify at `http://localhost:3000/api/dataops/health` — the `FRED` entry should
read `LIVE` / `FRED reachable`. With no proxy var set, fetch goes direct (no
change in behaviour).

### Optional — refresh the macro pipeline

You **do not** need this to run the terminal; the gold JSON is already committed
under `src/data/etl/`. Run the Python ETL only to regenerate the global-macro /
FedWatch data. It is fully decoupled (Node terminal ↔ Python batch job; the only
link is the JSON in `src/data/etl/`).

```bash
cd macro_data_etl
pip install -e .                                          # polars, duckdb, httpx, typer…
macro-etl run --source all                                # World Bank + BIS → gold
macro-etl fedwatch                                        # CME futures → FOMC probabilities
macro-etl export fed_probabilities --out ../src/data/etl  # write JSON the terminal reads
pytest                                                    # 22 tests, no network needed
```

Requirements: **Python 3.11+**. On a networked machine World Bank and BIS return
live data; CME blocks non-browser clients, so FedWatch falls back to a
deterministic futures curve (flagged in the page tooltip). Refresh the browser
after exporting.

## Deploy

This is a **Vite + React SPA** with Web-standard `/api/*` route handlers (not a Next.js app).
The handlers must be served by a runtime — a static-only host serves the SPA but no API, so
every module falls back to committed snapshots/simulation. Two supported paths:

- **Vercel:** the committed `vercel.json` sets `framework: vite`, builds with
  `npm run build:vercel`, and routes `/api/*` to the `api/[...path].ts` serverless function
  (which mounts the same route registry). Import the repo → Deploy. Set `MACRO_DB_URL` for live
  economics (the production data path as of 2026-07-17) and `MARKET_PIPELINE_URL` (preferred over a direct
  `MARKET_DB_URL` on serverless) for live markets; set `CRON_SECRET` to lock the daily refresh cron. 
  **Make sure the project's Framework Preset is _Vite_ (or "Other"), not Next.js.**
- **Node process host (Render / Railway / Fly.io / VM):** `npm run build` then `npm start` runs
  the standalone server in `src/server/index.ts`, serving `dist/` and `/api/*` from one process.
  Drive the daily refresh with an external scheduler hitting `/api/cron/refresh`.

**Production economics data:** Set `MACRO_DB_URL` to your Gold DB connection (the production path).
Without it, econ modules fall back to the committed snapshot (stale). **Internal-book modules** (lending, prime, collateral, cash,
…) are seeded fixtures in every environment regardless of `MACRO_DB_URL`.

---

## Project layout

```
vercel.json                  # Vercel deploy: framework vite, build:vercel, /api routing, cron
settings/
└── modules.config.json      # module on/off toggles (consumed by src/lib/moduleConfig.ts)
api/                         # Vercel-only serverless entry points
├── [...path].ts             #   catch-all → adapts the request to the shared route registry
└── _ping.ts                 #   zero-dep diagnostic (functions-run + env-present check)
src/
├── app/                     # one route per module
│   ├── (HOME, markets, securities-lending [+ /squeeze], prime-finance, collateral,
│   │    cash-optimizer, reinvestment, liquidity, sources-uses, optimization, trading-desk,
│   │    market-snapshot, market-lens, market-chart, macro-chart, news, sentiment,
│   │    polymarket, dataops, copilot, alerts)
│   ├── economics/           # ECON + curve, inflation, global-cpi, policy-rates, credit,
│   │                         #   rates, calendar, stats, eda, regime, ml, sec-finance, funding, benchmark, rate-analysis, utilization, yield-curve, rate-vol, funding-cost, motion
│   └── api/                 # Web Request→Response handlers (served by the registry, see below)
│       ├── econ/            # series, batch, indicators, curve, curve-history, calendar, stats, inversions
│       ├── market/[view]/   # committed snapshot or live DB/file/FastAPI market-data view
│       ├── chart/series/    # unified econ/market chart resolver
│       ├── dataops/health/  # live provider probe (FRED reachability, market, news_nlp)
│       ├── news/ · social/  # provider-chain headlines · Reddit + StockTwits aggregate
│       ├── polymarket/      # markets · events · history (live Gamma API → SIM)
│       ├── copilot/ · market-lens/   # Claude Q&A · Market Lens proxy
│       └── cron/refresh/    # daily cache warmer (cron target)
├── server/                  # the API runtime, shared by dev + standalone + Vercel
│   ├── registry.ts          #   single route registry (import.meta.glob over app/api/**)
│   ├── index.ts             #   standalone Node server (serves dist/ + /api/*) → `npm start`
│   ├── handler.ts           #   Vite-built bundle the Vercel function imports
│   ├── nodeAdapter.ts       #   Node ⇄ Web Request/Response helpers
│   ├── routeMatch.ts        #   file-system route → matcher
│   └── exportEconSnapshot.ts#   `npm run export:econ-snapshot` → econSnapshot.json
├── components/
│   ├── shell/               # command bar, sidebar, status bar, ticker, command palette
│   ├── ui/                  # Panel, Stat, Tag, DataGrid, PageHeader, ProvenanceBadge (+ staleness)
│   ├── econ/               # SourceBadge (FRED/SNAPSHOT/SIM provenance)
│   └── charts/              # SVG chart library (Sparkline, LineChart, CandleChart, Treemap,
│                            #   Sankey, NetworkGraph, Waterfall, Matrix, Radial, YieldCurve, ScatterPlot)
├── data/                    # deterministic domain generators + committed snapshots
│                            #   (markets, securitiesLending, primeFinance, collateral, cash, …,
│                            #   econSeries [166-series FRED catalog], benchmarkRates, yieldCurveAnalytics, rateVolatility, fundingCost, utilizationAnalytics, masterJson, econSnapshot.json, etl/, market/)
├── lib/                     # rng, format, hooks, nav, moduleConfig, provenance (badge +
│                            #   freshness + worstSource), useEcon, useMarket, useNews,
│                            #   useSocial, usePolymarket, charting/, server/fred.ts,
│                            #   server/fetchProxy.ts (proxy support), server/polymarket.ts,
│                            #   server/newsProviders.ts, server/socialProviders.ts, server/sentimentNlp.ts
└── tests/                   # badge-coverage + snapshot-staleness provenance audits

test/smoke.spec.ts           # Playwright E2E smoke suite (45 pages) — playwright.config.ts
.github/workflows/ci.yml     # CI: typecheck → lint → unit tests → build → E2E smoke
screenshots/                 # 30 full-resolution module captures
news_nlp/                    # Python FinBERT NLP stage (sentiment · NER · event clustering)
TESTING_HANDOFF.md           # test-suite plan + data-provenance audit checklist
docs/LIVE_DATA_READINESS_ASSESSMENT.md   # live-vs-snapshot-vs-sim audit, pre-MVOL baseline plus updates
```

---

*Quant Intelligence Platform — Market intelligence · Macro analytics · Securities finance ·
Treasury analytics · AI decision support, in a single Bloomberg-style operating system.*
