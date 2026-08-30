# Spec003 MVOL Implementation Handoff

## Status

Updated: 2026-08-30

Branch: `MVOL-Implementation`

Spec: `docs/specs/spec003/SPEC.md`

Purpose: implement the first version of the proposed `MVOL` Market Volatility
module, starting with a reserve-balances-versus-VIX claim audit.

## Non-Negotiables

- Market Terminal must read only from the existing FRED/Gold DB economic
  pipeline for this experiment.
- Do not call live FRED, CBOE, Yahoo, a scraped endpoint, or any new external
  vendor from Market Terminal.
- Use `src/lib/server/goldStore.ts` for DB access.
- Return explicit `ERR` or unavailable states when Gold DB data or approved
  release timing is unavailable.
- Do not silently fall back to SIM data.
- Include source citations in any UI/API/export-facing payload.

## Approved Input Series

- `WRESBAL`: reserve balances, weekly ending Wednesday, millions of U.S.
  dollars, not seasonally adjusted.
- `VIXCLS`: CBOE Volatility Index, daily close, index value, not seasonally
  adjusted.

Approved Gold table for version one:

- Gold `fred_latest_observation`
- Required columns: `series_id`, `observation_date`, `value`, optional
  `realtime_start`

## Version-One Scope

Build the calculation and route layer before UI:

1. Pure reserve/VIX calculation helper. Complete in
   `src/lib/marketVolatility.ts`.
2. Synthetic unit tests for all alignment and event-counting semantics.
   Complete in `src/lib/marketVolatility.test.ts`.
3. Gold DB route at `/api/market-volatility/reserve-vix`. Complete in
   `src/app/api/market-volatility/reserve-vix/route.ts`.
4. Route tests for Gold-only behavior, missing data, citations, and
   Tradability Mode unavailable state.
   Complete in `src/app/api/market-volatility/reserve-vix/route.test.ts`.
5. Static UI after the route is stable. Complete in
   `src/app/market-volatility/page.tsx`, with the fetch hook in
   `src/lib/useMarketVolatility.ts`. The page plots both the `VIXCLS` level
   series and the derived forward VIX outcomes.
6. Animated playback after the static UI and math are verified. Next priority
   after review of the first module surface.

## Proposed Files

Implemented first files:

- `src/lib/marketVolatility.ts`
- `src/lib/marketVolatility.test.ts`
- `src/app/api/market-volatility/reserve-vix/route.ts`
- `src/app/api/market-volatility/reserve-vix/route.test.ts`
- `src/lib/useMarketVolatility.ts`
- `src/app/market-volatility/page.tsx`

The module is enabled as `MVOL` in `settings/modules.config.json`, registered in
`src/lib/nav.ts`, and routed from `src/App.tsx` at `/market-volatility`.

## Calculation Defaults

- Default date range: `2009-01-01` through latest complete endpoint.
- Default mode: `research`.
- Default signal: `above_mean`.
- Default forward window: `7` calendar days.
- Default claim threshold: `71`.
- Primary outcome: VIX point change.
- Secondary outcome: VIX percent change.
- Hit-rate confidence interval: Wilson score interval.
- History type: current revised Gold DB history, clearly labeled.

## Alignment Modes

### Research Mode

- Anchor: `WRESBAL` weekly observation date, week ending Wednesday.
- VIX start: `VIXCLS` close on anchor date if available, otherwise first
  available close after anchor.
- Forward endpoint: first available VIX close on or after `anchor + 7 calendar
  days` or `anchor + 14 calendar days`.
- Use for public-data reconstruction and charts.
- Do not describe this mode as real-time tradable.

### Tradability Mode

- Anchor: first actionable market close after the reserve balance data is
  publicly available.
- VIX start: first available `VIXCLS` close after the actionable anchor.
- Forward endpoint: first available VIX close on or after `anchor + 7 calendar
  days` or `anchor + 14 calendar days`.
- Use for any trading-system framing.
- If approved Gold release timing is not available, return unavailable. Do not
  guess release timing and do not add a new source.

## Event Counting

- Above-mean study: include all eligible weekly observations where
  `reserveValue > trailing12WeekMean`.
