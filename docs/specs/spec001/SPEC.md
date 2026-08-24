# Spec001: Expand CPI Component Coverage

## Status

Draft

## Owner

Macro terminal / inflation explorer

## Background

The Inflation Explorer currently integrates 18 CPI item-level components through static definitions in `src/data/inflation.ts` and matching FRED catalog rows in `src/data/econSeries.ts`. Those definitions feed:

- CPI component table and contribution bars in `src/app/economics/inflation/page.tsx`
- live index-level fetches through `useLiveSeriesSet(allIds, "lin", 15)`
- derived `Index`, `MoM %`, `YoY %`, `Delta MoM`, and `Delta YoY` via `liveInflationItem`
- drill-through using `DrillProvider` with raw levels and derived growth metrics
- key-indicator inflation fallback through `/api/econ/indicators`

The local Gold DB now contains more CPI-like series than the 18 app-wired items. A direct profile of `gold_fred_latest_observation` found:

- 18 existing app CPI components with observations
- 74 CPI-like observed series matching `CUSR%`, `CUUR%`, or `CPI%`
- 56 CPI-like observed series not currently in the app component list

Important metadata caveat: `gold_dim_series` only contains 4 of the current 18 CPI components, while `gold_fred_latest_observation` contains all 18. Expansion should use `gold_fred_latest_observation` for availability and `meta_fred_series` for titles/tags, not rely only on `gold_dim_series`.

## Goal

Integrate additional CPI component series in the same user-facing pattern as the existing 18 CPI components:

- component appears in the CPI item table
- component has a label, weight or contribution treatment, and group membership
- component fetches live raw index levels through the existing `lin` path
- component derives `Index`, `MoM %`, `YoY %`, `Delta MoM`, and `Delta YoY`
- component supports drill-through with raw level and derived metric history
- component can optionally appear in the broader macro indicator list if it is added to `FRED_CATALOG`

## Non-Goals

- Do not add regional headline CPI rows as item-level components.
- Do not add duplicate headline/core CPI rows to the item-level component list.
- Do not mix seasonally adjusted and not-seasonally-adjusted versions of the same component in the default view without a clear toggle.
- Do not use placeholder weights for contribution analytics without labeling the contribution as unavailable or unweighted.

## Current 18 CPI Components

These are currently wired in `src/data/inflation.ts` and `src/data/econSeries.ts`.
Where the prior terminal row used a FRED convenience alias, the active ID now
uses the canonical FRED/Eco Gold DB `CUSR...` row and carries the old ID as
`legacyId` metadata only.

| Active Series ID | Label | Legacy ID |
| --- | --- | --- |
| CUSR0000SAH1 | Shelter |  |
| CUSR0000SEHC | Owners' Equiv. Rent |  |
| CUSR0000SEHA | Rent of Primary Residence |  |
| CUSR0000SAF1 | Food | CPIUFDSL |
| CUSR0000SAF11 | Food at Home |  |
| CUSR0000SEFV | Food Away from Home |  |
| CUSR0000SA0E | Energy | CPIENGSL |
| CUSR0000SETB01 | Gasoline |  |
| CUSR0000SEHF01 | Electricity |  |
| CUSR0000SAM | Medical Care | CPIMEDSL |
| CUSR0000SETA01 | New Vehicles |  |
| CUSR0000SETA02 | Used Cars & Trucks |  |
| CUSR0000SAA | Apparel | CPIAPPSL |
| CUSR0000SAT | Transportation | CPITRNSL |
| CUSR0000SEMD | Hospital Services |  |
| CUSR0000SAS367 | Airline Fares |  |
| CUSR0000SAR | Recreation | CPIRECSL |
| CUSR0000SAE | Education & Communication | CUSR0000SAE1 |

## Additional DB Inventory

### Recommended Seasonally Adjusted National Additions

Add these first. They are national CPI-U `CUSR0000...` seasonally adjusted group/component rows with live observations in Gold.

