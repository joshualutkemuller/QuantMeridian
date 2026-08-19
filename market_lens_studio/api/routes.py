"""API routes for Market Lens Studio."""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import APIRouter, HTTPException, Query

from market_lens_studio.analytics.all_time_highs import run_ath_analysis
from market_lens_studio.analytics.credit import run_credit_analysis
from market_lens_studio.analytics.cross_asset import run_cross_asset_dashboard
from market_lens_studio.analytics.drawdowns import (
    compute_drawdown_series,
    current_drawdown_rank,
    drawdown_recovery_table,
    identify_drawdown_events,
)
from market_lens_studio.analytics.inflation import run_inflation_analysis
from market_lens_studio.analytics.myth_buster import BUILT_IN_MYTHS, run_myth_test
from market_lens_studio.analytics.rates import run_rate_analysis
from market_lens_studio.analytics.returns import (
    compute_rolling_returns,
    unconditional_baseline,
)
from market_lens_studio.analytics.vix_event_studies import (
    VixChangePeriod,
    run_vix_decrease_study,
    run_vix_increase_study,
)
from market_lens_studio.analytics.volatility import run_panic_study
from market_lens_studio.config.schemas import (
    AnalysisRequest,
    AnalysisResult,
    ChartType,
    EventRule,
    ForwardWindow,
    PresetConfig,
    SeriesConfig,
    TilePayload,
    ViewConfig,
)
from market_lens_studio.data.adapters.fred_adapter import FredAdapter
from market_lens_studio.data.adapters.proxy_resolver import ProxyResolver
from market_lens_studio.data.lineage import LineageTracker
from market_lens_studio.data.series_catalog import (
    SERIES_CATALOG,
    get_entry,
    get_fred_id,
    get_yahoo_ticker,
    list_all,
)
from market_lens_studio.narratives.generator import generate_narrative

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Helpers ──────────────────────────────────────────────────────────────

_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"

_view_cache: Optional[dict[str, ViewConfig]] = None
_preset_store: dict[str, list[PresetConfig]] = {}  # user_id -> presets


def _load_views() -> dict[str, ViewConfig]:
    """Load view registry from YAML."""
    global _view_cache
    if _view_cache is not None:
        return _view_cache

    path = _CONFIG_DIR / "view_registry.yaml"
    if not path.exists():
        logger.warning("View registry not found at %s", path)
        return {}

    with open(path) as f:
        data = yaml.safe_load(f) or {}

    views: dict[str, ViewConfig] = {}
    for v in data.get("views", []):
        try:
            vc = ViewConfig(**v)
            views[vc.view_id] = vc
        except Exception as exc:
            logger.warning("Failed to parse view %s: %s", v.get("view_id"), exc)

    _view_cache = views
    return views


def _load_default_presets() -> list[PresetConfig]:
    """Load default presets from YAML."""
    path = _CONFIG_DIR / "default_presets.yaml"
    if not path.exists():
        return []

    with open(path) as f:
        data = yaml.safe_load(f) or {}

    presets: list[PresetConfig] = []
    for p in data.get("presets", []):
        try:
            p_copy = dict(p)
            req_data = p_copy.pop("request", {})
            req = AnalysisRequest(**req_data)
            presets.append(PresetConfig(request=req, **p_copy))
        except Exception as exc:
            logger.warning("Failed to parse preset %s: %s", p.get("preset_id"), exc)

    return presets


