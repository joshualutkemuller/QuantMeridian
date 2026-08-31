# Spec004 Phase 0: Template-To-Data Contract

## Status

In progress. This document converts the Spec004 scaffold into the first build
contract for `MPUB`. It is intentionally strict: a template is ready only when
its displayed numbers can be resolved from the approved FRED/Economic Gold
SQLite pipeline through `MACRO_DB_URL`.

## Source Boundary

- Approved numerical source: FRED/Economic Gold SQLite via `MACRO_DB_URL`.
- Approved route pattern: server route reads through `goldStore`.
- Approved base tables for the first slice:
  - `gold_fred_latest_observation`
  - `gold_release_calendar`
- Prohibited for `MPUB` phase one:
  - `src/data/market/*.json`
  - legacy market-pipeline snapshots
  - generated, sample, synthetic, or seeded fixture values
  - direct browser/API fetches to a new provider
  - old module output unless it exposes the same DB-only, no-fallback contract

Missing data must appear as an unavailable state with a reason. It must not be
filled from old snapshots or calculated from synthetic placeholders.

## Initial API Slice

The first implementation slice adds read-only route handlers:

- `GET /api/market-publishing/daily`
- `GET /api/market-publishing/candidates`

Both routes compose from `readCommandCenterPayload()`, which reads only the Gold
observation and release-calendar tables. The candidate route emits ready
candidate cards where Gold-backed observations exist and explicit unavailable
cards for gated areas such as earnings/valuation.

## Template Coverage Matrix

| # | Template | Phase 1 status | Gold tables | Required series / fields | Output basis | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Daily market scoreboard | Ready for API seed | `gold_fred_latest_observation` | `SP500`, `NASDAQCOM`, `DJIA`, plus optional `DTWEXBGS`, `GOLDPMGBD228NLBM`, `DCOILWTICO` | Latest index/price level, level delta, linked returns | Uses the Command Center market-return basis: 1D, 5D, MTD, 1M, 3M, QTD, YTD, 1Y/3Y/5Y annualized on 252 trading days. |
| 2 | Leaders and laggards derby | Ready for API seed | `gold_fred_latest_observation` | At least two market series with linked returns | Ranked linked returns | Initial detector ranks 1D returns. Later phases can add 5D, MTD, and YTD derby modes. |
| 3 | Index return table | Partial | `gold_fred_latest_observation` | Same market series as scoreboard | Linked returns across selected horizons | API seed has the calculations through Command Center, but a dedicated table/card layout is not built yet. |
| 4 | Drawdown / record proximity | Gap | `gold_fred_latest_observation` | Daily price/index histories for market series | Percent below trailing/all-time high | Needs a detector and display transform. No new data source required. |
| 5 | Treasury curve chart | Ready for API seed | `gold_fred_latest_observation` | `DGS2`, `DGS10`, `DGS30`, `T10Y2Y`, optional `DFII10`, `T10YIE` | Yield level and spread basis points | Initial detector uses 10Y and 10Y-2Y. Full curve chart can add maturity points. |
| 6 | Rates dashboard | Partial | `gold_fred_latest_observation` | `SOFR`, `EFFR`, `DGS2`, `DGS10`, `DGS30`, `DFII10`, `T10YIE` | Latest level and one-observation change | Command Center carries the inputs. Needs an MPUB-specific chart template. |
| 7 | VIX regime / volatility state | Ready for API seed | `gold_fred_latest_observation` | `VIXCLS`, optional `NFCI`, `STLFSI4` | Latest VIX level, point change, regime buckets | Initial detector combines VIX with stress/credit context. Full regime buckets can reuse MVOL logic. |
| 8 | Credit-spread risk gauge | Ready for API seed | `gold_fred_latest_observation` | `BAMLH0A0HYM2`, `BAMLC0A0CM` | OAS basis points | Initial detector combines HY/IG with VIX. Percentile gauge is a follow-up transform. |
| 9 | Inflation momentum | Partial | `gold_fred_latest_observation` | `PCEPILFE`, CPI headline/core/component series where cataloged | Index value, MoM %, change in MoM %, YoY %, change in YoY % | Data exists in other inflation routes, but MPUB needs a direct Gold-only candidate detector and template. |
| 10 | Labor and growth snapshot | Partial | `gold_fred_latest_observation` | `GDPNOW`, `GDPC1`, `UNRATE`, `PAYEMS`, `ICSA`, optional `RSAFS`, `INDPRO` | Levels and correct transformed changes by frequency | Command Center computes many inputs. MPUB needs a candidate detector that respects monthly/quarterly as-of dates. |
| 11 | Liquidity / reserves / funding | Partial | `gold_fred_latest_observation` | `WRESBAL`, `SOFR`, `EFFR`, optional funding gaps in catalog | Latest level and spread/change transforms | Inputs are present where Gold rows exist. Needs MPUB template and stale-state handling. |
| 12 | Economic week ahead | Ready for API seed | `gold_release_calendar` | `release_id`, `release_name`, `release_date`, `importance`, `econ_category`, `representative_series_id`, `fetched_at` | Calendar date and catalyst grouping | Initial detector uses upcoming HIGH/MEDIUM rows. Actual/prior/consensus values are not assumed. |
| 13 | Claim audit | Ready for API seed through MVOL inputs | `gold_fred_latest_observation` | `WRESBAL`, `VIXCLS`, `SP500` | MVOL reserve-above-mean experiment, +7D/+14D outcomes | Candidate route verifies inputs only; full stats remain in `/api/market-volatility/reserve-vix`. |
| 14 | Historical analog | Gap | `gold_fred_latest_observation` | Template-specific series history | Explicit sample, non-causal caveat | Needs design and statistical guardrails before build. No new source required for simple Gold-series analogs. |
| 15 | Earnings and valuation | Blocked | None approved | No approved complete fields yet | Unavailable | Must stay disabled until Joshua approves an upstream source and Gold schema for estimates, revisions, calendar timing, and forward valuation. |