- Cross-above study: include false-to-true reserve/mean transitions only.
- Cross-above study should use non-overlapping event windows for event-level
  hit-rate comparisons and claim-threshold checks.
- All API/UI output should label whether it is showing all-week above-mean
  statistics or cross-above event-study statistics.

## Helper Contract

Implement a pure helper similar to:

```ts
computeReserveVixExperiment({
  reserves,
  vix,
  startDate,
  endDate,
  alignmentMode,
  signalMode,
  forwardDays,
  claimThresholdPct,
})
```

Important semantics:

- The trailing 12-week reserve mean uses the 12 completed reserve observations
  before the anchor row. It does not include the current row.
- Drop rows without enough trailing history.
- Drop rows without valid VIX start or endpoint values from denominator counts.
- Count dropped rows in diagnostics.
- `vixFell` means `vixPointChange < 0`.
- Correlation is Pearson correlation between weekly reserve percent change and
  forward VIX point change, using only finite pairs.

## API Contract

Route:

```text
GET /api/market-volatility/reserve-vix
```

Parameters:

- `mode=research|tradability`
- `signal=above_mean|cross_above`
- `forwardDays=7|14`
- `start=YYYY-MM-DD`
- `end=YYYY-MM-DD`
- `claimThresholdPct=number`

Response must include:

- `source: "DB" | "ERR"`
- input series metadata and latest dates
- aggregate stats: unconditional rate, conditional rate, lift, sample size,
  Wilson confidence interval, mean/median VIX point change, mean/median VIX
  percent change, reserve/VIX correlation, claim threshold delta
- compact `series.vix` level history for the actual `VIXCLS` chart
- compact row-level data for charting
- diagnostics: dropped rows, missing VIX start, missing VIX endpoint,
  insufficient trailing mean, warnings
- citations for `WRESBAL`, `VIXCLS`, FRED, and CBOE-sourced VIX caveat

## Tests To Write First

Unit tests:

- trailing mean excludes current reserve row
- above-mean includes all eligible above-mean observations
- cross-above only captures false-to-true transitions
- cross-above non-overlap suppresses overlapping forward windows
- `+7` and `+14` calendar-day endpoints choose first available VIX close on or
  after target date
- missing VIX start or endpoint rows are dropped and counted
- Wilson interval works on small samples
- Pearson correlation ignores non-finite pairs

Route tests:

- `MACRO_DB_URL` unavailable returns `ERR`, no SIM fallback
- missing `WRESBAL` returns explicit error
- missing `VIXCLS` returns explicit error
- successful Gold rows return citations, stats, diagnostics, and row data
- Tradability Mode without approved release timing returns unavailable

## Validation Commands

Latest validation on 2026-08-30 after the static UI wiring:

```bash
npm test -- src/lib/marketVolatility.test.ts src/app/api/market-volatility/reserve-vix/route.test.ts src/lib/nav.test.ts
npm run check:gold-policy
npm run build:client
npm run build:server
git diff --check
```

Result: passed. The route also returned real Gold DB data locally for
`mode=research&signal=above_mean&forwardDays=7&start=2009-01-01`. Client build
retained the existing large-chunk warning; server build retained existing eval
warnings in chart template/market manifest files.

After helper implementation:

```bash
npm test -- src/lib/marketVolatility.test.ts
git diff --check
```

After route implementation:

```bash
npm test -- src/lib/marketVolatility.test.ts src/app/api/market-volatility/reserve-vix/route.test.ts
npm run check:gold-policy
npm run build:client
npm run build:server
git diff --check
```

Full `npm run typecheck` currently has known Gold hardening backlog failures
outside this workstream. Do not add new typecheck failures.

## Roadmap After Version One

- Review the first static module surface and refine chart layout/labels,
  especially the distinction between the actual `VIXCLS` level chart and the
  derived forward-outcome bars.
- Add point-in-time/vintage-aware reserve history when the upstream FRED/Gold
  pipeline exposes it.
- Add richer uncertainty bands after Wilson intervals are in place.
- Add citation-safe video export after UI and licensing/citation treatment are
  reviewed.
- Add saved claim-audit presets and user-defined thresholds.
- Add additional volatility experiments only after the reserve/VIX experiment is
  validated.
