# Spec006: Material-Change Detector (MPUB Candidate Feed)

## Status

Draft. Phase 0 is complete (12-table signal audit, approved by Joshua
2026-09-02, Tier A gate coverage added). Phase 1 is also complete:
`src/lib/materialChangeDetector.ts` reads the four Phase 1 tables and
produces real, threshold-based candidates, with 11 passing tests. Not yet
wired into the live `/api/market-publishing/candidates` route — see Phase
1's own notes. Phase 2 (transition tracking) has not started.

## Owner

Joshua Lutkemuller / Market Terminal

## Background

`spec004` (`MPUB`)'s Gap To Fill lists "material-change detection and
ranking" as missing. `spec005` (QuantSmith Integration Layer) recommended
building it next: it lives entirely inside Market Terminal against data
already in Gold, and its Phase 2 pilot exercise validated the exact
discipline this detector needs — every claim traces to a specific Gold row
with an as-of date, nothing is asserted without a source, and a claim that
can't be re-resolved is dropped or flagged rather than displayed. Spec005's
item 3 also named QuantSmith's monitoring/alerting pattern (baseline →
breach → `Observation`, never remediating or publishing silently) as the
reference architecture — this spec is that pattern, built natively against
`GoldStore`, with no QuantSmith runtime dependency.

## Current State

`GET /api/market-publishing/candidates`
(`src/app/api/market-publishing/candidates/route.ts`) and
`buildMarketPublishingCandidates` (`src/lib/marketPublishing.ts`) already
exist from spec004 Phase 0/1. Today it does the following, and nothing more:

- For each of ~7 fixed template slots (daily scoreboard, market derby, curve
  watch, vol/credit watch, macro week ahead, reserve/VIX claim audit,
  earnings gate), check whether the required Gold rows exist.
- If they exist, emit a `ready` candidate with a `score` from a hand-tuned
  formula against raw levels — e.g. `vol-credit-watch`'s score is
  `Math.min(96, 55 + Math.max(0, vix.value - 12) + (hy ? Math.max(0, hy.value - 300) / 25 : 0))`.
  These constants (`55`, `12`, `300`, `/25`) are not derived from history;
  they are arbitrary tuning against absolute levels.
- If they don't exist, emit an `unavailable` candidate with a reason.

This always returns essentially the same candidate set every single day,
regardless of whether anything actually moved. It answers "is data available
for this template" — a coverage checklist — not "what changed enough today
to be worth a chart," which is the question spec004 actually asks `MPUB`'s
`Today` workspace to answer. `docs/specs/spec004/PHASE0_DATA_CONTRACT.md`
names this directly: drawdown/record-proximity, inflation-momentum,
labor/growth, and historical-analog detectors are listed as `Gap` or
`Partial`, "needs a detector and display transform" — this spec is that
detector.

Both `daily` and `candidates` routes currently read only two Gold tables:
`gold_fred_latest_observation` and `gold_release_calendar` — the "approved
base tables for the first slice" per `PHASE0_DATA_CONTRACT.md`.

One gap noticed while grounding this spec: `scripts/check-gold-db-policy.sh`
enforces the Tier A no-fallback policy over `src/app/api/econ`,
`src/app/api/market`, and `src/app/api/chart`, but **not**
`src/app/api/market-publishing`. This spec's delivery plan adds it.

## Key Finding: The Statistics Already Exist In Gold

`fred-bronze-to-gold-pipeline`'s Gold layer does not just carry raw
observations — it already computes the change-detection statistics this
detector needs, as columns and tables market_terminal has not touched yet.
Confirmed by direct query against the local Gold DB
(`fred_local.db`) while writing this spec — every figure below is real,
not illustrative:

