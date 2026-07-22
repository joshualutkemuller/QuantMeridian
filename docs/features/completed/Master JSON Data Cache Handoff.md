# Master JSON Data Cache Handoff

## Objective

Build durable master JSONs for FRED and Yahoo-backed data so the terminal does not need to pull deep provider history during normal runtime. The desired runtime order is:

```text
live provider -> local master JSON cache -> committed snapshot -> deterministic SIM
```

The master cache is a real-data continuity layer. It is not a replacement for live providers, but it should keep the product useful when FRED or Yahoo is blocked, slow, rate-limited, missing credentials, or unavailable from a deployment runtime.

## Why This Matters

The current FRED snapshot fallback is committed and useful, but it is a point-in-time bundle. It does not accumulate history over time, and several provider-driven modules still need a deeper fallback path. A master JSON cache lets us:

- Pull only incremental provider updates after an initial seed.
- Preserve already fetched provider data when an upstream request fails.
- Make provider outages visible without forcing synthetic data.
- Support local development and static-ish deployments with real historical data.
- Keep provenance honest: live, master cache, snapshot, or simulation.

## Provider Constraints

FRED is the cleanest starting point because the app already has a catalog and official API integration. Still, individual series can carry third-party restrictions, so `simOnly` series must stay excluded unless licensing is explicitly cleared.

Yahoo should be treated as a private/local best-effort cache, not a redistributable public dataset. Yahoo terms restrict automated collection and reuse without permission, especially creating substitute databases or aggregated feeds. Keep Yahoo cache use scoped to this project/runtime unless a licensed market-data provider replaces it.

## Target Storage Layout

```text
data/master/
  manifest.json
  fred/
    CPIAUCSL.json
    DGS10.json
    T10Y2Y.json
  yahoo/
    SPY.json
    AAPL.json
```

The cache directory should be ignored by default if it becomes large or local-only. For deployable fallback, promote a curated subset into committed snapshots after validation.

## Shared JSON Contract

Each series file should store raw provider observations and metadata:

```json
{
  "schemaVersion": 1,
  "provider": "FRED",
  "symbol": "CPIAUCSL",
  "sourceId": "CPIAUCSL",
  "assetClass": "MACRO",
  "frequency": "M",
  "currency": null,
  "units": "lin",
  "generatedAt": "2026-06-24T00:00:00.000Z",
  "firstObservationDate": "1947-01-01",
  "lastObservationDate": "2026-05-01",
  "observations": [
    { "date": "2026-05-01", "value": 321.465 }
  ],
  "metadata": {
    "displayName": "CPI Urban All Items",
    "licenseTier": "redistributable-public",
    "transformPolicy": "store_raw_derive_display"
  }
}
```

Yahoo price files should store OHLCV observations:

```json
{
  "date": "2026-06-23",
  "open": 100,
  "high": 102,
  "low": 99,
  "close": 101,
  "adjClose": 100.8,
  "volume": 1234567
}
```

## Refresh Strategy

Refresh is incremental:

- Read existing master JSON.
- Pull from `lastObservationDate - overlapWindow`.
- Merge observations by date.
- Prefer newest provider values inside the overlap window.
- Deduplicate and sort ascending.
- Write atomically.
- Emit a run report.

Recommended overlap windows:

- FRED daily/weekly: 10 calendar days.
- FRED monthly/quarterly: 18 months for revisions.
- Yahoo daily OHLCV: 10 trading days.
- Yahoo corporate actions: refresh at least 2 years, or full history if cheap enough.

## Transform Policy

Store raw values once whenever possible:

- FRED: store `lin` and derive `pc1`, `pch`, `chg`, `pca`, bps scaling locally.
- Yahoo: store raw OHLCV plus adjusted close; derive returns locally.

This prevents multiple transformed copies of the same series and keeps revisions easier to reason about.

## Runtime Resolver

Add one provider-agnostic resolver:

```ts
getMasterSeries(provider, id, options)
```

Then route-level data flow should become:

```text
try live provider
try master JSON
try committed snapshot
try deterministic SIM
```

Expected provenance values:

- `FRED`
- `YAHOO`
- `MASTER`
- `SNAPSHOT`
- `SIM`

UI badges should show freshness for `MASTER`, for example: `MASTER CACHE · 2026-06-23`.

## Run Reports

Every refresh should emit a machine-readable report:

```json
{
  "provider": "FRED",
  "startedAt": "2026-06-24T00:00:00.000Z",
  "finishedAt": "2026-06-24T00:03:00.000Z",
  "written": 96,
  "updated": 12,
  "unchanged": 84,
  "failed": [
    { "id": "BAD_ID", "reason": "series does not exist" }
  ]
}
```

Reports should never erase existing master data on provider failure.

## Build Plan

1. Add master JSON schema/types.
2. Add FRED incremental exporter using raw `lin` values.
3. Add master JSON reader/resolver.
4. Wire `/api/econ/series`, `/api/econ/batch`, `/api/econ/indicators`, and chart-series to master fallback.
5. Extend curve, inversions, stats, and calendar fallbacks where a master representation makes sense.
6. Add Yahoo curated universe schema and exporter.
7. Add manifest and refresh reports.
8. Add scheduled refresh scripts.
9. Add UI provenance/freshness badges.
10. Add docs for local/private cache versus committed redistributable snapshots.

## Step 1 Status

Started in this handoff by adding shared TypeScript types for master JSON series, observations, manifests, refresh reports, and provenance.

## Step 2 Status

Implemented an incremental FRED master exporter:

```bash
FRED_API_KEY=xxxx npm run refresh:fred-master
```

The exporter writes raw `lin` values into `data/master/fred/{SERIES}.json`, updates `data/master/manifest.json`, and emits a timestamped refresh report under `data/master/reports/`. It preserves existing master files on provider failure and uses overlap windows for revisions.
