# Polymarket Integration — Handoff Document

> This document serves as both a build record and a **prompt** for wiring the Prediction Markets module to the live Polymarket API. Hand this to Claude Code (or any AI assistant) when you are ready to connect to live data.

**Module:** `POLY` — Prediction Markets  
**Page:** `/polymarket`  
**Created:** 2026-06-28  
**Status:** SIM complete — live Polymarket API + snapshot layers pending

---

## What Exists Today

### Files

| File | Purpose |
|------|---------|
| `src/data/polymarket.ts` | Core data module — 36 market definitions across 8 categories, SIM engine with deterministic Rng, event grouping, price history generation, category stats, movers |
| `src/lib/usePolymarket.ts` | Client hooks — `usePolymarkets()`, `usePolyEvents()`, `usePolyHistory()` with three-tier fallback (POLY → SNAPSHOT → SIM) |
| `src/app/api/polymarket/markets/route.ts` | API route — market listing with category filter + limit, currently SIM-only |
| `src/app/api/polymarket/events/route.ts` | API route — event grouping, currently SIM-only |
| `src/app/api/polymarket/history/route.ts` | API route — price history time series, currently SIM-only |
| `src/app/polymarket/page.tsx` | Full module page — 4 tabs (Markets, Events, Movers, Categories), KPI strip, detail panel with probability chart |
| `src/lib/nav.ts` | Nav entry added (code: `POLY`, group: `INTELLIGENCE`) |
| `src/lib/provenance.ts` | `POLY` provenance source added |
| `market_data_pipeline/src/connectors/polymarket.py` | Python connector — Polymarket CLOB + Gamma API adapter with rate limiting and caching |

### Data Flow (Current)

```
Page (React)
  └─ usePolymarkets({ limit, category })
       └─ GET /api/polymarket/markets?limit=100&category=...
            └─ getPolymarkets() → deterministic RNG fallback (SIM)
```

### SIM Data

36 prediction markets across 8 categories:

| Category | Count | Example Questions |
|----------|-------|-------------------|
| Politics | 6 | 2026 midterms, Trump approval, Ukraine ceasefire, UK snap election |
| Crypto | 6 | BTC $150k, ETH $8k, Solana ETF, crypto market cap, DOGE $1, BTC dominance |
| Economics | 8 | Fed rate cuts, CPI, GDP growth, unemployment, 10Y yield, ECB cuts, recession, S&P 6500 |
| Tech | 4 | AI $1T revenue, Apple foldable, OpenAI IPO, TikTok ban |
| Climate | 3 | 1.5°C breach, Category 5 hurricane, Arctic sea ice |
| Science | 2 | WHO pandemic emergency, mRNA vaccine approval |
| Sports | 3 | FIFA Club World Cup viewership, FIFA World Cup winner, NBA expansion |
| Culture | 2 | Hollywood bankruptcy, global box office $45B |

Each market generates:
- Deterministic probability (anchored to realistic mid-2026 values)
- 30-point sparkline (mean-reverting walk)
- 24h volume, total volume, liquidity, spread
- 24h probability change
- Resolution end date

### Module Features

| Tab | Content |
|-----|---------|
| **Markets** | Sortable DataGrid — contract name, category tag, probability bar, 24h change, volume, spread, sparkline, end date |
| **Events** | Expandable event cards grouping related contracts (9 pre-defined event groups) |
| **Movers** | Biggest 24h probability swings, split into up/down panels |
| **Categories** | Volume-by-category horizontal bar chart + market count breakdown |

**Detail Panel** (click any market):
- Full question text + metadata tags
- Probability history LineChart (90-day, area-filled)
- Yes/No prices, 24h volume, liquidity, spread, total volume

### Analytics Layer (Pure Functions)

All analytics are pure functions over `PolyMarket[]`. They work identically regardless of data source:

