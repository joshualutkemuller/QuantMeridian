"""Ingestion orchestration — extract → archive → normalize → quality → load.

FRED is the sole data source. Market equity/price data is served by the
fred-bronze-to-gold-pipeline via MACRO_DB_URL; this pipeline handles macro
series only.
"""

from __future__ import annotations

import json
import math
import time
from datetime import date, datetime, timezone

import polars as pl

from market_data_pipeline.src import analytics
from market_data_pipeline.src.config.catalog import get_catalog
from market_data_pipeline.src.config.settings import get_settings
from market_data_pipeline.src.connectors import FredConnector
from market_data_pipeline.src.ingestion.manifest import ManifestWriter
from market_data_pipeline.src.quality.checks import QualityChecker
from market_data_pipeline.src.storage.duckdb_store import DuckDBStore
from market_data_pipeline.src.storage.parquet_archive import ParquetArchive
from market_data_pipeline.src.transforms.normalize import normalize_macro


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _json_clean(obj):
    """Recursively coerce NaN/Inf → None so payloads are valid JSON."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _json_clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_clean(v) for v in obj]
    return obj


def _extract_asof(payload: dict) -> date | None:
    """Best-effort as-of date from a view payload."""
    val = payload.get("asof")
    if not val and isinstance(payload.get("cards"), list) and payload["cards"]:
        val = payload["cards"][0].get("asof")
    try:
        return date.fromisoformat(str(val)[:10]) if val else None
    except ValueError:
        return None


def _frame_asof(df: pl.DataFrame) -> str | None:
    if df is None or df.is_empty() or "date" not in df.columns:
        return None
    val = df["date"].max()
    return val.isoformat() if val else None


class Pipeline:
    def __init__(self, store: DuckDBStore | None = None) -> None:
        self.settings = get_settings()
        self.catalog = get_catalog()
        self.store = store or DuckDBStore(self.settings.duckdb_path)
        self.archive = ParquetArchive(self.settings.data_dir)
        self.manifest = ManifestWriter(self.store)
        self._sync_masters()

    # ------------------------------------------------------------------
    # Master/reference tables
    # ------------------------------------------------------------------

    def _sync_masters(self) -> None:
        assets = pl.DataFrame([
            {
                "series_id": a.series_id, "vendor_symbol": a.vendor_symbol,
                "display_name": a.display_name, "asset_class": a.asset_class,
                "sub_class": a.sub_class, "unit": a.unit, "currency": a.currency,
                "source": a.source, "frequency": a.frequency,
            }
            for a in self.catalog.assets
        ])
        macro = pl.DataFrame([
            {
                "series_id": m.series_id, "fred_id": m.fred_id, "display_name": m.display_name,
                "asset_class": m.asset_class, "category": m.category, "unit": m.unit,
                "fred_units": m.fred_units, "frequency": m.frequency, "tenor": m.tenor,
                "source": m.source,
            }
            for m in self.catalog.macro
        ])
        self.store.replace_table("asset_master", assets)
        self.store.replace_table("macro_series_master", macro)

    # ------------------------------------------------------------------
    # Source selection
    # ------------------------------------------------------------------

    def _macro_connector(self):
        return FredConnector(cache_ttl_hours=self.settings.macro_cache_ttl_h)

    # ------------------------------------------------------------------
    # Extraction
    # ------------------------------------------------------------------

    def ingest_macro(self, run_id: str, start: date | None = None) -> pl.DataFrame:
        conn = self._macro_connector()
        frames = []
        for m in self.catalog.macro:
            _t0 = time.perf_counter()
            res = conn.fetch_series(m.fred_id, start)
            res.latency_ms = int((time.perf_counter() - _t0) * 1000)
            self.manifest.record_result(run_id, res)
            if not res.rows.is_empty():
                frames.append(res.rows)
        if not frames:
            return pl.DataFrame()
        raw = pl.concat(frames, how="vertical_relaxed")
        self.archive.write(raw, "raw", "macro_observations", raw["source"][0], run_id)
        self._load_raw_macro(raw, run_id)
        return normalize_macro(raw, run_id, self.catalog)

    # ------------------------------------------------------------------
    # Raw loads
    # ------------------------------------------------------------------

    def _load_raw_macro(self, raw: pl.DataFrame, run_id: str) -> None:
        df = raw.with_columns(
            pl.lit(run_id).alias("ingestion_run_id"), pl.lit(_now()).alias("ingested_at")
        )
        if "realtime_start" not in df.columns:
            df = df.with_columns(pl.lit(None, dtype=pl.Date).alias("realtime_start"))
        else:
            df = df.with_columns(pl.col("realtime_start").fill_null(date(1900, 1, 1)))
        if "realtime_end" not in df.columns:
            df = df.with_columns(pl.lit(None, dtype=pl.Date).alias("realtime_end"))
        self.store.upsert(
            "raw_macro_observations", df, ["series_id", "date", "source", "realtime_start"]
        )

    # ------------------------------------------------------------------
    # Full run
    # ------------------------------------------------------------------

    def run(self, start: date | None = None, run_id: str | None = None) -> dict:
        run_id = run_id or f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        macro_norm = self.ingest_macro(run_id, start)
        normalized = macro_norm

        if not normalized.is_empty():
            self.archive.write(normalized, "silver", "normalized", "ALL", run_id)
            self.store.upsert(
                "normalized_time_series", normalized, ["series_id", "date", "source"]
            )

        qc = QualityChecker(
            abnormal_move_pct=self.settings.abnormal_move_pct,
            stale_days_daily=self.settings.stale_days_daily,
            stale_days_monthly=self.settings.stale_days_monthly,
        )
        expected = [m.series_id for m in self.catalog.macro]
        qc.run_all(normalized, expected_series=expected)
        qframe = qc.to_frame(run_id)
        if not qframe.is_empty():
            self.store.append("data_quality_results", qframe)

        self.build_analytics(run_id, normalized)

        return {
            "run_id": run_id,
            "normalized_rows": normalized.height,
            "macro_rows": macro_norm.height,
            "quality": qc.summary(),
        }

    # ------------------------------------------------------------------
    # Gold analytics rebuild
    # ------------------------------------------------------------------

    def build_analytics(self, run_id: str, normalized: pl.DataFrame | None = None) -> None:
        df = normalized if normalized is not None and not normalized.is_empty() else self.store.normalized()
        if df.is_empty():
            return
        prices = df.filter(pl.col("asset_class").is_in(
            ["EQUITY", "BOND", "COMMODITY", "CREDIT", "VOLATILITY", "CURRENCY"]
        ))
        macro = df.filter(pl.col("asset_class").str.starts_with("MACRO"))

        # market snapshot
        snap = analytics.market_snapshot(prices)
        self.store.replace_table("analytics_market_snapshot", _cards_to_frame(snap, run_id))

        # cross-asset
        ca = analytics.cross_asset_dashboard(prices)
        ca_rows = []
        for bucket, items in ca.items():
            if bucket == "asof":
                continue
            for it in items:
                ca_rows.append({"bucket": bucket, **it})
        self.store.replace_table("analytics_cross_asset_returns", _cards_to_frame(ca_rows, run_id))

        # drawdowns
        dd = analytics.drawdown_table(prices)
        self.store.replace_table("analytics_drawdowns", _cards_to_frame(dd, run_id))

        # rates
        rates = analytics.rates_dashboard(macro)
        self.store.replace_table("analytics_rate_dashboard", _cards_to_frame(rates.get("changes", []), run_id))

        # inflation
        infl = analytics.inflation_dashboard(macro)
        self.store.replace_table("analytics_inflation_dashboard", _cards_to_frame(infl, run_id))

        # serving table — full JSON payloads the UI can read straight from the DB
        self.materialize_api_views(run_id, prices=prices, macro=macro)

    # ------------------------------------------------------------------
    # Serving views (read directly by the terminal — DB or file)
    # ------------------------------------------------------------------

    def build_api_views(
        self,
        prices: pl.DataFrame,
        macro: pl.DataFrame,
        return_basis: str = "total",
    ) -> dict[str, dict]:
        """Build terminal view payloads for one return basis."""
        ca = analytics.cross_asset_dashboard(prices)
        basis_note = "total" if return_basis != "price" else "price"
        asof = _frame_asof(prices)
        views = _json_clean({
            "market": {"return_basis": basis_note, "cards": analytics.market_snapshot(prices)},
            "cross-asset": {"return_basis": basis_note, **ca},
            "rates": analytics.rates_dashboard(macro),
            "inflation": {"cards": analytics.inflation_dashboard(macro)},
            "regime": {"return_basis": basis_note, **analytics.regime_dashboard(prices, macro)},
            "bilello": {
                "return_basis": basis_note,
                "asof": asof,
                "best_worst_ytd": analytics.best_worst_ytd(prices),
                "asset_class_returns_by_year": analytics.asset_class_returns_by_year(prices),
                "asset_monthly_returns": analytics.asset_monthly_returns(prices),
                "asset_daily_prices": analytics.asset_daily_prices(prices),
                "current_drawdowns": analytics.current_drawdowns(prices),
                "rate_moves_ranked": analytics.rate_moves_ranked(macro),
                "inflation_vs_policy_gap": analytics.inflation_vs_policy_gap(macro),
                "unemployment_vs_longrun": analytics.unemployment_vs_longrun(macro),
            },
            "index-returns": build_index_returns_view(prices, return_basis=basis_note, asof=asof),
            "eda": analytics.eda_dashboard(prices, macro),
        })
        return views

    def materialize_api_views(
        self,
        run_id: str,
        prices: pl.DataFrame | None = None,
        macro: pl.DataFrame | None = None,
    ) -> dict[str, dict]:
        """Compute and upsert all terminal views into ``analytics_api_views``.

        The terminal can then read a single table (``SELECT payload_json FROM
        analytics_api_views WHERE view = ?``) from the DuckDB/Postgres file
        instead of calling the FastAPI service.
        """
        if prices is None or macro is None:
            df = self.store.normalized()
            prices = df.filter(pl.col("asset_class").is_in(
                ["EQUITY", "BOND", "COMMODITY", "CREDIT", "VOLATILITY", "CURRENCY"]))
            macro = df.filter(pl.col("asset_class").str.starts_with("MACRO"))
        views = self.build_api_views(prices, macro, return_basis="total")
        now = _now()
        rows = []
        for view, payload in views.items():
            asof = _extract_asof(payload)
            rows.append({
                "view": view,
                "payload_json": json.dumps(payload, default=str),
                "as_of": asof,
                "ingestion_run_id": run_id,
                "updated_at": now,
            })
        frame = pl.DataFrame(rows, schema_overrides={"as_of": pl.Date})
        self.store.upsert("analytics_api_views", frame, ["view"])
        return views

    def export_api_views(self, out_dir, run_id: str = "export") -> list:
        """Write the 6 view payloads as JSON files (for the file-cache path).

        Filenames match the terminal's committed snapshot so MARKET_DATA_DIR can
        point straight at the output dir.
        """
        from pathlib import Path

        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        df = self.store.normalized()
        prices = df.filter(pl.col("asset_class").is_in(
            ["EQUITY", "BOND", "COMMODITY", "CREDIT", "VOLATILITY", "CURRENCY"]))
        macro = df.filter(pl.col("asset_class").str.starts_with("MACRO"))
        views = self.build_api_views(prices, macro, return_basis="total")
        name_map = {
            "market": "market_snapshot", "cross-asset": "cross_asset", "rates": "rates",
            "inflation": "inflation", "regime": "regime", "bilello": "bilello",
            "index-returns": "index_returns",
            "eda": "eda",
        }
        written = []
        for view, payload in views.items():
            path = out / f"{name_map[view]}.json"
            path.write_text(json.dumps(payload, default=str))
            written.append(path)
        return written


def _cards_to_frame(cards: list[dict], run_id: str) -> pl.DataFrame:
    """Convert analytics card dicts → a frame for analytics tables.

    Renames the JSON ``asof`` key to the DB column ``as_of`` and stamps run id.
    """
    if not cards:
        return pl.DataFrame()
    rows = []
    for c in cards:
        r = dict(c)
        if "asof" in r:
            r["as_of"] = r.pop("asof")
        r["ingestion_run_id"] = run_id
        rows.append(r)
    return pl.DataFrame(rows, infer_schema_length=None)


INDEX_RETURN_SERIES = [
    {"symbol": "SPX", "series_id": "SPY", "proxy": "SPY", "name": "S&P 500", "base": 5975, "drift": 0.75, "vol": 4.2},
    {"symbol": "NDX", "series_id": "QQQ", "proxy": "QQQ", "name": "Nasdaq 100", "base": 21450, "drift": 0.95, "vol": 6.0},
    {"symbol": "RUT", "series_id": "IWM", "proxy": "IWM", "name": "Russell 2000", "base": 2380, "drift": 0.62, "vol": 5.8},
    {"symbol": "INDU", "series_id": "DIA", "proxy": "DIA", "name": "Dow Jones Industrial Average", "base": 43400, "drift": 0.58, "vol": 3.8},
    {"symbol": "EAFE", "series_id": "EFA", "proxy": "EFA", "name": "MSCI EAFE Proxy", "base": 2450, "drift": 0.46, "vol": 4.6},
    {"symbol": "EM", "series_id": "EEM", "proxy": "EEM", "name": "MSCI Emerging Markets Proxy", "base": 1080, "drift": 0.52, "vol": 6.4},
]

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _monthly_returns_for_series(prices: pl.DataFrame, series_id: str) -> dict[int, list[float | None]]:
    sub = prices.filter(pl.col("series_id") == series_id).select(["date", "value"]).drop_nulls().sort("date")
    out: dict[int, list[float | None]] = {}
    if sub.height == 0:
        return out
    rows = sub.to_dicts()
    by_month_end: dict[tuple[int, int], float] = {}
    for row in rows:
        d = row["date"]
        by_month_end[(d.year, d.month)] = float(row["value"])
    for year in sorted({d["date"].year for d in rows}):
        out[year] = []
        for month in range(1, 13):
            cur = by_month_end.get((year, month))
            prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
            base = by_month_end.get((prev_year, prev_month))
            if cur is None or base is None or base == 0:
                out[year].append(None)
            else:
                out[year].append(round((cur / base - 1.0) * 100, 2))
    return out


def _compound_pct(values: list[float | None]) -> float | None:
    valid = [v for v in values if v is not None]
    if not valid:
        return None
    ret = 1.0
    for v in valid:
        ret *= 1 + v / 100.0
    return round((ret - 1.0) * 100, 2)


def _max_drawdown_pct(values: list[float | None]) -> float | None:
    valid = [v for v in values if v is not None]
    if not valid:
        return None
    level = 100.0
    peak = 100.0
    worst = 0.0
    for v in valid:
        level *= 1 + v / 100.0
        peak = max(peak, level)
        worst = min(worst, level / peak - 1.0)
    return round(worst * 100, 2)


def build_index_returns_view(prices: pl.DataFrame, return_basis: str = "total", asof: str | None = None) -> dict:
    indices = [{k: v for k, v in item.items() if k != "series_id"} for item in INDEX_RETURN_SERIES]
    matrices = {}
    for item in INDEX_RETURN_SERIES:
        monthly = _monthly_returns_for_series(prices, item["series_id"])
        if not monthly:
            continue
        latest_year = max(monthly)
        full_years = [y for y in sorted(monthly) if y < latest_year][-10:]
        years = full_years if full_years else [y for y in sorted(monthly) if y <= latest_year]
        columns = [*years, latest_year] if latest_year not in years else years
        rows = []
        for i, month in enumerate(MONTHS):
            values = {str(year): monthly.get(year, [None] * 12)[i] for year in columns}
            avg_vals = [monthly[year][i] for year in years if monthly.get(year, [None] * 12)[i] is not None]
            month_avg = round(sum(avg_vals) / len(avg_vals), 2) if avg_vals else None
            rows.append({"month": month, "values": values, "monthAverage": month_avg})
        annual = {str(year): _compound_pct(monthly.get(year, [])) for year in columns}
        full_annuals = [annual[str(year)] for year in years if annual.get(str(year)) is not None]
        avg_annual = round(sum(full_annuals) / len(full_annuals), 2) if full_annuals else 0
        summaries = [
            {
                "year": year,
                "annualReturn": annual[str(year)],
                "maxDrawdown": _max_drawdown_pct(monthly.get(year, [])),
                "isYtd": year == latest_year,
            }
            for year in columns
        ]
        matrices[item["symbol"]] = {
            "index": {k: v for k, v in item.items() if k != "series_id"},
            "years": years,
            "ytdYear": latest_year,
            "rows": rows,
            "annualReturns": annual,
            "averageAnnualReturn": avg_annual,
            "summaries": summaries,
        }
    return {"return_basis": return_basis, "asof": asof, "indices": indices, "matrices": matrices}
