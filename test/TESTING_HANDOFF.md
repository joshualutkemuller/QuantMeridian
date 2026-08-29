# Testing Handoff: Comprehensive Test Suite Plan

## Overview

This document defines a full test suite covering smoke tests, unit tests, integration tests, and data-provenance audits for the Market Terminal. The primary goal beyond correctness is ensuring **no simulated data is silently displayed when the user believes they're seeing real data**.

---

## 1. Existing Test Infrastructure

**Runner:** Vitest (node environment)
**Config:** `vitest.config.ts`
**Run:** `npx vitest run`

### Existing Tests (23 tests across 4 files)

| File | Tests | Covers |
|------|-------|--------|
| `src/lib/provenance.test.ts` | 5 | Freshness classification (FRESH/AGING/STALE) |
| `src/lib/charting/studies.test.ts` | 5 | Spread, ratio, correlation, beta, percentile |
| `src/lib/charting/indicators.test.ts` | 7 | SMA, EMA, Bollinger, RSI, MACD, gaps, OHLC |
| `src/lib/charting/transforms.test.ts` | 6 | pctChange, log, vsLag, index100, zscore |

### What's Missing

- No API route tests
- No hook fallback-chain tests
- No component rendering tests
- No E2E / smoke tests
- No data-provenance contract tests

---

## 2. Data Provenance Architecture

### Source Tiers (defined in `src/lib/provenance.ts`)

| Source | Live? | Meaning |
|--------|-------|---------|
| `FRED` | Yes | Live Federal Reserve API |
| `LIVE` | Yes | Live market_data_pipeline FastAPI |
| `DB` | Yes | Local DuckDB/Postgres cache |
| `FILE` | Yes | Exported JSON file cache |
| `ETL` | Yes | macro_data_etl gold tables |
| `SNAPSHOT` | No | Committed build-time JSON |
| `ECON` | No | Deterministic econ model |
| `SIM` | No | Deterministic synthetic data |
| `LOADING` | - | Request in flight |
| `ERR` | - | Resolution failed |

### Fallback Chains

**Market data** (`src/lib/useMarket.ts` + `src/app/api/market/[view]/route.ts`):
```
LIVE (FastAPI) → DB (DuckDB/Postgres) → FILE (exported JSON) → SNAPSHOT (committed)
```

**Econ data** (`src/lib/useEcon.ts` + `src/app/api/econ/series/route.ts`):
```
FRED (live API) → SNAPSHOT (committed observations) → ETL (World Bank/BIS) → SIM (synthetic)
```

### Silent SIM Risk Points

These are the specific locations where SIM data can appear without clear user indication:

1. **`useMarketView` initial render** (`useMarket.ts:21`): Always renders SNAPSHOT synchronously before API resolves. If the API fails silently, user sees SNAPSHOT data with no error indication.

2. **`useLiveIndicators` fallback** (`useEcon.ts:155-162`): Returns `{}` on failure. Pages that merge live + SIM data (`effective()` in `economics/page.tsx:94-107`) fall back to SIM values per-indicator without flagging which ones are SIM.

3. **Per-indicator mixed sources** (`api/econ/indicators/route.ts:93-134`): Each of the ~40 indicators independently resolves FRED → SNAPSHOT → SIM. The page shows a single overall source badge, but individual rows may silently be SIM while others are FRED.

4. **`mergeSnapshotIndices` / `mergeLiveIndices`** (`data/markets.ts`): Command center indices merge live FRED data with snapshot data. Some indices may be live while others are snapshot/SIM, but only one badge is shown.

---

## 3. Proposed Test Suite

### 3A. Unit Tests — Data Provenance (`src/lib/provenance.test.ts`) — COMPLETED

12 tests implemented covering PROVENANCE_META coverage, live source classification,
provenanceMeta fallback for unknown codes, PROVENANCE_TONE_CLASS coverage,
future dates, empty strings, ISO timestamps, and custom thresholds.

### 3B. Unit Tests — Market Hook Source Resolution (`src/lib/useMarket.test.ts`) — COMPLETED

12 tests covering snapshot view availability, price vs total snapshots,
fallback behavior for views without price data, and source mapping contract
(LIVE/DB/FILE map correctly; unknown/undefined/null/garbage → SNAPSHOT; SIM not
in market vocabulary).

### 3C. Unit Tests — Econ Hook Source Resolution (`src/lib/useEcon.test.ts`) — COMPLETED

