# Gold DB Migration — Remaining Gaps

**Date:** 2026-08-27
**Branch:** `claude/fred-bronze-gold-pipeline-uiijsz`  
**Context:** After removing all data sources except the fred-bronze-to-gold-pipeline (Yahoo,
Polymarket, BIS, WorldBank, IMF, CME, Synthetic connectors deleted), this document records
every remaining gap where the app still reads from a non-gold source, falls to a stale
snapshot/SIM, or carries dead code referencing removed systems.

---

## Priority Matrix

| ID | File | Issue | Severity |
|----|------|--------|----------|
| G1 | `src/app/api/econ/calendar/route.ts` | RESOLVED — reads `gold.release_calendar` through `goldStore`; no live FRED/Finnhub route path | Closed |
| G2 | `market_lens_studio/data/series_catalog.py` | `preferred_source = "yahoo"` for all equity entries; all equity views silently empty | High |
| G3 | `src/app/api/econ/benchmark/route.ts` | Per-series SIM fallback inside gold path for series absent from gold table | Medium |
| G4 | `src/app/api/econ/batch/route.ts` | Same per-series SIM inside gold path | Medium |
| G5 | `src/app/api/dataops/health/route.ts` | Runtime reads of `MARKET_DB_URL`, `MARKET_DATA_DIR`, `MARKET_PIPELINE_URL` and labels them YAHOO | Medium |
| G6 | `market_data_pipeline/tests/test_api.py` | `MDP_OFFLINE=1` claims to force synthetic sources; FredConnector does not honour `settings.offline` — test may silently pass with empty data | Medium |
| G7 | `src/app/api/chart/templates/route.ts` | Falls back to `MARKET_DB_URL` | Low |
| G8 | `src/app/api/dataops/runs/route.ts` | Legacy `MARKET_PIPELINE_URL` manifest fallback | Low |
| G9 | `market_data_pipeline/src/config/settings.py` | Orphaned `allow_yahoo` / `yahoo_rate_limit` config fields | Low |
| G10 | `market_data_pipeline/src/config/catalog.py` | `AssetDef` default `source = "YAHOO"` | Low |
| G11 | `market_lens_studio/api/routes.py` | `get_yahoo_ticker` imported but dispatches to a handler that no longer exists | Low |
| G12 | `macro_data_etl/scripts/seed_demo.py` | Stale comment referencing live WorldBank/BIS/CME connectors | Info |

---

## Detailed Findings

### G1 — `/api/econ/calendar` Gold DB tier (Closed 2026-08-27)

**File:** `src/app/api/econ/calendar/route.ts`

The FRED/Eco pipeline now writes `gold_release_calendar` locally
(`gold.release_calendar` on Postgres/Delta), populated from FRED `/releases/dates`
plus `config/release_calendar.yml`. `src/app/api/econ/calendar/route.ts` now reads
that table through `goldStore` and returns `source: "DB"` or explicit `ERR`/empty
state. The route no longer imports the live FRED client or Finnhub calendar helper,
and it is no longer exempted by `scripts/check-gold-db-policy.sh`.

---

### G2 — market_lens_studio equity views silently empty (High)

**Files:**
- `market_lens_studio/data/series_catalog.py` — all equity/ETF entries have `preferred_source = "yahoo"` and `yahoo_ticker` fields
- `market_lens_studio/api/routes.py` line 119–129 — `_fetch_series()` uses `FredAdapter` exclusively; `get_yahoo_ticker` is imported (line 54) but never used for routing fetches

**What breaks:** When the `/run` endpoint processes equity series (SPY, QQQ, IWM, DIA, EFA,
EEM, GLD, SLV, USO, VIX, DXY), `_fetch_series` passes the bare ticker symbol to
`FredAdapter`, which calls the FRED API with e.g. `"SPY"` — FRED has no such series, so
data returns empty. All equity views in market_lens_studio are silently broken.

**Fix:** Wire `FredAdapter.__init__` to the gold SQLite DB via `MACRO_DB_URL` so the
`_store.normalized()` path resolves for series present in `gold_equity_return_daily` or
`gold_fred_latest_observation`. Update `preferred_source` to `"gold"` for DB-backed
entries. Remove the `get_yahoo_ticker` import once the catalog no longer references Yahoo.

