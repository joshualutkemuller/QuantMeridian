# CPI Expanded Component Weights Pipeline Handoff

Owner-facing purpose: give this document to an agent working inside the
`fred-bronze-to-gold-pipeline` / FRED-Eco Gold DB repository.

## Context

`market_terminal` now exposes an expanded CPI component view for selected SA CPI
series. The terminal must not add direct external data sources or local static
weight maps for these rows. It only reads CPI component weights from the
FRED/Eco Gold DB, specifically `gold_inflation_explorer.weight`.

The expanded rows already have index values in the Gold DB and render in
`market_terminal`. The remaining gap is that 8 of the 11 expanded rows do not
have weights in `gold_inflation_explorer`, so the terminal correctly shows
`Weight % = -` and excludes them from contribution bars.

## Current Gold DB State

Checked locally against:

`/Users/joshualutkemuller/Documents/Quant Sandbox/fred-bronze-to-gold-pipeline/fred_local.db`

All 11 expanded rows have `gold_inflation_explorer` records from `2024-01-01`
through `2026-06-01`. Only 3 currently have non-null weights:

| Series ID | Label | Weighted rows |
| --- | --- | ---: |
| `CUSR0000SAF` | Food and Beverages | 29 |
| `CUSR0000SAG` | Other Goods and Services | 29 |
| `CUSR0000SAH` | Housing | 29 |

## Missing Weights To Add

Add weights for these 8 SA CPI expanded component rows:

| Series ID | Current label in Gold | Terminal label | Expected target |
| --- | --- | --- | --- |
| `CUSR0000SAC` | Commodities | Commodities | `gold_inflation_explorer.weight` non-null |
| `CUSR0000SACL1E` | Core Goods | Core Goods | `gold_inflation_explorer.weight` non-null |
| `CUSR0000SAH2` | Fuels and Utilities | Fuels & Utilities | `gold_inflation_explorer.weight` non-null |
| `CUSR0000SAM1` | Medical Care Commodities | Medical Care Commodities | `gold_inflation_explorer.weight` non-null |
| `CUSR0000SAM2` | Medical Care Services | Medical Care Services | `gold_inflation_explorer.weight` non-null |
| `CUSR0000SAS` | Services | Services | `gold_inflation_explorer.weight` non-null |
| `CUSR0000SASLE` | Core Services | Core Services ex Energy | `gold_inflation_explorer.weight` non-null |
| `CUSR0000SEHF02` | Utility (Piped) Gas | Utility Gas Service | `gold_inflation_explorer.weight` non-null |

## Pipeline Requirement

Implement this in the FRED/Eco pipeline, not in `market_terminal`.

Preferred behavior:

- Populate `gold_inflation_explorer.weight` for the 8 missing SA rows.
- Populate `gold_inflation_explorer.contribution_pp` wherever the pipeline has
  enough index and weight data to calculate it consistently.
- Preserve the existing `series_id`, `item_label`, `basket = CPI`, and
  `sa_nsa = SA` records.
- Use a pipeline-owned, approved source or existing pipeline data product for
  CPI relative-importance weights. If the pipeline does not already have an
  approved weight source, stop and discuss before adding a new external source.
- Do not require `market_terminal` to carry source-specific weight constants.

## Validation SQL

Run this after rebuilding local Gold:

```sql
SELECT
  series_id,
  item_label,
  MIN(observation_date) AS first_date,
  MAX(observation_date) AS latest_date,
  COUNT(*) AS rows,
  SUM(CASE WHEN weight IS NOT NULL THEN 1 ELSE 0 END) AS weighted_rows,
  SUM(CASE WHEN contribution_pp IS NOT NULL THEN 1 ELSE 0 END) AS contribution_rows
FROM gold_inflation_explorer
WHERE series_id IN (
  'CUSR0000SAC',
  'CUSR0000SACL1E',
  'CUSR0000SAH2',
  'CUSR0000SAM1',
  'CUSR0000SAM2',
  'CUSR0000SAS',
  'CUSR0000SASLE',
  'CUSR0000SEHF02'
)
GROUP BY series_id, item_label
ORDER BY series_id;
```

Acceptance criteria:

- Every one of the 8 rows has `weighted_rows > 0`.
- Ideally every one of the 8 rows has weights for the full local explorer window
  currently represented by the pipeline (`2024-01-01` through latest CPI month).
- `market_terminal` should show non-null `Weight %` for those rows without any
  code-side static weights.
- Contribution bars in `market_terminal` should include those rows only when
  `gold_inflation_explorer.weight` is present.

## Market Terminal Dependency

The relevant terminal-side files are:

- `src/data/inflation.ts`: declares the expanded CPI rows with `weight: null`.
- `src/app/economics/inflation/page.tsx`: merges DB-provided weights from
  `/api/econ/inflation` / `gold_inflation_explorer`.
- `docs/specs/spec001/SPEC.md`: records the DB-only policy and spec status.

No `market_terminal` change should be needed once the pipeline emits weights for
these 8 IDs.

## Related Known Issue

All 11 Phase 1 expanded CPI IDs currently have a null `2025-10-01` observation
in `gold_fred_latest_observation`, and `gold_fred_feature_transforms` excludes
that null month. `market_terminal` derives MoM/YoY by calendar lag to avoid
array-position errors, but the pipeline should still treat that null month as a
data-continuity issue if it is not expected.
