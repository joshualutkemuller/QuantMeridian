# Spec003: Market Volatility Module

## Status

Implementation started. Version-one data, alignment, calculation semantics,
Gold DB route, tests, and the first static module UI are implemented. Animated
playback and release-timing work remain future slices.

Implementation handoff: `docs/specs/spec003/HANDOFF.md`.

## Owner

Market Terminal / market volatility research

## Proposed Module

- Code: `MVOL`
- Name: Market Volatility
- Group: Markets or Intelligence, to be decided
- Purpose: A cross-asset volatility research and visualization module focused on
  claim testing, volatility regimes, and transparent public-data experiments.

This is separate from the existing `RVOL` module, which is focused on rate
volatility under Economics. `MVOL` should be broader: equity volatility, VIX
event studies, volatility regime diagnostics, and claim-audit visuals.

## Initial Use Case

Recreate and visualize a public-data experiment around Federal Reserve reserve
balances and subsequent VIX moves.

The motivating claim to audit:

- Weekly reserve balances above their trailing 12-week mean are advertised as a
  signal for a statistically predictable VIX decline window.
- The module should reconstruct the signal using public data, show base rates,
  and make clear whether the conditional result is meaningfully different from
  ordinary VIX mean reversion.

The requested conclusion to support visually:

- VIX falls about 52-56% of weeks unconditionally.
- Weeks with reserves above the 12-week mean show only faint lift, around 59%
  next-week VIX decline frequency in the described reconstruction.
- First week after a true cross above the mean is around 60% with about 80
  observations, not near 71%.
- Weekly reserve percentage change has very low correlation with next-week VIX
  change, around -0.06 in the described reconstruction.
- The experiment should frame the claim as weak directional association, not a
  standalone 6-11 day trading system.

The attached screen recording is visual inspiration only. It is not a source of
implementation instructions.

## Data Policy

Use only existing approved Market Terminal data paths unless explicitly approved
by the owner.

For the initial experiment, the confirmed source series are FRED series already
flowing through the FRED / Gold DB economic pipeline:

- Reserve balances: FRED `WRESBAL`, "Reserve Balances with Federal Reserve
  Banks: Week Average", or the Gold DB equivalent series. Cite as Board of
  Governors of the Federal Reserve System (US), `WRESBAL`, retrieved from FRED,
  Federal Reserve Bank of St. Louis: https://fred.stlouisfed.org/series/WRESBAL.
- VIX: FRED `VIXCLS`, "CBOE Volatility Index: VIX", or the Gold DB equivalent
  series. Cite as Chicago Board Options Exchange, `VIXCLS`, retrieved from FRED,
  Federal Reserve Bank of St. Louis: https://fred.stlouisfed.org/series/VIXCLS.
- Equity outcome context: FRED `SP500`, "S&P 500", or the Gold DB equivalent
  series. Cite as S&P Dow Jones Indices LLC, `SP500`, retrieved from FRED,
  Federal Reserve Bank of St. Louis: https://fred.stlouisfed.org/series/SP500.

Market Terminal should not add a new volatility vendor, scraped dataset, or
separate external API for this module without explicit owner approval.

### Gold DB Data Contract

Version one should read only through the existing Market Terminal Gold DB access
layer in `src/lib/server/goldStore.ts`.

Required level-history inputs:

- Table: Gold `fred_latest_observation`.
- Series filter: `series_id IN ('WRESBAL', 'VIXCLS', 'SP500')`.
- Required columns: `series_id`, `observation_date`, `value`, and
  `realtime_start` when available.
- Sort order for calculations: ascending by `observation_date`.
- Minimum default date range: 2009-01-01 through latest complete endpoint.

The implementation should use `goldStore().raw(...)` plus `goldTable(...)` and
`goldParam(...)` for the initial multi-series query. It should return an explicit
`ERR`/empty state if `MACRO_DB_URL` is not configured, the Gold DB read fails, or
either required series is missing. It should not call live FRED or any market
data vendor from the Market Terminal route.

Tradability Mode may also read an approved Gold release-calendar table or field
if it exists. If actionable release timing is not available in the approved Gold
contract, Tradability Mode should render as unavailable with an explanatory
state instead of guessing or adding a new source.

### Citation And Licensing Caveat

The experiment can be recreated from FRED-published data, but the VIX series is
CBOE-sourced and FRED displays CBOE copyright/reprint notes. Any externally
shared video, chart export, or report should include source citations and should
respect applicable FRED and CBOE usage terms. Reserve balances are sourced from
the Board of Governors H.4.1 release through FRED and should cite both the
original source and FRED.