---

### G3 — `/api/econ/benchmark` per-series SIM inside gold path (Medium)

**File:** `src/app/api/econ/benchmark/route.ts` line ~88

Even with `goldEnabled() = true`, individual benchmark series not yet present in
`gold_fred_latest_observation` silently resolve to `getSeriesHistory()` SIM synthetic
values. The SIM call is inside the gold branch (not a separate fallback tier), making the
source tag misleading.

**Fix:** Ensure all benchmark series (DFF, SOFR, DGS2, DGS10, etc.) are ingested into
`gold_fred_latest_observation` by the pipeline, then remove the inner
`getSeriesHistory()` SIM lines (marked `// MIGRATION FALLBACK — remove in Phase 6`).

---

### G4 — `/api/econ/batch` per-series SIM inside gold path (Medium)

**File:** `src/app/api/econ/batch/route.ts` line ~82

Same pattern as G3. Per-series SIM fill within the gold-enabled branch for series absent
from the gold table.

**Fix:** Same as G3 — ensure full series coverage in `gold_fred_latest_observation` and
remove the Phase 6 SIM fill lines.

---

### G5 — `/api/dataops/health` reads removed env vars at runtime (Medium)

**File:** `src/app/api/dataops/health/route.ts` lines 128–137

The health route actively probes `MARKET_DB_URL`, `MARKET_DATA_DIR`, and
`MARKET_PIPELINE_URL` at request time and labels them as "YAHOO" health status. These env
vars point to infrastructure that has been decommissioned (the market_data_pipeline's
DuckDB and the Flask API).

**Additional files with reference-only (non-runtime) mentions:**
- `src/server/index.ts` lines 9–10
- `src/lib/server/marketManifest.ts` lines 140, 188, 192, 201
- `src/lib/provenance.ts` lines 52, 55
- `src/lib/useLiveRuns.ts` line 16
- `src/lib/charting/templates.ts` line 234

**Fix:** Replace the `MARKET_DB_URL`/`MARKET_DATA_DIR`/`MARKET_PIPELINE_URL` health checks
with `MACRO_DB_URL` provenance reporting (call `goldStore().health()`). Remove stale
library references.

---

### G6 — `test_api.py` offline mode does not actually use synthetic data (Medium)

**File:** `market_data_pipeline/tests/test_api.py`

The test sets `MDP_OFFLINE=1` expecting `Pipeline().run()` to *"force synthetic sources"*.
However, `FredConnector` does not branch on `settings.offline` — it returns an empty frame
on network failure rather than synthetic data. The test's
`assert r.json()["normalized_rows"] > 0` assertion is therefore only passing when FRED
cache files happen to be present in the test environment, or is silently passing with 0
rows if the assertion is weaker than expected.

**Fix:** Either wire the FRED connector to check `settings.offline` and return a seed
frame, or remove the `--offline` / `MDP_OFFLINE` code path entirely and replace the test
with a fixture-backed FRED mock.

---

### G7 — `/api/chart/templates` falls back to `MARKET_DB_URL` (Low)

**File:** `src/app/api/chart/templates/route.ts` line 19

Uses `CHART_DB_URL || MARKET_DB_URL` as the DB connection string. The `MARKET_DB_URL` leg
refers to the decommissioned DuckDB store.

**Fix:** Migrate to `MACRO_DB_URL` only (or a dedicated `CHART_DB_URL` backed by the gold
SQLite).

---

### G8 — `/api/dataops/runs` legacy MARKET_PIPELINE_URL fallback (Low)

**File:** `src/app/api/dataops/runs/route.ts` line 74

Contains a `fetchPipelineManifest()` call that reads from `MARKET_PIPELINE_URL` as a
fallback after checking gold audit tables. That URL points to the decommissioned
market_data_pipeline Flask API.

**Fix:** Remove the `fetchPipelineManifest()` branch once `audit_etl_run` and
`audit_etl_series_run` are consistently populated by the gold pipeline.

