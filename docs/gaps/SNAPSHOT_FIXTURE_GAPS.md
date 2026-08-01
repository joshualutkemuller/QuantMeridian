# Snapshot & Fixture Gaps

**Generated**: 2026-07-28
**Updated**: 2026-07-31 — G1, G2, G5, G8, G9, G10 completed; ETL tier fully gated; equity OOM fixed; nav/route test added
**Scope**: Every read path in the terminal that still resolves committed snapshot, ETL fixture, or seeded-`Rng` data instead of the Gold DB / FRED live chain.
**Related**: `docs/features/GOLD_DB_MIGRATION_HANDOFF.md`, `docs/validation/MODULE_DATA_AUDIT.md`, `docs/validation/LIVE_DATA_READINESS_ASSESSMENT.md`

---

## Executive summary

The **API layer is in good shape**. The gaps that remain are concentrated in three places: one page that bypasses its own route, one ungated fallback tier that is badged as live, and a set of Gold-backed routes that were built during the migration and never connected to a page.

Findings G2, G5 and G8 are the cases where synthetic or committed data reaches the user **under a badge that claims live**. Those are the priority — everything else is either honestly labelled or a wiring gap.

| ID | Gap | Severity | False-live? | Status |
|---|---|---|---|---|
| G1 | `economics/eda` bypassed `/api/market/eda`; route was never registered | Medium | No | **Fixed 2026-07-30** |
| G2 | ETL tier ungated and marked `live: true` | **High** | **Yes** | **Fixed 2026-07-31** |
| G3 | Six Gold-backed routes have zero UI callers | **High** | No | Open |
| G4 | `global-cpi` / `policy-rates` build from a synthetic base | Medium | Partial | **Fixed 2026-07-31** |
| G5 | `useInversions` merges SIM stats into live responses | **High** | **Yes** | **Fixed 2026-07-31** |
| G6 | dataops merges fixtures under a "LIVE MANIFEST" tag | Low | Partial | Open |
| G7 | Seven securities-finance pages have no live path at all | Informational | No | By design |
| G8 | `asset-quilt` renders the seeded quilt under a live badge | **High** | **Yes** | **Fixed 2026-07-30** |
| G9 | Gold equity reads OOM the server (whole-table `latest()`) | **High** | No | **Fixed 2026-07-31** |
| G10 | Nav advertises modules the router never registers | Medium | No | **Fixed 2026-07-31** (nav/route consistency test) |
| G11 | macro ETL frozen since 2026-06-24 but still load-bearing | **High** | **Yes** (via G2) | Open |

---

## What is already correctly gated

Recorded so this does not get re-audited.

- **`/api/market/[view]`** (`src/app/api/market/[view]/route.ts:596-702`) walks Gold DB → `MARKET_DB_URL` → `MARKET_DATA_DIR` → FastAPI, then returns `source: "SNAPSHOT_DISABLED"` with `data: null` unless `snapshot=1` or `MARKET_SNAPSHOT_FALLBACK=1`.
- **Econ routes** — `series`, `batch`, `benchmark`, `curve`, `curve-history`, `inversions`, `indicators`, `stats` — and **`/api/chart/series`** all route through `simFallbackEnabled` / `snapshotFallbackEnabled` (`src/lib/server/fallbacks.ts`) and return `source: "ERR"` rather than quietly degrading.
- **Client hooks** `useMarketView` (`src/lib/useMarket.ts`) and `useEconResource` (`src/lib/useEcon.ts:57-118`) independently suppress `SNAPSHOT` / `SIM` responses when the ribbon toggles are off, so a route that ignores the query param still cannot leak through the hook.
- **Dev and prod share one handler registry** (`src/server/registry.ts`, mounted by `vite-plugins/dev-api.ts` in dev), so there is no dev/prod divergence in fallback behaviour.
- **`market-snapshot` page** — the `?? snapFallback` expressions at `src/app/market-snapshot/page.tsx:56-61` look like ungated fallbacks but are dead defensive code: `useMarketView` returns shape-safe empty objects (`{ cards: [] }`), never `null`/`undefined`, so `??` never fires. No action needed.

---

## G1 — `economics/eda` bypassed its own API — **FIXED 2026-07-30**

**Severity**: Medium · **False-live**: No

`src/app/economics/eda/page.tsx:33` was a build-time import:

```ts
const data: EdaView = edaView;   // from "@/data/marketPipeline" → src/data/market/eda.json
```