| Table | Carries | Real example (queried while writing this spec) |
| --- | --- | --- |
| `gold_macro_indicator_dashboard` | Per-series `zscore`, `percentile`, `surprise`, `surprise_z`, `staleness_days` | Already used for spec005's Phase 2 pilot figures (CPI, Core PCE, etc.) |
| `gold_macro_category_summary` | Per-category, per-day `breadth_pct`, `avg_zscore`, `surprise_index`, `n_improving`/`n_deteriorating` | GROWTH category, 2026-08-24: `breadth_pct`=1.0 (10/10 series improving), `avg_zscore`=2.10, `surprise_index`=2.11 — a broad-based, statistically extreme category move in one row |
| `gold_macro_anomaly_scores` | Multi-factor joint anomaly flag (`mahalanobis_d2`, `p_value`, `is_anomaly`) | Monthly frequency; latest rows show `is_anomaly`=0 (not currently anomalous) |
| `gold_credit_spread_daily` / `gold_credit_spread_rolling` | Per-tier `zscore`, `percentile`, `is_stress_episode` | CCC_OAS, 2026-08-20: 1,035bps, zscore 1.75, 98th percentile — real stress in the lowest tier while IG (82bps) reads unremarkable |
| `gold_curve_spread_daily` | Per-spread `zscore`, `percentile`, `is_inverted`, `inversion_run` (multiple spreads, not just 10Y-2Y) | Generalizes `curve_watch` beyond the one hard-coded spread |
| `gold_zscore_heatmap` | Any series' `zscore`/`percentile` across 5 lookback windows (expanding, 12/36/60/120) | The most generic reusable signal source — works for any `series_id`, not just macro-dashboard-covered ones |
| `gold_funding_stress_daily` | `stress_bucket` (e.g. "elevated"), `composite_z` | 2026-08-20: bucket "elevated", `stress_score` 60.9 |
| `gold_treasury_curve_metrics` | `curve_move` (e.g. "bear-steepener"), `is_inverted_10y2y`/`10y3m`, `is_recession` | 2026-08-20: "bear-steepener", not inverted |
| `gold_spread_inversion_episode` | Inversion episode start/end/trough, `is_ongoing`, `recession_overlap` | No ongoing episode currently (consistent with `is_inverted`=0 above) |
| `gold_series_structural_breaks` | Pairwise structural-break tests (`is_significant`, `break_date`, `as_of_date`) | 5 significant breaks found on recent `as_of_date` runs, e.g. `T10YIE`/`DGS10` break at 2022-12-22, re-confirmed as of 2026-08-20 |
| `gold_recession_probability_daily` | Model-implied recession odds at 3/6/12mo horizons | Monthly frequency; latest (2026-07-01) near-zero across horizons |