## Reusable Module Classification

| Existing module / route | Classification for MPUB | Reason |
| --- | --- | --- |
| `/api/command-center` | Approved seed | Gold-only route; no market snapshot or synthetic fallback; returns per-series as-of dates. |
| `/api/market-volatility/reserve-vix` | Approved for claim-audit stats in research mode | Gold-only route for `WRESBAL`, `VIXCLS`, and `SP500`; tradability mode correctly fails unavailable pending Gold release timing. |
| `/api/econ/calendar` | Approved for calendar facts | Gold-only `release_calendar` route; no fallback. |
| `/api/market/[view]` | Blocked for phase one | Serves legacy market views and pipeline/file paths; useful as schema inspiration only. |
| `/asset-quilt`, `/market-snapshot`, `/index-returns` | Blocked for direct reuse | Useful UI concepts, but current data path includes legacy market-pipeline/file behavior. |
| `/economics/inflation`, `/economics/credit`, `/economics/rates` | Partial | Contain useful domain logic and Gold rows, but MPUB should query approved Gold tables directly or through a DB-only route. |
| `/news`, `/sentiment` | Context only | May suggest topics. Numerical claims still need approved structured Gold data and their own citation. |

## Current Gaps

- MPUB does not yet have a UI route at `/market-publishing`.
- MPUB does not yet render share-ready PNG cards.
- Drawdown, percentile, inflation-momentum, labor/growth, and historical-analog
  detectors still need dedicated Gold-only transforms.
- Post-release notes need a release-specific Gold value contract for actual,
  prior, revised prior, and consensus/expectation fields where available.
- Earnings/valuation remains intentionally blocked.

## Tests

Initial executable guardrail:

- `src/app/api/market-publishing/candidates/route.test.ts`

The test proves:

- MPUB daily/candidate routes compose from Gold-backed Command Center data.
- missing Gold config fails closed with `ERR`.
- ready candidates carry `source: "DB"` and citations.
- earnings/valuation is explicit `unavailable`.
- route SQL touches Gold observation/calendar tables and does not reference
  `bilello`, `snapshot`, or `src/data/market`.