| Function | Returns | Description |
|----------|---------|-------------|
| `getPolymarkets()` | `PolyMarket[]` | All simulated markets with prices, volumes, sparklines |
| `getPolyEvents()` | `PolyEvent[]` | 9 event groups with child markets |
| `getPolyPriceHistory(id, days)` | `PolyPricePoint[]` | Daily probability time series for charting |
| `getPolyCategories()` | `CategoryStat[]` | Category breakdown sorted by volume |
| `getPolyMovers(n)` | `PolyMarket[]` | Top n markets by absolute 24h change |

### TypeScript Types

```typescript
interface PolyMarket {
  id: string;                    // "poly-000"
  question: string;              // "Will BTC exceed $150k by Dec 2026?"
  category: PolyCategory;        // "Crypto" | "Politics" | "Economics" | ...
  yesPrice: number;              // 0.00–1.00 (implied probability)
  noPrice: number;               // complement minus half spread
  spread: number;                // bid-ask spread (0.01–0.04)
  volume24h: number;             // 24h USD volume
  totalVolume: number;           // lifetime USD volume
  liquidity: number;             // current order book depth
  chg24h: number;                // probability change (-0.10 to +0.10)
  endDate: string;               // "2026-12-15" resolution date
  spark: number[];               // 30-point probability sparkline
  active: boolean;
}

interface PolyEvent {
  id: string;
  title: string;
  category: PolyCategory;
  markets: PolyMarket[];
  totalVolume: number;
}

interface PolyPricePoint {
  date: string;                  // "2026-06-17"
  price: number;                 // yes probability (0–1)
}

type PolyCategory = "Politics" | "Crypto" | "Economics" | "Sports"
                   | "Science" | "Culture" | "Tech" | "Climate";
```

---

## What To Build: Live Polymarket API Layer

### Polymarket APIs (Public, No Auth Required)

**CLOB API** — Order book and price data:
```
Base: https://clob.polymarket.com

GET /markets                            → List all active markets with prices
GET /market/{condition_id}              → Single market detail
GET /prices-history?market={token_id}&interval=1d&fidelity=60  → Price history
```

**Gamma API** — Rich metadata and event grouping:
```
Base: https://gamma-api.polymarket.com

GET /events?active=true&closed=false&limit=100  → Events with metadata
GET /markets?active=true&closed=false           → Markets with rich metadata
```

### Architecture

Add live Polymarket API calls to the existing API routes. The page, hooks, and analytics stay untouched — only the API routes change where they get data from.

```
/api/polymarket/markets/route.ts
  └─ resolveMarkets()
       ├─ Try 1: LIVE — fetch from Gamma API + CLOB prices (if POLYMARKET_ENABLED=1)
       ├─ Try 2: SNAPSHOT — load src/data/polymarket/snapshot.json
       └─ Try 3: SIM — getPolymarkets() deterministic fallback

/api/polymarket/history/route.ts
  └─ resolveHistory()
       ├─ Try 1: LIVE — fetch from CLOB /prices-history endpoint
       └─ Try 2: SIM — getPolyPriceHistory() deterministic fallback
```

### Implementation Steps

#### Step 1: Server-Side Polymarket Client

Create `src/lib/server/polymarket.ts`:

```typescript
const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";

export function polymarketEnabled(): boolean {
  return process.env.POLYMARKET_ENABLED === "1";
}

export async function fetchGammaMarkets(opts: {
  limit?: number;
  active?: boolean;
  category?: string;
}): Promise<GammaMarket[]> {
  const params = new URLSearchParams({
    active: String(opts.active ?? true),
    closed: "false",
    limit: String(opts.limit ?? 100),
  });
  const r = await fetch(`${GAMMA_BASE}/markets?${params}`, {
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`Gamma ${r.status}`);
  return r.json();
}

export async function fetchClobPriceHistory(
  tokenId: string,
  interval = "1d",
  fidelity = 60
): Promise<{ t: number; p: number }[]> {
  const params = new URLSearchParams({
    market: tokenId,
    interval,
    fidelity: String(fidelity),
  });
  const r = await fetch(`${CLOB_BASE}/prices-history?${params}`, {
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`CLOB ${r.status}`);
  const json = await r.json();
  return json.history ?? [];
}
```

