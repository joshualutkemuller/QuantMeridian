# Benchmark Rates — Database Provider Handoff

> This document serves as both a build record and a **prompt** for wiring the Benchmark Rates module to an external database. Hand this to Claude Code (or any AI assistant) when you are ready to connect your database.

**Module:** `BMRK` — Benchmark Rates  
**Page:** `/economics/benchmark`  
**Created:** 2026-06-24  
**Status:** SIM + FRED live complete — database provider layer pending

---

## What Exists Today

### Files

| File | Purpose |
|------|---------|
| `src/data/benchmarkRates.ts` | Core data module — 33 series definitions, SIM engine, all analytics (trend, spreads, correlation, regime, status board) |
| `src/app/api/econ/benchmark/route.ts` | API route — batch fetches series, tries FRED → SNAPSHOT → SIM |
| `src/app/economics/benchmark/page.tsx` | Full analytics page — 3 tabs (Status Board, Trend Analysis, Spread Analysis), 7 KPIs, regime classification, correlation matrix |
| `src/lib/nav.ts` | Nav entry added (code: `BMRK`, group: `ECONOMICS`) |

### Data Flow (Current)

```
Page (React)
  └─ useLiveSeriesSet(BENCHMARK_FRED_IDS, "lin", 520)
       └─ GET /api/econ/benchmark?ids=SOFR,DGS10,...&n=520
            ├─ Try 1: fredSeries(id) → FRED REST API (if FRED_API_KEY set)
            ├─ Try 2: getSnapshotObservations(id) → committed JSON snapshot
            └─ Try 3: simSeries(id) → deterministic RNG fallback
```

### Analytics Layer (Pure Functions)

All analytics are pure functions over a `SeriesMap` (`Record<string, Obs[]>` where `Obs = {date, value}`). They work identically regardless of whether the data came from FRED, a database, or SIM:

| Function | Returns | Description |
|----------|---------|-------------|
| `computeTrend(obs)` | `TrendMetrics` | 1/5/20/60/120d changes, MAs, percentile, 52w range, direction, momentum |
| `computeAllSpreads(map)` | `SpreadResult[]` | 11 pre-defined spread pairs with z-scores, percentiles, history |
| `computeSpread(map, pairId)` | `SpreadResult` | Single spread pair deep-dive |
| `computeCorrelation(map, ids, window)` | `CorrelationResult` | N×N correlation matrix from daily returns |
| `computeStatusBoard(map)` | `BenchmarkStatus[]` | Traffic-light status for every rate (elevated/normal/depressed) |
| `classifyRegime(map)` | `RegimeResult` | Rate regime (Tightening/Restrictive/Neutral/Easing/Accommodative) |
| `computeSummary(map)` | `BenchmarkSummary` | Headline KPIs (SOFR, 10Y, 2s10s, IG/HY OAS, 30Y mtg, regime) |

### Series Catalog (33 Rates)

| Category | Series |
|----------|--------|
| Overnight (7) | SOFR, EFFR, OBFR, IORB, BGCR, TGCR, Prime |
| Treasury (10) | 1M, 3M, 6M, 1Y, 2Y, 5Y, 10Y, 20Y, 30Y, 10Y TIPS |
| Credit (5) | IG OAS, HY OAS, AAA OAS, BBB OAS, TED Spread |
| Swap (3) | 2Y/5Y/10Y USD Swap Rates |
| Mortgage (2) | 30Y/15Y Fixed Mortgage |
| Commodity (2) | WTI Crude, Gold |
| International (3) | ECB DFR, BoE Rate, BoJ Rate |

### Spread Pairs (11 Pre-Defined)

SOFR−EFFR, SOFR−IORB, 10Y−2Y, 10Y−3M, 5Y−2Y, 30Y−5Y, HY−IG OAS, 30Y Mtg−10Y, 2Y Swap Spread, 10Y Swap Spread, Breakeven Inflation

---

## What To Build: Database Provider Layer

### Architecture

Add a provider abstraction between the API route and the data source. The page and analytics layer stay untouched — only the API route changes where it gets `Obs[]` from.