It was the only market page that did not use `useMarketView`, permanently frozen at the committed snapshot with a hardcoded `source="SIM"` badge.

### Root cause was worse than the symptom

While fixing it: **the EDA route was never registered in the router**. `EDA` is `enabled` in `settings/modules.config.json:42` and `src/lib/nav.ts:84` advertises `/economics/eda`, but `src/App.tsx` had no matching `<Route>` — the nav link fell through to `not-found`. The page had been unreachable, which is why nobody noticed it was serving a frozen snapshot. See **G10**.

### What was done

1. **New Gold source** — `src/lib/server/goldEda.ts` assembles an `EdaView` from three Gold tables (the Phase 5 plan in `GOLD_DB_MIGRATION_HANDOFF.md:120`):

   | Panel | Gold table | Result |
   |---|---|---|
   | Cross-correlation (CCF) | `gold.series_lead_lag` | 8 pairs × 25 lags |
   | Granger causality | `gold.series_lead_lag` | 16 rows (both directions per pair) |
   | Pearson heatmap | `gold.series_correlation` (window = 0) | 11 × 11, sparse |
   | CUSUM changepoints | `gold.series_structural_breaks` | 8 breaks |
   | Lagged OLS | — | **no Gold source** |
   | PELT segments | — | **no Gold source** (pipeline runs Chow, not PELT) |

2. **Route tier** — `/api/market/[view]` gained a Gold branch for `eda` ahead of the existing DB/FILE/LIVE chain. Verified live: `source: "DB"`, `asof: 2026-07-16`.

3. **Page rewired** to `useMarketView<EdaView>("eda")` with the badge driven by the returned `source`. This required more than a swap — `emptyMarketView("eda")` returns all-empty arrays, and the page indexed `[0]` in five places, so it would have crashed on first render. Added: empty-safe `useMemo`s returning `null`, a clamped `ccfIdx` (the pair set differs between snapshot and Gold), an early return after all hooks, and a `?.` guard on the PELT segment column.

4. **Honest per-panel empty states** — `EdaView.coverage` carries `true` or a reason string per panel. The two panels Gold cannot serve now say why ("the pipeline runs Chow structural-break tests, not PELT…") instead of rendering an ambiguous empty table or silently falling back to the snapshot.

5. **Sparse matrix support** — `PearsonHeatmap.matrix` is now `(number | null)[][]`. Gold correlates a curated pair list, not a full clique; a `0` would misread as "measured, uncorrelated". `CorrelationMatrix` renders `null` as an empty well and rotates column headers (Gold's FRED ids are longer than the snapshot's 3-letter tickers and collided).

6. **Route registered** in `src/App.tsx` behind the existing `on("EDA")` module gate.

**Tests**: `src/lib/server/goldEda.test.ts` — 8 cases covering pair grouping, both Granger directions emitted once per pair (not once per lag row), sparse-matrix symmetry and null preservation, CUSUM filtering, coverage reporting, and the `null` return that lets the route fall through.

### Caveat

Gold serves 4 of 6 panels. Lagged OLS and PELT need pipeline-side tables (`series_lagged_ols`, a PELT variant of `series_structural_breaks`) before they can be Gold-backed — that work belongs in `fred-bronze-to-gold-pipeline`, not here.

---

## G2 — ETL tier is ungated and badged as live

**Severity**: High · **False-live**: **Yes**

`src/app/api/econ/series/route.ts:96-99`:

```ts
// 4. ETL
const etl = getEtlInflationObservations(id, n);
if (etl) {
  return json({ source: "ETL", id, label, units: "yoy", observations: etl });
}
```

No `allowSnapshot` / `allowSim` check — and this sits **one step after** the SNAPSHOT tier that *is* gated (`:86-93`). The data comes from committed `src/data/etl/inflation_timeseries.json`.

Compounding it, `ETL` carries `live: true` in `src/lib/provenance.ts:57`, which drives the green live pulse:

```ts
ETL: { label: "ETL · MACRO", live: true, tone: "etl", title: "macro_data_etl gold tables …" },
```

**Net effect**: with both ribbon toggles off and no Gold DB configured, global CPI series render committed fixture data behind a green "live" badge.

Same pattern in **`/api/econ/fomc`** (`src/app/api/econ/fomc/route.ts:30-31`), which serves `fed_probabilities.json` via `fomcFromEtl()` / `impliedPathFromEtl()` once `hasEtlFedData()` passes. The `simFallbackEnabled` guard at `:18-22` only covers the case where ETL data is *absent*, not the case where it is present-but-committed.

