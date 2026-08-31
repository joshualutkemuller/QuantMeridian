# Spec004: Daily Market Publishing Suite

## Status

Draft scaffold with Phase 0 and an initial read-only Phase 1 API slice in
progress. See `PHASE0_DATA_CONTRACT.md` for the current template-to-data matrix
and source-gap list.

## Owner

Joshua Lutkemuller / Market Terminal

## Working Name

- Suite: Daily Market Publishing Suite
- Recommended entry module: `MPUB`
- Recommended route: `/market-publishing`
- Recommended navigation group: Intelligence

Use one entry module with focused workspaces in version one. Promote a workspace
to a separate sidebar module only after its workflow and data contract are
stable. This keeps the terminal navigable while still creating a reusable suite.

## Product Thesis

Turn Market Terminal's existing economics, markets, volatility, news, and chart
capabilities into a daily editorial workflow for creating accurate, powerful,
share-ready market visuals and concise commentary.

The product should help the owner answer four questions each day:

1. What changed enough to matter?
2. What historical or cross-asset context makes the change understandable?
3. Which visual communicates the point most clearly?
4. Can the visual be reproduced, cited, and shared without overstating the data?

The goal is not to copy another publisher's layouts, wording, brand, proprietary
datasets, or conclusions. The goal is to learn from successful public formats:
simple charts, strong framing, consistent cadence, clear sources, and a useful
distinction between signal and noise.

## External Inspiration

### Charlie Bilello Pattern