```
/api/econ/benchmark/route.ts
  └─ resolveProvider()  ← NEW: picks provider from env
       ├─ DatabaseProvider   ← NEW: queries your DB
       ├─ FredProvider       (existing fredSeries() calls)
       ├─ SnapshotProvider   (existing snapshot JSON)
       └─ SimProvider        (existing simSeries())
```

### Step 1: Create the Provider Interface

**Create `src/lib/server/benchmarkProvider.ts`:**

```typescript
export interface BenchmarkObs {
  date: string;    // YYYY-MM-DD
  value: number;
}

export interface BenchmarkProvider {
  /** Fetch daily observations for one series. */
  getSeries(id: string, n: number): Promise<BenchmarkObs[]>;

  /** Batch fetch multiple series. */
  getBatch(ids: string[], n: number): Promise<Record<string, BenchmarkObs[]>>;

  /** Provider name for provenance badges. */
  readonly source: "DB" | "FRED" | "SNAPSHOT" | "SIM";
}
```

### Step 2: Implement the Database Provider

**Create `src/lib/server/dbProvider.ts`:**

This is where your database-specific code lives. The implementation depends on your database type.

#### Environment Variables

```env
# Provider selection
BENCHMARK_PROVIDER=db              # db | fred | snapshot | sim

# Connection (pick one block based on your DB)

# ── SQL Server ──
BENCHMARK_DB_DRIVER=mssql
BENCHMARK_DB_HOST=your-server.database.windows.net
BENCHMARK_DB_PORT=1433
BENCHMARK_DB_NAME=rates_db
BENCHMARK_DB_USER=reader
BENCHMARK_DB_PASS=...

# ── Oracle ──
BENCHMARK_DB_DRIVER=oracle
BENCHMARK_DB_CONNECTION_STRING=your-host:1521/ORCL
BENCHMARK_DB_USER=reader
BENCHMARK_DB_PASS=...

# ── Sybase ──
BENCHMARK_DB_DRIVER=sybase
BENCHMARK_DB_HOST=your-sybase-host
BENCHMARK_DB_PORT=5000
BENCHMARK_DB_NAME=rates_db
BENCHMARK_DB_USER=reader
BENCHMARK_DB_PASS=...

# ── Databricks ──
BENCHMARK_DB_DRIVER=databricks
DATABRICKS_HOST=your-workspace.cloud.databricks.com
DATABRICKS_TOKEN=dapi...
DATABRICKS_SQL_PATH=/sql/1.0/warehouses/abc123
DATABRICKS_CATALOG=main
DATABRICKS_SCHEMA=rates

# ── PostgreSQL ──
BENCHMARK_DB_DRIVER=pg
BENCHMARK_DB_URL=postgresql://user:pass@host:5432/rates_db

# Column mapping (customize to match your schema)
BENCHMARK_DB_TABLE=daily_benchmark_rates
BENCHMARK_DB_COL_DATE=observation_date
BENCHMARK_DB_COL_SERIES=series_id
BENCHMARK_DB_COL_VALUE=rate_value
```

#### Expected Database Schema

The provider expects a table/view with at minimum these columns (names configurable via env):

```sql
-- Minimum required schema
CREATE TABLE daily_benchmark_rates (
  observation_date  DATE         NOT NULL,
  series_id         VARCHAR(50)  NOT NULL,   -- e.g., 'SOFR', 'DGS10', 'BAMLH0A0HYM2'
  rate_value        DECIMAL(18,6) NOT NULL,
  -- Optional columns the provider can use:
  source            VARCHAR(50),             -- e.g., 'BLOOMBERG', 'REFINITIV', 'FRED'
  unit              VARCHAR(20),             -- e.g., '%', 'bps', '$/bbl'
  asset_class       VARCHAR(50),             -- e.g., 'Overnight', 'Treasury', 'Credit'
  updated_at        TIMESTAMP,
  PRIMARY KEY (observation_date, series_id)
);

-- Useful index for the typical query pattern
CREATE INDEX idx_bmrk_series_date
  ON daily_benchmark_rates (series_id, observation_date DESC);
```