def _fetch_series(
    series_id: str,
    source: str,
    ticker: str,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> tuple[list[date], list[float]]:
    """Fetch a data series using the appropriate adapter."""
    adapter = FredAdapter()
    fid = get_fred_id(series_id) or ticker
    return adapter.fetch_series(fid, start_date, end_date, series_id)


def _clean_dict(d: Any) -> Any:
    """Recursively clean a dict/list, replacing NaN/Inf with None."""
    if isinstance(d, dict):
        return {k: _clean_dict(v) for k, v in d.items()}
    elif isinstance(d, list):
        return [_clean_dict(v) for v in d]
    elif isinstance(d, float):
        if d != d or abs(d) == float("inf"):
            return None
        return d
    return d


# ── Routes ───────────────────────────────────────────────────────────────


@router.get("/views")
async def list_views():
    """List all available analysis views."""
    views = _load_views()
    return {
        "views": [
            {
                "view_id": v.view_id,
                "display_name": v.display_name,
                "category": v.category,
                "description": v.description,
            }
            for v in views.values()
        ],
        "count": len(views),
    }


@router.get("/views/{view_id}/schema")
async def get_view_schema(view_id: str):
    """Get the configuration schema for a specific view."""
    views = _load_views()
    view = views.get(view_id)
    if view is None:
        raise HTTPException(status_code=404, detail=f"View '{view_id}' not found")
    return view.model_dump()


@router.get("/series")
async def list_series(
    asset_class: Optional[str] = Query(None, description="Filter by asset class"),
):
    """List all available data series."""
    entries = list_all()
    if asset_class:
        entries = [e for e in entries if e.asset_class == asset_class]
    return {
        "series": [
            {
                "series_id": e.series_id,
                "ticker": e.ticker,
                "display_name": e.display_name,
                "asset_class": e.asset_class,
                "is_proxy": e.is_proxy,
                "preferred_source": e.preferred_source,
            }
            for e in entries
        ],
        "count": len(entries),
    }


@router.get("/series/{series_id}/metadata")
async def get_series_metadata(series_id: str):
    """Get detailed metadata for a specific series."""
    entry = get_entry(series_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Series '{series_id}' not found")
    return {
        "series_id": entry.series_id,
        "ticker": entry.ticker,
        "yahoo_ticker": entry.yahoo_ticker,
        "fred_id": entry.fred_id,
        "display_name": entry.display_name,
        "asset_class": entry.asset_class,
        "is_proxy": entry.is_proxy,
        "proxy_for": entry.proxy_for,
        "proxy_note": entry.proxy_note,
        "preferred_source": entry.preferred_source,
        "fallback_source": entry.fallback_source,
    }


@router.get("/proxies")
async def list_proxies():
    """List all ETF proxy mappings."""
    resolver = ProxyResolver()
    proxies = resolver.get_all_proxies()
    return {
        "proxies": [
            {
                "index_name": name,
                "proxy_ticker": m.proxy_ticker,
                "proxy_display_name": m.proxy_display_name,
                "inception_date": m.inception_date,
                "note": m.proxy_note,
            }
            for name, m in proxies.items()
        ],
        "count": len(proxies),
    }


@router.post("/run")
async def run_analysis(request: AnalysisRequest):
    """Run a Market Lens analysis.

    This is the main endpoint that orchestrates data fetching, analytics,
    and narrative generation based on the requested view and configuration.
    """
    views = _load_views()
    view = views.get(request.view_id)
    if view is None:
        raise HTTPException(status_code=404, detail=f"View '{request.view_id}' not found")

    # Parse forward windows
    try:
        windows = request.parsed_windows()
        window_days = [w.trading_days for w in windows]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Resolve and fetch series
    lineage = LineageTracker()
    proxy_resolver = ProxyResolver(
        allow_proxies=request.proxy_policy.allow_etf_proxies,
        require_labeling=request.proxy_policy.require_labeling,
    )

    # Determine which series to use
    series_configs = list(request.series)
    if not series_configs and view.default_series:
        for sid in view.default_series:
            entry = get_entry(sid)
            if entry:
                series_configs.append(SeriesConfig(
                    series_id=entry.series_id,
                    ticker=entry.ticker,
                    source=entry.preferred_source,
                    display_name=entry.display_name,
                    asset_class=entry.asset_class,
                    is_proxy=entry.is_proxy,
                    proxy_for=entry.proxy_for,
                ))

    # Fetch all series data
    series_data: dict[str, tuple[list[date], list[float]]] = {}
    series_meta: dict[str, dict] = {}
    warnings: list[str] = []

    for sc in series_configs:
        try:
            dates, values = _fetch_series(
                sc.series_id, sc.source, sc.ticker,
                request.start_date, request.end_date,
            )
            series_data[sc.series_id] = (dates, values)
            series_meta[sc.series_id] = {
                "series_id": sc.series_id,
                "display_name": sc.display_name,
                "is_proxy": sc.is_proxy,
                "proxy_for": sc.proxy_for,
                "data_points": len(dates),
                "asset_class": sc.asset_class,
            }
            lineage.record(
                series_id=sc.series_id,
                source=sc.source,
                ticker=sc.ticker,
                dates=dates,
                is_proxy=sc.is_proxy,
                proxy_for=sc.proxy_for,
                proxy_note=sc.proxy_note,
            )
            if not dates:
                warnings.append(f"No data retrieved for {sc.series_id}")
        except Exception as exc:
            logger.error("Failed to fetch %s: %s", sc.series_id, exc)
            warnings.append(f"Failed to fetch {sc.series_id}: {str(exc)}")

    warnings.extend(lineage.get_warnings())

    # Run analytics based on view
    tiles: list[TilePayload] = []
    results_dict: dict = {}

    try:
        results_dict, tiles = _dispatch_analytics(
            request.view_id, series_data, series_meta, window_days,
            request.event_rule, request.options,
        )
    except Exception as exc:
        logger.error("Analytics failed for %s: %s", request.view_id, exc, exc_info=True)
        warnings.append(f"Analytics error: {str(exc)}")

    # Generate narrative
    primary_series_info: dict = {}
    if series_meta:
        first_key = next(iter(series_meta))
        primary_series_info = series_meta[first_key]

    narrative = ""
    try:
        narrative = generate_narrative(
            view_id=request.view_id,
            results_dict=results_dict,
            series_info=primary_series_info,
            proxy_warnings=[w for w in warnings if "proxy" in w.lower()],
        )
    except Exception as exc:
        logger.error("Narrative generation failed: %s", exc)
        narrative = f"Narrative generation failed: {str(exc)}"

    # Determine as-of date
    all_end_dates: list[date] = []
    for dates, _ in series_data.values():
        if dates:
            all_end_dates.append(dates[-1])
    as_of = max(all_end_dates) if all_end_dates else None

    result = AnalysisResult(
        view_id=request.view_id,
        tiles=tiles,
        series_used=[sc.series_id for sc in series_configs],
        warnings=warnings,
        narrative=narrative,
        metadata=_clean_dict({
            "lineage": lineage.summary(),
            "results": results_dict,
        }),
        as_of_date=as_of,
        sample_size=results_dict.get("sample_size", 0),
    )

    return _clean_dict(result.model_dump())


# ── Analytics Dispatch ───────────────────────────────────────────────────


def _dispatch_analytics(
    view_id: str,
    series_data: dict[str, tuple[list[date], list[float]]],
    series_meta: dict[str, dict],
    forward_windows: list[int],
    event_rule: Optional[EventRule],
    options: dict,
) -> tuple[dict, list[TilePayload]]:
    """Dispatch to the appropriate analytics based on view_id."""
    tiles: list[TilePayload] = []

    def _get_series(sid: str) -> tuple[list[date], list[float]]:
        return series_data.get(sid, ([], []))

    def _first_series() -> tuple[str, list[date], list[float]]:
        for sid, (d, v) in series_data.items():
            if d:
                return sid, d, v
        return "", [], []

    def _get_equity_series() -> tuple[str, list[date], list[float]]:
        for sid, meta in series_meta.items():
            ac = meta.get("asset_class", "")
            if ac == "EQUITY" or sid in ("SPY", "QQQ", "IWM", "DIA"):
                d, v = series_data.get(sid, ([], []))
                if d:
                    return sid, d, v
        return _first_series()

    def _get_vol_series() -> tuple[str, list[date], list[float]]:
        for sid, meta in series_meta.items():
            ac = meta.get("asset_class", "")
            if ac == "VOLATILITY" or "VIX" in sid.upper():
                d, v = series_data.get(sid, ([], []))
                if d:
                    return sid, d, v
        return "", [], []

    results: dict = {}

    # ── ATH Analysis ─────────────────────────────────────────────────
    if view_id == "all_time_high_analyzer":
        sid, dates, values = _get_equity_series()
        cooldown = event_rule.cooldown_days if event_rule else 5
        results = run_ath_analysis(dates, values, forward_windows, cooldown)

        tiles = [
            TilePayload(
                tile_id="ath_count_by_year", chart_type=ChartType.BAR,
                title="All-Time Highs by Year",
                payload={"data": results.get("count_by_year", {})},
            ),
            TilePayload(
                tile_id="ath_forward_returns_table", chart_type=ChartType.TABLE,
                title="Forward Returns After ATH",
                payload=results.get("forward_return_comparison", {}),
            ),
            TilePayload(
                tile_id="ath_vs_non_ath_boxplot", chart_type=ChartType.BOXPLOT,
                title="ATH vs Non-ATH Forward Returns",
                payload=results.get("event_study", {}),
            ),
            TilePayload(
                tile_id="ath_narrative", chart_type=ChartType.TEXT,
                title="Analysis Summary", payload={"text": "See narrative"},
            ),
        ]

    # ── Drawdown Analysis ────────────────────────────────────────────
    elif view_id == "drawdown_recovery_analyzer":
        sid, dates, values = _get_equity_series()
        threshold = event_rule.threshold if event_rule and event_rule.threshold else -0.10

        dd_series = compute_drawdown_series(dates, values)
        dd_events = identify_drawdown_events(dates, values, threshold)
        recovery = drawdown_recovery_table(dates, values)
        dd_rank = current_drawdown_rank(dates, values)

        results = {
            "drawdown_series": {
                "dates": [d.isoformat() for d in dd_series["date"].to_list()],
                "drawdowns": dd_series["drawdown"].to_list(),
            },
            "events": [
                {
                    "start_date": e.start_date.isoformat(),
                    "trough_date": e.trough_date.isoformat(),
                    "recovery_date": e.recovery_date.isoformat() if e.recovery_date else None,
                    "drawdown_pct": e.drawdown_pct,
                    "recovery_days": e.recovery_days,
                    "is_recovered": e.is_recovered,
                }
                for e in dd_events
            ],
            "recovery_table": recovery.to_dicts(),
            "current_drawdown": dd_rank,
            "sample_size": len(dd_events),
        }

        tiles = [
            TilePayload(
                tile_id="drawdown_series_chart", chart_type=ChartType.LINE,
                title="Drawdown Series", payload=results["drawdown_series"],
            ),
            TilePayload(
                tile_id="drawdown_events_table", chart_type=ChartType.TABLE,
                title="Major Drawdown Events", payload={"events": results["events"]},
            ),
            TilePayload(
                tile_id="recovery_table", chart_type=ChartType.TABLE,
                title="Calendar Year Returns vs Max Drawdown",
                payload={"data": results["recovery_table"]},
            ),
            TilePayload(
                tile_id="current_drawdown_gauge", chart_type=ChartType.GAUGE,
                title="Current Drawdown", payload=dd_rank,
            ),
        ]

    # ── Panic/Volatility Spike ───────────────────────────────────────
    elif view_id == "panic_volatility_spike":
        _, vix_dates, vix_values = _get_vol_series()
        eq_sid, eq_dates, eq_values = _get_equity_series()

        pct = event_rule.percentile if event_rule and event_rule.percentile else 95.0
        cooldown = event_rule.cooldown_days if event_rule else 10

        results = run_panic_study(
            vix_dates, vix_values, eq_dates, eq_values,
            forward_windows, pct, cooldown,
        )

        tiles = [
            TilePayload(
                tile_id="panic_events_table", chart_type=ChartType.TABLE,
                title="Panic Events",
                payload={"events": results.get("panic_events", [])},
            ),
            TilePayload(
                tile_id="panic_forward_returns", chart_type=ChartType.TABLE,
                title="Forward Returns After Panic",
                payload={
                    "forward_stats": results.get("forward_stats", {}),
                    "baseline_stats": results.get("baseline_stats", {}),
                },
            ),
            TilePayload(
                tile_id="panic_distribution_boxplot", chart_type=ChartType.BOXPLOT,
                title="Forward Return Distribution",
                payload=results.get("distribution", {}),
            ),
            TilePayload(
                tile_id="panic_narrative", chart_type=ChartType.TEXT,
                title="Analysis Summary", payload={"text": "See narrative"},
            ),
        ]

    # ── VIX Largest Increases ────────────────────────────────────────
    elif view_id == "vix_largest_increases_forward_returns":
        _, vix_dates, vix_values = _get_vol_series()
        eq_sid, eq_dates, eq_values = _get_equity_series()

        period_str = event_rule.change_window if event_rule and event_rule.change_window else "1W"
        try:
            period = VixChangePeriod(period_str)
        except ValueError:
            period = VixChangePeriod.ONE_WEEK

        top_n = event_rule.largest_event_count if event_rule else 20
        cooldown = event_rule.cooldown_days if event_rule else 10

        results = run_vix_increase_study(
            vix_dates, vix_values, eq_dates, eq_values,
            period, top_n, forward_windows, cooldown,
        )

        tiles = [
            TilePayload(
                tile_id="vix_increase_events_table", chart_type=ChartType.TABLE,
                title=f"Top {top_n} Largest VIX Increases ({period_str})",
                payload={"events": results.get("event_table", [])},
            ),
            TilePayload(
                tile_id="vix_increase_forward_stats", chart_type=ChartType.TABLE,
                title="Forward Return Statistics",
                payload={
                    "forward_stats": results.get("forward_stats", {}),
                    "baseline_stats": results.get("baseline_stats", {}),
                },
            ),
            TilePayload(
                tile_id="vix_increase_boxplot", chart_type=ChartType.BOXPLOT,
                title="Forward Return Distribution",
                payload=results.get("distribution", {}),
            ),
            TilePayload(
                tile_id="vix_increase_narrative", chart_type=ChartType.TEXT,
                title="Analysis Summary", payload={"text": "See narrative"},
            ),
        ]

    # ── VIX Largest Decreases ────────────────────────────────────────
    elif view_id == "vix_largest_decreases_forward_returns":
        _, vix_dates, vix_values = _get_vol_series()
        eq_sid, eq_dates, eq_values = _get_equity_series()

        period_str = event_rule.change_window if event_rule and event_rule.change_window else "1M"
        try:
            period = VixChangePeriod(period_str)
        except ValueError:
            period = VixChangePeriod.ONE_MONTH

        top_n = event_rule.largest_event_count if event_rule else 20
        cooldown = event_rule.cooldown_days if event_rule else 21

        results = run_vix_decrease_study(
            vix_dates, vix_values, eq_dates, eq_values,
            period, top_n, forward_windows, cooldown,
        )

        tiles = [
            TilePayload(
                tile_id="vix_decrease_events_table", chart_type=ChartType.TABLE,
                title=f"Top {top_n} Largest VIX Decreases ({period_str})",
                payload={"events": results.get("event_table", [])},
            ),
            TilePayload(
                tile_id="vix_decrease_forward_stats", chart_type=ChartType.TABLE,
                title="Forward Return Statistics",
                payload={
                    "forward_stats": results.get("forward_stats", {}),
                    "baseline_stats": results.get("baseline_stats", {}),
                },
            ),
            TilePayload(
                tile_id="vix_decrease_boxplot", chart_type=ChartType.BOXPLOT,
                title="Forward Return Distribution",
                payload=results.get("distribution", {}),
            ),
            TilePayload(
                tile_id="vix_decrease_narrative", chart_type=ChartType.TEXT,
                title="Analysis Summary", payload={"text": "See narrative"},
            ),
        ]

    # ── Inflation / Purchasing Power ─────────────────────────────────
    elif view_id == "inflation_purchasing_power":
        eq_sid, eq_dates, eq_values = _get_equity_series()
        cpi_dates, cpi_values = _get_series("CPIAUCSL")

        results = run_inflation_analysis(
            eq_dates, eq_values, cpi_dates, cpi_values,
            asset_name=series_meta.get(eq_sid, {}).get("display_name", eq_sid),
        )

        tiles = [
            TilePayload(
                tile_id="inflation_trend", chart_type=ChartType.LINE,
                title="Cumulative Inflation",
                payload=results.get("inflation_series", {}),
            ),
            TilePayload(
                tile_id="purchasing_power", chart_type=ChartType.LINE,
                title="Purchasing Power Erosion",
                payload=results.get("purchasing_power", {}),
            ),
            TilePayload(
                tile_id="real_vs_nominal", chart_type=ChartType.LINE,
                title="Real vs Nominal Returns",
                payload=results.get("real_returns", {}),
            ),
            TilePayload(
                tile_id="inflation_summary", chart_type=ChartType.TEXT,
                title="Summary", payload=results.get("summary", {}),
            ),
        ]

    # ── Fed Rates / Yield Curve ──────────────────────────────────────
    elif view_id in ("fed_rates_yield_curve", "rate_cut_hike_event_study"):
        fed_dates, fed_values = _get_series("FEDFUNDS")
        long_dates, long_values = _get_series("DGS10")
        short_dates, short_values = _get_series("DGS2")
        eq_sid, eq_dates, eq_values = _get_equity_series()

        threshold = event_rule.threshold if event_rule and event_rule.threshold else -0.25
        cooldown = event_rule.cooldown_days if event_rule else 30

        results = run_rate_analysis(
            fed_dates, fed_values, long_dates, long_values,
            short_dates, short_values, eq_dates, eq_values,
            forward_windows, threshold, cooldown,
        )

        tiles = [
            TilePayload(
                tile_id="yield_spread_chart", chart_type=ChartType.LINE,
                title="10Y-2Y Yield Spread",
                payload=results.get("spread_series", {}),
            ),
            TilePayload(
                tile_id="inversions_table", chart_type=ChartType.TABLE,
                title="Yield Curve Inversions",
                payload={"inversions": results.get("inversions", [])},
            ),
            TilePayload(
                tile_id="rate_events_table", chart_type=ChartType.TABLE,
                title="Rate Change Events",
                payload=results.get("rate_event_study", {}),
            ),
            TilePayload(
                tile_id="current_rates", chart_type=ChartType.GAUGE,
                title="Current Rate Environment",
                payload=results.get("current_state", {}),
            ),
        ]

    # ── Credit Spread Stress ─────────────────────────────────────────
    elif view_id == "credit_spread_stress":
        spread_dates, spread_values = _get_series("BAMLH0A0HYM2")
        if not spread_dates:
            spread_dates, spread_values = _get_series("HY_OAS")
        eq_sid, eq_dates, eq_values = _get_equity_series()

        credit_dates: Optional[list[date]] = None
        credit_values: Optional[list[float]] = None
        for sid in ("HYG", "JNK", "LQD"):
            if sid in series_data:
                cd, cv = series_data[sid]
                if cd:
                    credit_dates = cd
                    credit_values = cv
                    break

        pct = event_rule.percentile if event_rule and event_rule.percentile else 90.0
        cooldown = event_rule.cooldown_days if event_rule else 20

        results = run_credit_analysis(
            spread_dates, spread_values, eq_dates, eq_values,
            credit_dates, credit_values,
            forward_windows, pct, cooldown,
        )

        tiles = [
            TilePayload(
                tile_id="spread_chart", chart_type=ChartType.LINE,
                title="Credit Spread History",
                payload=results.get("spread_series", {}),
            ),
            TilePayload(
                tile_id="stress_events", chart_type=ChartType.TABLE,
                title="Spread Widening Events",
                payload=results.get("stress_events", {}),
            ),
            TilePayload(
                tile_id="equity_forward_returns", chart_type=ChartType.TABLE,
                title="Equity Forward Returns After Stress",
                payload=results.get("equity_forward_returns", {}),
            ),
            TilePayload(
                tile_id="current_credit", chart_type=ChartType.GAUGE,
                title="Current Credit Conditions",
                payload=results.get("current_state", {}),
            ),
        ]

    # ── Cross-Asset Leaderboard ──────────────────────────────────────
    elif view_id in ("cross_asset_leaderboard", "etf_proxy_market_monitor", "leadership_rotation"):
        display_names = {
            sid: meta.get("display_name", sid)
            for sid, meta in series_meta.items()
        }
        results = run_cross_asset_dashboard(series_data, display_names)

        tiles = [
            TilePayload(
                tile_id="leaderboard_table", chart_type=ChartType.TABLE,
                title="Cross-Asset Leaderboard",
                payload={"leaderboard": results.get("leaderboard", [])},
            ),
            TilePayload(
                tile_id="best_worst", chart_type=ChartType.BAR,
                title="Best & Worst Performers",
                payload=results.get("best_worst_by_window", {}),
            ),
            TilePayload(
                tile_id="summary", chart_type=ChartType.TEXT,
                title="Summary", payload=results.get("summary", {}),
            ),
        ]

    # ── Market Myth Buster ───────────────────────────────────────────
    elif view_id == "market_myth_buster_studio":
        eq_sid, eq_dates, eq_values = _get_equity_series()
        myth_id = options.get("myth_id")

        myth = None
        if myth_id:
            myth = next((m for m in BUILT_IN_MYTHS if m.myth_id == myth_id), None)
        if myth is None and BUILT_IN_MYTHS:
            myth = BUILT_IN_MYTHS[0]

        if myth:
            trigger_dates = None
            trigger_values = None
            if myth.trigger_series_id and myth.trigger_series_id in series_data:
                trigger_dates, trigger_values = series_data[myth.trigger_series_id]

            myth_result = run_myth_test(
                myth, eq_dates, eq_values, trigger_dates, trigger_values,
            )
            results = {
                "myth_id": myth_result.myth_id,
                "claim": myth_result.claim,
                "verdict": myth_result.verdict,
                "confidence": myth_result.confidence,
                "summary": myth_result.summary,
                "sample_size": myth_result.sample_size,
                "forward_stats": myth_result.forward_stats,
                "baseline_stats": myth_result.baseline_stats,
                "details": myth_result.details,
            }

            tiles = [
                TilePayload(
                    tile_id="myth_verdict", chart_type=ChartType.GAUGE,
                    title=f"Myth: {myth.claim[:60]}",
                    payload={"verdict": myth_result.verdict, "confidence": myth_result.confidence},
                ),
                TilePayload(
                    tile_id="myth_stats", chart_type=ChartType.TABLE,
                    title="Forward Return Comparison",
                    payload={
                        "forward_stats": myth_result.forward_stats,
                        "baseline_stats": myth_result.baseline_stats,
                    },
                ),
                TilePayload(
                    tile_id="myth_narrative", chart_type=ChartType.TEXT,
                    title="Analysis", payload={"text": myth_result.summary},
                ),
            ]

    # ── Strength Begets Strength ─────────────────────────────────────
    elif view_id == "strength_begets_strength":
        eq_sid, eq_dates, eq_values = _get_equity_series()
        roll_values = compute_rolling_returns(eq_values, 252)
        roll_dates = eq_dates[252: 252 + len(roll_values)]
        results = {
            "rolling_returns": {
                "dates": [d.isoformat() for d in roll_dates],
                "values": roll_values,
            },
            "sample_size": len(roll_values),
        }

        tiles = [
            TilePayload(
                tile_id="rolling_return_chart", chart_type=ChartType.LINE,
                title="Rolling 1-Year Returns",
                payload=results["rolling_returns"],
            ),
        ]

    # ── Generic fallback ─────────────────────────────────────────────
    else:
        eq_sid, eq_dates, eq_values = _get_equity_series()
        if eq_dates:
            baseline = {str(w): unconditional_baseline(eq_values, w) for w in forward_windows}
            results = {
                "baseline": baseline,
                "sample_size": len(eq_dates),
            }
            tiles = [
                TilePayload(
                    tile_id="baseline_stats", chart_type=ChartType.TABLE,
                    title="Unconditional Baseline Returns",
                    payload=results["baseline"],
                ),
            ]

    return results, tiles


# ── Preset Management ────────────────────────────────────────────────────


@router.post("/presets")
async def save_preset(preset: PresetConfig):
    """Save a user preset."""
    if not preset.preset_id:
        preset.preset_id = str(uuid.uuid4())[:8]

    user_presets = _preset_store.setdefault(preset.user_id, [])
    # Replace if exists
    user_presets = [p for p in user_presets if p.preset_id != preset.preset_id]
    user_presets.append(preset)
    _preset_store[preset.user_id] = user_presets

    return {"preset_id": preset.preset_id, "status": "saved"}


@router.get("/presets/{user_id}")
async def get_user_presets(user_id: str):
    """Get all presets for a user."""
    user_presets = _preset_store.get(user_id, [])
    defaults = _load_default_presets()
    all_presets = defaults + user_presets
    return {
        "presets": [p.model_dump() for p in all_presets],
        "count": len(all_presets),
    }


@router.delete("/presets/{preset_id}")
async def delete_preset(preset_id: str, user_id: str = Query(default="default")):
    """Delete a user preset."""
    user_presets = _preset_store.get(user_id, [])
    original_count = len(user_presets)
    user_presets = [p for p in user_presets if p.preset_id != preset_id]
    _preset_store[user_id] = user_presets

    if len(user_presets) == original_count:
        raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")

    return {"status": "deleted", "preset_id": preset_id}
