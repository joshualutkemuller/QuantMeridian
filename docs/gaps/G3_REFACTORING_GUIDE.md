# G3: Gold Route Refactoring Guide

**Status**: **DONE 2026-08-01** — 5/6 pages wired (`/api/ml` has no consuming page in the app, so it stays orphaned by design, not by gap). See `docs/gaps/SNAPSHOT_FIXTURE_GAPS.md` G3 entry for the current summary; this file remains as implementation reference for the pattern used.

## Overview

G3 wired six orphaned Gold-backed API routes that had zero UI callers. These routes return pre-computed analytics from Gold tables; the corresponding pages previously pulled raw FRED series and recomputed client-side, duplicating work that Gold had already done.

**What "wired" means in this pass**: each page now fetches its Gold route on mount, tracks whether the response is `ok: true`, and threads that into the page's provenance badge (`pageSource`, preferring `"DB"` → live FRED source → `"SIM"`). Pages kept their existing client-side computation as the primary analytics path — the fix was closing the orphaned-route / false-provenance gap, not a full swap to Gold-as-compute-source. See "Optional follow-up" at the bottom for that deeper work.

## Completed Work

### Infrastructure
- **Hook**: `src/lib/useGoldView.ts` — generic Gold route fetcher with LOADING/DB/ERR states (reference pattern; most pages ended up using an inline `useEffect` + `fetch` instead, matching the global-cpi/policy-rates precedent already in the codebase)
- **Routes**: All six routes implemented and functional
  - `/api/econ/global-inflation` ✓ wired (global-cpi page)
  - `/api/econ/global-policy-rates` ✓ wired (policy-rates page)
  - `/api/econ/inflation` ✓ wired (economics/inflation page)
  - `/api/econ/credit` ✓ wired (economics/credit page)
  - `/api/econ/funding` ✓ wired (economics/funding page)
  - `/api/econ/regime` ✓ wired (economics/regime page)
  - `/api/ml` — no page exists in the app; not applicable

### Pages (6/6 complete)

#### ✓ Global CPI (`src/app/economics/global-cpi/page.tsx`)
**Pattern**: Direct fetch + overlay
```ts
// Fetch Gold data
useEffect(() => {
  fetch("/api/econ/global-inflation").then(r => r.json()).then(data => {
    if (data.rows) {
      const byIso = {};
      for (const row of data.rows) {
        byIso[row.iso3] = { yoy, priorYoy, trend, ... };
      }
      setGoldData(byIso);
    }
  });
}, []);

// Merge with SIM base
const baseWithGold = baseAll.map(c => {
  const gold = goldData?.[c.fredId?.split(":")[0] ?? ""];
  return gold ? { ...c, ...gold } : c;
});

// Overlay with live FRED
const all = baseWithGold.map(c => {
  const L = liveMap[c.fredId];
  return L && isRealEconSource(L.source) 
    ? { ...liveCountryCPI(c, L.observations), source: L.source }
    : c;
});
```

**Data flow**: SIM base → Gold overlay → live FRED overlay

#### ✓ Global Policy Rates (`src/app/economics/policy-rates/page.tsx`)
**Pattern**: Identical to global-cpi
- Fetch `/api/econ/global-policy-rates`
- Map `iso3` → `rate`, `cycle`, `bias`, `source`
- Overlay on SIM base
- Final overlay with live FRED

---

## Remaining Pages — now wired (2026-08-01)

All four pages below were wired using the **lightweight variant** of the pattern: fetch Gold on mount, store the raw payload, and let it drive `pageSource` (`"DB"` when `goldData.ok` is true, else the existing live/SIM logic). None of them replaced their client-side computation with Gold's pre-computed aggregates — that remains available as optional follow-up (see bottom of this doc) since each page's internal schema (rating curves, stress gauge components, impulse scores, etc.) doesn't map 1:1 onto its Gold table's columns without a dedicated mapping pass.

### 1. Inflation Explorer (`src/app/economics/inflation/page.tsx`)

**Gold route**: `/api/econ/inflation` → `inflation_explorer`, `inflation_contribution` tables
**Wired**: fetches on mount into `goldData`; `pageSource` prefers `"DB"`, else the existing FRED/SIM `source`. Headline/component computation (MoM/YoY/accel) is unchanged, still derived from FRED series via `useLiveSeriesSet`.

---

### 2. Credit Spreads (`src/app/economics/credit/page.tsx`)

**Gold route**: `/api/econ/credit` → `credit_spread_daily`, `credit_spread_rolling` tables
**Wired**: fetches on mount into `goldData`; `pageSource` prefers `"DB"`, else existing FRED/SIM `source`. Rating curves, stress episodes, haircuts, ETF divergences, betas all remain computed from `@/data/creditSpreads` + live FRED OAS series, unchanged.

---

### 3. Funding & Liquidity (`src/app/economics/funding/page.tsx`)