**This reframes the detector's scope.** Market Terminal should not build new
statistical models — the upstream pipeline already owns that layer, and
duplicating it here would violate spec004's own "Market Terminal remains a
read-only consumer" rule. The actual gap is **synthesis, ranking, and
transition-tracking**: read across these already-computed signals, apply
transparent and owner-reviewable thresholds, track what's *new* since the
last run (not just what's currently true), and produce a small ranked
candidate list — replacing the current fixed-template, ad hoc-score
approach.

## Goals

- Read the Gold tables above (a defined, named subset — see Data Policy) and
  turn threshold crossings into `MarketPublishingCandidate` entries additive
  to today's fixed template set, not a replacement for it.
- Replace ad hoc level-based score constants with scores derived from the
  Gold-provided `zscore`/`percentile`/`breadth_pct`/etc. columns themselves.
- Track candidate state across runs so the feed distinguishes *new today*
  from *still active since [date]* — a chronic condition (e.g. CCC stress
  sitting at the 98th percentile for a month) should not re-flag as fresh
  news every single day.
- Give every candidate a transparent, inspectable reason: which table,
  which column(s), which threshold, matching spec004's Editorial Ranking
  requirement ("The UI should display why a candidate ranked highly") and
  the citation discipline `buildMarketPublishingCandidates` already follows.
- Add `src/app/api/market-publishing` to the Tier A no-fallback policy gate.

## Non-Goals

- No new statistical model, anomaly detector, or threshold math implemented
  in Market Terminal. Every signal traces to a Gold column that already
  computed it upstream.
- No auto-publish or auto-advance of a candidate's editorial queue state.
  This detector only ever produces the `Candidate` state; spec004's
  existing `Candidate → Selected → Needs review → Ready → Published →
  Archived` lifecycle remains a human action.
- No coverage of earnings/valuation signals — still gated per spec004's
  existing Source Gate decision.
- Not a QuantSmith integration. This spec implements spec005 item 3's
  *reference architecture* (baseline → breach → flagged candidate) natively
  in TypeScript against `GoldStore`. No Python dependency, no QuantSmith
  runtime call.
- Does not redesign the existing 7 fixed-template candidates' content —
  only extends the feed and revisits their score formulas where a real Gold
  statistic can replace an arbitrary constant.

## Candidate Scoring Model

Maps directly onto spec004's existing Editorial Ranking component list,
using real Gold columns instead of inventing a new formula:

| Component (spec004) | Source | Example |
| --- | --- | --- |
| Magnitude vs. recent history | `zscore` / `zscore_expanding` / `zscore_12`/`36`/`60`/`120` | `gold_zscore_heatmap`, `gold_macro_indicator_dashboard.zscore` |
| Historical percentile / record proximity | `percentile*` columns | `gold_credit_spread_daily.percentile`, `gold_curve_spread_daily.percentile` |
| Cross-asset confirmation | Multiple signal sources agreeing directionally within the same run (e.g. credit stress + funding stress + curve move together) | Computed at synthesis time, not a Gold column — documented rule, not invented data |
| Economic or market relevance | Static, owner-reviewed category/domain weight table | New, documented constant table — explicitly not ML-derived |
| Freshness | `staleness_days` (dashboard) / table's own frequency vs. today | Penalize a monthly `gold_macro_anomaly_scores` row that's several weeks old relative to a same-day daily signal |
| Chart clarity | Whether an existing `MGC`/`MKC` template already covers the series/category | Lower priority (not blocked) when no chart template exists yet |
| Data completeness | All required legs resolve without nulls (e.g. both spread legs) | Existing `unavailableCandidate` pattern already does this for the fixed templates |
| Caveat severity | `is_backfilled`, `is_stress_episode`, monthly/quarterly-vs-daily frequency mismatch | Surfaced in the candidate's `warnings` array, matching today's existing pattern |

Every score must be reproducible from its cited table/column/threshold — no
free-form "importance" number, consistent with spec004's Trust And Citation
Contract.

## New-Vs-Still-Active (Transition Tracking)

A signal that has read "elevated" or "98th percentile" for weeks should not
re-appear as a fresh, high-ranked candidate every single run — that floods
the queue and trains the owner to ignore it. The detector needs a small
local record of what it flagged on its last run, so it can classify each
candidate as:

- **New** — crossed its threshold since the last run.
- **Continuing** — still past threshold, first flagged on `[date]`.
- **Resolved** — was past threshold last run, no longer is.

This state is Market Terminal's own bookkeeping, not a Gold table — Gold
stays read-only. It belongs with `MPUB`'s existing "local, versioned"
philosophy (spec004 §Archive: local artifacts, never written to Gold), e.g.
a small JSON or SQLite file under a local data directory, not committed to
the repo (generated state, per `.gitignore` conventions elsewhere in this
repo).

## Output Contract

Additive changes to the existing `MarketPublishingCandidate` type in
`src/lib/marketPublishing.ts` — nothing existing is renamed or removed, so
today's route/tests keep working:

```ts
export type MarketPublishingChangeType = "new" | "continuing" | "resolved";

export interface MarketPublishingScoreBreakdown {
  component: string;   // one of spec004's Editorial Ranking components
  value: number;
  goldTable: string;
  goldColumn: string;
  threshold: string;   // human-readable rule that fired, e.g. "|zscore| >= 2"
}

// Added to MarketPublishingCandidate, all optional so existing
// fixed-template candidates (which don't set them) remain valid:
//   changeType?: MarketPublishingChangeType;
//   firstFlaggedAt?: string | null;
//   scoreBreakdown?: MarketPublishingScoreBreakdown[];
```

## Data Policy

Per spec004's Non-Negotiable Rules, any table beyond the two currently
"approved base tables" in `PHASE0_DATA_CONTRACT.md` needs Joshua's explicit
review before a route reads it — even though every table above is in the
*same already-approved* Gold/FRED pipeline, not a new provider. This spec
proposes adding the 12 tables profiled in `PHASE0_DATA_CONTRACT.md`'s
"Spec006 Signal Table Audit" section (the 10 rows in the Key Finding table
above, with `gold_credit_spread_daily` and `gold_credit_spread_rolling`
counted as two physical tables) to the approved list, scoped to read-only
`SELECT` through `goldStore`, before any implementation lands. This is a
lighter review than spec004's full Source Gate (same pipeline, same trust
boundary), but it is still a real decision point, not a rubber stamp — one
table (`gold_series_structural_breaks`) reports historical break dates that
need care not to be redisplayed as "material today" just because the row
was re-confirmed on today's `as_of_date` run (see Risks), and the audit
found real null-rate caveats on two of the twelve (see Risks and the audit
section itself).