Charlie Bilello describes his work as making complex market ideas easier to
understand and separating signal from noise. His recurring formats include
"The Week in Charts" and broader "State of the Markets" reviews across asset
classes. See [Charlie Bilello's Creative Planning profile](https://creativeplanning.com/team/charlie-bilello/)
and [The State of the Markets, August 2026](https://creativeplanning.com/insights/the-week-in-charts/the-state-of-the-markets-august-2026/).

Patterns worth adapting into an original Market Terminal workflow:

- broad cross-asset scorecards
- leaders, laggards, records, drawdowns, and historical comparisons
- one clear observation per visual
- plain-language signal-versus-noise framing
- weekly and state-of-market packages assembled from reusable charts

### Yardeni Pattern

Yardeni publishes daily insights, focused news, clear charts, weekly webcasts,
market calls, economic week-ahead notes, performance derbies, and extensive
earnings/valuation work. Its public research index covers daily markets, global
markets, rates, commodities, currencies, sector performance, earnings,
valuation, breadth, sentiment, and market-macro correlations. See
[Yardeni Research's public chart index](https://archive.yardeni.com/),
[Yardeni QuickTakes](https://www.yardeniquicktakes.com/archive/), and the public
[earnings and valuation market-call example](https://www.yardeniquicktakes.com/us-market-call-stocks-getting-cheaper-as-earnings-outpace-prices/).

Patterns worth adapting:

- a repeatable daily market call with a small number of evidence-backed claims
- chart sequences that move from performance to earnings, breadth, valuation,
  rates, and sentiment
- week-ahead catalysts connected to likely market sensitivities
- relative-performance and sector "derby" views
- explicit links between markets, earnings, and the economy

## Current Market Terminal Overlap

The repository already has many analytical ingredients, but not the editorial
and publishing workflow that joins them.

| Existing module | Reusable capability | Current limitation for this suite |
| --- | --- | --- |
| `HOME` Command Center | Gold/FRED indices, rates, volatility, domestic/global health, catalysts, explicit as-of dates | Strong daily starting point, but no editorial queue or export workflow |
| `SNAP` Market Snapshot | Cross-asset returns, drawdowns, curve, regime, leaders/laggards | Uses the separate market pipeline/file architecture; must not silently enter a Gold-only publishing path |
| `QUILT` Asset Quilt | Bilello-style annual return rankings and dispersion | Pipeline-backed with an optional generated fallback; generated data is prohibited in `MPUB` |
| `IRET` Index Returns | Monthly return matrices, annual returns, drawdowns | Pipeline/file source and per-index provenance need review before reuse |
| `LENS` Market Lens | Configurable comparisons and analytical templates | A research workspace, not a daily publishing queue |
| `MGC` / `MKC` Chart Studios | Reusable macro and market chart construction | No share-card templates, editorial metadata, or publication archive |
| `MOTN` Macro Motion | Animated FRED series | Useful for short video, but needs citation-safe export and editorial framing |
| `MVOL` / `RVOL` | Claim audits, VIX context, rate-volatility regimes | Excellent source for focused posts; export/playback work remains incomplete |
| `ECON`, `INFL`, `CURV`, `CRDT`, `FUND` | Growth, inflation, rates, credit, and liquidity context | Need curated daily-change detectors and reusable publishing presets |
| `CAL` | Real Gold/FRED release calendar | No ready-to-share week-ahead visual or catalyst briefing workflow |
| `NEWS` / `SENT` | Approved live news, clusters, social context, sentiment | Can suggest topics, but must not become an uncited numerical source |
| EDGAR feature documents | Proposed filing and company-fundamental intelligence | Not yet an approved earnings-estimate or valuation data contract |

### Inventory Finding

The closest existing implementation is the `bilello` view in
`src/data/marketPipeline.ts`, consumed by `SNAP` and `QUILT`. It already models
best/worst YTD, annual asset-class returns, monthly returns, current drawdowns,
rate moves, and macro gaps. It is useful as a schema reference, but its committed
JSON and market-pipeline fallback behavior do not meet the Gold-only, no-synthetic
standard required for the new publishing suite.

There is no dedicated Yardeni-style module. Related capabilities are spread
across market snapshot, rates, inflation, credit, sentiment, NEWS, and planned
EDGAR/earnings work.

## Gap To Fill

Market Terminal currently helps analyze data. It does not yet help operate a
repeatable publishing process. The missing layer includes:

- material-change detection and ranking
- a daily editorial queue
- chart templates built around one defensible claim
- chart-level source, transform, frequency, and as-of metadata
- share-ready image and short-video composition
- concise post-copy and alt-text drafting
- pre-publication factual and freshness checks
- a reproducible archive of chart definitions and published snapshots
- a separate approval path for data the Gold/FRED database cannot supply

## Proposed Suite

Version one should expose these as workspaces inside `MPUB`.

## Audience, Tone, And Narrative Modes

The owner should be able to select an editorial profile for each candidate,
saved template, or publication. The profile has three independent controls:

- **Audience:** who the visual and copy are designed for
- **Tone:** how the point is expressed
- **Narrative approach:** which evidence structure organizes the post

Changing the editorial profile may change vocabulary, annotation density,
supporting context, title construction, and copy length. It must never change
the underlying calculation, selected observation window, axis scale, source,
as-of date, confidence language, or required caveat.

### Audience Modes

| Mode | Default emphasis | Communication style | Guardrail |
| --- | --- | --- | --- |
| Macro Investors | Growth, inflation, labor, policy, liquidity, credit, regimes, and medium-term cross-asset implications | Economic framing with cycle and historical context | Do not imply that a macro relationship is causal or immediately tradable |
| Active Traders | Price action, catalysts, volatility, drawdowns, cross-asset confirmation, and near-term scenarios | Concise, time-sensitive, levels and changes first | Do not manufacture intraday precision from daily, weekly, monthly, or stale FRED observations |
| Financial Professionals | Methodology, units, basis, provenance, revisions, comparability, and decision relevance | Compact institutional language with visible definitions | Do not hide limitations for the sake of a cleaner executive summary |
| Quants | Sample construction, transforms, distributions, base rates, confidence bands, robustness, and alternative explanations | Method-first language with statistical annotations | Do not equate statistical significance, correlation, or backtest fit with an exploitable edge |
| Broader Investing Twitter | One clear idea, plain-language definitions, intuitive comparisons, and why the observation matters | Accessible, concise, and visually led | Simplify the explanation, never the factual qualification or risk disclosure |

Audience mode should also influence the default supporting panels. For example,
a quant version of an `MVOL` visual should lead with sample size and confidence
bands, while the broader-audience version should lead with the base rate and
plain-language verdict. Both versions must show the same result and caveats.

### Tone Modes

Initial selectable tones:

- `Analytical`: neutral, measured, and evidence-first
- `Direct`: concise conclusion with supporting evidence immediately visible
- `Educational`: explains the metric and why the comparison is useful
- `Contrarian`: tests a popular claim against base rates and history
- `Risk-Aware`: emphasizes uncertainty, downside cases, and what could invalidate
  the interpretation
- `Executive`: shortest decision-relevant summary with methodology available on
  inspection
- `Social/Punchy`: strong opening line and compact phrasing without sensationalism

Tone is not sentiment. A `Social/Punchy` mode cannot overstate certainty, remove
a caveat, or turn an unavailable result into a claim.

### Narrative Approaches

Initial selectable approaches:

- `What Changed`: latest move, magnitude, and comparison period
- `Why It Matters`: observed change followed by economic or market relevance
- `Signal Or Noise`: base rate, conditional evidence, and verdict
- `Historical Context`: percentile, prior episodes, or long-run comparison
- `Claim Audit`: claim, reconstruction, result, uncertainty, and conclusion
- `Cross-Asset Confirmation`: primary move compared with rates, credit,
  volatility, currencies, or commodities
- `Regime Shift`: evidence that a state or trend changed, plus the threshold used
- `Week Ahead`: catalyst, consensus context when approved, exposed series, and
  scenario branches
- `Chart Thread`: ordered sequence from headline fact to supporting evidence and
  caveats

The UI should offer a preview matrix so the owner can compare two editorial
profiles against the same immutable chart data before choosing one.

### Editorial Profile Contract

Each candidate and archived publication should retain:

- `audience`
- `tone`
- `narrativeApproach`
- `detailLevel`
- owner-edited title and copy
- generated-versus-owner-edited status for each text field

The original generated draft must remain recoverable after manual edits. The
archive should record the final selected profile so a successful format can be
reused without losing its data and methodology contract.

The owner should also be able to save named custom profiles, such as
`Macro / Educational / Historical Context` or
`Traders / Direct / Cross-Asset Confirmation`. Custom editorial instructions
may refine language and structure, but they remain subordinate to the immutable
data, provenance, citation, and caveat rules.

## Recurring Publication Packages

`MPUB` should support recurring, versioned packages in addition to individual
charts. A package is an ordered collection of chart definitions, commentary,
citations, unavailable-section notices, and one editorial profile. Every edition
must have an explicit data cutoff and retain the as-of date of each included
series.

Default scheduling should use `America/New_York`, respect US market holidays,
and remain configurable. A scheduled time creates or refreshes a draft; it does
not publish externally.

| Package | Default cadence | Primary purpose | Core content |
| --- | --- | --- | --- |
| Pre-Market Brief | US business days before the open | Establish the day's macro and market setup | Prior-close performance, rates, volatility, credit/liquidity state, overnight context only when approved data exists, and today's catalysts |
| Post-Release Note | Event-driven after an approved Gold update | Explain a major economic release quickly and accurately | Actual reading, prior and revised prior, change, trend, component detail, historical context, and market sensitivity |
| Market Close Wrap | US business days after approved close data is available | Summarize what moved and what mattered | Index and cross-asset returns, actual level changes, rates, VIX, credit, leaders/laggards, regime changes, and selected chart candidates |
| Weekend Week In Markets | Weekly after Friday data is complete | Package the week's most important charts and narratives | Weekly performance, major records/drawdowns, macro releases, rates/volatility/credit, signal-or-noise review, and next week's catalysts |
| Monthly State Of Markets And Economic Health | Monthly after key month-end data is available | Review markets and the economic cycle together | Monthly/YTD performance, growth, labor, inflation, policy, liquidity, credit, global health, volatility, risks, and historical context |
| Quarterly Market Guide | Quarterly after the selected data cutoff | Produce a durable, broad market-and-economy reference package | Economic cycle, markets, policy/rates, inflation, labor, consumer/housing, liquidity/credit, global context, volatility, long-run comparisons, scenarios, and approved earnings/valuation sections |

### Pre-Market Brief

The pre-market package should lead with what is known before the US open:

- prior-close index and cross-asset performance
- latest Treasury curve, policy, credit, volatility, and liquidity observations
- today's scheduled economic releases and major known catalysts
- the current macro and volatility regime
- three to five charts or facts worth watching

Under the initial Gold/FRED-only policy, this package must say `Prior Close` or
`Latest Available` where appropriate. It cannot describe overnight futures,
pre-market equities, or live global trading unless Joshua later approves those
inputs and they are landed in the upstream Gold contract.

### Post-Release Note

This package should be generated only after the release's approved Gold rows have
updated, not merely because the scheduled release time has passed. It should
support CPI/PCE, payrolls/unemployment, GDP, retail sales, industrial production,
housing, FOMC-related data, and other cataloged releases.

Every edition should show:

- release name and release period
- published-at time when the approved calendar provides it
- actual, prior, revised prior, and expected value only when each field is
  available from an approved source
- level, period-over-period change, and year-over-year change where meaningful
- contribution/component context without mixing SA and NSA data
- historical percentile or comparable episodes
- explicit revision and missing-consensus states

Market reaction should be included only when approved market observations cover
the required pre/post window. Otherwise the package should omit that section
rather than infer a reaction.

### Market Close Wrap

The close package should be anchored to the latest completed observation in the
approved database, not a hard-coded 4:00 p.m. timestamp. It should distinguish
index level changes from percentage returns and show the exact start/end dates
for linked returns.

Recommended sequence:

1. Headline market scorecard
2. Rates, volatility, and credit confirmation
3. Leaders, laggards, records, and drawdowns
4. Macro/news context supported by approved evidence
5. One primary chart and two supporting candidates
6. Tomorrow's known catalysts

### Weekend Week In Markets

This should be the flagship recurring social package: a compact ordered chart
thread plus optional longer-form review. It should select the week's strongest
evidence across markets, macro, rates, credit, volatility, and claim audits,
while retaining rejected candidates so selection bias can be reviewed.

The default narrative flow should be:

1. The week in one sentence
2. Cross-asset and index performance
3. The most consequential macro development
4. Rates, credit, and volatility confirmation or disagreement
5. Leaders, laggards, records, or historical extremes
6. Signal-or-noise or claim-audit chart
7. The week ahead

### Monthly State Of Markets And Economic Health

The monthly package should combine market performance with an economic-health
scorecard rather than treating them as separate stories. It should compare the
latest month, quarter-to-date, year-to-date, and relevant long-run context.

Core chapters:

- market and cross-asset state
- US growth and labor health
- inflation and policy progress
- rates, credit, liquidity, and financial conditions
- global growth/inflation/policy snapshot
- volatility and risk regime
- recession, overheating, and policy-risk indicators
- strongest evidence, contradictory evidence, and what to watch next

### Quarterly Market Guide

The quarterly package should provide the breadth and reference value commonly
associated with a "Guide to the Markets," but it must be an original Market
Terminal product. Do not copy another firm's chart designs, language, page order,
branding, forecasts, or proprietary data.

Recommended chapters:

1. Executive state-of-markets dashboard
2. Economic cycle and domestic health
3. Inflation, labor, consumer, housing, and production
4. Monetary policy, Treasury curve, real yields, and financial conditions
5. Credit, liquidity, reserves, and funding
6. US and global market performance
7. Volatility, drawdowns, breadth, and risk regimes
8. Historical returns, cycles, and cross-asset relationships
9. Earnings, margins, and valuation only where an approved Gold contract exists
10. Scenario map, risks, conflicting signals, and next-quarter catalysts
11. Methodology, source, revision, and availability appendix

The initial output can be an ordered collection of share-ready charts. PDF or
slide-deck export should be added only after deterministic pagination, citations,
and visual QA are defined. Each chapter should also support social cutdowns that
retain the parent edition and chart provenance.

### Package Edition Contract

Each package edition should retain:

- `packageType`
- `editionDate` and covered period
- `scheduledFor`, `cutoffAt`, and `generatedAt`
- per-series and per-section `dataAsOf`
- selected audience, tone, narrative approach, and detail level
- ordered included chart IDs and template versions
- unavailable, stale, omitted, and owner-suppressed sections with reasons
- draft, reviewed, ready, published, corrected, or superseded status
- owner edits, citations, exports, and parent/child social cutdowns

Refreshing a draft may update its data through the edition cutoff. Once marked
`Published`, an edition is immutable; fixes create a linked corrected edition.

### 1. Today

A morning/close briefing assembled from approved data:

- cross-asset and index performance
- rates and curve movement
- volatility, credit, and liquidity state
- domestic and global macro health
- recent releases and upcoming catalysts
- new highs/lows, drawdowns, unusual moves, and regime changes
- a ranked list of candidate stories with a factual reason each was selected

This workspace should answer "what deserves a chart today?" It should not write
an investment recommendation or invent a narrative when the evidence is weak.

### 2. Chart Queue

A curation board for candidate visuals:

- `Candidate`
- `Selected`
- `Needs review`
- `Ready`
- `Published`
- `Archived`

Each item stores a title, one-sentence takeaway, chart definition, source series,
transform, observation dates, staleness state, caveat, destination format, and
publication status.

### 3. Market Derbies

Reusable ranking and relative-performance visuals inspired by the best parts of
`SNAP`, `QUILT`, and `IRET`:

- daily, weekly, MTD, QTD, YTD, 1Y, 3Y, and 5Y performance
- price level change versus percentage return kept distinct
- sectors, styles, regions, asset classes, and rates ranked consistently
- current drawdown and distance from record high
- equal-weight versus capitalization-weight comparisons when approved data exists
- US versus rest-of-world and risk-on versus defensive comparisons

One year and longer returns should use the terminal's documented annualization
policy where applicable. Every visual must state whether returns are price or
total return; no mixed-basis ranking is allowed.

### 4. Macro And Volatility

Share-ready views composed from Gold-backed modules:

- inflation trend and component leadership
- growth and labor momentum
- Treasury curve and real/nominal rate changes
- credit spreads and financial conditions
- reserves, liquidity, and funding conditions
- VIX and volatility regimes
- claim-audit visuals from `MVOL`
- historical percentile, recession/shock comparison, and rolling relationship
  views when the sample and methodology are disclosed

### 5. Earnings And Valuation

Planned workspace, unavailable by default until an upstream contract is
explicitly approved.

Desired eventual views:

- reported earnings and revenue growth
- beat/miss breadth and surprise magnitude
- forward earnings and revisions
- price versus earnings growth
- profit margins
- forward and trailing valuation
- earnings yield versus Treasury yields
- sector earnings contribution and breadth
- earnings calendar and post-report price reaction

FRED does not provide the complete analyst-consensus, forward-estimate,
company-level surprise, and valuation history needed for these views. Existing
Gold SEC company-fundamental tables may support reported fundamentals after a
separate coverage and semantics audit, but they do not by themselves solve
consensus estimates or earnings-calendar timing. `MPUB` must show this workspace
as unavailable until Joshua approves a specific upstream source and Gold schema.

### 6. Publish

A composition and review surface, not an automatic social bot.

- select a chart or ordered chart thread
- select audience, tone, narrative approach, and detail level
- compare editorial-profile previews against the same immutable chart data
- edit title, takeaway, caveat, source footer, and alt text
- preview landscape, square, and vertical-safe layouts
- export PNG first; add video only after deterministic rendering is verified
- copy post text and alt text
- run freshness, missing-data, transform, and citation checks
- require a final human approval before anything is posted externally

Direct posting to X or any other platform is out of scope until separately
approved, including credentials, permissions, rate limits, and audit behavior.

### 7. Archive

A local, reproducible library of output definitions:

- publication date and platform
- exported artifact path or immutable identifier
- chart-spec version
- series IDs and source tables
- query/transform parameters
- data-as-of and generated-at timestamps
- title, copy, alt text, caveats, and citations
- audience, tone, narrative approach, detail level, and manual-edit status
- package type, edition period, cutoff, chapter order, and parent/child artifact links
- superseded/corrected status

The archive should store definitions and provenance, not scraped copies of other
publishers' charts.

## Initial Content Template Library

Phase one should start with a small set of dependable templates rather than an
unbounded chart generator.

1. Daily market scoreboard
2. Five-day and YTD leaders/laggards
3. Index level, actual level change, and linked-return horizon table
4. Current drawdown versus history
5. Treasury curve today versus one week/month/year ago
6. 2s10s and 3m10y slope history
7. VIX level and volatility-regime context
8. Credit-spread risk gauge with historical percentile
9. Inflation headline/core/component momentum
10. Labor and growth health snapshot
11. Liquidity/reserves/funding dashboard
12. Economic week ahead
13. Claim audit with base rate, signal rate, lift, confidence band, and verdict
14. Historical analog with explicit sample and non-causal caveat
15. Earnings and valuation package, disabled until its source gate is cleared

## Data Policy

### Non-Negotiable Rules

- Do not add a new data source to Market Terminal without explicit discussion
  and approval from Joshua.
- Phase one `MPUB` numerical data must come from the approved FRED/Economic Gold
  SQLite pipeline through `MACRO_DB_URL`.
- Do not flow sample, generated, synthetic, committed fixture, or silent fallback
  values into `MPUB`.
- Missing, stale, or unsupported data must render as unavailable with a reason.
- Reused module output is permitted only when its resolved rows satisfy the same
  approved-source and no-fallback contract.
- Existing approved NEWS/SOCIAL feeds may help surface topics, but a headline is
  not evidence for a plotted value. Numerical claims must resolve to an approved
  structured dataset and carry their own citation.

### Source Gate

Any proposed dataset outside the current Gold/FRED contract requires a written
decision containing:

- business use and exact fields needed
- provider and licensing/redistribution terms
- historical depth, frequency, and revision behavior
- upstream ingestion and Gold schema ownership
- quality, freshness, and outage behavior
- cost and credential handling
- explicit owner approval before implementation

Market Terminal remains a read-only consumer. New ingestion belongs in the
upstream pipeline/database repository, followed by a reviewed Gold contract.

## Trust And Citation Contract

Every exported visual must visibly include:

- data source and series IDs or dataset name
- observation as-of date
- generated-at date when useful
- frequency and units
- transformation or return basis
- annualization method when applicable
- stale, partial, revised, or unavailable state

Every chart definition must retain enough metadata to reproduce the visual.
Revised economic series should not be described as point-in-time evidence unless
vintage-aware data was actually used. Correlation must not be described as
causation, and a historical conditional frequency must not be framed as a
tradable edge without a tradability-aware test.

## Editorial Ranking

Candidate stories should receive transparent component scores rather than a
black-box "viral" score:

- magnitude versus recent history
- historical percentile or record proximity
- cross-asset confirmation
- economic or market relevance
- freshness
- chart clarity
- data completeness
- caveat severity

The UI should display why a candidate ranked highly. The owner makes the final
editorial selection.

## Visual Output Contract

- Provide configurable landscape, square, and vertical-safe canvases.
- Use stable pixel dimensions and deterministic layout.
- Keep one primary message per visual.
- Show endpoint labels and the exact latest observation date.
- Keep source/caveat text legible in the exported artifact.
- Use consistent positive/negative colors without implying that every increase
  is good or every decrease is bad.
- Avoid decorative elements that obscure actual data.
- Generate descriptive alt text from the same chart data, then allow editing.
- Preserve a clean original Market Terminal visual identity.

## High-Level Architecture

```text
Gold/FRED SQLite
       |
       v
approved read-only queries
       |
       v
daily facts + material-change detectors
       |
       v
editorial candidate queue
       |
       v
versioned chart templates
       |
       v
review checks -> image/video render -> local publication archive
```

Proposed route families, subject to implementation review:

- `GET /api/market-publishing/daily`
- `GET /api/market-publishing/candidates`
- `GET /api/market-publishing/packages`
- `POST /api/market-publishing/render`
- `GET /api/market-publishing/archive`

The first two routes should be read-only and Gold-backed. Render/archive writes
should use an explicitly approved local artifact location and versioned schema;
they should never mutate the Gold database.

## Delivery Plan

### Phase 0: Contract Audit

- map every initial template to exact Gold tables, series IDs, units, and dates
- classify existing reusable modules as approved, partial, or blocked
- confirm no synthetic/file fallback can enter the new route family
- identify Gold gaps and create upstream handoffs instead of adding APIs locally
- decide final suite/module naming and visual identity

Deliverable: approved template-to-data matrix and source-gap list.

### Phase 1: Gold Daily Brief

- implement Gold-only daily facts and material-change detectors
- build `Today` and `Chart Queue` workspaces
- add audience, tone, and narrative selectors with deterministic text presets
- add draft generators for Pre-Market, Post-Release, and Market Close packages
- ship five initial templates: daily scoreboard, market derbies, curve, volatility
  and credit, and macro week ahead
- make per-card as-of dates and unavailable states explicit
- add tests proving no sample/synthetic fallback is reachable

Deliverable: useful daily research workflow without export automation.

### Phase 2: Share Studio

- add deterministic chart-card layouts
- add side-by-side editorial-profile previews over immutable chart data
- add title/takeaway/caveat/source/alt-text editing
- add PNG export and copyable post text
- add pre-publication validation
- add thread/carousel ordering without direct social posting
- add Weekend Week In Markets and Monthly State Of Markets And Economic Health
  package composition

Deliverable: human-reviewed share-ready images generated from approved data.

### Phase 3: Archive, Quarterly Guide, And Motion

- persist versioned chart definitions and publication metadata locally
- add correction/supersession workflow
- add the Quarterly Market Guide chapter system and social cutdowns
- connect approved `MOTN`/`MVOL` playback to deterministic short-video rendering
- retain source and as-of labels throughout animation

Deliverable: reproducible publishing history and citation-safe motion output.

### Phase 4: Earnings Decision Gate

- audit existing Gold SEC fundamentals coverage and semantics
- define missing consensus, estimate-revision, valuation, and event-calendar fields
- prepare an upstream data-source proposal for owner review
- implement earnings views only after explicit approval and Gold integration

Deliverable: approved earnings data contract or a documented decision to defer.

### Phase 5: Editorial Analytics And Optional Distribution

- measure which templates and topics were published most consistently
- record manually supplied post-performance metrics if desired
- improve candidate ranking without optimizing for unsupported sensational claims
- evaluate direct X integration only as a separate permissioned project

## Version-One Acceptance Criteria

- `MPUB` displays only approved Gold/SQLite numerical data.
- A code test demonstrates that fixture, sample, and synthetic paths cannot feed
  the module.
- Every displayed and exported number has an observation as-of date.
- Every exported chart has source, units, transform, and return-basis metadata.
- At least five daily templates render useful real data or an explicit
  unavailable state.
- Pre-Market, Post-Release, and Market Close drafts retain explicit edition
  cutoffs and per-section as-of dates.
- The owner can move a candidate through the editorial queue and export a PNG.
- The owner can select any supported audience, tone, and narrative approach, and
  the resulting presentation preserves identical data, dates, and caveats.
- The exported artifact can be reproduced from its saved chart definition.
- No external post is published without a separate human action.
- Earnings views remain disabled until their source contract is approved.

## Risks And Pitfalls

- **False freshness:** daily presentation does not make monthly or quarterly
  economic observations daily. Always show the underlying observation date.
- **Revision bias:** current revised macro history can overstate what was known
  at an earlier date.
- **Mixed return bases:** price and total return series cannot be ranked together
  without explicit handling.
- **Frequency mismatch:** daily market data and weekly/monthly macro data require
  documented alignment.
- **Narrative overreach:** a compelling chart can still be statistically weak or
  non-causal.
- **Selection bias:** repeatedly choosing only extreme charts can create a
  misleading editorial record.
- **Licensing:** public availability does not automatically permit every form of
  redistribution; exported visuals need source-specific review.
- **Earnings incompleteness:** reported SEC facts are not a substitute for
  consensus estimates, revisions, or a complete earnings calendar.
- **Automation risk:** automatic copy generation or posting can amplify a stale,
  revised, or incorrectly transformed value.

## Decisions Before Implementation

Recommended defaults are included so work can proceed once approved.

| Decision | Recommendation |
| --- | --- |
| Navigation | One `MPUB` module with workspaces, not seven new sidebar items |
| Initial source | Gold/FRED SQLite only |
| Legacy `bilello` data | Schema inspiration only until rebuilt on an approved Gold contract |
| Synthetic behavior | Prohibited; explicit unavailable state |
| First output | PNG plus copyable text and alt text |
| Direct posting | Defer; always human-reviewed in early phases |
| Earnings | Keep disabled until a separate source/Gold contract is approved |
| Archive | Local versioned definitions and metadata; never write to Gold |
| Audience modes | Macro investors, active traders, financial professionals, quants, and broader investing Twitter |
| Tone and approach | Independently selectable and saved per publication |
| Recurring packages | Six versioned package types; schedules create drafts and never auto-publish |
| Quarterly format | Original `Quarterly Market Guide`, with earnings/valuation sections gated by approved data |
| Editorial voice | Original Market Terminal voice; selectable framing remains evidence-first and non-sensational |

## Recommended First Slice

Start with Phase 0 and a thin Phase 1 vertical slice:

1. Audit Gold coverage for the 14 initial templates.
2. Define the daily-facts response contract.
3. Implement five Gold-only candidate detectors.
4. Render `Today` and `Chart Queue` with explicit unavailable states.
5. Add a no-fallback test before any export work.

This proves the daily editorial loop with trusted data before investing in image
rendering, motion, earnings, or distribution automation.

## Related Documents

- `docs/handoff.md`
- `docs/roadmaps/MARKET_TERMINAL_ROADMAP.md`
- `docs/roadmaps/FUTURE_FEATURE_ROADMAP.md`
- `docs/gold-db/MODULE_DATA_AUDIT.md`
- `docs/data/DATA_PIPELINE_OVERVIEW.md`
- `docs/data/PLATFORM_DATA_CONNECTIVITY.md`
- `docs/specs/spec002_news_live_intelligence/SPEC.md`
- `docs/specs/spec003/SPEC.md`
- `docs/specs/spec004/PHASE0_DATA_CONTRACT.md`
- `docs/features/completed/Feature Addition - Market Lens Studio.md`
- `docs/features/Feature Addition - EDGAR Filing Intelligence (Regime, NLP & Exposure Analytics).md`