Current local Gold/FRED DB coverage checked on 2026-08-30 is sufficient for the
requested 2009 through mid-August 2026 reconstruction:

- `WRESBAL`: 1984-01-04 through 2026-08-19.
- `VIXCLS`: 1990-01-02 through 2026-08-20.
- `SP500`: S&P 500 level history through FRED/Gold for risk-on/risk-off
  context. If unavailable in a local Gold DB snapshot, MVOL should keep the VIX
  experiment running and mark SPX outcome fields unavailable rather than adding
  a separate data source.

## Experiment Scaffold

### Input Series

- Weekly reserve balances: `WRESBAL`, weekly ending Wednesday, millions of U.S.
  dollars, not seasonally adjusted.
- Daily VIX closes: `VIXCLS`, daily close, index value, not seasonally adjusted,
  converted to weekly observations aligned to the reserve balance calendar.
- Daily S&P 500 levels: `SP500`, daily index level, aligned to the same anchor
  and forward endpoint rules as VIX for equity-return context.

### Signal Construction

- Compute trailing 12-week mean of reserve balances.
- Mark weeks where reserves are above the trailing 12-week mean.
- Mark true cross-above events where reserves move from below/equal the
  12-week mean to above it.
- Compute weekly reserve percent change.

### Outcome Windows

Evaluate whether VIX falls over:

- Next week: first available VIX close on or after `anchor + 7 calendar days`.
- Approximately 6-11 calendar days: version one uses the same deterministic
  `anchor + 7 calendar days` endpoint and labels the broader 6-11 day framing
  as claim language, not an inside-window optimization.
- Two weeks: first available VIX close on or after `anchor + 14 calendar days`.

### Alignment Modes

The module should support two explicit alignment modes. The selected mode must
be visible in the UI and repeated in any exported visual/report.

#### Research Mode

Research Mode is the default for recreating the public-data experiment exactly
from FRED-labeled observations.

- Anchor date: each `WRESBAL` weekly observation date, which is the week ending
  Wednesday.
- VIX start: `VIXCLS` close on the anchor date if available; otherwise first
  available VIX close after the anchor date.
- Forward endpoints: first available VIX close on or after `anchor + 7 calendar
  days` and `anchor + 14 calendar days`.
- Purpose: faithful public-data reconstruction and charting.
- Caveat: this mode is not a real-time tradability test because the weekly
  reserve reading may not have been known before the anchor close.

#### Tradability Mode

Tradability Mode is the default for any claim that implies a market participant
could act on the signal.

- Anchor date: first actionable market close after the reserve balance data is
  publicly available.
- VIX start: first available `VIXCLS` close after the actionable anchor.
- Forward endpoints: first available VIX close on or after `anchor + 7 calendar
  days` and `anchor + 14 calendar days` from the actionable anchor.
- Purpose: avoids lookahead bias when evaluating any trading-system framing.
- Caveat: this mode depends on the release timing encoded in the Gold/FRED
  pipeline or an approved release-calendar field; do not introduce a new source
  for release timing without owner approval.

The exact alignment rules should be implemented as named parameters and repeated
in any exported visual/report:

- weekly anchor date
- market-holiday handling
- first available VIX close after the anchor
- forward endpoint selection
- overlapping vs non-overlapping event handling
- research vs tradability mode

### Metrics

- Unconditional VIX fall rate by window.
- Conditional VIX fall rate when reserves are above the 12-week mean.
- Conditional lift versus base rate.
- Mean and median VIX point change.
- Mean and median VIX percent change.
- True cross-above event hit rate and sample size.
- Correlation between weekly reserve percent change and forward VIX change.
- Confidence intervals or binomial bands for claimed hit rates.
- SPX rise rate and mean/median SPX percent return over the same +7D/+14D
  outcome windows.
- VIX-regime breakdown by starting VIX level: below 15, 15-20, 20-30, and above
  30. Each bucket should show base VIX fall rate, signal VIX fall rate, lift,
  mean VIX point change, SPX rise rate, and mean SPX return where available.

### Event Counting

- Above-mean studies should include all weekly observations where reserves are
  above their trailing 12-week mean.
- Cross-above studies should use event-only handling and avoid overlapping
  forward windows when comparing event hit rates, sample sizes, or claim
  thresholds.
- The UI should label the event-counting mode so users can distinguish all-week
  conditional statistics from cross-above event studies.

