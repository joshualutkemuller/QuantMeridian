#!/usr/bin/env python3
"""Publish a local fred-bronze-to-gold SQLite DB into Postgres for Render.

The FRED pipeline local backend writes tables as ``gold_dim_series`` and
``audit_etl_run``. The terminal's Render runtime reads Postgres schemas such as
``gold.dim_series`` through ``MACRO_DB_URL``. This bridge copies the local SQLite
objects into matching Postgres schemas.

Usage:
  MACRO_DB_URL=postgres://... python3 scripts/publish_fred_gold_to_postgres.py
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path
from dataclasses import dataclass
from typing import Iterable


DEFAULT_SQLITE = "../fred-bronze-to-gold-pipeline/fred_local.db"
DEFAULT_PREFIXES = ("gold", "audit", "meta")
DEFAULT_SERVING_SINCE = "2020-01-01"

SERVING_OBJECTS = (
    "audit_data_quality_result",
    "audit_etl_run",
    "audit_etl_series_run",
    "gold_benchmark_rate_board",
    "gold_credit_spread_daily",
    "gold_credit_spread_rolling",
    "gold_curve_spread_daily",
    "gold_curve_spread_rolling",
    "gold_dim_series",
    "gold_equity_factor_attribution",
    "gold_equity_factor_implied_return",
    "gold_equity_price_reconciliation",
    "gold_equity_return_daily",
    "gold_equity_total_return_index",
    "gold_fomc_meeting_path",
    "gold_fomc_probability",
    "gold_fred_feature_transforms",
    "gold_fred_latest_observation",
    "gold_funding_stress_daily",
    "gold_funding_tape_daily",
    "gold_global_inflation",
    "gold_global_policy_rates",
    "gold_index_constituents",
    "gold_inflation_contribution",
    "gold_inflation_explorer",
    "gold_inflation_forecast",
    "gold_macro_anomaly_scores",
    "gold_macro_category_summary",
    "gold_macro_factor_loadings",
    "gold_macro_factor_scores",
    "gold_macro_indicator_dashboard",
    "gold_macro_indicator_sparkline",
    "gold_macro_regime_daily",
    "gold_powerbi_catalog",
    "gold_recession_probability_daily",
    "gold_release_calendar",
    "gold_series_correlation",
    "gold_series_lead_lag",
    "gold_series_structural_breaks",
    "gold_spread_inversion_episode",
    "gold_treasury_curve",
    "gold_treasury_curve_metrics",
    "gold_treasury_curve_rolling",
    "gold_v_source_coverage",
    "gold_yield_curve_ns_factors",
)

DATE_FILTER_COLUMNS = (
    "observation_date",
    "as_of_date",
    "release_date",
    "date",
    "started_at",
    "checked_at",
)


@dataclass(frozen=True)
class PublishObject:
    obj_type: str
    name: str
    where_sql: str = ""
    params: tuple[object, ...] = ()


def load_psycopg():
    try:
        import psycopg  # type: ignore

        return psycopg
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            "psycopg is required. Install it with:\n"
            "  python3 -m pip install 'psycopg[binary]'\n"
        ) from exc


def qident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def pg_type(sqlite_type: str) -> str:
    t = (sqlite_type or "").upper()
    if "INT" in t:
        return "BIGINT"
    if any(token in t for token in ("REAL", "FLOA", "DOUB")):
        return "DOUBLE PRECISION"
    if "BLOB" in t:
        return "BYTEA"
    return "TEXT"


def split_object(name: str) -> tuple[str, str] | None:
    if "_" not in name:
        return None
    schema, table = name.split("_", 1)
    if not schema or not table:
        return None
    return schema, table


def sqlite_objects(conn: sqlite3.Connection, prefixes: Iterable[str]) -> list[tuple[str, str]]:
    allowed = tuple(f"{p}_" for p in prefixes)
    rows = conn.execute(
        "SELECT type, name FROM sqlite_master "
        "WHERE type IN ('table', 'view') ORDER BY type, name"
    ).fetchall()
    return [(row["type"], row["name"]) for row in rows if row["name"].startswith(allowed)]


def serving_objects(conn: sqlite3.Connection, since: str) -> list[PublishObject]:
    all_objects = {name: obj_type for obj_type, name in sqlite_objects(conn, DEFAULT_PREFIXES)}
    planned: list[PublishObject] = []
    for name in SERVING_OBJECTS:
        obj_type = all_objects.get(name)
        if not obj_type:
            continue
        cols = {col for col, _ in columns(conn, name)}
        date_col = next((col for col in DATE_FILTER_COLUMNS if col in cols), None)
        if date_col:
            planned.append(PublishObject(obj_type, name, f"WHERE {qident(date_col)} >= ?", (since,)))
        else:
            planned.append(PublishObject(obj_type, name))
    return planned


def columns(conn: sqlite3.Connection, name: str) -> list[tuple[str, str]]:
    cols = conn.execute(f"PRAGMA table_info({qident(name)})").fetchall()
    return [(row["name"], pg_type(row["type"])) for row in cols]


def compatibility_columns(source_name: str, existing: set[str]) -> list[tuple[str, str, str]]:
    extras: list[tuple[str, str, str]] = []
    if "observation_date" in existing and "date" not in existing:
        extras.append(("date", "TEXT", qident("observation_date")))
    if source_name in {"gold_curve_spread_daily", "gold_spread_inversion_episode"} and "spread_name" in existing and "spread_id" not in existing:
        extras.append(("spread_id", "TEXT", qident("spread_name")))
    return extras


def create_indexes(pg_conn, schema: str, table: str, col_names: list[str]) -> None:
    target = f"{qident(schema)}.{qident(table)}"
    index_sets = [
        ("series_id", "date"),
        ("series_id", "observation_date"),
        ("ticker", "date"),
        ("ticker", "observation_date"),
        ("spread_id", "date"),
        ("spread_name", "observation_date"),
        ("as_of_date",),
    ]
    with pg_conn.cursor() as cur:
        for cols in index_sets:
            if all(col in col_names for col in cols):
                suffix = "_".join(cols)
                idx = qident(f"idx_{schema}_{table}_{suffix}"[:60])
                col_sql = ", ".join(qident(col) for col in cols)
                cur.execute(f"CREATE INDEX IF NOT EXISTS {idx} ON {target} ({col_sql})")


def drop_existing_target(cur, schema: str, table: str) -> None:
    target = f"{qident(schema)}.{qident(table)}"
    cur.execute(
        """
        SELECT c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %s AND c.relname = %s
        """,
        (schema, table),
    )
    row = cur.fetchone()
    if not row:
        return
    relkind = row[0]
    if relkind in {"r", "p", "f"}:
        cur.execute(f"DROP TABLE {target} CASCADE")
    elif relkind in {"v", "m"}:
        cur.execute(f"DROP VIEW {target} CASCADE")
    else:
        raise RuntimeError(f"Cannot replace {schema}.{table}; unsupported Postgres relkind {relkind!r}")


def copy_object(sqlite_conn: sqlite3.Connection, pg_conn, plan: PublishObject, batch_size: int) -> int:
    source_name = plan.name
    parsed = split_object(source_name)
    if parsed is None:
        return 0
    schema, table = parsed
    cols = columns(sqlite_conn, source_name)
    if not cols:
        return 0

    existing = {col for col, _ in cols}
    extras = compatibility_columns(source_name, existing)
    target_cols = [*cols, *[(col, typ) for col, typ, _ in extras]]
    pg_cols = ", ".join(f"{qident(col)} {typ}" for col, typ in target_cols)
    col_names = [col for col, _ in target_cols]
    select_exprs = [qident(col) for col, _ in cols] + [f"{expr} AS {qident(col)}" for col, _, expr in extras]
    select_sql_cols = ", ".join(select_exprs)
    target_col_sql = ", ".join(qident(col) for col in col_names)
    target = f"{qident(schema)}.{qident(table)}"

    with pg_conn.cursor() as cur:
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {qident(schema)}")
        drop_existing_target(cur, schema, table)
        cur.execute(f"CREATE TABLE {target} ({pg_cols})")

        total = 0
        select_sql = f"SELECT {select_sql_cols} FROM {qident(source_name)} {plan.where_sql}".strip()
        with cur.copy(f"COPY {target} ({target_col_sql}) FROM STDIN") as copy:
            rows = sqlite_conn.execute(select_sql, plan.params)
            while True:
                batch = rows.fetchmany(batch_size)
                if not batch:
                    break
                for row in batch:
                    copy.write_row(tuple(row[col] for col in col_names))
                total += len(batch)

    create_indexes(pg_conn, schema, table, col_names)
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", default=DEFAULT_SQLITE, help="Path to fred_local.db")
    parser.add_argument("--db-url", default=os.environ.get("MACRO_DB_URL"), help="Postgres URL. Defaults to MACRO_DB_URL.")
    parser.add_argument(
        "--prefix",
        action="append",
        dest="prefixes",
        help="SQLite object prefix/schema to publish. Repeatable. Defaults: gold, audit, meta.",
    )
    parser.add_argument(
        "--serving-only",
        action="store_true",
        help="Publish only terminal-facing serving objects, trimmed by --since. Intended for Render Free Postgres testing.",
    )
    parser.add_argument(
        "--since",
        default=DEFAULT_SERVING_SINCE,
        help=f"Minimum date for date-based tables in --serving-only mode. Default: {DEFAULT_SERVING_SINCE}.",
    )
    parser.add_argument("--batch-size", type=int, default=10_000)
    args = parser.parse_args()

    if not args.db_url:
        raise SystemExit("Set MACRO_DB_URL or pass --db-url postgres://...")
    if not args.db_url.startswith(("postgres://", "postgresql://")):
        raise SystemExit("This publisher expects a Postgres MACRO_DB_URL.")

    sqlite_path = Path(args.sqlite).expanduser().resolve()
    if not sqlite_path.exists():
        raise SystemExit(f"SQLite DB not found: {sqlite_path}")

    prefixes = tuple(args.prefixes or DEFAULT_PREFIXES)
    psycopg = load_psycopg()

    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row
    if args.serving_only:
        objects = serving_objects(sqlite_conn, args.since)
    else:
        objects = [PublishObject(obj_type, name) for obj_type, name in sqlite_objects(sqlite_conn, prefixes)]
    if not objects:
        scope = "serving allowlist" if args.serving_only else f"prefixes: {', '.join(prefixes)}"
        raise SystemExit(f"No SQLite objects found for {scope}")

    mode = f"serving-only since {args.since}" if args.serving_only else f"prefixes {', '.join(prefixes)}"
    print(f"Publishing {len(objects)} SQLite objects from {sqlite_path} ({mode})")
    with psycopg.connect(args.db_url) as pg_conn:
        for obj in objects:
            count = copy_object(sqlite_conn, pg_conn, obj, args.batch_size)
            pg_conn.commit()
            filter_note = f" {obj.where_sql} {obj.params}" if obj.where_sql else ""
            print(f"  {obj.obj_type:5s} {obj.name:42s} -> {count:>10} rows{filter_note}")

    sqlite_conn.close()
    print("Done. Set the Render web service MACRO_DB_URL to this same Postgres URL.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
