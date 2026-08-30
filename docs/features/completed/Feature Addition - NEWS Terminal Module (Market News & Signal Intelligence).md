# Build Prompt: NEWS Terminal Module (Market News, Social Intelligence & Signal Engine)

Date: 2026-06-20
Status: Completed — terminal module implemented; live ingestion remains provider-dependent
Module code: **`NEWS`** — Market News & Signal Intelligence

> **Implementation status (2026-06-21).** The terminal-side module is shipped:
> `src/data/news.ts` (deterministic gold-table engine), `src/app/news/page.tsx`
> (all seven core views — Headline Tape, Narrative Monitor, Social Intelligence,
> Market Impact, Attention Heatmap, Event Intelligence, Signal Engine), and the
> `NEWS` nav entry in the INTELLIGENCE group. Data is seeded/SSR-safe and badged
> `SIM`; the gold-table shapes match this plan so the Python pipeline can serve
> them live (Alpha Vantage / Marketaux / Reddit / SEC EDGAR) without UI changes.
> The NLP/clustering/historical-impact *backends* described below are the next
> phase.
>
> **Update 2026-08-30.** NEWS now has live-capable headline/social provider
> chains, `/api/news/diagnostics`, `/api/social/diagnostics`, DATAOPS
> `INTELLIGENCE_FEEDS`, a diagnostics drawer, and structured `news_nlp`
> component health. Current active work lives in
> `docs/specs/spec002_news_live_intelligence/SPEC.md`; next priority is the
> upstream-pipeline persistence handoff before any historical storage code.
Related: `docs/MARKET_TERMINAL_ROADMAP.md`, `docs/features/Feature Addition - Intelligence Layer (SEC Edgar, Stocktwits, X, and News).md`, `docs/features/Feature Addition - EDGAR Filing Intelligence (Regime, NLP & Exposure Analytics).md`, `docs/specs/spec002_news_live_intelligence/SPEC.md`

---

## Objective

Design and implement a production-grade **NEWS Module** for the QIT Terminal (Bloomberg-style Quant Intelligence Platform).

This is NOT a generic news feed.

The goal is to create an institutional-quality **Market Intelligence Engine** that continuously ingests, classifies, scores, summarizes, and generates actionable signals from:

1. Financial News APIs
2. X (Twitter) posts
3. Reddit discussions
4. SEC Filings
5. Earnings Releases
6. Economic Releases
7. Central Bank Communications

The system should ultimately answer:

> "What matters right now?"
>
> "Why does it matter?"
>
> "Who is talking about it?"
>
> "How important is it?"
>
> "What historically happens after events like this?"
>
> "Which positions, sectors, asset classes, and securities are most exposed?"

The module must integrate into the existing:

- Next.js Terminal Frontend
- Python Market Data Pipeline
- DuckDB
- Polars
- FastAPI
- Medallion Architecture
- Existing DataOps Framework

---

# Design Principles

The system should behave more like:

- Bloomberg News Monitor
- Bloomberg TOP
- Bloomberg News Heatmap
- Bloomberg MLGO
- AlphaSense
- Koyfin News Intelligence

and less like:

- Yahoo Finance news page
- RSS feed reader
- Generic news aggregator

The focus is:

- Signal extraction
- Regime awareness
- Market relevance
- Historical context
- Narrative evolution

---

# New Terminal Module

Module Code:

NEWS

Module Name:

Market News & Signal Intelligence

---

# Core Views

## NEWS-1

Headline Tape

Real-time scrolling feed.

Columns:

- Timestamp
- Importance Score
- Asset Class
- Region
- Source
- Headline
- Sentiment
- Impact Score

Filters:

- Equities
- Rates
- Credit
- Commodities
- FX
- Crypto
- Macro
- Securities Finance

---

## NEWS-2

Narrative Monitor

Detect emerging narratives.

Examples:

- AI Boom
- Banking Stress
- Inflation Reacceleration
- Soft Landing
- Recession
- Fed Cuts
- Treasury Supply
- Energy Shock

Show:

- Narrative
- Mentions Today
- 7D Change
- 30D Change
- Sentiment Trend
- Velocity

Visual:

Narrative Bubble Map

---

## NEWS-3

Social Intelligence

Combines:

- X
- Reddit

Show:

- Most discussed tickers
- Most discussed sectors
- Most discussed macro themes
- Trending topics
- Mention velocity

---

## NEWS-4

Market Impact Dashboard

Show:

Historical impact of similar events.

Example:

Fed Surprise Cut

Historically:

SPY:
+2.1%
+4.3%
+7.8%

over:

- 1 Day
- 1 Week
- 1 Month

Similar analysis for:

- Rates
- Credit
- VIX
- Commodities
- Dollar

---

## NEWS-5

Market Attention Heatmap

Rank:

- Tickers
- Sectors
- Countries
- Commodities

by:

Attention Score

---

## NEWS-6

Event Intelligence

Cluster news into events.

Instead of 500 headlines:

Show:

US Inflation Surprise

Related Headlines:
(23)

Summary:
Generated automatically.

---

## NEWS-7

Market Signal Engine

Generated signals.

Examples:

"Credit stress mentions rising rapidly."

"Fed-cut narrative accelerating."

"AI capex discussion strongest since 2023."

"Regional bank stress discussion increasing."

Signals should have:

- Confidence
- Direction
- Supporting Evidence
- Similar Historical Episodes

---

# Data Sources

## Tier 1 News Sources

Use multiple sources.

### Alpha Vantage News Sentiment

Free

Ingest:

- headline
- summary
- source
- ticker tags
- sentiment

---

### Marketaux

Free Tier

Ingest:

- headlines
- entities
- symbols
- industries

---

### SEC EDGAR

Required

Ingest:

- 10-K
- 10-Q
- 8-K
- S-1

Detect:

- risk factor changes
- guidance changes
- liquidity concerns
- financing needs

---

### FRED Releases

Required

Economic releases.

---

### Federal Reserve Communications

Ingest:

- FOMC statements
- Minutes
- Speeches

---

# Social Intelligence Layer

## X (Twitter)

Build pluggable connectors.

Support:

### Official API Mode

If credentials available.

### Alternative Mode

Design connector abstraction.

Do NOT hardcode any provider.

Create interface:

SocialSourceAdapter

Implementations:

- XSourceAdapter
- RedditSourceAdapter

Required metadata:

- post_id
- timestamp
- author
- followers
- likes
- reposts
- replies
- impressions (if available)
- url

Store raw.

Never store only processed outputs.

---

## Reddit

Target Subreddits

### Markets

- r/stocks
- r/investing
- r/options
- r/wallstreetbets
- r/valueinvesting

### Economics

- r/economics

### Fixed Income

- r/bonds

### Macro

- r/macroeconomics

### Crypto

- r/cryptocurrency

Capture:

- title
- body
- score
- comments
- subreddit
- author

Calculate:

- engagement score
- velocity score
- sentiment score

---

# Data Architecture

Follow Medallion.

---

## Raw Layer

Store exactly as received.

Tables:

raw_news_articles

raw_social_posts

raw_reddit_posts

raw_fed_releases

raw_sec_filings

raw_central_bank_docs

---

## Silver Layer

Normalized format.

Table:

normalized_news_events

Columns:

event_id
headline
body
source
source_type
timestamp
asset_class
country
sector
ticker
sentiment
importance
engagement

---

## Gold Layer

Tables:

analytics_news_signals

analytics_narratives

analytics_social_trends

analytics_market_attention

analytics_event_clusters

analytics_historical_impact

analytics_news_dashboard

---

# NLP Layer

Implement using open-source models.

Prefer:

- Sentence Transformers
- FinBERT
- FinGPT-compatible models
- spaCy

Tasks:

- sentiment
- entity extraction
- topic extraction
- summarization
- clustering

---

# Narrative Detection Engine

Cluster similar stories.

Example:

100 articles discussing:

"Nvidia AI demand"

Become:

Single Narrative

Metrics:

- narrative_score
- velocity
- acceleration
- breadth
- sentiment

---

# Attention Score Framework

Create composite score.

Inputs:

Headline Count
Source Quality
Engagement
Social Mentions
Market Reaction
Recency

Output:

0-100

Attention Score

---

# Signal Framework

Generate signals when thresholds are exceeded.

Examples:

Mention Velocity Spike

Narrative Acceleration

Sentiment Regime Shift

Cross-Asset Narrative Spread

Abnormal Attention Score

Unusual Social Activity

---

# Historical Event Engine

For every detected event:

Search historical database.

Find:

Top N similar events.

Calculate forward returns.

Horizons:

- 1D
- 5D
- 10D
- 20D
- 60D

Assets:

- SPY
- QQQ
- TLT
- HYG
- LQD
- GLD
- DXY
- VIX
- SOFR
- Treasury Curve

---

# AI Layer

Generate:

Daily Intelligence Brief

Structure:

What Happened
Why It Matters
Key Narratives
Social Trends
Risk Signals
Opportunities
What To Watch Tomorrow

---

# DataOps

Track:

source
vendor
ingestion_time
processing_time
latency
quality_score

Maintain:

Full lineage

Every signal must trace back to:

- article
- post
- filing
- release

---

# Frontend Requirements

Terminal Style

Black Background

Dense Layout

Keyboard Driven

Bloomberg Inspired

Support:

Multi-monitor workflows

Minimal whitespace

Streaming updates

---

# Stretch Goals

Build:

Market Intelligence Graph

Nodes:

- Companies
- Economies
- Commodities
- Narratives
- Central Banks
- Securities

Edges:

- Mentioned Together
- Influences
- Causes
- Exposed To

Allow users to explore:

"Show all entities connected to Treasury Supply narrative."

or

"Show everything linked to Nvidia."

---

# Deliverables

Produce:

1. Full Architecture Design
2. Database Schema
3. ETL Framework
4. Connector Design
5. NLP Pipeline
6. Signal Engine
7. Historical Impact Engine
8. FastAPI Endpoints
9. Next.js Integration Plan
10. Testing Strategy
11. DataOps Framework
12. Deployment Plan
13. Cost Analysis
14. Scaling Roadmap
15. Security & Compliance Review

The solution should be designed as if it will eventually support:

- Tens of thousands of users
- Millions of news records
- Multi-asset institutional workflows
- Future migration to premium vendors such as Bloomberg, FactSet, Refinitiv, Polygon, RavenPack, Dataminr, and AlphaSense

---

## Notes for implementation (reuse within this repo)

This prompt is a build brief. When implemented, it should reuse existing terminal
infrastructure rather than rebuild it:

- **EDGAR ingestion / section extraction / NLP / regime** — reuse the pieces mapped in
  `docs/features/Feature Addition - EDGAR Filing Intelligence (Regime, NLP & Exposure Analytics).md`
  and the sibling `unstructured_signal_fusion` repo (SEC client, section rules, embeddings,
  HMM, importance scoring, topic drift).
- **FRED releases / Fed communications** — reuse `/api/econ/*`, `src/data/econSeries.ts`,
  `src/lib/server/fred.ts`, and the econ calendar.
- **Historical Event Engine forward-return math** — reuse the Market Lens engine
  (`src/data/marketLens.ts`) which already computes event-conditional forward returns over
  SPY/QQQ/TLT/HYG/LQD/GLD/VIX with committed-snapshot + FRED series.
- **Provenance / DataOps** — reuse the `LIVE / DB / FILE / FRED / SNAPSHOT / SIM` badge
  convention and the `DATAOPS` module for lineage and quality scores.
- **Frontend primitives** — `PageHeader`, `KpiStrip`, `Panel`, `DataGrid`, `NetworkGraph`
  (for the Market Intelligence Graph), `Treemap`/`HeatGrid` (Attention Heatmap), `Sankey`,
  and the charting engine (`src/lib/charting`, `src/components/charting`).
- **Alerts** — signals stream into the `ALRT` Alert Center.