### Calculation Contract

The first implementation should place the math in a pure helper that can be unit
tested without React or database dependencies.

Proposed helper:

```ts
computeReserveVixExperiment({
  reserves,
  vix,
  spx,
  startDate,
  endDate,
  alignmentMode,
  signalMode,
  forwardDays,
  claimThresholdPct,
})
```

Required semantics:

- `reserves` is weekly `WRESBAL` level history; `vix` is daily `VIXCLS` level
  history; optional `spx` is daily `SP500` level history from the same Gold/FRED
  path.
- Drop reserve rows until at least 12 prior weekly observations are available
  for the trailing mean. The trailing mean should use the 12 completed reserve
  observations before the anchor row, not include the current row.
- `reserveAboveMean = reserveValue > trailing12WeekMean`.
- `reservePctChange = (reserveValue / priorReserveValue - 1) * 100`, when a
  prior reserve value exists and is nonzero.
- `crossAbove = reserveAboveMean === true` and prior eligible row
  `reserveAboveMean !== true`.
- `vixStart` and `vixEnd` follow the selected alignment mode and endpoint rule.
- `vixPointChange = vixEnd - vixStart`.
- `vixPctChange = (vixEnd / vixStart - 1) * 100`, when `vixStart` is nonzero.
- `vixFell = vixPointChange < 0`.
- `spxPctChange = (spxEnd / spxStart - 1) * 100`, when `SP500` is available and
  `spxStart` is nonzero.
- `spxRose = spxEnd > spxStart`, when matched SPX start/end values exist.
- SPX matching should use the same anchor and forward endpoint dates as VIX. Do
  not drop otherwise valid reserve/VIX rows if SPX is unavailable; count missing
  SPX matches in diagnostics and expose SPX rates from the matched subset.
- VIX-regime buckets use the starting `vixStart` level at the anchor.
- Rows without a valid start or endpoint VIX close should be excluded from hit
  rate denominators and counted in a dropped-row diagnostic.
- Correlation should be Pearson correlation between `reservePctChange` and
  forward `vixPointChange` over rows where both values are finite.
- Hit-rate confidence intervals should use a binomial interval and expose the
  method name in the response. Wilson score interval is preferred for version
  one because it behaves better than a normal approximation with smaller event
  counts.

The helper should return both row-level observations for charting and aggregate
statistics for the metric panel.

### API Contract

Proposed route:

```text
GET /api/market-volatility/reserve-vix
```

Supported query parameters:

- `mode=research|tradability`, default `research`.
- `signal=above_mean|cross_above`, default `above_mean`.
- `forwardDays=7|14`, default `7`.
- `start=YYYY-MM-DD`, default `2009-01-01`.
- `end=YYYY-MM-DD`, default latest complete endpoint.
- `claimThresholdPct=number`, default `71`.

Response shape should include:

```ts
{
  source: "DB" | "ERR" | "UNAVAILABLE";
  experimentId: "reserve-vix";
  mode: "research" | "tradability";
  signal: "above_mean" | "cross_above";
  forwardDays: 7 | 14;
  dateRange: { start: string; end: string };
  inputs: {
    reservesSeriesId: "WRESBAL";
    vixSeriesId: "VIXCLS";
    spxSeriesId: "SP500";
    reservesRows: number;
    vixRows: number;
    spxRows: number;
    latestReserveDate: string | null;
    latestVixDate: string | null;
    latestSpxDate: string | null;
  };
  stats: {
    unconditional: HitRateStats;
    conditional: HitRateStats;
    spxUnconditionalRise: HitRateStats;
    spxConditionalRise: HitRateStats;
    liftPctPoints: number | null;
    meanVixPointChange: number | null;
    medianVixPointChange: number | null;
    meanVixPctChange: number | null;
    medianVixPctChange: number | null;
    meanSpxPctChange: number | null;
    medianSpxPctChange: number | null;
    reservePctChangeVixPointChangeCorr: number | null;
    claimThresholdPct: number;
    claimDeltaPctPoints: number | null;
    vixRegimes: VixRegimeStats[];
  };
  readout: {
    verdict:
      | "Unavailable"
      | "Insufficient Sample"
      | "No Meaningful Edge"
      | "Weak Lower-Vol Association"
      | "Potential Context Signal"
      | "Risk-Off / No Short-Vol Support";
    bias: "risk_on" | "neutral" | "risk_off" | "unavailable";
    confidence: "low" | "medium" | "high";
    ciOverlap: boolean | null;
    evidence: {
      baseRatePct: number | null;
      signalRatePct: number | null;
      liftPctPoints: number | null;
      signalN: number;
      meanVixPointChange: number | null;
      spxRiseRatePct: number | null;
      meanSpxPctChange: number | null;
      claimDeltaPctPoints: number | null;
    };
    notes: string[];
  };
  series: {
    vix: MarketVolSeriesPoint[];
    spx: MarketVolSeriesPoint[];
  };
  rows: ReserveVixExperimentRow[];
  diagnostics: {
    droppedRows: number;
    missingVixStart: number;
    missingVixEndpoint: number;
    insufficientTrailingMean: number;
    missingSpxStart: number;
    missingSpxEndpoint: number;
    confidenceIntervalMethod: "wilson";
    warnings: string[];
  };
  citations: Citation[];
  error?: string;
}
```

