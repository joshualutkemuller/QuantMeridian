# Platform Data Connectivity — Holistic View

Date: 2026-06-21
Status: Living reference
Scope: All 37 modules across 6 groups; what each needs to run on live data.

This document is the single place to see **what the platform is, how data flows through it, and exactly which external sources you still need to connect** to take each module from deterministic simulation to live data.

---

## 1. How data flows (the pattern)

Every module follows the same **provenance-first** contract:

1. **Render deterministic first.** Each module has a seeded simulation engine so it renders instantly, SSR-safe, with zero configuration. Nothing ever blocks on a network call.
2. **Upgrade to live when a backend is configured.** API routes always return HTTP 200 with a `source` field; the client swaps in live data only when it's genuinely live.
3. **Label honestly.** A `ProvenanceBadge` (`FRED` / `LIVE` / `DB` / `ECON` / `SIM` …) shows the true source per series/component — no silently faked live data.

### Live backends that already exist

| Backend | Powers | Wire-up | Default when absent |
|---|---|---|---|
| **FRED** (`api.stlouisfed.org`) | All ECONOMICS modules + SENT's VIX component | `FRED_API_KEY` | deterministic `SIM` |
| **market_data_pipeline** | All MARKETS modules + LENS + MKC | first of `MARKET_DB_URL` → `MARKET_DATA_DIR` → `MARKET_PIPELINE_URL` → committed snapshot | committed `SNAPSHOT` |
| **Anthropic API** | AI Copilot | `ANTHROPIC_API_KEY` | canned responses |

### Relevant environment variables

| Var | Purpose |
|---|---|
| `FRED_API_KEY` | FRED live econ/funding/rates data |
| `MARKET_DB_URL` / `MARKET_DATA_DIR` / `MARKET_PIPELINE_URL` | market-data pipeline resolver (DuckDB/Postgres, exported JSON, or the FastAPI service) |
| `MARKET_LENS_URL` / `CHART_DB_URL` | Market Lens engine + chart series store |
| `ANTHROPIC_API_KEY` | AI Copilot LLM |
| `ALPHAVANTAGE_API_KEY` / `MARKETAUX_API_KEY` / `FINNHUB_API_KEY` / `NEWSAPI_API_KEY` | NEWS headline provider chain (first configured wins) |
| `REDDIT_USER_AGENT` / `STOCKTWITS_ENABLED` / `STOCKTWITS_ACCESS_TOKEN` | NEWS-3 + SENT social feeds (Reddit / StockTwits) |
| `NEWS_NLP_URL` | `news_nlp` FinBERT service — re-scores headlines (sentiment becomes `… + FinBERT`) |
| `MARKET_CRON_*`, `CRON_SECRET`, `CRON_TARGET_URL` | scheduled market ingestion |

### NLP layering (NEWS / SENT sentiment)

Sentiment resolves best → fallback, each flipping the provenance badge:
**provider-native** (Alpha Vantage / Marketaux) → **FinBERT** (`news_nlp` via `NEWS_NLP_URL`) → **in-house heuristic** (negation-aware finance lexicon, `src/lib/server/sentimentNlp.ts`) → **SIM**. The `news_nlp/` package (FinBERT + spaCy NER + event clustering) is scaffolded and runs on a lexicon fallback without the model stack.

**Key takeaway:** the macro/funding surface (FRED) and the market surface (pipeline) are *already wired* — they need credentials/env, not new code. The gaps are the **behavioral, securities-finance, and internal-book** feeds.

### Live health probes & provenance surface

Provenance is observable at runtime — the platform probes its own backends rather than only rendering fixtures:

