# Render Gold DB Setup

This runbook connects the deployed `market_terminal` on Render to the local
`fred-bronze-to-gold-pipeline` output by publishing that local SQLite database
into Render Postgres.

Render cannot read a database file on your laptop. The deployed web service must
read a network-accessible database, so the production path is:

```text
fred-bronze-to-gold-pipeline/fred_local.db
  -> Render Postgres
  -> market_terminal MACRO_DB_URL
```

## 1. Create Render Postgres

Create a Render Postgres database in the same region as the `market_terminal`
web service.

Copy the internal connection string when possible. Use it for the Render web
service environment variable:

```text
MACRO_DB_URL=postgres://...
```

Keep this URL secret.

## 2. Refresh the Local FRED Gold DB

From the sibling pipeline repo:

```bash
cd ../fred-bronze-to-gold-pipeline
export FRED_API_KEY=...
PYTHONPATH=src python -m fred_pipeline run --local --db-path fred_local.db
```

That produces tables such as:

```text
gold_dim_series
gold_fred_latest_observation
gold_fred_feature_transforms
gold_macro_indicator_dashboard
gold_treasury_curve
gold_benchmark_rate_board
```

## 3. Publish SQLite Gold To Render Postgres

From this repo:

```bash
cd ../market_terminal
python3 -m pip install "psycopg[binary]"
MACRO_DB_URL="postgres://..." npm run publish:fred-gold -- --serving-only
```

`--serving-only` is the recommended free-test mode. It publishes only
terminal-facing Gold objects and trims date-based tables to `2020-01-01+` by
default so the copy can fit in a small Postgres database. You can trim harder:

```bash
MACRO_DB_URL="postgres://..." npm run publish:fred-gold -- --serving-only --since 2024-01-01
```

For a paid production database with enough storage, omit `--serving-only` to
publish every `gold_*`, `audit_*`, and `meta_*` object.

The publisher maps SQLite object prefixes into Postgres schemas:

```text
gold_dim_series       -> gold.dim_series
gold_v_source_coverage -> gold.v_source_coverage
audit_etl_run         -> audit.etl_run
meta_fred_series      -> meta.fred_series
```

It replaces the published tables/views on each run, so treat the target Postgres
database as a serving copy of the local Gold build.

## 4. Configure Render Web Service

Set this environment variable on the `market_terminal` Render web service:

```text
MACRO_DB_URL=postgres://...
```

Then redeploy `main`.

Optional legacy market-pipeline views use a separate variable:

```text
MARKET_DB_URL=postgres://...
```

Populate that with:

```bash
cd market_data_pipeline
python -m pip install -e ".[postgres]"
FRED_API_KEY=... python -m market_data_pipeline.cli run --start 2010-01-01
MARKET_DB_URL="postgres://..." python -m market_data_pipeline.cli publish-views
```

`MACRO_DB_URL` is the important one for the FRED Gold migration.

## 5. Verify

After Render redeploys, check:

```text
/api/dataops/health
/api/econ/series?id=SOFR&n=5
/api/econ/batch?ids=SOFR,DGS10&units=lin&n=5
/api/econ/curve
/api/econ/benchmark?ids=SOFR,DGS10&n=5
```

Expected result: responses should include `source: "DB"` for Gold-backed routes.

If they fall back to `FRED`, `SNAPSHOT`, or `SIM`, check the Render logs for
`Gold DB read failed` and confirm:

- `MACRO_DB_URL` is set on the web service, not only locally.
- The Postgres URL is reachable from Render.
- The database contains `gold.dim_series`.
- The local publisher completed without errors.