14 tests covering mapSource classification (FRED, SNAPSHOT, ETL, SIM, undefined,
null, unknown strings, Finnhub), isRealEconSource predicate, snapshot seeding
(DGS10, CPIAUCSL presence, non-existent series returns null, sort order).

### 3D. Unit Tests — API Route Source Resolution (`src/app/api/econ/indicators/route.test.ts`) — COMPLETED

14 tests covering pct() and ppDelta() math helpers, MoM derivation from raw
levels, YoY derivation with sufficient/insufficient history, FRED_CATALOG
contract (required fields, uniqueness, frequency codes), per-indicator source
independence, and overall source tier resolution logic.

### 3E. Unit Tests — Asset Quilt Returns (`src/app/asset-quilt/page.test.ts`)

```
TEST: quiltFromBilello returns full-year annual returns when no asof
  - SPY 2020 total_return matches snapshot value

TEST: quiltFromBilello filters years by asof
  - asof="2020-12-31" → only years 2016-2020

TEST: quiltFromBilello uses daily prices for intra-month dates
  - asof="2020-03-15" → 2020 SPY return differs from asof="2020-03-31"

TEST: quiltFromBilello falls back to monthly when no daily prices
  - Remove asset_daily_prices → uses asset_monthly_returns
  - asof="2020-06-30" compounds months 1-6

TEST: quiltFromBilello falls back to annual when no monthly/daily
  - Remove both → uses full-year total_return for all years

TEST: Daily price return calculation accuracy
  - returnFromDaily computes (end/base - 1) correctly
  - Handles missing prior-year-end price gracefully (returns null)
  - Handles series with no data in the target year (returns null)

TEST: Rankings re-sort correctly for partial years
  - Full year 2020 leader differs from Q1 2020 leader
```

### 3F. Unit Tests — Heatmap Horizon Returns (`src/data/markets.test.ts`)

```
TEST: horizonReturn extracts correct field per horizon
  - 1D → ret_1d, 1W → ret_5d, MTD → mtd, YTD → ytd
  - 1Y → ret_1y, 3Y → cagr_3y, 5Y → cagr_5y

TEST: isAnnualized returns true only for 3Y and 5Y

TEST: horizonDateRange formats correctly
  - 1D with asOf "2026-06-23" → "2026-06-20 → 2026-06-23"
  - YTD → "2025-12-31 → 2026-06-23"

TEST: heatmapFromCards uses ETF_SECTOR mapping
  - SPY → "Broad Mkt", XLK → "Technology"

TEST: heatmapFromCards uses ETF_WEIGHT for sizing
  - SPY weight > XLB weight

TEST: moversFromCards sorts gainers desc, losers asc
```

### 3G. Integration Tests — API Routes (`src/app/api/**/*.test.ts`)

```
TEST: GET /api/market/market returns valid response shape
  - Response has { data, source } keys
  - source is one of LIVE/DB/FILE/SNAPSHOT
  - data.cards is an array of SnapshotCard-shaped objects

TEST: GET /api/econ/series?id=DGS10 returns valid response
  - Response has { source, observations } keys
  - observations are { date, value } objects sorted ascending
  - Values are finite numbers

TEST: GET /api/econ/indicators returns all catalog indicators
  - Response has { source, indicators } keys
  - indicators.length === FRED_CATALOG.length
  - Every indicator has: id, value, prior, change, changePct, asOf, history, source

TEST: GET /api/econ/indicators source field is per-indicator
  - Each indicator.source is one of FRED/SNAPSHOT/SIM

TEST: Fallback to SNAPSHOT when API is unavailable
  - With no MARKET_PIPELINE_URL set, market routes return SNAPSHOT source
  - With no FRED_API_KEY set, econ routes return SNAPSHOT or SIM source
```

---

## 4. Smoke Tests (E2E via Playwright) — COMPLETED

**Implementation:** `test/smoke.spec.ts` + `playwright.config.ts`
**Run:** `npx playwright test test/smoke.spec.ts`

### 4A. Page Load Smoke Tests — COMPLETED

93 tests across 44 pages covering:
- Page load without JS errors (44 pages, with known fault allowance for `/economics/curve`)
- Every page renders content (body length > 50 chars)
- ResizeObserver and fetch errors filtered as non-critical

### 4B. Provenance Badge Smoke Tests — COMPLETED

44 tests verifying every page displays a data source indicator by checking for
ProvenanceBadge tooltip titles or source text (SIM/SNAPSHOT/FRED/LIVE/ETL/ECON)
in the rendered body.