#### Series ID Mapping

Your database may use different identifiers than FRED. Add a mapping table or env config:

```env
# If your DB uses Bloomberg tickers instead of FRED ids:
BENCHMARK_ID_MAP=SOFR:SOFRRATE,DGS10:USGG10YR,BAMLH0A0HYM2:LUATTRUU
```

Or create a mapping table:

```sql
CREATE TABLE benchmark_series_map (
  terminal_id   VARCHAR(50) PRIMARY KEY,  -- FRED-style id used by the terminal
  db_id         VARCHAR(100) NOT NULL,    -- Your database's identifier
  label         VARCHAR(200),
  category      VARCHAR(50),
  unit          VARCHAR(20)
);
```

#### Implementation Template (Knex — SQL Server / Postgres / MySQL / Oracle)

```typescript
import Knex from "knex";
import type { BenchmarkProvider, BenchmarkObs } from "./benchmarkProvider";

const TABLE = process.env.BENCHMARK_DB_TABLE ?? "daily_benchmark_rates";
const COL_DATE = process.env.BENCHMARK_DB_COL_DATE ?? "observation_date";
const COL_SERIES = process.env.BENCHMARK_DB_COL_SERIES ?? "series_id";
const COL_VALUE = process.env.BENCHMARK_DB_COL_VALUE ?? "rate_value";

function createKnex() {
  const driver = process.env.BENCHMARK_DB_DRIVER ?? "pg";

  if (driver === "pg") {
    return Knex({ client: "pg", connection: process.env.BENCHMARK_DB_URL });
  }
  if (driver === "mssql") {
    return Knex({
      client: "mssql",
      connection: {
        server: process.env.BENCHMARK_DB_HOST!,
        port: Number(process.env.BENCHMARK_DB_PORT ?? 1433),
        database: process.env.BENCHMARK_DB_NAME!,
        user: process.env.BENCHMARK_DB_USER!,
        password: process.env.BENCHMARK_DB_PASS!,
        options: { encrypt: true, trustServerCertificate: false },
      },
    });
  }
  if (driver === "mysql2") {
    return Knex({
      client: "mysql2",
      connection: {
        host: process.env.BENCHMARK_DB_HOST!,
        port: Number(process.env.BENCHMARK_DB_PORT ?? 3306),
        database: process.env.BENCHMARK_DB_NAME!,
        user: process.env.BENCHMARK_DB_USER!,
        password: process.env.BENCHMARK_DB_PASS!,
      },
    });
  }
  // Add oracle, etc.
  throw new Error(`Unsupported driver: ${driver}`);
}

let _knex: ReturnType<typeof Knex> | null = null;
function db() {
  if (!_knex) _knex = createKnex();
  return _knex;
}

// Optional: series ID mapping
const ID_MAP: Record<string, string> = Object.fromEntries(
  (process.env.BENCHMARK_ID_MAP ?? "")
    .split(",")
    .filter(Boolean)
    .map((pair) => pair.split(":"))
    .filter((parts) => parts.length === 2)
);
function mapId(terminalId: string): string {
  return ID_MAP[terminalId] ?? terminalId;
}

export class DatabaseProvider implements BenchmarkProvider {
  readonly source = "DB" as const;

  async getSeries(id: string, n: number): Promise<BenchmarkObs[]> {
    const rows = await db()
      .select(COL_DATE, COL_VALUE)
      .from(TABLE)
      .where(COL_SERIES, mapId(id))
      .orderBy(COL_DATE, "desc")
      .limit(n);

    return rows
      .map((r: any) => ({
        date: new Date(r[COL_DATE]).toISOString().slice(0, 10),
        value: Number(r[COL_VALUE]),
      }))
      .reverse();
  }

  async getBatch(ids: string[], n: number): Promise<Record<string, BenchmarkObs[]>> {
    const dbIds = ids.map(mapId);
    const rows = await db()
      .select(COL_DATE, COL_SERIES, COL_VALUE)
      .from(TABLE)
      .whereIn(COL_SERIES, dbIds)
      .andWhere(
        COL_DATE,
        ">=",
        db().raw(`CURRENT_DATE - INTERVAL '${n * 2} days'`)
      )
      .orderBy([COL_SERIES, { column: COL_DATE, order: "desc" }]);

    // Group by series, take last N
    const reverseMap = Object.fromEntries(Object.entries(ID_MAP).map(([k, v]) => [v, k]));
    const grouped: Record<string, BenchmarkObs[]> = {};
    for (const r of rows) {
      const dbId = r[COL_SERIES];
      const terminalId = reverseMap[dbId] ?? dbId;
      if (!grouped[terminalId]) grouped[terminalId] = [];
      if (grouped[terminalId].length < n) {
        grouped[terminalId].push({
          date: new Date(r[COL_DATE]).toISOString().slice(0, 10),
          value: Number(r[COL_VALUE]),
        });
      }
    }
    // Reverse each series to chronological order
    for (const id of Object.keys(grouped)) grouped[id].reverse();
    return grouped;
  }
}
```