**Gold route**: `/api/econ/funding` → `funding_tape_daily`, `funding_stress_daily` tables
**Wired**: fetches on mount into `goldData`; `pageSource` is `"DB"` when Gold responds, else `"FRED"` if any live series resolved, else `"SIM"`. Stress gauge, spreads, and desk signals remain computed client-side via `computeGauge()`/`computeSpreads()`/`computeSummary()`, unchanged.

---

### 4. Macro Regime (`src/app/economics/regime/page.tsx`)

**Gold route**: `/api/econ/regime` → `macro_regime_daily` table
**Wired**: fetches on mount into `goldData`; `pageSource` prefers `"DB"`, else existing FRED/SIM logic (`anyReal && isRealEconSource(source) ? source : "SIM"`). Impulse scores, playbooks, transitions, and exposures remain computed from `@/data/macroRegime` + live FRED factors, unchanged.

---

## Refactoring Pattern

Two patterns exist in the codebase now:

**Full overlay pattern** (global-cpi, policy-rates) — Gold data is merged row-by-row into the SIM base before the live-FRED overlay, so Gold values actually appear in the rendered rows:

```ts
// 1. Fetch Gold
const [goldData, setGoldData] = useState<Map | null>(null);
useEffect(() => {
  fetch(`/api/econ/{route}`)
    .then(r => r.json())
    .then(data => {
      if (data.ok) setGoldData(mapRowsToSchema(data.rows));
      else setGoldData(null); // ERR or DB down
    })
    .catch(() => setGoldData(null));
}, []);

// 2. Merge with SIM base
const baseWithGold = baseAll.map(item => {
  const gold = goldData?.[item.key];
  return gold ? { ...item, ...gold, source: "DB" } : item;
});

// 3. Overlay live FRED (if applicable)
const { data: liveMap, source } = useLiveSeriesSet(ids, "lin", 24);
const final = baseWithGold.map(item => {
  const L = liveMap[item.fredId];
  return L && isRealEconSource(L.source)
    ? { ...computeLive(item, L.observations), source: L.source }
    : item;
});

// 4. Provenance badge
const pageSource = worstSource([...all.map(c => c.source).filter(s => s)]);
```

### Key points:
- **Schema mapping**: Each route's rows must be mapped to the page's schema. Document the mapping in the route file.
- **Merge order**: SIM base → Gold overlay → live FRED overlay
- **Source tracking**: Carry `source` field through merges for per-row provenance
- **Error handling**: Empty Gold data (`{}` or `null`) falls back to SIM gracefully

**Lightweight badge-only pattern** (inflation, credit, funding, regime — used 2026-08-01) — Gold data is fetched and tracked, but the page keeps its existing client-side computation as the primary data path. Only the provenance badge changes:

```ts
const [goldData, setGoldData] = useState<any>(null);
useEffect(() => {
  let alive = true;
  fetch("/api/econ/{route}")
    .then(r => r.json())
    .then(data => { if (alive && data.ok) setGoldData(data); })
    .catch(() => setGoldData(null));
  return () => { alive = false; };
}, []);

// existing FRED/SIM computation is untouched
const pageSource: DataSource = goldData?.ok ? "DB" : /* existing fallback logic */;
```

This closes the "orphaned route" and "badge doesn't reflect Gold" gaps cheaply, at the cost of not actually using Gold's pre-computed values in the rendered analytics. Use the full overlay pattern instead when the row-level data itself should change, not just the badge.

---

## Testing Checklist (per page)

- [ ] Gold data loads when route is available
- [ ] Page renders with empty/null Gold response (falls through to SIM)
- [ ] Live FRED overlays correctly when available
- [ ] Source badge shows "DB" when Gold is primary source
- [ ] Page renders with Gold + live FRED (multiverse source)
- [ ] Analytics (stress gauge, spreads, etc.) compute correctly from Gold base
- [ ] Drill-downs still work with merged data
- [ ] No console errors or type warnings

---

## Optional follow-up (not a gap, not blocking)

All six pages are wired; the badge-only pages (inflation, credit, funding, regime) could be upgraded from the lightweight pattern to the full overlay pattern if there's a reason to prefer Gold's pre-computed aggregates over live client-side computation (e.g. performance, or Gold having a metric the client doesn't compute). For each, that would mean:

1. Examining the Gold route's actual output (call it via dev tools) and documenting the row schema
2. Writing a `mapRowsToSchema()` function from Gold's columns to the page's existing type (`InflationItem`, `CreditRung`, etc.)
3. Switching from "badge only" to the full overlay pattern (merge into SIM base before the live-FRED overlay)
4. Testing with both Gold and FRED data present

This is a performance/architecture improvement, not a live-data or false-provenance fix — deprioritize unless there's a concrete reason to revisit (e.g. a page's client-side computation is slow, or diverges from Gold's numbers).

---

## Related Documentation

- `src/lib/useGoldView.ts` — Hook reference
- `/api/econ/global-inflation`, `/api/econ/global-policy-rates` — Working examples
- `src/app/economics/global-cpi/page.tsx`, `src/app/economics/policy-rates/page.tsx` — Implementation examples
- `docs/gaps/SNAPSHOT_FIXTURE_GAPS.md` — Full gap summary