`rows` should be compact enough for the UI. If the full row set becomes too
large for the route, add deterministic server-side sampling for chart playback
and keep aggregate stats computed from the full eligible set.

### Acceptance Criteria

Version one is complete when:

- The route reads `WRESBAL`, `VIXCLS`, and optional `SP500` only from the
  approved Gold DB path.
- Research Mode and Tradability Mode are both represented in the route contract;
  Tradability Mode returns an explicit unavailable state if release timing is
  not available in Gold.
- `forwardDays=7` and `forwardDays=14` use deterministic calendar-day endpoint
  rules.
- Above-mean mode counts all eligible weekly above-mean observations.
- Cross-above mode uses event-only, non-overlapping handling.
- The API exposes base rate, conditional rate, lift, sample size, Wilson
  confidence interval, mean/median VIX point change, mean/median VIX percent
  change, and reserve/VIX correlation.
- The API exposes VIX-regime breakdowns and SPX outcome context from Gold/FRED
  `SP500`: unconditional/conditional SPX rise rate and mean/median SPX return.
- Every UI/export-facing payload includes the FRED/CBOE citations, the
  `VIXCLS` level series used to derive forward outcomes, the `SP500` context
  series when available, and labels the calculation as current revised Gold DB
  history.
- The UI includes an `EDGE` readout panel that turns the stats into a cautious
  context verdict, never a standalone buy/sell instruction.
- Missing data, stale endpoint coverage, or unavailable Tradability Mode never
  silently fall back to simulated data.
- Tradability Mode without approved Gold release timing returns
  `source: "UNAVAILABLE"` with an explanatory pending state, not a generic
  calculation failure.

### Test Plan

Add synthetic unit tests for the pure helper before wiring the route:

- trailing 12-week mean excludes the current reserve row.
- above-mean mode includes all eligible above-mean weeks.
- cross-above mode finds only false-to-true transitions.
- cross-above non-overlap suppresses events whose forward windows overlap.
- weekend/holiday endpoint logic chooses the first available VIX close on or
  after `anchor + forwardDays`.
- rows with missing VIX start or endpoint are dropped from denominators and
  counted in diagnostics.
- Wilson confidence interval and hit-rate denominators are stable on small
  samples.
- correlation ignores non-finite reserve percent changes or VIX changes.
- SPX forward outcomes use the same anchors/endpoints and do not affect VIX row
  eligibility when SPX is missing.
- VIX-regime buckets classify rows by starting VIX level.

Add route tests after the helper tests:

- Gold DB unavailable returns `source: "ERR"` and no simulated fallback.
- missing `WRESBAL` or `VIXCLS` rows returns an explicit error.
- successful Gold rows return citations, diagnostics, and deterministic stats.
- Tradability Mode without approved release timing returns an unavailable state.

## Visual Direction

The first build should feel like an animated research tape rather than a static
table.

Potential visual layout:

- Top lane: reserve balances with trailing 12-week mean and above/below regime
  shading.
- Middle lane: VIX level and forward outcome windows.
- Bottom lane: event dots for cross-above signals, colored by whether VIX fell
  over the selected window.
- Side panel: base rate, conditional rate, lift, sample size, mean VIX change,
  SPX outcome context, and correlation.
- Regime panel: VIX below 15, 15-20, 20-30, and above 30, showing whether the
  reserve signal only works in specific volatility states.
- Playback controls: play/pause, scrubber, window selector, and event stepper.
- Claim-audit panel: compares the observed conditional result against a claimed
  threshold such as 71%.
- Readout panel: verdict, risk-on/risk-off tilt, confidence label, evidence
  fields including SPX rise/return context, and warnings when confidence
  intervals overlap or the observed rate is well below the claim threshold.