#### Implementation Template (Databricks)

```typescript
import { DBSQLClient } from "@databricks/sql";
import type { BenchmarkProvider, BenchmarkObs } from "./benchmarkProvider";

export class DatabricksProvider implements BenchmarkProvider {
  readonly source = "DB" as const;
  private client: DBSQLClient | null = null;

  private async connect() {
    if (this.client) return this.client;
    this.client = new DBSQLClient();
    await this.client.connect({
      host: process.env.DATABRICKS_HOST!,
      token: process.env.DATABRICKS_TOKEN!,
      path: process.env.DATABRICKS_SQL_PATH!,
    });
    return this.client;
  }

  async getSeries(id: string, n: number): Promise<BenchmarkObs[]> {
    const client = await this.connect();
    const session = await client.openSession();
    const catalog = process.env.DATABRICKS_CATALOG ?? "main";
    const schema = process.env.DATABRICKS_SCHEMA ?? "rates";
    const table = process.env.BENCHMARK_DB_TABLE ?? "daily_benchmark_rates";

    const op = await session.executeStatement(
      `SELECT observation_date, rate_value
       FROM ${catalog}.${schema}.${table}
       WHERE series_id = ?
       ORDER BY observation_date DESC
       LIMIT ?`,
      { namedParameters: { series_id: id, limit: n } }
    );
    const rows = await op.fetchAll();
    await session.close();

    return rows
      .map((r: any) => ({ date: String(r.observation_date), value: Number(r.rate_value) }))
      .reverse();
  }

  async getBatch(ids: string[], n: number): Promise<Record<string, BenchmarkObs[]>> {
    const result: Record<string, BenchmarkObs[]> = {};
    // Databricks SQL doesn't support arrays in params easily; batch via concurrent calls
    await Promise.all(ids.map(async (id) => {
      result[id] = await this.getSeries(id, n);
    }));
    return result;
  }
}
```

#### Implementation Template (Sybase via FreeTDS)

```typescript
import Sybase from "sybase";  // or use 'node-sybase'
import type { BenchmarkProvider, BenchmarkObs } from "./benchmarkProvider";

export class SybaseProvider implements BenchmarkProvider {
  readonly source = "DB" as const;
  private db: any;

  constructor() {
    this.db = new Sybase(
      process.env.BENCHMARK_DB_HOST!,
      Number(process.env.BENCHMARK_DB_PORT ?? 5000),
      process.env.BENCHMARK_DB_NAME!,
      process.env.BENCHMARK_DB_USER!,
      process.env.BENCHMARK_DB_PASS!
    );
  }

  private query(sql: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.connect((err: any) => {
        if (err) return reject(err);
        this.db.query(sql, (err: any, data: any) => {
          if (err) return reject(err);
          resolve(data);
        });
      });
    });
  }

  async getSeries(id: string, n: number): Promise<BenchmarkObs[]> {
    const rows = await this.query(
      `SELECT TOP ${n} observation_date, rate_value
       FROM daily_benchmark_rates
       WHERE series_id = '${id}'
       ORDER BY observation_date DESC`
    );
    return rows
      .map((r: any) => ({ date: String(r.observation_date).slice(0, 10), value: Number(r.rate_value) }))
      .reverse();
  }

  async getBatch(ids: string[], n: number): Promise<Record<string, BenchmarkObs[]>> {
    const result: Record<string, BenchmarkObs[]> = {};
    for (const id of ids) result[id] = await this.getSeries(id, n);
    return result;
  }
}
```

