# CPI October 2025 Null Observation Handoff

Owner-facing purpose: explain the `2025-10-01` CPI null rows seen by
`market_terminal` and give the FRED/Eco pipeline agent exact validation steps.

## Finding

The October 2025 CPI null rows are an upstream source gap, not a
`market_terminal` rendering or transform bug.

Local Gold/Silver profile checked against:

`/Users/joshualutkemuller/Documents/Quant Sandbox/fred-bronze-to-gold-pipeline/fred_local.db`

Observed behavior:

- `gold_fred_latest_observation` has 68 CPI-like latest rows on `2025-10-01`
  where `value IS NULL` and `is_missing = 1`.
- The curated terminal CPI component coverage endpoint reports 51 curated CPI
  component series with at least one null observation row.
- `silver_fred_observation` carries the same missing source markers.
- FRED-shaped rows use `raw_value = '.'`.
- BLS-shaped `CUSR...` / `CUUR...` rows use `raw_value = '-'`.
- `gold_fred_feature_transforms` excludes the null October rows.
- `gold_inflation_explorer` mostly excludes the null October rows; local count
  for `observation_date = '2025-10-01'` is 6 rows.

For BLS-shaped `CUSR...` / `CUUR...` rows, the Bronze payload includes footnote
code `X` with the text: "Data unavailable due to the 2025 lapse in
appropriations."

## Sample Evidence

Gold latest observations around the gap:

```sql
SELECT series_id, observation_date, value, is_missing
FROM gold_fred_latest_observation
WHERE series_id IN ('CUSR0000SAC','CUSR0000SAF','CUSR0000SAH','CUSR0000SAS','CUUR0000SAC','CPIAUCSL')
  AND observation_date BETWEEN '2025-08-01' AND '2025-12-01'
ORDER BY series_id, observation_date;
```

Expected pattern:

- August 2025: valid value
- September 2025: valid value
- October 2025: `value = NULL`, `is_missing = 1`
- November 2025: valid value
- December 2025: valid value

Silver source markers:

```sql
SELECT series_id, observation_date, raw_value, value, is_missing, realtime_start, realtime_end
FROM silver_fred_observation
WHERE series_id IN ('CUSR0000SAC','CPIAUCSL','CUUR0000SAC')
  AND observation_date BETWEEN '2025-09-01' AND '2025-11-01'
ORDER BY series_id, observation_date;
```

Representative output:

| Series ID | Observation Date | Raw Value | Value | Missing |
| --- | --- | --- | --- | ---: |
| `CPIAUCSL` | `2025-10-01` | `.` | `NULL` | 1 |
| `CUSR0000SAC` | `2025-10-01` | `-` | `NULL` | 1 |
| `CUUR0000SAC` | `2025-10-01` | `-` | `NULL` | 1 |

BLS payload footnote check:

```sql
SELECT
  series_id,
  substr(response_payload, max(1, instr(response_payload, '"year": "2025", "period": "M10"') - 180), 620) AS payload_excerpt
FROM bronze_fred_api_response
WHERE series_id IN ('CUSR0000SAC','CUUR0000SAC')
ORDER BY series_id, ingested_at DESC;
```

Counts:

```sql
SELECT COUNT(*) AS gold_cpi_like_oct_2025_missing
FROM gold_fred_latest_observation
WHERE observation_date = '2025-10-01'
  AND is_missing = 1
  AND (series_id LIKE 'CUSR%' OR series_id LIKE 'CUUR%' OR series_id LIKE 'CPI%');

SELECT COUNT(*) AS gold_cpi_like_oct_2025_transforms
FROM gold_fred_feature_transforms
WHERE observation_date = '2025-10-01'
  AND (series_id LIKE 'CUSR%' OR series_id LIKE 'CUUR%' OR series_id LIKE 'CPI%');

SELECT COUNT(*) AS explorer_oct_2025_rows
FROM gold_inflation_explorer
WHERE observation_date = '2025-10-01';
```

Current local results:

| Check | Count |
| --- | ---: |
| Gold CPI-like October 2025 missing latest observations | 68 |
| Gold CPI-like October 2025 transform rows | 6 |
| Gold inflation explorer October 2025 rows | 6 |

## Market Terminal Behavior

The terminal should not impute or backfill this gap locally.

Current terminal behavior is correct:

- derived MoM/YoY calculations ignore non-finite values
- calendar-lag logic avoids comparing the wrong adjacent array positions
- `/api/econ/inflation/coverage` surfaces the null-observation count and latest
  null date
- Inflation Explorer displays null-observation coverage tags instead of silently
  hiding the data-quality issue

## Pipeline Decision Needed

The FRED/Eco pipeline should choose one explicit policy:

1. Preserve source missing rows exactly as `is_missing = 1`.
2. Add a Gold data-quality issue classification for the October 2025 lapse in
   appropriations so downstream consumers can distinguish expected source gaps
   from ingest failures.
3. If an authoritative revision later fills October 2025, rebuild Gold so
   `gold_fred_latest_observation.value` becomes non-null and transform/explorer
   rows are regenerated.

Do not ask `market_terminal` to patch this with an interpolated value or a
static override.

## Acceptance Criteria

After any pipeline-side change:

- The October 2025 source gap is either still present and explicitly classified,
  or filled by an authoritative revised source payload.
- `gold_fred_feature_transforms` contains no rows derived from null source
  values.
- `gold_inflation_explorer` contains no rows with fake imputed index values.
- `/api/econ/inflation/coverage` still reports the gap if it remains in Gold,
  or reports fewer/null no-observation flags if the source is revised.