### How stale, concretely (added 2026-07-30)

The original write-up flagged the mislabelling but not the age of the data. Measured:

| ETL artifact | Latest observation | Age as of 2026-07-30 |
|---|---|---|
| `inflation_timeseries.json` | **2024-12-31** | ~19 months |
| `policy_rate_timeseries.json` | 2026-05-01 | ~3 months |
| `fed_probabilities.json` | Jun 24 vintage | ~5 weeks |
| `country_macro_latest.json` | Jun 24 vintage | ~5 weeks |

So the ungated tier at `econ/series/route.ts:96` serves **~19-month-old CPI data behind a green live pulse**, reachable in the default configuration with both toggles off. That is the largest single truth gap in the terminal and it moves G2 to the front of the queue.

**Fix**: gate the ETL tier behind `snapshotFallbackEnabled` (committed JSON is a snapshot by any other name), and either set `live: false` on the `ETL` provenance meta or introduce a distinct freshness treatment that reflects the export date rather than the request time. See **G11** for what can be retired outright instead of gated.

---

## G3 — Six Gold-backed routes have zero UI callers

**Severity**: High · **False-live**: No

`docs/validation/MODULE_DATA_AUDIT.md` lists these under "New routes added by migration." All query Gold tables. None are referenced anywhere outside `src/app/api`:

| Route | Gold tables | UI refs |
|---|---|---:|
| `/api/econ/global` | `gold.global_inflation`, `gold.global_policy_rates` | 0 |
| `/api/econ/inflation` | `gold.inflation_explorer`, `gold.inflation_contribution` | 0 |
| `/api/econ/credit` | `gold.credit_spread_daily`, `gold.credit_spread_rolling` | 0 |
| `/api/econ/funding` | `gold.funding_tape_daily`, `gold.funding_stress_daily` | 0 |
| `/api/econ/regime` | `gold.macro_regime_daily` | 0 |
| `/api/ml` | recession prob, inflation forecast, factor scores, anomaly, attribution | 0 |
| `/api/econ/benchmark` | Gold benchmark series | 0 |

The corresponding pages — `economics/inflation`, `/credit`, `/funding`, `/regime`, `/ml`, `/benchmark` — instead pull **raw series** through `/api/econ/batch` via `useLiveSeriesSet` and recompute the analytics client-side on top of `@/data/*` SIM shapes.

This is the single largest live-path gap in the codebase: the Gold aggregates already exist, are already tested, and are simply not connected. It also means the client is duplicating analytics that the Gold layer has already computed, so the two can drift.

### Status (2/6 pages wired, infrastructure complete)

**Infrastructure**:
- Hook: `src/lib/useGoldView.ts` (generic Gold route fetcher)
- Routes: All six implemented and functional

**Wired pages** (2/6):
- ✓ `/economics/global-cpi` (fetches `/api/econ/global-inflation`, overlays SIM → Gold → live FRED)
- ✓ `/economics/policy-rates` (fetches `/api/econ/global-policy-rates`, same pattern)

**Remaining pages** (4/6):
- `/economics/inflation` (route exists; page bypasses via FRED computation)
- `/economics/credit` (route exists; page computes from raw spreads)
- `/economics/funding` (route exists; page computes stress gauge)
- `/economics/regime` (route exists; page computes from FRED factors)

All four can follow the global-cpi pattern: fetch Gold → overlay SIM base → overlay live FRED → track source. See `docs/gaps/G3_REFACTORING_GUIDE.md` for detailed refactoring checklist, schema mapping notes, and per-page complexity estimates (1-4 hours each).

**Why incomplete**: Each page has different schema/aggregation levels. Infrastructure is ready; page migrations are deferred pending schema verification and merge-logic design (not blocking other work).

---

## G4 — `global-cpi` and `policy-rates` build from a synthetic base — **FIXED 2026-07-31**

**Severity**: Medium · **False-live**: Partial → Transparent

**Problem**: Construction order was **SIM base → Gold overlay → live FRED overlay**. All rows always rendered because SIM seed in `src/data/globalMacro.ts` creates full country list; overlays only replace fields they can supply. Countries with neither Gold nor FRED coverage silently showed simulated values, but page badge showed best-case source (e.g., "DB" if ANY country had Gold), misleading users that all data was live.