### Step 3: Create the Provider Resolver

**Create `src/lib/server/benchmarkResolver.ts`:**

```typescript
import type { BenchmarkProvider } from "./benchmarkProvider";

let _provider: BenchmarkProvider | null = null;

export function resolveProvider(): BenchmarkProvider {
  if (_provider) return _provider;

  const providerType = process.env.BENCHMARK_PROVIDER ?? "fred";

  switch (providerType) {
    case "db": {
      const driver = process.env.BENCHMARK_DB_DRIVER ?? "pg";
      if (driver === "databricks") {
        const { DatabricksProvider } = require("./dbProviderDatabricks");
        _provider = new DatabricksProvider();
      } else if (driver === "sybase") {
        const { SybaseProvider } = require("./dbProviderSybase");
        _provider = new SybaseProvider();
      } else {
        // Knex-based: pg, mssql, mysql2, oracledb
        const { DatabaseProvider } = require("./dbProvider");
        _provider = new DatabaseProvider();
      }
      break;
    }
    case "fred":
    default:
      // Use the existing FRED → SNAPSHOT → SIM cascade (no provider object needed)
      _provider = null as any;
      break;
  }

  return _provider;
}

export function isDbProvider(): boolean {
  return process.env.BENCHMARK_PROVIDER === "db";
}
```

### Step 4: Update the API Route

**Modify `src/app/api/econ/benchmark/route.ts`:**

```typescript
// Add at the top:
import { resolveProvider, isDbProvider } from "@/lib/server/benchmarkResolver";

// Replace the GET handler body with:
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 60);
  const n = Number(url.searchParams.get("n") ?? 520);

  // If a DB provider is configured, use it as the primary source
  if (isDbProvider()) {
    try {
      const provider = resolveProvider();
      const batch = await provider.getBatch(ids, n);
      const series = ids.map(id => ({
        id,
        observations: batch[id] ?? [],
        source: provider.source,
      }));
      return json({ source: provider.source, series });
    } catch (e) {
      // Fall through to FRED/SIM cascade
      console.error("[BMRK] DB provider error, falling through:", e);
    }
  }

  // Existing FRED → SNAPSHOT → SIM cascade (unchanged)
  // ...
}
```

### Step 5: Add "DB" to the Provenance System

**Modify `src/lib/useEcon.ts`:**
- Add `"DB"` to `DataSource` type: `export type DataSource = "FRED" | "SNAPSHOT" | "SIM" | "LOADING" | "ETL" | "DB";`

**Modify `src/components/ui/ProvenanceBadge.tsx`:**
- Add a badge style for `"DB"` source (suggested: green tone, label "DATABASE")

### Step 6: Install Dependencies

Depending on your database:

```bash
# SQL Server
npm install knex tedious

# PostgreSQL
npm install knex pg

# MySQL
npm install knex mysql2

# Oracle
npm install knex oracledb

# Databricks
npm install @databricks/sql

# Sybase (via FreeTDS)
npm install sybase
# Ensure FreeTDS is installed on the host: apt-get install freetds-dev
```

---

## Extending the Series Catalog

When wiring to your database, you likely have more benchmarks than the 33 FRED-mapped series. To add custom series:

### Option A: Extend the Static Catalog

Add entries to `BENCHMARK_SERIES` in `src/data/benchmarkRates.ts`:

```typescript
// Example: adding SONIA and ESTR
{ id: "SONIA", short: "SONIA", label: "Sterling Overnight Index Average", category: "International", unit: "%", decimals: 3, hasFred: false, anchor: 4.45, vol: 0.005, drift: 0 },
{ id: "ESTR", short: "€STR", label: "Euro Short-Term Rate", category: "International", unit: "%", decimals: 3, hasFred: false, anchor: 3.15, vol: 0.003, drift: 0 },
```

