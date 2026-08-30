# Feature Completion — NEWS NLP: live Attention, Event Clusters & Signals

Date: 2026-06-22
Status: Completed — tape-derived attention, clusters, and signals are integrated
Related: `docs/features/completed/Feature Addition - NEWS Terminal Module (Market News & Signal Intelligence).md`, `news_nlp/README.md`, `docs/data/PLATFORM_DATA_CONNECTIVITY.md`, `docs/specs/spec002_news_live_intelligence/SPEC.md`

> **Update 2026-08-30.** The higher-fidelity `news_nlp` path is now wired:
> `/api/news` can consume service-backed scoring/clustering, `/api/news/diagnostics`
> and DATAOPS expose structured `NEWS_NLP` health, and the NEWS diagnostics
> drawer can inspect raw provider and NLP payloads. Current active work is
> tracked in `docs/specs/spec002_news_live_intelligence/SPEC.md`; the next NEWS
> priority is the upstream-pipeline persistence handoff before any historical
> storage code.

## Objective

Take the NEWS module from "core wired" to **complete** — every view that *can* be
derived from the live tape is, instead of rendering a fixture. The headline tape,
narrative monitor, social and sentiment layering are already live-capable; this
finishes the three remaining simulated views and the partial one.

## Current state → target

| View | Before | After |
|---|---|---|
| NEWS-1 Headline Tape | ✅ live (provider chain) | ✅ |
| NEWS-2 Narrative Monitor | ✅ from live headlines | ✅ |
| NEWS-3 Social | ✅ Reddit+StockTwits | ✅ |
| NEWS-5 Attention | 🟡 tickers only | ✅ **all 4 dimensions from the tape** |
| NEWS-6 Event Clusters | ❌ fixture | ✅ **clustered from the live tape** |
| NEWS-7 Signal Engine | ❌ template-seeded | ✅ **derived from live narratives/attention/social** |
| NEWS-4 Market Impact | ❌ curated model | 🟡 **event list driven by live clusters; impact magnitudes stay a curated historical model** (needs an external event-study dataset to go fully live — out of scope) |

## Work items

1. **NEWS-5 Attention — finish the heatmap.** Extend `attentionFromHeadlines` to derive
   *sectors* (ticker→sector map over the headline ticker mentions), *countries* and
   *commodities* (keyword scan of headline text). Per-dimension fallback to the seeded
   rows when the live tape is too sparse (<3 hits).

2. **NEWS-6 Event Clusters — cluster the tape.** New `eventsFromHeadlines` groups
   headlines by narrative keyword match (reusing `NARRATIVE_KW`): each narrative with
   ≥2 matches becomes a cluster with a representative title, modal asset class, related
   count, importance (mentions × recency), net sentiment, first-seen time, distinct
   sources, and a generated summary. Falls back to the curated clusters when nothing
   clears the threshold.

3. **NEWS-7 Signal Engine — derive from live signals.** New `signalsFromHeadlines`
   builds signals from the *now-live* narratives (acceleration + sentiment regime),
   social (mention-velocity spikes) and attention (abnormal attention) — real evidence
   strings and confidence from the underlying magnitudes; curated `similarEpisodes`
   retained as historical analogs.

4. **NEWS-4 Market Impact (honest partial).** Drive the event *selection* from the live
   clusters/narratives so the dashboard reflects what's actually in the tape; keep the
   per-asset impact magnitudes as the labelled **historical-average model** until an
   event-study dataset is connected. Documented, not faked.

## Approach & guarantees

- All derivations are **pure functions over the (possibly live) `Headline[]`** the
  `useNews` hook already provides — same pattern as NEWS-2/NEWS-5 tickers. No new feed
  required: with a provider key the whole module is live; with none it's deterministic SIM.
- Every new function **falls back to the existing engine** so views never render empty.
- Provenance unchanged — the header badge already reflects the headline source.

## Higher-fidelity upgrade

The `news_nlp` stage now supports service-backed scoring and clustering behind
the same terminal shapes, and `/health` reports separate sentiment, clustering,
NER, lexicon fallback, device, and runtime metadata. NEWS-6 uses transformer
clusters when `NEWS_NLP_URL` is configured and keyword clustering otherwise.

## Out of scope

- Historical headline/social persistence. That requires the Phase 3 upstream
  persistence handoff in `docs/specs/spec002_news_live_intelligence/`.
- X/Twitter social adapter (paid).
- A real event→asset-move dataset for NEWS-4 magnitudes.