| Series ID | DB Title | Suggested Label | Notes |
| --- | --- | --- | --- |
| CUSR0000SA0 | CPI-U All Items (SA) | All Items | Headline duplicate; use only as reference, not default component |
| CUSR0000SA0E | CPI-U Energy (SA) | Energy | Canonical replacement for legacy `CPIENGSL` |
| CUSR0000SA0L1E | CPI-U All Items Less Food and Energy / Core (SA) | Core CPI | Headline/core duplicate; use only as reference |
| CUSR0000SAA | CPI-U Apparel (SA) | Apparel | Canonical replacement for legacy `CPIAPPSL` |
| CUSR0000SAC | CPI-U Commodities (SA) | Commodities | New group |
| CUSR0000SACL1E | CPI-U Commodities Less Food and Energy Commodities (SA) | Core Goods | New group |
| CUSR0000SAE | CPI-U Education and Communication (SA) | Education & Communication | Canonical replacement for legacy `CUSR0000SAE1` |
| CUSR0000SAF | CPI-U Food and Beverages (SA) | Food & Beverages | New group |
| CUSR0000SAF1 | CPI-U Food (SA) | Food | Canonical replacement for legacy `CPIUFDSL` |
| CUSR0000SAG | CPI-U Other Goods and Services (SA) | Other Goods & Services | New group |
| CUSR0000SAH | CPI-U Housing (SA) | Housing | New parent group |
| CUSR0000SAH2 | CPI-U Fuels and Utilities (SA) | Fuels & Utilities | New component |
| CUSR0000SAM | CPI-U Medical Care (SA) | Medical Care | Canonical replacement for legacy `CPIMEDSL` |
| CUSR0000SAM1 | CPI-U Medical Care Commodities (SA) | Medical Care Commodities | New component |
| CUSR0000SAM2 | CPI-U Medical Care Services (SA) | Medical Care Services | New component |
| CUSR0000SAR | CPI-U Recreation (SA) | Recreation | Canonical replacement for legacy `CPIRECSL` |
| CUSR0000SAS | CPI-U Services (SA) | Services | New group |
| CUSR0000SASLE | CPI-U Services Less Energy Services (SA) | Core Services ex Energy | New group |
| CUSR0000SAT | CPI-U Transportation (SA) | Transportation | Canonical parent replacement for legacy `CPITRNSL` |
| CUSR0000SEHF02 | CPI-U Utility (Piped) Gas Service (SA) | Utility Gas Service | New component |

### Optional Not-Seasonally-Adjusted National Additions

These `CUUR0000...` rows are useful, but should not be mixed into the default
SA CPI table unless the UI adds an `SA / NSA` toggle. The toggle is now in
place, and the terminal includes only NSA rows that exist in the FRED/Eco Gold
DB.

| Series ID | Suggested Label |
| --- | --- |
| CUUR0000SAA | Apparel NSA |
| CUUR0000SAC | Commodities NSA |
| CUUR0000SACL1E | Core Goods NSA |
| CUUR0000SAE | Education & Communication NSA |
| CUUR0000SAF | Food & Beverages NSA |
| CUUR0000SAF1 | Food NSA |
| CUUR0000SAF11 | Food at Home NSA |
| CUUR0000SAF116 | Alcoholic Beverages NSA |
| CUUR0000SAG | Other Goods & Services NSA |
| CUUR0000SAH | Housing NSA |
| CUUR0000SAH1 | Shelter NSA |
| CUUR0000SAH2 | Fuels & Utilities NSA |
| CUUR0000SAM | Medical Care NSA |
| CUUR0000SAM1 | Medical Care Commodities NSA |
| CUUR0000SAM2 | Medical Care Services NSA |
| CUUR0000SAR | Recreation NSA |
| CUUR0000SAS | Services NSA |
| CUUR0000SASLE | Core Services ex Energy NSA |
| CUUR0000SAT | Transportation NSA |
| CUUR0000SEFV | Food Away from Home NSA |
| CUUR0000SEHA | Rent of Primary Residence NSA |
| CUUR0000SEHC | Owners' Equivalent Rent NSA |
| CUUR0000SEHF01 | Electricity NSA |
| CUUR0000SEHF02 | Utility Gas Service NSA |
| CUUR0000SETA01 | New Vehicles NSA |
| CUUR0000SETA02 | Used Cars & Trucks NSA |
| CUUR0000SETB01 | Gasoline NSA |

Current Gold does not expose NSA counterparts for the terminal's SA Hospital
Services (`CUSR0000SEMD`) or Airline Fares (`CUSR0000SAS367`) rows, so those are
not shown in the NSA view.

### Exclude From Default Item-Level Components

These have observations but should not be counted as new item-level components by default:

- `CPIAUCSL`: headline CPI already used as a headline aggregate
- `CPILFESL`: core CPI already used as a headline aggregate
- `CUSR0000SA0`, `CUUR0000SA0`: all-items headline variants
- `CUSR0000SA0L1E`, `CUUR0000SA0L1E`: core CPI variants
- `CUUR0100SA0`, `CUUR0200SA0`, `CUUR0300SA0`, `CUUR0400SA0`: regional headline CPI

## Proposed Data Model Changes

### Inflation Component Definition

Replace or extend the tuple shape in `src/data/inflation.ts`:

Current:

```ts
const CPI_COMPONENTS: [string, string, number, number][] = [
  // id, label, weight%, baseYoY
];
```

Proposed:

```ts
interface InflationComponentDef {
  id: string;
  label: string;
  group: "CPI" | "PCE";
  subgroup?: "headline" | "food" | "energy" | "housing" | "medical" | "transportation" | "goods" | "services" | "other";
  seasonalAdjustment: "SA" | "NSA";
  weight: number | null;
  baseYoY: number;
  includeInDefault: boolean;
  contributionEligible: boolean;
  preferredOver?: string;
}
```

Rationale:

- The expanded DB inventory includes duplicate concepts across SA, NSA, and legacy FRED IDs.
- Some added group series do not have exact basket weights in the app yet.
- Contributions should be shown only when weights are available and meaningful.

### FRED Catalog

For each default component added to `CPI_COMPONENTS`, also add a matching `FRED_CATALOG` entry in `src/data/econSeries.ts` so it can participate in:

- `/api/econ/indicators`
- macro chart search/linking
- drill links
- snapshot/simulation fallback behavior

Use:

```ts
{
  id,
  label: `CPI: ${label}`,
  short,
  unit: "index",
  category: "INFLATION",
  freq: "M",
  decimals: 1,
  level,
  vol,
  bullish: false
}
```

## UI Plan

### Phase 1: Add SA National Expansion

Add a curated set of SA additions to the default CPI component table:

- Commodities
- Core Goods
- Food & Beverages
- Housing
- Fuels & Utilities
- Medical Care Commodities
- Medical Care Services
- Services
- Core Services ex Energy
- Utility Gas Service
- Other Goods & Services

Avoid adding headline/core duplicates to the default table.

### Phase 2: Add Component Controls

Add small table controls to the CPI component panel:

- `Level`: `Core View` / `Expanded`
- `Seasonality`: `SA` / `NSA`
- `Contribution`: `Weighted only` / `All series`

Default:

- `Level = Core View`
- `Seasonality = SA`
- `Contribution = Weighted only`

### Phase 3: Contribution Handling

For new components without verified weights:

- display `Weight %` as `-`
- exclude from weighted contribution bars by default
- include in hot/cool acceleration lists
- include in drill-through

Add verified weights later only through the FRED/Eco Gold DB. Do not add a
market_terminal-local static weight map or any direct external data source
without explicit owner approval.

## API Plan

### Existing Endpoint Behavior

`/api/econ/batch?ids=...&units=lin&n=15` already returns index-level observations for arbitrary series IDs in the component list.

`liveInflationItem` already derives:

- index
- MoM
- prior MoM
- YoY
- prior YoY
- Delta MoM
- Delta YoY

No new value-fetch endpoint is required for phase 1.

### Coverage Diagnostics Endpoint

`/api/econ/inflation/coverage` now exposes terminal-side CPI coverage
diagnostics from the FRED/Eco Gold DB only. It compares the curated CPI
component universe against:

- `gold_fred_feature_transforms` for usable transform coverage
- `gold_fred_latest_observation` for null observation gaps
- `gold_inflation_explorer` for DB-provided weights and contribution coverage

The Inflation Explorer uses this endpoint to:

- hide CPI component rows without transform coverage once diagnostics load
- show DB coverage, weighted-row count, and null-observation flags
- expose active canonical series IDs and legacy ID mappings in the component
  table
- keep expanded CPI weights DB-only by clearing component weights when Gold is
  available but `gold_inflation_explorer.weight` is missing

### Optional Future Endpoint

Add `/api/econ/inflation/components` if the component list should become DB-driven instead of static. It should:

- query `gold_fred_latest_observation` for observed CPI component IDs
- join `meta_fred_series` for title/tags
- classify `SA` vs `NSA`
- exclude headline/core/regional rows unless requested
- return a stable list sorted by subgroup and label

This should come after the static expansion is verified in the UI.

## Implementation Checklist

1. [x] Add `InflationComponentDef` to `src/data/inflation.ts`.
2. [x] Convert existing `CPI_COMPONENTS` and `PCE_COMPONENTS` from tuples to objects.
3. [x] Add curated SA CPI additions to `CPI_COMPONENTS`.
4. [x] Preserve the existing 18 IDs and labels to avoid breaking user familiarity.
5. [x] Set `weight: null` for additions unless a verified weight is available.
6. [x] Update `makeItem` and `getInflationComponents` to support nullable weights.
7. [x] Update contribution calculation so `weight == null` produces `contribution: null` or is excluded from contribution bars.
8. [x] Update component table to render missing weight as `-`.
9. [x] Update contribution chart to use only contribution-eligible rows.
10. [x] Add matching `FRED_CATALOG` rows for all added default components.
11. [x] Ensure `useLiveSeriesSet(allIds, "lin", 15)` includes expanded IDs.
12. [x] Ensure drill-through uses `units: "lin"` and `growthMetrics: true`, same as existing 18.
13. [x] Add table controls for core/expanded.
14. [x] Add tests for `liveInflationItem`, nullable weights, and contribution filtering.
15. [x] Verify `/api/econ/batch` returns DB observations for all added default IDs.
16. [x] Add SA/NSA toggle after default expansion is stable.
17. [x] Wire DB-provided relative-importance weights before showing expanded contribution analytics.
18. [ ] Add missing expanded-component weights to the FRED/Eco Gold pipeline if those weights are required in `market_terminal`.
19. [x] Add DB-backed CPI coverage diagnostics for transforms, null observations, and weights.
20. [x] Add component-table source identity for canonical and legacy CPI IDs.
21. [x] Use DB transform coverage to suppress CPI rows that are declared but not usable in Gold.

## Implementation Status

As of 2026-08-22, Phase 1 is wired into `market_terminal` behind the Inflation
Explorer `Expanded` mode:

- `src/data/inflation.ts` now models component definitions as objects with
  subgroup, seasonal adjustment, nullable weight, default-inclusion, and
  contribution eligibility metadata.
- The existing 18 CPI component rows remain the default core view.
- The 11 curated SA CPI additions are available only in expanded mode.
- CPI components now have an `SA / NSA` toggle. SA remains the default. NSA uses
  DB-backed `CUUR...` rows and does not include missing NSA analogues for
  Hospital Services or Airline Fares.
- Expanded row weights are not hardcoded in `market_terminal`; the app only
  accepts weights returned by the FRED/Eco Gold DB in `gold_inflation_explorer`.
- Rows without DB-provided weights render `Weight %` and `Contrib pp` as `-` and
  are excluded from the YoY contribution bar chart.
- The Inflation Explorer fetches `/api/econ/inflation/coverage` and shows CPI
  DB coverage, weighted-row count, null-observation count, latest null date,
  SA/NSA identity, and active canonical series IDs.
- CPI component rows are filtered by Gold transform coverage once coverage
  diagnostics load, so a declared catalog row does not appear as a stale or
  blank component unless Gold has usable transforms for it.
- When Gold inflation data is available, `market_terminal` only treats CPI
  weights as present if `gold_inflation_explorer.weight` is non-null.
- `src/data/econSeries.ts` has matching `FRED_CATALOG` entries so the batch
  endpoint and drill-through can resolve the new IDs.
- `src/data/inflation.test.ts` covers default-vs-expanded component counts,
  nullable expanded weights, DB-provided weight handling, contribution
  eligibility, and live-value derivation.
- `src/lib/server/inflationCoverage.test.ts` covers the CPI coverage diagnostic
  summary, missing transforms, null observations, and missing weights.
- `liveInflationItem` derives MoM/YoY and acceleration by calendar month lags
  instead of array position, so sparse monthly windows do not silently compare
  the wrong months.

Local validation:

- `gold_fred_latest_observation` has all 11 Phase 1 IDs with 30 rows each
  through `2026-06-01`.
- `gold_fred_feature_transforms` has all 11 Phase 1 IDs with 29 non-null rows
  through `2026-06-01`.