## Architecture

```text
Gold tables (12, pending approval above)
        |
        v
new: src/lib/materialChangeDetector.ts
  - reads GoldStore (read-only)
  - applies documented thresholds per signal
  - diffs against local transition-state file -> new/continuing/resolved
  - emits MarketPublishingCandidate[] with scoreBreakdown
        |
        v
buildMarketPublishingCandidates() (existing, src/lib/marketPublishing.ts)
  - merges detector output additively with the existing 7 fixed-template
    candidates
        |
        v
GET /api/market-publishing/candidates (existing route, unchanged shape)
```

## Delivery Plan

### Phase 0: Table approval and signal audit

- [x] Profile null/staleness/frequency behavior across all 12 tables (some
  are monthly; several are daily but on two different actual refresh lags;
  one is event/episodic; one re-runs irregularly) — see
  `PHASE0_DATA_CONTRACT.md`'s "Spec006 Signal Table Audit" section.
  Found: Group A/B daily tables are 4 days apart in actual freshness despite
  both being "daily"; `gold_credit_spread_rolling` has a ~14% null rate on
  thin-history window/instrument combinations; `gold_series_structural_breaks`
  has a 50% null `f_stat` rate on its latest run (use `is_significant`
  instead) plus one likely-seed outlier row.
- [x] Add `src/app/api/market-publishing` to
  `scripts/check-gold-db-policy.sh`'s `TIER_A_DIRS` — verified clean first
  (no forbidden patterns already present), gate still passes.
- [x] **Get Joshua's explicit approval** to add the 12 audited tables to
  `PHASE0_DATA_CONTRACT.md`'s approved base-table list. **Approved
  2026-09-02.** Phase 1 is unblocked.

### Phase 1: Read-only detector over a narrow signal set — done

- Implemented `src/lib/materialChangeDetector.ts` against the four Phase 1
  tables: `gold_macro_category_summary`, `gold_credit_spread_daily`,
  `gold_funding_stress_daily`, `gold_treasury_curve_metrics`.