#### Step 2: Map Gamma/CLOB Responses to PolyMarket Interface

The Gamma API returns fields like:
```json
{
  "id": "...",
  "question": "Will BTC exceed $150k?",
  "outcomes": ["Yes", "No"],
  "outcomePrices": "[0.42, 0.58]",
  "volume": 12345678.90,
  "volume24hr": 234567.89,
  "liquidity": 456789.01,
  "endDate": "2026-12-31T00:00:00Z",
  "category": "Crypto",
  "spread": 0.02,
  "active": true,
  "conditionId": "0x...",
  "clobTokenIds": "[\"token1\",\"token2\"]"
}
```

Map this to the existing `PolyMarket` interface. The sparkline requires a separate price history call (or can be left empty for the grid and filled on detail click).

#### Step 3: Create Snapshot

Run a one-time script to capture real Polymarket data:

```bash
curl "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50&order=volume24hr&ascending=false" \
  | python3 -m json.tool > src/data/polymarket/snapshot.json
```

Commit this as the SNAPSHOT tier so the module shows real data even without network access.

#### Step 4: Update API Routes

In `src/app/api/polymarket/markets/route.ts`, add the three-tier fallback:

```typescript
export async function GET(req: Request) {
  // 1. LIVE
  if (polymarketEnabled()) {
    try {
      const raw = await fetchGammaMarkets({ limit, category });
      const markets = raw.map(gammaToPolyMarket);
      return json({ source: "POLY", data: markets });
    } catch { /* fall through */ }
  }

  // 2. SNAPSHOT
  const snap = loadSnapshot();
  if (snap) return json({ source: "SNAPSHOT", data: snap });

  // 3. SIM
  return json({ source: "SIM", data: getPolymarkets() });
}
```

#### Step 5: Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `POLYMARKET_ENABLED` | Set to `1` to enable live Polymarket API calls | `undefined` (SIM mode) |

No API key needed — Polymarket's CLOB and Gamma APIs are public.

### Python Connector (Pipeline Integration)

A Python connector is provided at `market_data_pipeline/src/connectors/polymarket.py` for batch ingestion into the data pipeline. It follows the existing `ThrottledClient` + `ResponseCache` pattern and can be registered in the pipeline to ingest Polymarket data alongside FRED and Yahoo.

### Data Quality Considerations

1. **Rate Limits** — Polymarket APIs have undocumented rate limits. Use 2 req/sec with exponential backoff.
2. **Stale Markets** — Filter by `active=true&closed=false` to avoid resolved contracts.
3. **Price Precision** — Polymarket prices are 0.00–1.00 with 2 decimal precision.
4. **Volume Units** — All volumes are in USDC (≈ USD).
5. **Token IDs** — Each Yes/No outcome has a separate CLOB token ID. Use the Yes token for price history.
6. **Event Grouping** — The Gamma API returns `groupItemTitle` for event grouping. Use this to build the Events tab.

---

## Future Enhancements

1. **WebSocket streaming** — CLOB offers WebSocket feeds for real-time price updates
2. **Correlation overlay** — Show prediction market probabilities alongside relevant FRED series (e.g., "Fed cut" contract vs. CME FedWatch)
3. **Volume alerts** — Alert when a market's 24h volume spikes (signal for desk attention)
4. **Custom watchlist** — Let users pin specific contracts to their Command Center
5. **Resolution tracking** — Track contract outcomes and P&L for paper trading
6. **Arbitrage scanner** — Compare implied probabilities across multiple prediction platforms
7. **Sentiment cross-reference** — Link prediction market signals to the SENT module's fear/greed index