**Fix applied** (2026-07-31):
1. **Page source badge now based on proportion**: Calculate if majority (>50%) of rows have real (DB/FRED) data. Only show "DB"/"FRED" if majority is real; otherwise show "SIM"
2. **Header shows real/tracked split**: Display count like "7/12 real/tracked" so coverage is visible at a glance
3. **Per-row source already visible**: Grid has source tags for each country; users can see exact source

**Result**: Partial false-live issue becomes transparent. When SIM dominates, badge correctly shows "SIM" instead of false "DB". Both page-level proportion AND per-row detail available.

---

## G5 — `useInversions` merges SIM stats into live responses

**Severity**: High · **False-live**: **Yes**

`src/lib/useEcon.ts:173-177`:

```ts
(j) => ({
  inversions: j.inversions ?? [],
  stats: j.stats ?? getInversionStats(spreadId),   // ← SIM on the success path
  timeline: j.timeline ?? [],
}),
```

This `pick` function runs on the **success path**, after `useEconResource`'s suppression logic has already decided the response is real. If the DB/FRED route returns `inversions` but omits `stats`, the page renders synthetic statistics under a `DB` or `FRED` badge.

The bug is that `pick` is not source-aware, unlike the `shouldSuppress` / `suppressedData` machinery wrapping it (`useEcon.ts:66-70`). Note the sibling fields correctly degrade to `[]` — only `stats` reaches for a generator.

**Fix**: return `stats: j.stats ?? null` and have the consuming page render an unavailable state, matching how `inversions` and `timeline` already behave.

---

## G6 — dataops merges fixtures under a "LIVE MANIFEST" tag

**Severity**: Low · **False-live**: Partial

`src/app/dataops/page.tsx:136-138`:

```ts
const runs    = useMemo(() => (live ? mergeByProvider(getProviderRuns(), live.runs) : getProviderRuns()), [live]);
const series  = useMemo(() => (live ? [...getSeriesRunResults(), ...live.series] : getSeriesRunResults()), [live]);
const lineage = useMemo(() => (live ? mergeByProvider(getLineageRuns(), live.lineage) : getLineageRuns()), [live]);
```

`mergeByProvider` is documented at `:102` as "Replace fixture rows whose provider/source has live manifest data; keep the rest." So providers the manifest does not cover retain seeded `Rng` run history — while the panel header shows `LIVE MANIFEST` (`:268`, `:341`) because *some* row resolved.

Partially mitigated: the page already disclaims at `:260` that "Coverage / Fresh / Series / Failed are illustrative targets, not live metrics," and provider **status** is genuinely probed via `/api/dataops/health`.

**Fix**: tag merged rows individually rather than tagging the whole panel, so a fixture row reads `FIXTURE` even inside a live-manifest table.

---

## G7 — Securities-finance pages have no live path

**Severity**: Informational · **False-live**: No

Fully synthetic, sourced from seeded `Rng` generators, all correctly badged `ProvenanceBadge source="SIM"`:

| Page | Data module |
|---|---|
| `/collateral` | `@/data/collateral` |
| `/optimization` | `@/data/optimization` |
| `/sources-uses` | `@/data/sourcesUses` |
| `/trading-desk` | `@/data/etrading`, `@/data/trading`, `@/data/marketConditions` |
| `/prime-finance` | `@/data/primeFinance`, `@/data/marketConditions` |
| `/copilot` | `@/data/securitiesLending`, `@/data/primeFinance`, `@/data/collateral`, `@/data/cash` |
| `/securities-lending/squeeze` | `@/data/squeeze` |

This matches the **Tier C** classification in `MODULE_DATA_AUDIT.md` ("book stays synthetic") — there are no Gold tables for the securities-finance domain and no internal book connected.

**No action implied.** Listed to confirm the scope is intentional rather than unfinished migration, and so a future reviewer does not re-flag it.

---

## G8 — `asset-quilt` rendered the seeded quilt under a live badge — **FIXED 2026-07-30**

**Severity**: High · **False-live**: **Yes**

`src/app/asset-quilt/page.tsx:24` was:

```ts
const quilt = useMemo(() => quiltFromBilello(bilello, asof) ?? getAssetQuilt(), [bilello, asof]);
```

`quiltFromBilello` returns `null` on an empty view (`:215`), and `getAssetQuilt()` is a seeded `Rng` generator (`src/data/marketAnalytics.ts:104-105`). With no DB and both ribbon toggles off, the page rendered a fully synthetic 11-year quilt while the badge showed `source` from `useMarketView` — `"LOADING"`, i.e. a SYNC pill — and the panel header printed the same source string.

