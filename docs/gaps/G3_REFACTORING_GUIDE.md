# G3: Gold Route Refactoring Guide

**Status**: Infrastructure complete (hook + 2/6 pages wired); remaining 4 pages documented for future work.

## Overview

G3 wires six orphaned Gold-backed API routes that have zero UI callers. These routes return pre-computed analytics from Gold tables, but the corresponding pages instead pull raw FRED series and recompute client-side, duplicating work that Gold has already done.

## Completed Work

### Infrastructure
- **Hook**: `src/lib/useGoldView.ts` — generic Gold route fetcher with LOADING/DB/ERR states
- **Routes**: All six routes implemented and functional
  - `/api/econ/global-inflation` ✓ (wired)
  - `/api/econ/global-policy-rates` ✓ (wired)
  - `/api/econ/inflation` (route exists, page not using it)
  - `/api/econ/credit` (route exists, page not using it)
  - `/api/econ/funding` (route exists, page not using it)
  - `/api/econ/regime` (route exists, page not using it)

### Pages (2/6 complete)

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

## Remaining Pages (4/6)

### 1. Inflation Explorer (`src/app/economics/inflation/page.tsx`)

**Current**: Pulls headline + component FRED series, computes MoM/YoY/accel client-side

**Gold provides**: `inflation_explorer`, `inflation_contribution` tables

**Refactoring notes**:
- Route returns aggregated explorer/contribution data (not itemized)
- Current page builds individual `InflationItem[]` from FRED series
- **Decision needed**: Use Gold aggregates as summary layer above the detail table, or just skip in favor of full FRED computation
- **Simpler path**: Add Gold data fetch but keep existing FRED computation as primary; Gold as reference/overlay only

**Estimated effort**: 1-2 hours

---

### 2. Credit Spreads (`src/app/economics/credit/page.tsx`)

**Current**: Fetches FRED OAS series, overlays on SIM credit curve

**Gold provides**: `credit_spread_daily`, `credit_spread_rolling` tables

**Refactoring notes**:
- Page builds rating curves from FRED series (BBB, BB, CCC, etc)
- Gold tables likely contain pre-computed daily spreads and rolling metrics
- Current page does heavy computation: stress episodes, haircuts, ETF divergences, betas (all from `@/data/creditSpreads`)
- Gold routes provide different level of aggregation
- **Decision needed**: Determine if Gold tables have the same rating-curve structure or different abstraction
- **Recommendation**: Parallel fetch like global-cpi (fetch Gold, overlay on SIM, then live FRED)

**Estimated effort**: 2-3 hours (depends on schema mismatch)

---

### 3. Funding & Liquidity (`src/app/economics/funding/page.tsx`)

**Current**: Builds fallback series map from macro inputs, fetches FRED FUNDING_FRED_IDS, computes spreads/gauge/stress client-side

**Gold provides**: `funding_tape_daily`, `funding_stress_daily` tables

**Refactoring notes**:
- Page computes stress gauge (0–100) from multiple series
- Heavy use of `computeGauge()`, `computeSpreads()`, `computeSum

mary()`
- Gold tables might have pre-computed gauge and stress metrics
- Depends on whether Gold provides the same metric abstractions
- **Recommendation**: Start with parallel fetch like global-cpi; only replace full computation if Gold metrics match

**Estimated effort**: 2-3 hours

---

### 4. Macro Regime (`src/app/economics/regime/page.tsx`)

**Current**: Fetches FRED REGIME_FRED_IDS, merges into factors via `mergeLiveRegimeFactors()`, computes regime summary

**Gold provides**: `macro_regime_daily` table

**Refactoring notes**:
- Page is sophisticated: impulse scores, playbooks, transitions, exposures, haircuts
- Most data comes from `@/data/macroRegime` (SIM base)
- Live FRED overlay on factors (UNRATE, T10Y2Y, VIXCLS, etc)
- Gold table likely has pre-computed regime scores and named regimes
- **Decision needed**: Use Gold regime scores directly, or compute live from current FRED factors?
  - Gold approach: fresher than snapshot but fixed daily cadence
  - Live approach: always current but expensive compute
  - **Recommendation**: Hybrid — use Gold as base, compute live FRED factors on top if available
- **Complexity**: Merging Gold regime scores with live factor computation

**Estimated effort**: 2-4 hours

---

## Refactoring Pattern

All four remaining pages should follow the **global-cpi pattern**:

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

## Next Steps

1. **Inflation page** (simplest): Establish precedent for non-global pages
2. **Funding page** (straightforward): Metric-based computation
3. **Credit page** (medium): More complex schema, haircuts & ETF logic
4. **Regime page** (hardest): Sophisticated impulse/playbook interplay

For each, start by:
1. Examining the Gold route's actual output (call it via dev tools)
2. Documenting the row schema
3. Writing a simple `mapRowsToSchema()` function
4. Following the global-cpi pattern
5. Testing with both Gold and FRED data present

---

## Related Documentation

- `src/lib/useGoldView.ts` — Hook reference
- `/api/econ/global-inflation`, `/api/econ/global-policy-rates` — Working examples
- `src/app/economics/global-cpi/page.tsx`, `src/app/economics/policy-rates/page.tsx` — Implementation examples
- `docs/gaps/SNAPSHOT_FIXTURE_GAPS.md` — Full gap summary
