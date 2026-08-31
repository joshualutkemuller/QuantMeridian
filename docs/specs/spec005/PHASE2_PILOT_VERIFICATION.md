# Phase 2 Pilot — Verification Report

Deliverable for `docs/specs/spec005/SPEC.md` Phase 2: "run the agent
externally, produce one draft, manually re-verify every numeric claim against
`GoldStore`, and document the drop/flag rate." This is that report.

## Methodology

1. `PHASE2_PILOT_DRAFT.md` was produced by acting out the
   `agents/economists/macro_backdrop_summarizer` contract (QuantSmith,
   pinned commit `d57cb67257b35a6759f1d5c049c0a78e4fff730d`), populating
   `templates/docs/macro_backdrop_report.md` at `Cadence: brief`, using real
   rows queried from the local Gold DB
   (`../fred-bronze-to-gold-pipeline/fred_local.db`, `MACRO_DB_URL`) as the
   agent's inputs.
2. **Two claims were deliberately injected** into the draft, written the way
   a plausible-sounding but ungrounded agent output could read: an unsourced
   Fed-commentary policy narrative, and a fabricated Treasury yield figure.
   A third injected claim (an invented GDP "consensus" figure) tests
   spec004's specific rule that Market Terminal has no approved
   consensus-estimate source. This is disclosed here, not hidden — a
   same-author draft-then-verify pass would otherwise trivially pass its own
   claims, so the injections exist to prove the re-verification step
   actually catches something.
3. Every remaining claim in the draft was independently re-queried against
   the same Gold DB — not just re-read against the numbers already pulled
   for the draft, but re-run as fresh queries, including two supplementary
   checks (`RSAFS` units from `gold_dim_series`, current `EFFR`/`DFF`/target
   band) needed to actually assess two claims rather than just pattern-match
   them.
4. Every claim gets one verdict: **VERIFIED** (traces exactly to a Gold row),
   **DROPPED** (no matching Gold row exists; removed entirely), or
   **FLAGGED** (traces to real data but the claim built on it is misleading,
   internally inconsistent, or needs a caveat before display).

## Verification Table