- Thresholds validated against real data before coding, and corrected from
  this section's original draft where the draft's guess didn't match
  reality: `|avg_zscore| >= 1.5 AND breadth_pct >= 0.8` for category breadth
  (fires on exactly `GROWTH` today); `is_stress_episode = 1 OR percentile >=
  0.95` for credit (percentile is stored 0-1, not 0-100 — fires on exactly
  `CCC_OAS` today); `stress_bucket IN ('elevated', 'stressed')` for funding
  (real bucket values are `calm`/`normal`/`elevated`/`stressed` — "severe"
  in the earlier draft doesn't exist in the data); curve fires only on
  `is_inverted_10y2y = 1 OR is_inverted_10y3m = 1 OR is_recession = 1` —
  `curve_move`'s directional label (`bear-steepener` etc.) is present on
  most days and would flood the queue if used as the trigger itself, so it
  appears only as descriptive text on a candidate, never as the condition.
- No transition tracking yet, per plan — every run reports current state.
- 11 tests in `src/lib/materialChangeDetector.test.ts` prove: no fallback
  path exists (`goldEnabled()=false` → 4 unavailable candidates, zero
  queries attempted); a failed read produces an explicit unavailable
  candidate rather than a thrown error or silent empty state; an empty
  result set is distinct from a real "condition not met" zero-candidate
  outcome; a null `breadth_pct` (real in the audit — `FX`/`MONEY`/`RATES`)
  is skipped without crashing; and every ready candidate's `scoreBreakdown`
  cites one of the four approved tables with a non-empty column/threshold.
  All pass; `npm run typecheck` and the existing
  `candidates/route.test.ts` suite are unaffected.
- **Not wired into `buildMarketPublishingCandidates`/the live
  `/api/market-publishing/candidates` route yet.** That route's own test
  asserts an exact, fixed set of Gold reads (spec004 Phase 0's no-fallback
  guardrail) — wiring this in changes what that guardrail means and is a
  deliberate follow-up decision, not an implicit side effect of Phase 1.

### Phase 2: Transition tracking

- Add the local new/continuing/resolved state file and the corresponding
  `changeType`/`firstFlaggedAt` fields.
- Tests proving a chronic signal is not re-ranked as "new" on every run.

### Phase 3: Remaining signal sources and score-formula cleanup

- Add `gold_macro_indicator_dashboard`/`gold_zscore_heatmap`-driven candidates
  (broader per-series coverage beyond the fixed template set).
- Replace the existing fixed templates' ad hoc score constants (`vix.value -
  12`, etc.) with real percentile/zscore-derived equivalents where a Gold
  column now covers the same signal.
- Add the lower-frequency sources (`gold_macro_anomaly_scores`,
  `gold_recession_probability_daily`, `gold_series_structural_breaks`) with
  explicit frequency/staleness caveats in `warnings`.

### Phase 4: UI wiring

- Surface the ranked, transition-aware candidate feed in `MPUB`'s `Today`
  workspace. Not started until Phases 0-3 are proven with tests, per
  spec005's own lesson that a manual/tested pass should precede anything
  the owner is expected to trust unattended.

## Decisions Before Implementation

| Decision | Recommendation |
| --- | --- |
| New statistics vs. reuse | Reuse only; every signal must trace to an existing Gold column |
| Table approval scope | Lighter review than a new Source Gate (same pipeline), but still explicit and documented per table |
| Transition state storage | Local file, not Gold, not committed to the repo |
| Score formula | Fully reproducible from cited table/column/threshold; no free-form heuristic constants going forward |
| Existing 7 fixed-template candidates | Kept; new detector output is additive, not a replacement |
| Structural-break table usage | Context/caveat source for narrative framing, not a same-day "material today" trigger by itself (see Risks) |
| UI wiring | Deferred to Phase 4, after tests prove the detection/scoring/transition logic |

## Risks And Pitfalls

- **Threshold arbitrariness masquerading as rigor.** Reusing a real Gold
  `zscore` column is better than an invented constant, but the cutoff
  (`|zscore| >= 2`) is still a choice. State it plainly as owner-tunable,
  not as a discovered truth.
- **Chronic-flag flooding without transition tracking** (addressed by Phase
  2, but real until then) — Phase 1 ships without it deliberately, and that
  limitation should be visible in the UI/API output, not silently accepted.
- **Frequency-mismatch false parity.** A monthly `gold_macro_anomaly_scores`
  row and a daily `gold_credit_spread_daily` row must not be ranked as if
  they carry equal freshness. `staleness_days`/frequency-aware penalties are
  part of Goals, not an afterthought.
- **Structural-break re-confirmation mistaken for a new event.**
  `gold_series_structural_breaks.break_date` can be years old while
  `as_of_date` is today — the test re-ran and re-confirmed the historical
  break, it did not detect a new one. A naive "as_of_date = today, so this
  is material today" rule would misrepresent an old, known break as fresh
  news. This table is confirmed as context/caveat only, never a same-day
  trigger by itself, per the Decisions table above.
- **Percentile without sample-size context.** A percentile computed from a
  short history can look extreme without actually being unusual. Where a
  table's `n_obs`/`n_factors_used`/similar field exists, surface it in
  `warnings` rather than let a thin-sample percentile masquerade as a
  robust one.

## Related Documents

- `docs/specs/spec004/SPEC.md`, `docs/specs/spec004/PHASE0_DATA_CONTRACT.md`
  (§ Spec006 Signal Table Audit — Pending Approval)
- `docs/specs/spec005/SPEC.md`, `docs/specs/spec005/PHASE2_PILOT_VERIFICATION.md`
- `src/lib/marketPublishing.ts`
- `src/app/api/market-publishing/candidates/route.ts`,
  `src/app/api/market-publishing/candidates/route.test.ts`
- `scripts/check-gold-db-policy.sh`