| Endpoint | Returns |
|---|---|
| `GET /api/dataops/health` | Per-provider live status — FRED key presence, market-pipeline resolver (DB/FILE/PIPELINE reachability), news/social provider config, and a live `/health` ping to the `news_nlp` FinBERT service (with model name). |
| `GET /api/dataops/runs` | Live ingestion **runs / series outcomes / lineage** aggregated from the `market_data_pipeline` ingestion manifest, resolved **`MARKET_DB_URL` (Postgres/DuckDB) → `MARKET_PIPELINE_URL`** (mirrors the market-views resolver). Includes real per-series **latency** (the pipeline now records `latency_ms`). Empty → the page keeps fixtures. |

Where it surfaces:

- **DATAOPS** overlays both probes onto the Provider Health, Runs, Series Outcomes and Lineage panels, badging each **`LIVE PROBE` / `LIVE MANIFEST`** vs **`FIXTURES`** and recomputing the "Live Providers" KPI from real status.
- **Status bar (every module)** shows a global **`DATA n/m LIVE`** chip (green/amber/red dot) via the same `/api/dataops/health` probe, with a tooltip listing each provider's status + detail. So live-vs-sim is visible terminal-wide, not just on DATAOPS.

Both probes are config + reachability based (paid/keyed feeds report *configured*, not a billed test call; the two URL services — `news_nlp`, market pipeline — get a real `/health` ping), and degrade to the fixture/SIM baseline when nothing is wired.

---

## 2. Connection status at a glance

| Status | Meaning | Count |
|---|---|---|
| ✅ **Live-capable now** | Backend exists; set a key/env and it's live | ECONOMICS (14), MARKETS (7), AI (1) |
| 🟡 **Partial** | Some components live, others need a new feed | FUND, GCPI, GPOL, SENT, REINV, LIQ, DESK |
| 🔴 **Needs a new feed** | No backend yet — requires an external vendor/source | FINANCE book (SLAB/PB), SQZ, NEWS, OPTIMIZATION book, CAL, FOMC |

---

## 3. Data-source connection matrix (master list)

Each external source, what it powers, and where it stands.

| # | Source | Powers (modules) | Access / cost | Status |
|---|---|---|---|---|
| 1 | **FRED** | ECON, INFL, CRDT, CURV, MGC, MOTN, REGIME, SFE, STAT, EML, FUND (12/16), SENT (VIX) | Free + key | ✅ wired — set `FRED_API_KEY` |
| 2 | **Market data pipeline** (Yahoo / Tiingo / Polygon / Alpha Vantage) | MKT, SNAP, IRET, QUILT, LENS, MKC, HOME, DESK | Free/paid tiers | 🟡 wired (SNAPSHOT) — set `MARKET_DB_URL`/`MARKET_PIPELINE_URL` + provider keys |
| 3 | **Anthropic API** | AI Copilot | Paid | ✅ wired — set `ANTHROPIC_API_KEY` |
| 4 | **AAII Investor Sentiment Survey** | SENT (index, survey, positioning, contrarian, divergence) | Free weekly CSV (`aaii.com`) | 🔴 ingest needed |
| 5 | **NAAIM Exposure Index** | SENT (positioning, index) | Free weekly (`naaim.org`) | 🔴 ingest needed |
| 6 | **Social APIs** — Reddit (free, UA-gated), StockTwits (free-ish), X (paid) | NEWS-3, SENT (social mood, divergence, ticker drill) | Reddit/StockTwits adapters built (`socialProviders.ts`); set `REDDIT_USER_AGENT` / `STOCKTWITS_ENABLED` | 🟡 adapters wired |
| 7 | **News headlines** — Alpha Vantage / Marketaux / Finnhub / NewsAPI | NEWS-1/2/5, header KPIs | Free/paid tiers; chain falls through | 🟡 chain wired — set a key |
| 7b | **`news_nlp` FinBERT stage** — sentiment, NER, event clustering | NEWS sentiment + NEWS-6 clusters, SENT | Scaffolded (`news_nlp/`); run service + set `NEWS_NLP_URL` | 🟡 scaffolded |
| 8 | **Options data** (CBOE put/call + skew) | SENT (put/call comp), SQZ | Free/paid | 🔴 |
| 9 | **Securities-finance / short-interest vendor** (S&P Global, FIS Astec, exchange SI) | SQZ, SLAB | Paid | 🔴 |
| 10 | **Fund flows** (ICI free; EPFR/Lipper paid) | SENT (positioning) | Mixed | 🔴 |
| 11 | **CME FedWatch / fed funds futures** | FOMC | Free/derived | 🔴 |
| 12 | **Economic calendar feed** | CAL | Free/paid | 🔴 |
| 13 | **BIS / FX-forward** (xccy basis, FRA-OIS) | FUND (4 series) | Free (BIS) / computed | 🔴 |
| 14 | **Global macro** (World Bank / OECD / BIS via `macro_data_etl`) | GCPI, GPOL | Free | 🟡 partial |
| 15 | **Internal firm books** (lending, prime, collateral, cash, positions) | SLAB, PB, COLL, CASH, REINV, SXU, LIQ, DESK | Internal integration | 🔴 |
| 16 | **Optimization solver** (Gurobi) | OPT, COLL, CASH | License | 🔴 |