---

### G9 — Orphaned Yahoo config fields in settings.py (Low)

**File:** `market_data_pipeline/src/config/settings.py` lines 34–35, 39

```python
allow_yahoo: bool = Field(default=True, alias="MDP_ALLOW_YAHOO")
yahoo_rate_limit: float = Field(default=1.0)
```

No connector reads these fields after Yahoo was removed.

**Fix:** Delete both fields and any `MDP_ALLOW_YAHOO` env var references.

---

### G10 — `AssetDef` default source is "YAHOO" (Low)

**File:** `market_data_pipeline/src/config/catalog.py` lines 27, 111

`AssetDef` has `source: str = "YAHOO"` as its default. The `series_catalog.yaml` has
`assets: []` so no `AssetDef` instances are created, making this inert. Still misleading.

**Fix:** Change default to `"FRED"` or remove the `source` field from `AssetDef`.

---

### G11 — `get_yahoo_ticker` dead import in routes.py (Low)

**File:** `market_lens_studio/api/routes.py` line 54

```python
from ..data.series_catalog import ..., get_yahoo_ticker
```

`get_yahoo_ticker` is only used in the `/series/{series_id}/metadata` response for display
purposes. The actual fetch path never calls it. Once `preferred_source` in the catalog is
updated away from `"yahoo"` (G2 fix), this can be removed.

**Fix:** Remove the import and the metadata field that exposes `yahoo_ticker`.

---

### G12 — Stale comment in seed_demo.py (Info)

**File:** `macro_data_etl/scripts/seed_demo.py`

Comment reads: *"live connectors require outbound network access (World Bank / BIS / CME)"*.
The live connectors no longer exist.

**Fix:** Update comment to reflect that seed data is purely static and no live connectors
are involved.

---

## Phase 6 Migration Stubs Still Present

Several routes carry `// MIGRATION FALLBACK — remove in Phase 6` markers indicating planned
cleanup. These are not gaps per se (they try gold first) but should be tracked:

| Route | Stale code to remove in Phase 6 |
|-------|----------------------------------|
| `src/app/api/econ/indicators/route.ts` | Full FRED + snapshot + SIM fallback chain below gold tier |
| `src/app/api/econ/curve/route.ts` | FRED + snapshot + SIM chain below gold tier |
| `src/app/api/econ/curve-history/route.ts` | FRED + snapshot + SIM chain below gold tier |
| `src/app/api/econ/series/route.ts` | 5-tier fallback chain (includes ETL fixture tier) |
| `src/app/api/econ/stats/route.ts` | FRED + snapshot + SIM chain |
| `src/app/api/econ/inversions/route.ts` | FRED + snapshot + SIM chain |
| `src/app/api/chart/series/route.ts` | SIM at tail after gold + FRED |
| `src/app/api/econ/benchmark/route.ts` | Inner SIM fill per missing series (also G3 above) |
| `src/app/api/econ/batch/route.ts` | Inner SIM fill per missing series (also G4 above) |

---

## What Is Clean

The following are confirmed gold-DB-exclusive (no SIM/snapshot/Yahoo path at all, errors
explicitly on missing DB):

- `/api/econ/inflation`
- `/api/econ/global`
- `/api/econ/global-inflation`
- `/api/econ/global-policy-rates`
- `/api/econ/regime`
- `/api/econ/credit`
- `/api/econ/funding`
- `/api/market/[view]` for all 8 views (`market`, `cross-asset`, `rates`, `inflation`, `regime`, `bilello`, `index-returns`, `eda`) — gold tiers wired; snapshot fallback only when `MARKET_SNAPSHOT_FALLBACK=1`
- `/api/news` and `/api/social` — intentionally kept on live providers
- `/api/polymarket/*` — intentionally stubbed DISABLED
- `/api/cron/refresh` — clean; no MARKET_PIPELINE_URL; warms gold-sourced routes only
- `macro_data_etl/` Python pipeline — no live BIS/WorldBank/IMF/CME connector classes remain; transform functions for existing silver Parquet files are still valid for gold-rebuild
