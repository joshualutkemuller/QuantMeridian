"""Analysis orchestrator — receives request, runs analytics, returns result."""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Optional

from market_lens_studio.config.schemas import (
    AnalysisRequest,
    AnalysisResult,
    ChartType,
    ForwardWindow,
    TilePayload,
)
from market_lens_studio.data.lineage import LineageTracker
from market_lens_studio.data.adapters.proxy_resolver import ProxyResolver
from market_lens_studio.narratives.generator import generate_narrative

logger = logging.getLogger("market_lens_studio.orchestrator")


class Orchestrator:
    """Runs a Market Lens analysis end-to-end."""

    def __init__(self):
        self._lineage = LineageTracker()

    def run(self, request: AnalysisRequest) -> AnalysisResult:
        """Execute an analysis request and return tiles + narrative."""
        view_id = request.view_id
        windows = request.parsed_windows()
        window_days = [w.trading_days for w in windows]
        window_labels = [w.label for w in windows]

        proxy = ProxyResolver(
            allow_proxies=request.proxy_policy.allow_etf_proxies,
            require_labeling=request.proxy_policy.require_labeling,
        )

        # Resolve series and fetch data
        series_data = self._fetch_data(request, proxy)

        tiles: list[TilePayload] = []
        warnings: list[str] = []
        proxy_notes: list[str] = []
        sample_size = 0
        statistics = {}
        baselines = {}
        event_name = ""

        try:
            if view_id == "ath_forward_returns":
                tiles, stats_info = self._run_ath(series_data, window_days, window_labels, request)
                event_name = "All-Time Highs"
                sample_size = stats_info.get("sample_size", 0)
                statistics = stats_info.get("statistics", {})
                baselines = stats_info.get("baselines", {})

            elif view_id == "drawdown_analysis":
                tiles, stats_info = self._run_drawdown(series_data, request)
                event_name = "Drawdown Analysis"
                sample_size = stats_info.get("sample_size", 0)

            elif view_id in ("vix_spike_study", "largest_vix_increases", "largest_vix_decreases"):
                tiles, stats_info = self._run_vix_study(series_data, window_days, window_labels, request)
                event_name = stats_info.get("event_name", "VIX Event Study")
                sample_size = stats_info.get("sample_size", 0)
                statistics = stats_info.get("statistics", {})
                baselines = stats_info.get("baselines", {})

            elif view_id == "monthly_seasonality":
                tiles, stats_info = self._run_seasonality(series_data, request)
                event_name = "Monthly Seasonality"
                sample_size = stats_info.get("sample_size", 0)

            elif view_id == "rolling_returns":
                tiles, stats_info = self._run_rolling(series_data, window_days, window_labels, request)
                event_name = "Rolling Returns"
                sample_size = stats_info.get("sample_size", 0)
                statistics = stats_info.get("statistics", {})

            elif view_id == "cross_asset_correlation":
                tiles, stats_info = self._run_correlation(series_data, request)
                event_name = "Cross-Asset Correlation"
                sample_size = stats_info.get("sample_size", 0)

            elif view_id == "asset_class_returns":
                tiles, stats_info = self._run_asset_returns(series_data, window_days, window_labels, request)
                event_name = "Asset Class Returns"
                sample_size = stats_info.get("sample_size", 0)

            elif view_id == "credit_spread_stress":
                tiles, stats_info = self._run_credit(series_data, request)
                event_name = "Credit Spread Stress"
                sample_size = stats_info.get("sample_size", 0)

            elif view_id == "purchasing_power":
                tiles, stats_info = self._run_purchasing_power(series_data, request)
                event_name = "Purchasing Power"
                sample_size = stats_info.get("sample_size", 0)

            elif view_id == "yield_curve_analysis":
                tiles, stats_info = self._run_rates(series_data, request)
                event_name = "Yield Curve"
                sample_size = stats_info.get("sample_size", 0)

            elif view_id == "volatility_regime":
                tiles, stats_info = self._run_vol_regime(series_data, window_days, window_labels, request)
                event_name = "Volatility Regime"
                sample_size = stats_info.get("sample_size", 0)

            else:
                warnings.append(f"View '{view_id}' not yet implemented — returning empty result.")

        except Exception as e:
            logger.exception("Analysis failed for view %s", view_id)
            warnings.append(f"Analysis error: {e}")

        # Collect proxy notes from lineage
        for rec in self._lineage.get_records():
            if rec.is_proxy and rec.proxy_note:
                proxy_notes.append(rec.proxy_note)
        warnings.extend(self._lineage.get_warnings())

        results_dict = {
            "event_name": event_name,
            "sample_size": sample_size,
            "forward_stats": statistics,
            "baseline_stats": baselines,
        }
        series_info = {
            "series_id": request.series[0].series_id if request.series else "Market",
            "display_name": request.series[0].display_name if request.series else "Market",
        }
        narrative = generate_narrative(
            view_id=view_id,
            results_dict=results_dict,
            series_info=series_info,
            proxy_warnings=proxy_notes,
        )

        return AnalysisResult(
            view_id=view_id,
            tiles=tiles,
            series_used=[s.series_id for s in request.series],
            warnings=warnings,
            narrative=narrative,
            metadata={
                "lineage": self._lineage.summary(),
                "proxy_notes": proxy_notes,
            },
            run_timestamp=datetime.utcnow(),
            as_of_date=request.end_date,
            sample_size=sample_size,
        )

    def _fetch_data(self, request: AnalysisRequest, proxy: ProxyResolver) -> dict[str, tuple[list, list]]:
        """Fetch and resolve data for all requested series.

        Returns {series_id: (dates, values)}.
        """
        from market_lens_studio.data.adapters.fred_adapter import FredAdapter

        fred = FredAdapter()
        result = {}

        for sc in request.series:
            ticker, proxy_note = proxy.resolve(sc.series_id)
            if proxy_note:
                self._lineage.record(
                    series_id=sc.series_id,
                    source=sc.source,
                    ticker=ticker,
                    dates=[],
                    is_proxy=True,
                    proxy_note=proxy_note,
                )

            try:
                dates, values = fred.fetch_series(ticker, request.start_date, request.end_date)

                if dates and values:
                    self._lineage.record(
                        series_id=sc.series_id,
                        source=sc.source,
                        ticker=ticker,
                        dates=dates,
                    )
                    result[sc.series_id] = (dates, values)
                else:
                    result[sc.series_id] = ([], [])
            except Exception as e:
                logger.warning("Failed to fetch %s: %s", sc.series_id, e)
                result[sc.series_id] = ([], [])

        return result

    def _primary_series(self, series_data: dict) -> tuple[str, list, list]:
        """Get the first series with data."""
        for sid, (dates, vals) in series_data.items():
            if dates and vals:
                return sid, dates, vals
        return "", [], []

    def _run_ath(self, series_data, window_days, window_labels, request):
        from market_lens_studio.analytics.all_time_highs import ath_forward_returns
        sid, dates, values = self._primary_series(series_data)
        if not dates:
            return [], {"sample_size": 0}

        cooldown = request.event_rule.cooldown_days if request.event_rule else 5
        result = ath_forward_returns(dates, values, window_days, window_labels, cooldown)

        tiles = [
            TilePayload(tile_id="event_table", chart_type=ChartType.TABLE, title=f"All-Time Highs — {sid}", payload={
                "events": [{"date": str(d), "index": i} for d, i in zip(result.event_dates, range(len(result.event_dates)))],
                "total_events": result.event_count,
            }),
            TilePayload(tile_id="forward_return_box", chart_type=ChartType.BOXPLOT, title=f"Forward Returns After ATH — {sid}", payload={
                "windows": {label: [r for r in rets if r is not None] for label, rets in result.forward_returns.items()},
                "statistics": result.statistics,
            }),
            TilePayload(tile_id="baseline_comparison", chart_type=ChartType.BAR, title=f"ATH vs Baseline — {sid}", payload={
                "event_stats": result.statistics,
                "baseline_stats": result.baselines,
            }),
        ]

        return tiles, {
            "sample_size": result.event_count,
            "statistics": result.statistics,
            "baselines": result.baselines,
        }

    def _run_drawdown(self, series_data, request):
        from market_lens_studio.analytics.drawdowns import detect_drawdowns, drawdown_series
        sid, dates, values = self._primary_series(series_data)
        if not dates:
            return [], {"sample_size": 0}

        threshold = request.options.get("threshold", -0.10)
        events = detect_drawdowns(dates, values, threshold)
        dd_series = drawdown_series(values)

        tiles = [
            TilePayload(tile_id="drawdown_table", chart_type=ChartType.TABLE, title=f"Drawdowns > {threshold*100:.0f}% — {sid}", payload={
                "events": [{"peak_date": str(e.peak_date), "trough_date": str(e.trough_date), "drawdown_pct": round(e.drawdown_pct * 100, 2), "recovery_days": e.recovery_days} for e in events],
            }),
            TilePayload(tile_id="drawdown_chart", chart_type=ChartType.LINE, title=f"Drawdown Chart — {sid}", payload={
                "dates": [str(d) for d in dates],
                "drawdowns": [round(v * 100, 2) if v is not None else None for v in dd_series],
            }),
        ]

        return tiles, {"sample_size": len(events)}

    def _run_vix_study(self, series_data, window_days, window_labels, request):
        view_id = request.view_id
        sid, dates, values = self._primary_series(series_data)

        if view_id == "vix_spike_study":
            from market_lens_studio.analytics.volatility import vix_spike_study
            vix_data = series_data.get("^VIX", ([], []))
            if not vix_data[0]:
                vix_data = (dates, values)
            threshold = request.options.get("vix_threshold", 30)
            cooldown = request.options.get("cooldown_days", 10)
            result = vix_spike_study(dates, vix_data[1], values, threshold, window_days, window_labels, cooldown)
        else:
            from market_lens_studio.analytics.vix_event_studies import vix_event_forward_returns
            vix_data = series_data.get("^VIX", ([], []))
            direction = "increase" if view_id == "largest_vix_increases" else "decrease"
            top_n = request.options.get("top_n", 20)
            change_window = request.options.get("change_window_days", 5)
            cooldown = request.options.get("cooldown_days", 10)
            events, result = vix_event_forward_returns(
                dates, vix_data[1] if vix_data[0] else values, values,
                change_window, top_n, direction, window_days, window_labels, cooldown,
            )

        tiles = [
            TilePayload(tile_id="event_table", chart_type=ChartType.TABLE, title=f"{result.event_name}", payload={
                "events": [{"date": str(d)} for d in result.event_dates],
                "total_events": result.event_count,
            }),
            TilePayload(tile_id="forward_return_box", chart_type=ChartType.BOXPLOT, title=f"Forward Returns — {result.event_name}", payload={
                "windows": {label: [r for r in rets if r is not None] for label, rets in result.forward_returns.items()},
                "statistics": result.statistics,
            }),
        ]

        return tiles, {
            "event_name": result.event_name,
            "sample_size": result.event_count,
            "statistics": result.statistics,
            "baselines": result.baselines,
        }

    def _run_seasonality(self, series_data, request):
        from market_lens_studio.analytics.myth_buster import monthly_seasonality, sell_in_may, day_of_week_effect
        sid, dates, values = self._primary_series(series_data)
        if not dates:
            return [], {"sample_size": 0}

        monthly = monthly_seasonality(dates, values)
        sim = sell_in_may(dates, values)
        dow = day_of_week_effect(dates, values)

        month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

        tiles = [
            TilePayload(tile_id="seasonality_heatmap", chart_type=ChartType.HEATMAP, title=f"Monthly Seasonality — {sid}", payload={
                "months": {month_names[m-1]: stats for m, stats in monthly.items()},
            }),
            TilePayload(tile_id="sell_in_may", chart_type=ChartType.BAR, title="Sell in May?", payload=sim),
            TilePayload(tile_id="day_of_week", chart_type=ChartType.BAR, title="Day of Week Effect", payload=dow),
        ]

        return tiles, {"sample_size": len(dates)}

    def _run_rolling(self, series_data, window_days, window_labels, request):
        from market_lens_studio.analytics.returns import compute_rolling_returns, unconditional_baseline
        sid, dates, values = self._primary_series(series_data)
        if not dates:
            return [], {"sample_size": 0}

        stats = {}
        tiles_data = {}
        for wd, label in zip(window_days, window_labels):
            rolls = compute_rolling_returns(values, wd)
            baseline = unconditional_baseline(values, wd)
            clean = [r for r in rolls if r is not None]
            stats[label] = baseline
            tiles_data[label] = {"returns": [round(r * 100, 2) if r is not None else None for r in rolls[-252:]], "baseline": baseline}

        tiles = [
            TilePayload(tile_id="histogram", chart_type=ChartType.BAR, title=f"Rolling Return Distribution — {sid}", payload=tiles_data),
            TilePayload(tile_id="statistics_table", chart_type=ChartType.TABLE, title=f"Rolling Return Statistics — {sid}", payload={"statistics": stats}),
        ]

        return tiles, {"sample_size": len(values), "statistics": stats}

    def _run_correlation(self, series_data, request):
        from market_lens_studio.analytics.cross_asset import rolling_correlation

        sids = list(series_data.keys())
        if len(sids) < 2:
            return [], {"sample_size": 0}

        # Compute pairwise correlations
        corr_matrix = {}
        for i, s1 in enumerate(sids):
            for s2 in sids[i+1:]:
                d1, v1 = series_data[s1]
                d2, v2 = series_data[s2]
                n = min(len(v1), len(v2))
                if n > 63:
                    corrs = rolling_correlation(v1[:n], v2[:n], 63)
                    latest = corrs[-1] if corrs else None
                    corr_matrix[f"{s1}/{s2}"] = {"latest": latest, "series_length": len(corrs)}

        tiles = [
            TilePayload(tile_id="correlation_matrix", chart_type=ChartType.HEATMAP, title="Correlation Matrix", payload={"correlations": corr_matrix}),
        ]

        return tiles, {"sample_size": sum(len(v[1]) for v in series_data.values())}

    def _run_asset_returns(self, series_data, window_days, window_labels, request):
        from market_lens_studio.analytics.returns import compute_rolling_returns

        returns_table = {}
        for sid, (dates, values) in series_data.items():
            if not values:
                continue
            sid_rets = {}
            for wd, label in zip(window_days, window_labels):
                if len(values) > wd:
                    ret = values[-1] / values[-1 - wd] - 1.0 if values[-1 - wd] != 0 else None
                    sid_rets[label] = round(ret * 100, 2) if ret is not None else None
                else:
                    sid_rets[label] = None
            returns_table[sid] = sid_rets

        tiles = [
            TilePayload(tile_id="return_table", chart_type=ChartType.TABLE, title="Asset Class Returns", payload={"returns": returns_table, "windows": window_labels}),
            TilePayload(tile_id="bar_chart", chart_type=ChartType.BAR, title="Return Comparison", payload={"returns": returns_table}),
        ]

        return tiles, {"sample_size": len(returns_table)}

    def _run_credit(self, series_data, request):
        from market_lens_studio.analytics.credit import spread_percentile, spread_zscore, credit_stress_indicator

        results = {}
        for sid, (dates, values) in series_data.items():
            if not values:
                continue
            current = values[-1]
            pct = spread_percentile(current, values)
            z = spread_zscore(current, values)
            results[sid] = {"current": current, "percentile": pct, "zscore": z}

        hy_vals = series_data.get("BAMLH0A0HYM2", ([], []))[1]
        ig_vals = series_data.get("BAMLC0A0CM", ([], []))[1]
        stress = credit_stress_indicator(
            hy_vals[-1] if hy_vals else None,
            ig_vals[-1] if ig_vals else None,
            hy_vals, ig_vals,
        )

        tiles = [
            TilePayload(tile_id="spread_gauge", chart_type=ChartType.GAUGE, title="Credit Stress Indicator", payload={"stress": stress, "series": results}),
            TilePayload(tile_id="spread_history", chart_type=ChartType.LINE, title="Spread History", payload={
                sid: {"dates": [str(d) for d in dates[-252:]], "values": values[-252:]}
                for sid, (dates, values) in series_data.items() if values
            }),
        ]

        return tiles, {"sample_size": sum(len(v[1]) for v in series_data.values())}

    def _run_purchasing_power(self, series_data, request):
        from market_lens_studio.analytics.inflation import purchasing_power, real_returns, inflation_adjusted_series

        asset_sid, asset_dates, asset_vals = self._primary_series(series_data)
        cpi_data = series_data.get("CPIAUCSL", ([], []))

        if cpi_data[1]:
            pp = purchasing_power(cpi_data[1], 100.0)
            tiles = [
                TilePayload(tile_id="purchasing_power_chart", chart_type=ChartType.LINE, title="Purchasing Power of $100", payload={
                    "dates": [str(d) for d in cpi_data[0][-120:]],
                    "values": [round(v, 2) if v is not None else None for v in pp[-120:]],
                }),
            ]
        else:
            tiles = []

        return tiles, {"sample_size": len(asset_vals)}

    def _run_rates(self, series_data, request):
        from market_lens_studio.analytics.rates import detect_inversions, curve_slope

        tiles = []
        short = series_data.get("DGS2", ([], []))
        long = series_data.get("DGS10", ([], []))

        if short[1] and long[1]:
            n = min(len(short[1]), len(long[1]))
            slope_current = curve_slope(short[1][-1] if short[1] else None, long[1][-1] if long[1] else None)
            inversions = detect_inversions(short[0][:n], short[1][:n], long[1][:n])

            tiles.append(TilePayload(tile_id="slope_history", chart_type=ChartType.LINE, title="2s10s Slope", payload={
                "current_slope_bps": slope_current,
                "inversion_count": len(inversions),
            }))

        return tiles, {"sample_size": sum(len(v[1]) for v in series_data.values())}

    def _run_vol_regime(self, series_data, window_days, window_labels, request):
        from market_lens_studio.analytics.volatility import panic_regime_detection, rolling_volatility

        vix_data = series_data.get("^VIX", ([], []))
        sid, dates, values = self._primary_series(series_data)

        if vix_data[1]:
            regimes = panic_regime_detection(vix_data[1])
            current_regime = regimes[-1] if regimes else "UNKNOWN"
        else:
            current_regime = "UNKNOWN"
            regimes = []

        rvol = rolling_volatility(values) if values else []

        tiles = [
            TilePayload(tile_id="regime_chart", chart_type=ChartType.LINE, title="Volatility Regime", payload={
                "current_regime": current_regime,
                "regime_counts": {r: regimes.count(r) for r in set(regimes)} if regimes else {},
            }),
            TilePayload(tile_id="rolling_vol", chart_type=ChartType.LINE, title=f"Rolling Volatility — {sid}", payload={
                "values": [round(v * 100, 1) if v is not None else None for v in rvol[-252:]] if rvol else [],
            }),
        ]

        return tiles, {"sample_size": len(values)}