- `/api/econ/batch?units=lin&n=15` returned `source: DB` and 15 observations
  for every Phase 1 ID.
- `gold_inflation_explorer` currently has DB-provided weights for only 3 of the
  11 Phase 1 expanded IDs: `CUSR0000SAF`, `CUSR0000SAG`, and `CUSR0000SAH`.
  The other expanded rows should remain unweighted in `market_terminal` until
  the FRED/Eco pipeline adds weights.
- `gold_inflation_explorer` has 30 CPI NSA series from `2024-01-01` through
  `2026-06-01`; the terminal wires 28 non-headline/core NSA component rows
  behind the toggle.
- `/api/econ/inflation/coverage` currently reports 57 curated CPI component
  series, transform coverage for all 57, 51 series with at least one null
  observation row, and 39 series missing DB-provided weights.
- Every Phase 1 ID has a null `2025-10-01` row in
  `gold_fred_latest_observation`; the transform table excludes those null rows.
  This is now explained as an upstream October 2025 source gap. BLS-shaped
  `CUSR...` / `CUUR...` payloads carry footnote code `X` for the 2025 lapse in
  appropriations. This is safe for `market_terminal` derived metrics because
  they are calendar-lag based, and the terminal should not locally impute or
  override the missing month.

## Candidate Phase 1 Default Additions

Use this initial default expansion list unless design review chooses otherwise:

```ts
[
  { id: "CUSR0000SAC", label: "Commodities", subgroup: "goods" },
  { id: "CUSR0000SACL1E", label: "Core Goods", subgroup: "goods" },
  { id: "CUSR0000SAF", label: "Food & Beverages", subgroup: "food" },
  { id: "CUSR0000SAH", label: "Housing", subgroup: "housing" },
  { id: "CUSR0000SAH2", label: "Fuels & Utilities", subgroup: "housing" },
  { id: "CUSR0000SAM1", label: "Medical Care Commodities", subgroup: "medical" },
  { id: "CUSR0000SAM2", label: "Medical Care Services", subgroup: "medical" },
  { id: "CUSR0000SAS", label: "Services", subgroup: "services" },
  { id: "CUSR0000SASLE", label: "Core Services ex Energy", subgroup: "services" },
  { id: "CUSR0000SEHF02", label: "Utility Gas Service", subgroup: "energy" },
  { id: "CUSR0000SAG", label: "Other Goods & Services", subgroup: "other" }
]
```

## Validation Plan

### Data Checks

Run these checks before merging implementation:

```sql
SELECT series_id, COUNT(*) AS obs_rows, MAX(observation_date) AS latest_date
FROM gold_fred_latest_observation
WHERE NOT is_missing
  AND series_id IN (...)
GROUP BY series_id
ORDER BY series_id;
```

Acceptance:

- every added default ID has at least 14 non-missing monthly observations
- latest date is within the expected CPI publication lag
- series values are positive index levels

### UI Checks

- Inflation Explorer CPI table includes the added default rows in expanded mode.
- Each added row has populated `Index`, `MoM %`, `YoY %`, `Delta MoM`, and `Delta YoY`.
- Rows with missing weights do not produce misleading weighted contribution values.
- Drill-through opens and displays raw index plus derived MoM/YoY metrics.
- Core 18 components remain present.

### Build/Test Checks

Run:

```bash
npm test -- src/lib/useEcon.test.ts
npm run build:client
```

Add focused tests if component definition logic is refactored into pure helpers.

## Rollout Plan

1. Land static definition refactor with no new visible components.
2. Add the phase 1 SA default additions behind an `Expanded` table mode.
3. Verify live DB values for every added ID locally.
4. Enable expanded mode in the default CPI table if density remains usable.
5. Add NSA toggle in a separate follow-up. Done.
6. Consider a DB-driven component endpoint only after the static expanded list is stable.

## Open Questions

- Should parent groups such as `Housing`, `Services`, and `Commodities` sit beside narrower subcomponents, or should the default table avoid parent/child double counting?
- Do we want the FRED/Eco pipeline to add broader CPI relative-importance
  coverage before showing expanded contribution analytics for every row?
- Should the FRED/Eco pipeline add NSA Hospital Services and Airline Fares rows,
  or should those remain SA-only in the terminal?
- Should regional CPI headline rows live in a separate regional CPI module instead of the Inflation Explorer?