### 4C. No Undefined/NaN Tests — COMPLETED

5 critical page tests (/, /markets, /market-snapshot, /economics, /trading-desk)
verifying no "undefined" or "NaN" appears in primary rendered content.

---

## 5. Data Transparency Audit Tests

These tests specifically catch silent SIM data. They should run as part of CI.

### 5A. Badge Coverage Contract (`src/tests/badge-coverage.test.ts`)

```
TEST: Every page.tsx file imports ProvenanceBadge or SourceBadge or DataSourceStrip
  - Glob all src/app/**/page.tsx files
  - For each, check that the file either:
    a) imports ProvenanceBadge, SourceBadge, or DataSourceStrip, OR
    b) is listed in BADGE_EXEMPT_PAGES (pages that render badges via child components)
  - Fail on any unlisted page without a badge import

BADGE_EXEMPT_PAGES = [
  "macro-chart/page.tsx",     // badge rendered inside ChartStudio
  "market-chart/page.tsx",    // badge rendered inside ChartStudio
  "economics/motion/page.tsx", // badge rendered inside MotionStudio
  "market-lens/page.tsx",     // badge rendered inside lens components
]
```

### 5B. Source Propagation Contract (`src/tests/source-propagation.test.ts`)

```
TEST: useMarketView never returns "SIM" as source
  - The market hook only returns LIVE/DB/FILE/SNAPSHOT/LOADING
  - SIM is not in the market source vocabulary
  - (Market data is never simulated — it's snapshot or live)

TEST: useEconResource maps unknown sources to "SIM" not "SNAPSHOT"
  - If the API returns an unrecognized source string, it should map to SIM
  - This prevents unknown sources being silently labeled as SNAPSHOT

TEST: Overall source badge reflects worst-tier source in the mix
  - If 39 indicators are FRED and 1 is SIM, overall source should NOT be "FRED"
  - (Current behavior: overall IS "FRED" if any are — document this as known)
```

### 5C. Snapshot Staleness Contract (`src/tests/snapshot-staleness.test.ts`)

```
TEST: Committed market snapshots have asof dates
  - bilello.json has non-null asof field
  - market_snapshot.json cards have asof fields
  - index_returns.json has non-null asof

TEST: Committed econ snapshot has generatedAt
  - econSnapshot.json has non-null generatedAt
  - Each series entry has asOf date

TEST: Freshness badge triggers on stale data
  - classifyFreshness with date 30 days ago → "STALE"
  - ProvenanceBadge renders "STALE · 30d" text
```

### 5D. Mixed-Source Transparency (`src/tests/mixed-source.test.ts`)

```
TEST: Command center shows correct combined source
  - When FRED indices are live but market cards are SNAPSHOT:
    → Badge should show "FRED" (highest live tier present)
  - When no live data available:
    → Badge should show "SNAPSHOT" or "SIM"

TEST: Economics dashboard per-row source visibility
  - Each indicator row should have accessible source metadata
  - (Currently source is per-indicator in the API response but not shown per-row)
  - Recommendation: add per-row source dot or tooltip

TEST: Asset quilt shows source accurately with partial-year data
  - When using daily prices for partial year, source reflects the snapshot tier
  - When falling back to annual returns, source is still accurate
```

---

## 6. Pages Currently Missing Provenance Badges — COMPLETED

All pages now have provenance badges. Audit results:

| Page | Path | Status | Notes |
|------|------|--------|-------|
| DataOps | `/dataops` | **ADDED** | ProvenanceBadge showing LIVE/SIM based on health probe |
| Market Lens | `/market-lens` | **ADDED** | Replaced custom Tag with standard ProvenanceBadge |
| Statistics | `/economics/stats` | Already had badge | SourceBadge via useLiveSeriesSet |
| Credit Spreads | `/economics/credit` | Already had badge | SourceBadge with regime tag |
| Inflation Explorer | `/economics/inflation` | Already had badge | SourceBadge via useLiveSeriesSet |
| Global CPI | `/economics/global-cpi` | Already had badge | SourceBadge with country count |
| Global Policy | `/economics/policy-rates` | Already had badge | SourceBadge with ChartLink |
| Rate Probabilities | `/economics/rates` | Already had badge | SourceBadge via fedSource |
| Economic Calendar | `/economics/calendar` | Already had badge | SourceBadge via useEconCalendar |
| Sec-Finance Econ | `/economics/sec-finance` | Already had badge | SourceBadge via useLiveSeriesSet |
| Yield Curve | `/economics/yield-curve` | Already had badge | ProvenanceBadge via badgeSource |
| Squeeze Radar | `/securities-lending/squeeze` | Already had badge | ProvenanceBadge hardcoded SIM |