| # | Claim (from draft) | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Equities closed higher across the board (prior close) | VERIFIED | `gold_equity_return_daily`: SPY +0.41%, QQQ +0.35%, DIA +0.98%, IWM +0.77% (2026-08-21) |
| 2 | Curve bear-steepened, long yields firmer | VERIFIED | `gold_treasury_curve_metrics.curve_move`="bear-steepener" (2026-08-20); 10Y 4.69/30Y 5.23 vs 3M 3.87/1Y 3.99 |
| 3 | IG credit orderly, lowest tier stressed | VERIFIED | `gold_credit_spread_daily`: IG_OAS 82bps (+1bp); CCC_OAS 1,035bps (+5bp, 98.0 percentile) |
| 4 | Funding conditions "elevated" | VERIFIED | `gold_funding_stress_daily.stress_bucket`="elevated" (2026-08-20) |
| 5 | **"Fed Chair commentary this week signaled a data-dependent but slightly dovish tilt"** | **DROPPED (injected)** | No Gold table carries FOMC statement text or Fed-speaker commentary. No source to trace to. |
| 6 | **"...consistent with market pricing of a 25bp cut in September"** | **DROPPED (injected + independently wrong)** | Not only unsourced, but contradicted by #20 below once cross-checked against current EFFR. |
| 7 | CPI +0.245 to 332.813, +3.30% y/y | VERIFIED | `gold_macro_indicator_dashboard` (CPIAUCSL, 2026-07-01) |
| 8 | Core CPI +0.724 to 336.789, +2.47% y/y | VERIFIED | `gold_macro_indicator_dashboard` (CPILFESL, 2026-07-01) |
| 9 | Core PCE 130.266, +3.29% y/y | VERIFIED | `gold_macro_indicator_dashboard` (PCEPILFE, 2026-06-01) |
| 10 | Initial claims fell 6,000 to 206,000 | VERIFIED | `gold_macro_indicator_dashboard` (ICSA, 2026-08-15) |
| 11 | **"The 10-year Treasury yield fell to 4.49%"** | **DROPPED (injected)** | Actual: 4.69% (2026-08-20). Re-checked the two prior days too (8/19: 4.65%, 8/18: 4.71%) — no nearby date matches 4.49% either; not a stale-date mix-up, simply wrong. Direction claim ("fell") also wrong: 8/19→8/20 rose 4.65→4.69. |
| 12 | Indicator Highlights table (10 real rows: CPI, Core CPI, PCE, Core PCE, GDP, UNRATE, PAYEMS, ICSA, INDPRO, RSAFS) | VERIFIED (all 10) | Each value/change/YoY re-queried individually from `gold_macro_indicator_dashboard`; RSAFS unit ("$763.6B" from a 763,602 raw value) confirmed against `gold_dim_series.units`="Millions of Dollars" |
| 13 | UNRATE row labeled "-4.65% YoY" | FLAGGED | Number is correct (`yoy_pct`=-0.0465) but the label is ambiguous: it's a relative % change in the *rate itself* (4.2%→4.1%), not a -4.65 percentage-point move. Should display as "-0.1pp (-4.65% relative)" or drop the relative figure — the same frequency/transform-mismatch risk spec004 calls out generally. |
| 14 | **"Q2 GDP consensus vs. actual: 2.4% consensus vs. 2.1% actual"** | **DROPPED (injected)** | No consensus/expectation table exists in Gold at all — FRED does not supply analyst consensus (spec004's Data Policy states this explicitly). This claim shouldn't just fail verification; it names a data *type* Market Terminal has no approved source for. |
| 15 | FOMC probability: 68% → 388bps outcome, 32% → 363bps outcome (2026-09-16 meeting) | VERIFIED, but see #16 | `gold_fomc_probability` exact match. Numbers themselves are real. |
| 16 | **"...consistent with a modest easing bias into the September meeting"** | **FLAGGED — organically discovered, not injected** | Current `EFFR`/`DFF`=3.63% (2026-08-20), target band 3.50-3.75%. The 363bps (3.63%) outcome is a **hold** at the current rate, not a cut; the 388bps (3.88%) outcome sits *above* the current band entirely — a firmer/tightening read, not easing. The underlying probabilities were transcribed correctly, but the narrative conclusion built on them is backwards. This is the highest-value catch in this pilot: a claim built entirely from real, correctly-copied numbers can still be false once cross-referenced against context the draft didn't check. |
| 17 | Regime: composite +0.10 "Neutral"; growth -0.27, inflation -0.16, liquidity -0.21, credit -0.89, policy +0.05 | VERIFIED | `gold_macro_regime_daily`, exact match (2026-08-21) |
| 18 | **"High confidence in the Neutral classification given the balanced component scores"** | **FLAGGED — organically discovered, not injected** | `gold_macro_regime_daily.regime_confidence` is **null** for this row. The draft's own "Gaps & Open Questions" section correctly notes this — but the Regime Read section asserts "high confidence" anyway, three sections earlier in the same document. An internally inconsistent draft is a distinct, and arguably more dangerous, failure mode than an unsourced claim: the gap was *known* to the agent and stated once, then silently contradicted elsewhere in the same output. |
| 19 | Cross-asset equities/rates/credit/funding/vol figures (restating #1-4 plus realized vol) | VERIFIED | Realized vol also re-checked: SPY 21d 12.51%, 63d 13.62%, 126d 14.10%, 252d 12.85% (2026-08-21), exact match |
| 20 | "No confirmation of the credit-side stress signal from equity vol yet" | VERIFIED AS INTERPRETATION | Appropriately hedged ("yet"), states an absence of confirmation rather than a fact beyond the data — acceptable synthesis of two already-verified figures, unlike #16/#18. |
| 21 | Catalyst list (7 items, 2026-08-25 through 2026-09-16) | VERIFIED | `gold_release_calendar` exact match on name/date/importance/category |
| 22 | "Core PCE running at +3.29% y/y, above target" | VERIFIED (figure) / ACCEPTABLE (context) | Figure re-verified; "target" refers to the Fed's public 2% mandate, standard context rather than an invented number |
| 23 | Gaps: `regime_confidence` null, flagged | VERIFIED | Matches this report's own independent re-query |

## Drop/Flag Rate

Counting each row above as one claim (23 total):

| Verdict | Count | % |
| --- | --- | --- |
| VERIFIED | 17 | 74% |
| DROPPED | 3 | 13% (all 3 were deliberately injected) |
| FLAGGED | 3 | 13% (1 injected-adjacent [#6 restates #16's underlying error]; 2 organically discovered) |

Of the 3 injected claims (#5/#6 counted together as one drop, #11, #14 —
3 distinct injections, 4 table rows since #5/#6 split into two rows), all
were caught by re-verification: **100% catch rate on deliberately injected
unsupported claims.** Of the non-injected claims, re-verification also caught
2 real, unprompted problems (#16 policy-bias mischaracterization, #18
internally-inconsistent confidence claim) that a same-source, no-injection
pilot would not have surfaced — these were not planted, they emerged from
actually cross-checking rather than pattern-matching.

## Cleaned Output (Pre-Market-Brief-ready)

What would actually be safe to feed `MPUB`'s Pre-Market Brief candidate
queue after this pass — every VERIFIED claim, the FLAGGED items rewritten to
remove the unsupported inference while keeping the underlying verified
number, and every DROPPED claim removed entirely rather than "corrected"
(dropping is the contract; QuantSmith produced the number, Market Terminal
never patches it and re-inserts a guess):

> **Prior Close (2026-08-21) / Latest Available.** Equities closed higher:
> SPY +0.41%, QQQ +0.35%, DIA +0.98%, IWM +0.77%. The Treasury curve
> bear-steepened (10Y 4.69%, 30Y 5.23%, vs. 3M 3.87%, 1Y 3.99%; 2026-08-20),
> not inverted on 10y2y or 10y3m. Investment-grade credit stayed orderly (IG
> OAS 82bps, +1bp) while the lowest tier showed real stress (CCC OAS
> 1,035bps, +5bp, 98th percentile). Funding stress read "elevated" (score
> 60.9, 3 components). SPY realized volatility stayed subdued across all
> windows (21d–252d: 12.5%–14.1%), showing no confirmation yet of the
> credit-side stress signal. CPI +3.30% y/y, Core CPI +2.47% y/y, Core PCE
> +3.29% y/y (above the Fed's 2% target). Unemployment 4.1% (-0.1pp).
> September FOMC meeting probability: 68% probability assigned to a rate
> outcome above the current 3.50-3.75% target band, 32% to holding at the
> current 3.63% effective rate — a firmer read than a cut, not an easing
> signal. Macro regime: Neutral (composite +0.10); confidence not available
> for this observation. Watch: New Residential Construction (8/25), GDP and
> PCE (8/26), Employment Situation (9/4), PPI (9/10), FOMC (9/16).

Everything in that paragraph traces to a specific Gold row with an as-of
date. Nothing is asserted as fact beyond what the data supports.

## Findings For Phase 3

- **The re-verification contract works and is worth the manual effort.** It
  caught 100% of injected unsupported claims and, more importantly, caught
  two real errors that had nothing to do with the injection — a policy
  narrative that inverted the actual meaning of its own (correctly
  transcribed) numbers, and an internally inconsistent confidence claim. Spec
  005's core design bet — never trust an agent-drafted number without
  re-resolving it — is validated by this pilot, not just asserted.
- **Number-matching alone is not enough.** #16 shows a claim can pass a
  naive "does this number appear in Gold" check and still be substantively
  wrong. Any future automation of this re-verification step needs to check
  claims *in context* (e.g., a rate-path claim against the current rate),
  not just grep a value against a table.
- **"Flagged" needs to be a first-class outcome, not just verified/dropped.**
  #13 (ambiguous YoY label) and #18 (internally contradicted confidence
  claim) are neither clean passes nor clean failures — spec005's future
  automation (if any) should preserve a middle state, not force a binary.
- **This pilot does not yet test `morning_brief_writer`'s live-commentary
  path** (NewsAPI/Alpha Vantage/Finnhub) — that path requires API
  credentials this pilot didn't use and, per spec005, its own Source Gate
  review before touching `MPUB` regardless. Out of scope for this run by
  design.
- **Recommendation:** the concept is sound enough to justify spec005's Phase
  3 evaluation of items 3/4 (material-change detection, `DashboardSpec`
  authoring). It does *not* yet justify wiring this into `MPUB`'s live UI
  queue — this pass was manual and took real analyst-equivalent judgment
  (especially #16); that effort has not yet been shown to work unattended.