### Option B: Dynamic Catalog from Database

Create a metadata table and load the catalog at startup:

```sql
CREATE TABLE benchmark_catalog (
  series_id    VARCHAR(50) PRIMARY KEY,
  short_name   VARCHAR(20),
  label        VARCHAR(200),
  category     VARCHAR(50),
  unit         VARCHAR(20),
  decimals     INT DEFAULT 2,
  is_active    BOOLEAN DEFAULT TRUE
);
```

Then replace `BENCHMARK_SERIES` with a server-loaded catalog:

```typescript
// In benchmarkResolver.ts or a new catalogLoader.ts:
export async function loadCatalog(): Promise<BenchmarkDef[]> {
  if (!isDbProvider()) return BENCHMARK_SERIES;
  const rows = await db().select("*").from("benchmark_catalog").where("is_active", true);
  return rows.map(r => ({
    id: r.series_id,
    short: r.short_name,
    label: r.label,
    category: r.category as BenchmarkCategory,
    unit: r.unit as BenchmarkUnit,
    decimals: r.decimals,
    hasFred: false,
    anchor: 0, vol: 0, drift: 0, // Not needed when DB provides real data
  }));
}
```

### Option C: Add Custom Spread Pairs

Add to `SPREAD_PAIRS` in `src/data/benchmarkRates.ts`:

```typescript
{ id: "sonia_estr", label: "SONIA − €STR", seriesA: "SONIA", seriesB: "ESTR", desc: "GBP vs EUR overnight" },
```

---

## Adding New Analytics

The analytics layer is designed to be extended. All functions take `SeriesMap` as input and return typed results. To add a new analysis:

1. Define the return type in `src/data/benchmarkRates.ts`
2. Write a pure function over `SeriesMap`
3. Call it via `useMemo()` in the page
4. Render in a new `<Panel>`

Examples of analytics you might add:
- **Volatility analysis**: rolling realized vol per series
- **Seasonal patterns**: average rate by month-of-year
- **Term structure models**: Nelson-Siegel or Svensson curve fitting
- **Rate forecasting**: simple mean-reversion or momentum models
- **Cross-market analysis**: US vs international rate differentials
- **Carry analysis**: funding cost vs investment yield across tenors

---

## Testing the Database Connection

```bash
# Set env vars in .env.local:
BENCHMARK_PROVIDER=db
BENCHMARK_DB_DRIVER=mssql
BENCHMARK_DB_HOST=...
# ... etc.

# Start dev server:
npm run dev

# Test the API directly:
curl http://localhost:3000/api/econ/benchmark?ids=SOFR,DGS10&n=30

# Expected response:
# { "source": "DB", "series": [{ "id": "SOFR", "observations": [...], "source": "DB" }, ...] }
```

The page at `/economics/benchmark` will automatically pick up DB data — the analytics layer, charts, and status board all work unchanged because they only care about `SeriesMap`.

---

## Verification Checklist

When wiring the database provider:

- [ ] Provider returns `{date, value}[]` in chronological order (oldest first)
- [ ] Dates are `YYYY-MM-DD` strings
- [ ] Values are numbers (not strings)
- [ ] Series IDs match the terminal catalog (or ID mapping is configured)
- [ ] Connection pooling is enabled (Knex handles this by default)
- [ ] Errors fall through gracefully to FRED/SIM cascade
- [ ] `ProvenanceBadge` shows "DB" when database is active
- [ ] `npx tsc --noEmit` passes
- [ ] Page renders with all 3 tabs (Status, Trends, Spreads)
- [ ] Spread analysis and correlation matrix compute correctly from DB data
- [ ] Regime classification produces sensible results

---

## Changelog

| Date | Action |
|------|--------|
| 2026-06-24 | Module created: 33 series, SIM engine, full analytics page (3 tabs), FRED live upgrade |
| — | Pending: Database provider layer (this handoff) |
