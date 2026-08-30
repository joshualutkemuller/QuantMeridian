# Spec003: Market Volatility Module

## Status

Draft scaffold — high-level concept only.

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

Market Terminal should not add a new volatility vendor, scraped dataset, or
separate external API for this module without explicit owner approval.

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

## Experiment Scaffold

### Input Series

- Weekly reserve balances: `WRESBAL`, weekly ending Wednesday, millions of U.S.
  dollars, not seasonally adjusted.
- Daily VIX closes: `VIXCLS`, daily close, index value, not seasonally adjusted,
  converted to weekly observations aligned to the reserve balance calendar.

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

### Event Counting

- Above-mean studies should include all weekly observations where reserves are
  above their trailing 12-week mean.
- Cross-above studies should use event-only handling and avoid overlapping
  forward windows when comparing event hit rates, sample sizes, or claim
  thresholds.
- The UI should label the event-counting mode so users can distinguish all-week
  conditional statistics from cross-above event studies.

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
  and correlation.
- Playback controls: play/pause, scrubber, window selector, and event stepper.
- Claim-audit panel: compares the observed conditional result against a claimed
  threshold such as 71%.

The visual should make base-rate context impossible to miss. A viewer should see
whether the conditional result is materially better than normal VIX behavior
before seeing any trade framing.

## User Controls

Initial controls can be simple:

- Signal mode: above 12-week mean, cross above 12-week mean.
- Forward window: 1 week, 6-11 days, 2 weeks.
- Date range: default 2009 through latest available.
- Event handling: all weeks vs first cross only.
- Show confidence band: on/off.
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

- Should the module code be `MVOL`, `VOL`, or another mnemonic?
- Should `MVOL` live under Markets, Intelligence, or Economics?
- Should the first version be a standalone route or a Market Lens preset promoted
  into its own module later?
- Should the video-style visualization be rendered as a live animated UI only,
  or should the module also export a shareable `.mp4`/`.webm`?
- Should FRED/Gold provide the weekly alignment directly, or should alignment be
  computed in the terminal route?

## Locked Decisions

These decisions are approved for the first implementation:

- Primary default view: use Research Mode for the headline reconstruction, with
  Tradability Mode available as a toggle.
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

## First Implementation Slice

1. Confirm the exact Gold/FRED series IDs for reserve balances and VIX.
2. Write a pure calculation helper for weekly alignment, 12-week mean signal,
   forward VIX windows, base rates, conditional rates, lift, and correlation.
3. Add tests using small synthetic series to lock the event-window semantics.
4. Create a route/API that reads only the approved FRED/Gold pipeline data.
5. Build the first `MVOL` UI with static charts and metric cards.
6. Add animated playback once the math and data provenance are stable.

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