---

## 4. Module-by-module inventory

### MARKETS — backed by `market_data_pipeline` (✅ live-capable)
| Module | Data dependency | Status |
|---|---|---|
| HOME · Command Center | market pipeline + book aggregates | 🟡 (book side internal) |
| MKT · Live Markets | quotes / OHLC | ✅ pipeline |
| SNAP · Market Snapshot | cross-asset returns | ✅ pipeline |
| IRET · Index Returns | index history | ✅ pipeline |
| QUILT · Asset Quilt | periodic returns | ✅ pipeline |
| LENS · Market Lens Studio | lens engine (snapshots + FRED) | ✅ |
| MKC · Market Chart Studio | `chart/series?source=market` | ✅ |

### ECONOMICS — backed by FRED (✅ live-capable; set `FRED_API_KEY`)
| Module | Data dependency | Status |
|---|---|---|
| ECON · Macro Dashboard | FRED catalog (104 series) | ✅ |
| INFL · Inflation Explorer | FRED inflation series | ✅ |
| CRDT · Credit Spreads | FRED OAS series | ✅ |
| CURV · Treasury Curve Lab | FRED treasury tenors | ✅ |
| MGC · Macro Chart Studio | FRED via chart/series | ✅ |
| MOTN · Macro Motion Studio | FRED batch | ✅ |
| REGIME · Macro Regime | FRED-derived states | ✅ |
| SFE · Sec-Finance Economics | FRED-derived | ✅ |
| STAT · Statistical Analysis | FRED-derived | ✅ |
| EML · ML Applications | FRED-derived | ✅ |
| FUND · Funding & Liquidity | FRED (12/16) + BIS (4) | 🟡 — xccy basis & FRA-OIS need BIS |
| GCPI · Global Inflation | World Bank/OECD via `macro_data_etl` | 🟡 |
| GPOL · Global Policy Rates | BIS/central banks via `macro_data_etl` | 🟡 |
| FOMC · Rate Probabilities | CME FedWatch / fed funds futures | 🔴 |
| CAL · Economic Calendar | calendar feed | 🔴 |

### INTELLIGENCE
| Module | Data dependency | Status |
|---|---|---|
| AI · Copilot | Anthropic API | ✅ (set `ANTHROPIC_API_KEY`) |
| SENT · Investor Sentiment | AAII + NAAIM + social + VIX (FRED) | 🟡 — VIX live; social chain wired; surveys needed |
| NEWS · News & Signal Intel | headline chain + social chain + `news_nlp` FinBERT | 🟡 — chains wired (need keys); tape, narratives, attention (4 dims) & signals recompute from the live tape; **NEWS-6 consumes FinBERT transformer clusters** (POST /cluster) when NEWS_NLP_URL is set, keyword clustering otherwise; only Market Impact stays a curated historical model |
| ALRT · Alert Center | derived from all modules | live as sources connect |
| DATAOPS · Data Ops | provider health (meta) | reflects the above |