**Badge-exempt pages** (badges render inside child components):
- `/macro-chart` — badge rendered inside ChartStudio
- `/market-chart` — badge rendered inside ChartStudio
- `/economics/motion` — badge rendered inside MotionStudio

---

## 7. CI Pipeline — IMPLEMENTED

**Config:** `.github/workflows/ci.yml`

### `verify` job (runs on every push/PR)
| Step | Command | Covers |
|------|---------|--------|
| Type-check | `npx tsc --noEmit` | TypeScript compilation |
| Lint | `npm run lint` | Code style |
| Unit tests | `npm test` (`vitest run`) | All unit tests including badge-coverage, snapshot-staleness, provenance, source resolution, charting |
| Build | `npm run build` | Production build |

### `e2e` job (runs after verify passes)
| Step | Command | Covers |
|------|---------|--------|
| Install Playwright | `npx playwright install --with-deps chromium` | Browser setup |
| Smoke tests | `npx playwright test test/smoke.spec.ts` | 93 E2E tests: page loads, badge visibility, no undefined/NaN |
| Upload artifacts | `actions/upload-artifact@v4` | Playwright report (7-day retention) |

### Test inventory covered by CI
- **Unit tests (vitest)**: provenance (19), useMarket (12), useEcon (14), indicators route (19), charting indicators (7), charting studies (5), charting transforms (6), badge-coverage (1), snapshot-staleness (varies)
- **E2E tests (Playwright)**: 44 page load smoke tests, 44 provenance badge visibility tests, 5 no-undefined/NaN tests

---

## 8. Key Risk: Silent SIM Data — MITIGATED

### How It Happened (Before Fix)

1. **Per-indicator fallback**: The `/api/econ/indicators` route resolved each of ~40 indicators independently. If FRED was down for one series, that one silently fell back to SIM while others showed FRED. The page-level badge said "FRED" because at least one indicator resolved from FRED.

2. **Mixed market sources**: The command center merged FRED index data with pipeline snapshot data. The badge showed "FRED" even if the pipeline cards were stale snapshots.

3. **Initial render flash**: `useMarketView` renders committed SNAPSHOT data synchronously, then tries the API. If the API is slow or fails, the user sees SNAPSHOT data that may be days/weeks old.

### Mitigations Implemented

1. **Per-row source indicators** — ALREADY EXISTED: Each indicator row in the Macro Dashboard shows a colored dot (green=FRED, violet=SNAPSHOT, amber=SIM) with a tooltip at `economics/page.tsx:306-308`. Column header "Src" at line 264.

2. **Worst-source badge** — IMPLEMENTED: Added `worstSource()` utility to `src/lib/provenance.ts` that returns the lowest-tier source from an array (tier order: FRED > LIVE > POLY > DB > FILE > ETL > SNAPSHOT > ECON > SIM). Updated all API routes and pages to use worst-source logic:
   - `src/app/api/econ/indicators/route.ts` — overall source now reflects worst indicator
   - `src/app/api/econ/batch/route.ts` — batch endpoint uses worstSource
   - `src/app/api/econ/benchmark/route.ts` — benchmark endpoint uses worstSource
   - `src/app/page.tsx` — Command Center badge reflects worst source across FRED indices + pipeline cards
   - `src/app/economics/global-cpi/page.tsx` — Global CPI badge uses worstSource
   - `src/app/economics/policy-rates/page.tsx` — Policy Rates badge uses worstSource

3. **Staleness alerts** — ALREADY EXISTED: `StalenessBar` component (`src/components/ui/StalenessBar.tsx`) renders a red warning banner when data is >7 days stale. Already integrated into Command Center, Markets, Economics, and Asset Quilt pages.

4. **Loading skeleton**: Not yet implemented (deferred — lower priority). The `LOADING` state currently shows SNAPSHOT data during initial render.

### Test Coverage

- `src/lib/provenance.test.ts`: 7 new tests for `worstSource()` covering mixed arrays, single-element, empty array, unknown strings, and full tier ordering.
- `src/app/api/econ/indicators/route.test.ts`: 5 tests updated to verify worst-source logic instead of best-source.