The visual should make base-rate context impossible to miss. A viewer should see
whether the conditional result is materially better than normal VIX behavior
before seeing any trade framing.

## User Controls

Initial implemented controls:

- Signal mode: above 12-week mean, cross above 12-week mean.
- Alignment mode: Research Mode, Tradability Mode.
- Forward window: +7 calendar days, +14 calendar days.
- Date range: default 2009 through latest available.
- Claim threshold: default 71%.

Deferred controls:

- Confidence band visibility toggle.
- Playback speed.

## Non-Goals

- Do not present the reserve/VIX relationship as a trading system by default.
- Do not size positions, compute Kelly sizing, or imply standalone tradability
  unless a later approved research spec adds execution assumptions.
- Do not add a new Market Terminal data source.
- Do not merge this into `RVOL`; that module remains rate-volatility focused.
- Do not treat a social-media claim as validated without base-rate and sample
  size context.

## Open Questions

- Should the video-style visualization be rendered as a live animated UI only,
  or should the module also export a shareable `.mp4`/`.webm`?
- Should FRED/Gold provide the weekly alignment directly, or should alignment be
  computed in the terminal route?

## Locked Decisions

These decisions are approved for the first implementation:

- Primary default view: use Research Mode for the headline reconstruction, with
  Tradability Mode available as a toggle.
- Module placement: `MVOL` lives as a standalone Markets module at
  `/market-volatility`.
- Forward endpoints: use deterministic `anchor + 7 calendar days` and
  `anchor + 14 calendar days` endpoint rules in both Research Mode and
  Tradability Mode.
- Overlapping windows: include all weekly above-mean observations for the broad
  conditional base-rate study; use event-only, non-overlapping handling for
  cross-above studies.
- Statistical framing: show binomial confidence intervals for hit rates in
  version one.
- VIX change definition: use VIX point change as the primary outcome and VIX
  percent change as a secondary outcome.
- Revisions/vintage handling: version one uses current revised Gold DB history
  and labels that fact clearly; point-in-time vintage testing is deferred until
  the FRED pipeline exposes vintage-aware data.
- Export policy: live UI first. Shared video export is deferred because it needs
  explicit CBOE/FRED citation and usage handling.
- Claim threshold handling: default to the 71% benchmark for this experiment,
  while allowing configurable claim thresholds so the module can audit other
  volatility claims later.

## Roadmap Considerations

These are likely follow-up candidates after the first implementation:

- Add point-in-time/vintage-aware reserve history once exposed by the upstream
  FRED/Gold pipeline.
- Add richer uncertainty views such as bootstrap bands or regime-conditioned
  confidence intervals.
- Add video export with embedded citations, data as-of metadata, and FRED/CBOE
  usage safeguards.
- Add user-defined claim thresholds and saved claim-audit presets.
- Add additional volatility claim audits after the reserve/VIX experiment is
  validated.

## Implementation Progress

1. Complete: pure calculation helper for weekly alignment, 12-week mean signal,
   forward VIX windows, base rates, conditional rates, lift, Wilson confidence
   intervals, and correlation in `src/lib/marketVolatility.ts`.
2. Complete: synthetic tests for helper semantics in
   `src/lib/marketVolatility.test.ts`.
3. Complete: Gold DB-only route at `/api/market-volatility/reserve-vix` in
   `src/app/api/market-volatility/reserve-vix/route.ts`.
4. Complete: route tests for Gold-only behavior, missing data, citations, and
   Tradability Mode unavailable state in
   `src/app/api/market-volatility/reserve-vix/route.test.ts`.
5. Complete: first `MVOL` UI with static charts, metric cards, diagnostics, and
   source citations in `src/app/market-volatility/page.tsx`, including a
   `VIXCLS` level chart plus derived forward-outcome bars, with
   `src/lib/useMarketVolatility.ts` as the client fetch hook.
6. Complete: `EDGE` readout panel and tested readout classifier for cautious
   risk-on/risk-off context language.
7. Complete: VIX-regime buckets and Gold/FRED `SP500` forward outcome context.
8. Later: add animated playback once the static UI and data provenance are
   stable.

## Validation

Future implementation should include:

```bash
npm test -- <market-volatility-tests>
npm run check:gold-policy
npm run build:client
npm run build:server
git diff --check
```

Full `npm run typecheck` currently has known non-NEWS Gold/market backlog
failures; `MVOL` implementation should not add new typecheck failures.