### FINANCE — internal book / vendor (🔴)
| Module | Data dependency | Status |
|---|---|---|
| SLAB · Securities Lending | internal lending book / SBL vendor | 🔴 |
| SQZ · Squeeze Radar | securities-finance + short-interest + options vendor | 🔴 |
| PB · Prime Finance | internal prime brokerage book | 🔴 |

### OPTIMIZATION — internal books + solver (🔴/🟡)
| Module | Data dependency | Status |
|---|---|---|
| OPT · Optimization Center | internal positions + Gurobi | 🔴 |
| COLL · Collateral Mgmt | internal collateral/agreements + solver | 🔴 |
| CASH · Cash Optimizer | internal cash/funding (+ FRED rates) | 🟡 |
| REINV · Cash Reinvestment | internal + money-market rates (FRED) | 🟡 |
| LIQ · Liquidity Stress | internal + market | 🟡 |
| SXU · Sources & Uses | internal funding ledger | 🔴 |

### DESK
| Module | Data dependency | Status |
|---|---|---|
| DESK · Trading Desk | market pipeline + internal book | 🟡 |

---

## 5. Recommended connection roadmap

Ordered by **coverage per unit of effort**:

1. **`FRED_API_KEY`** *(minutes)* → lights up all 14 ECONOMICS-FRED modules **and** SENT's VIX component. Highest ROI.
2. **Market pipeline** *(`MARKET_DB_URL` / `MARKET_PIPELINE_URL` + provider keys)* → all 7 MARKETS modules + LENS + MKC + the market side of HOME/DESK go from SNAPSHOT to live.
3. **`ANTHROPIC_API_KEY`** *(minutes)* → AI Copilot.
4. **AAII + NAAIM weekly CSV ingest** *(low effort, free)* → SENT survey/positioning fully live; most of the SENT index.
5. **News + social + NLP** — the chains are already built; finish them:
   - set a **headline** key (`ALPHAVANTAGE_API_KEY` → Marketaux/Finnhub/NewsAPI) → NEWS tape/narratives/attention go live;
   - set **social** env (`REDDIT_USER_AGENT`, `STOCKTWITS_ENABLED`) → NEWS-3 **and** SENT social (one integration, two modules);
   - run the **`news_nlp` FinBERT** service and set `NEWS_NLP_URL` → upgrades heuristic sentiment to FinBERT and unlocks NEWS-6 clusters. Start *persisting* social for SENT-6 divergence history.
   - All of the above surface in **DATAOPS** under the `NEWS_NLP` provider.
6. **Options (CBOE)** → SENT put/call component + SQZ options fields.
7. **Securities-finance / short-interest vendor** *(paid)* → SQZ and the live SLAB book.
8. **Internal firm books + Gurobi** *(largest integration)* → FINANCE + OPTIMIZATION + DESK on real positions.
9. **Niche feeds** — CME FedWatch (FOMC), economic calendar (CAL), BIS (FUND xccy/FRA-OIS), fund flows (SENT).

---

## 6. Notes & caveats

- **The simulation is not a mock to be thrown away** — it's the permanent fallback tier and the contract every live feed slots behind. Connecting a source never requires UI changes; it flips a `source` badge.
- **One social integration covers two modules** (NEWS + SENT) — sequence it once.
- **Securities-finance data is the one domain FRED can't help with** — SQZ/SLAB inherently need a borrow/short-interest vendor.
- **Internal books are an integration, not a subscription** — FINANCE/OPTIMIZATION/DESK depend on connecting the firm's own systems (and a solver license), which is the heaviest lift but the most proprietary value.
- Keep this document updated as each `source` flips from 🔴/🟡 to ✅.