Unlike G1 this was a genuine false-live case: the fallback was reachable in the default configuration and ungated by either ribbon toggle. `index-returns` already had the correct pattern (`:100`), gating its generator on `simEnabled`.

**Fixed**: the generated quilt is now gated on `simEnabled` like every other synthetic fallback; an `isSim` flag drives the badge and panel header to read `SIM` rather than the transport source; and an early return (after all hooks) renders an explicit empty state when there is no quilt at all. Verified in both states — SIM off shows the empty state, SIM on shows the quilt under an orange `SIM` badge.

---

## G9 — Gold equity reads exhaust the heap

**Severity**: High · **False-live**: No

`GET /api/market/bilello` **kills the dev server**:

```text
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

Reproduced on a clean tree (`git stash -u`), so this predates the G1/G8 work. The cause is the Gold equity tier at `src/app/api/market/[view]/route.ts:609-612`:

```ts
const [priceRows, totalRows] = await Promise.all([
  store.latest<GoldEquityRow>("equity_return_daily"),
  store.latest<GoldEquityRow>("equity_total_return_index"),
]);
```

`store.latest()` issues `SELECT * FROM <table>` with no date bound and no `LIMIT`, then buffers every row into JS objects and caches the array. Against the local Gold DB (29 GB) that is unbounded. `MARKET_DATA_DIR`/`MARKET_PIPELINE_URL` never get a chance to serve, because the process dies first.

**Blast radius**: every equity-backed view — `market`, `cross-asset`, `bilello`, `index-returns` — so QUILT, SNAP, IRET and MKT cannot currently be served from Gold at all. It also masks G8: asset-quilt sits on `LOADING` forever because the request never returns.

Note the contrast with the EDA tables, which are small and bounded (200 / 16 / 8 rows) and read fine.

**Fix**: push the date filter into SQL. Add a bounded accessor (`store.since(table, fromDate)` or a `raw` query with `WHERE observation_date >= …` + `LIMIT`) and have the equity branch request only the window it needs, rather than the whole table. The route already knows `asof`.

---

## G10 — Nav advertises modules the router never registers

**Severity**: Medium · **False-live**: No

`EDA` was `enabled: true` in `settings/modules.config.json:42` and present in `src/lib/nav.ts:84`, but `src/App.tsx` had no `<Route>` for it — the sidebar entry rendered and 404'd. Fixed for EDA as part of G1.

The structural problem remains: **nav entries, module config and router registration are three independent lists with nothing asserting they agree.** A module can be enabled and advertised while being unreachable, and nothing fails.

**Fix**: add a test that every `on(code)`-gated `NAV` entry resolves to a registered route (and vice versa). Cheap to write, and it would have caught EDA at the point it was introduced.

**Not audited**: whether other `NAV` codes have the same problem. Worth a sweep — the failure is silent by construction.

---

## G11 — the macro ETL is frozen, but still load-bearing

**Severity**: High · **False-live**: **Yes** (via G2) · **Added**: 2026-07-30

### Status: it is not a live pipeline

`macro_data_etl` has not been run since **2026-06-24** — both `macro_data_etl/data/macro.duckdb` and all four `src/data/etl/*.json` exports carry that timestamp. It is not a data source; it is a set of frozen fixtures that happen to have been pipeline-generated. But five code paths still read it:

- `/api/econ/fomc` — `fomcFromEtl()`, `impliedPathFromEtl()`
- `/api/econ/series` — the ungated ETL tier (G2)
- `economics/rates` — `etlFedSource()`, `etlFedModelInputs()`
- `economics/global-cpi` — `etlCountryCPI()`
- `economics/policy-rates` — `etlPolicyRate()`

### Gold coverage vs. ETL, per artifact

| ETL artifact | Coverage | Gold counterpart | Gold coverage | Verdict |
|---|---|---|---|---|
| `fed_probabilities.json` | 4 meetings, Jun 24 vintage | `gold.fomc_probability` (22 rows) + `fomc_meeting_path` (12) | meetings to 2027-12, vintage **2026-07-26** | **Gold strictly better — retire now** |
| `inflation_timeseries.json` | 37 countries, latest **2024-12-31** | `gold.global_inflation` | 12 countries, latest **2026-06-01** | Gold 19 months fresher; 37 → 12 country loss |
| `country_macro_latest.json` | 39 countries | `gold.global_inflation` | 12 countries | Same loss |
| `policy_rate_timeseries.json` | 30 countries, latest 2026-05-01 | `gold.global_policy_rates` | **2 countries** (US, Euro Area) | **Blocked — 30 → 2 is not acceptable** |

### Three separate decisions

1. **FOMC — retire the ETL path today.** Gold has more meetings and a fresher vintage, with no coverage loss. Cleanest slice of G3; touches the same two files as the G2 fix.
2. **Global CPI — retire, accepting 12 countries.** Trading 37 stale countries (ending 2024-12) for 12 current ones is the right trade; stale breadth has little value. Requires a product sign-off on the country list.
3. **Policy rates — blocked.** Gold covers 2 of 30. Retiring here would gut GPOL. See below.

`src/data/etl/` cannot be deleted until (3) is resolved. Until then the honest interim is the G2 gating: keep the data, stop calling it live.

### Widening `gold.global_policy_rates`

The table is driven by `config/global_series.yml` in `fred-bronze-to-gold-pipeline`, which lists exactly two `policy_rates:` entries (`FEDFUNDS`, `ECBDFR`). `manifests/global_policy.yml` holds seven verified series, five of which the config never references — but **adding them would not help**, because they are discontinued:

| Series | Country | Latest obs | Usable? |
|---|---|---|---|
| `ECBMRRFR` | Euro Area | 2026-07-17 | yes (duplicate of existing coverage) |
| `IRSTCB01JPM156N` | Japan | 2023-12-01 | no — discontinued |
| `IRSTCB01CAM156N` | Canada | 2023-12-01 | no — discontinued |
| `IRSTCB01BRM156N` | Brazil | 2023-12-01 | no — discontinued |
| `BOERUKM` | UK | 2017-01-01 | no — 9 years stale |
| `INTDSRJPM193N` | Japan | 2017-04-01 | no — discontinued |

Note the manifest header claims "Verified against live FRED (2026-07-17): all ids below resolve" — that verifies the *endpoint resolves*, not that the series is still updated. Those are different things, and the manifest conflates them. Worth correcting upstream.

**FRED is a dead end for this table.** The OECD `IRSTCB01*` family was discontinued at end-2023, and the manifest already documents ten more ids (US, GB, AU, CH, MX, KR, SE, NO, NZ, TR) that 400 outright.

**The viable path is BIS.** `macro_data_etl/src/connectors/bis.py` already fetches exactly this data — BIS SDMX-REST, dataflow `WS_CBPOL` at `stats.bis.org/api/v2`, keyed by ISO-2 ref area — and that connector is the source of the ETL's 30-country coverage. Widening Gold means porting that connector into `fred-bronze-to-gold-pipeline` as a non-FRED source feeding `gold.global_policy_rates`, then extending `config/global_series.yml`'s `policy_rates:` list.

That is pipeline-side work in a different repo, and it is the true blocker on retiring `src/data/etl/`. Sequence: port BIS → widen the config → cut GPOL over → delete the ETL fixtures.

---

## Suggested order of work

**Done** (2026-07-31): G1 (EDA on Gold + route registered), G2 (ETL tier gated), G5 (stats guarded), G8 (asset-quilt false-live), G9 (equity OOM fixed), G10 (nav/route consistency test), G3 (infrastructure + 2/6 pages wired), G4 (real/synthetic split visible).

**Remaining**:

1. **G3 remaining pages** (4/6) — refactor inflation, credit, funding, regime pages to use Gold routes. Estimated 1-4 hours each. See `docs/gaps/G3_REFACTORING_GUIDE.md` for pattern and per-page notes.
2. **G6** — tag merged rows individually in dataops so fixture rows read `FIXTURE` even inside live-manifest table. Cosmetic but improves transparency. ~30 mins.
3. **G11** — retire the frozen macro ETL. Blocked by BIS connector port to gold pipeline (pipeline-side work, not here).

### Pipeline-side backlog (`fred-bronze-to-gold-pipeline`, separate repo)

These block terminal-side work and cannot be fixed here:

- **Port the BIS `WS_CBPOL` connector** to feed `gold.global_policy_rates` (G11). The true blocker on deleting `src/data/etl/`.
- **Correct `manifests/global_policy.yml`'s "verified" claim** — it asserts live status for six series, five of which stopped updating in 2023 or earlier.
- **`series_lagged_ols` + a PELT variant** of `series_structural_breaks` — takes EDA from 4/6 to 6/6 Gold-backed panels (G1).
- **Decide the `gold.global_inflation` country list** — 12 today vs. 37 in the frozen ETL.
