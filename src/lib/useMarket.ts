
import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import {
  type BilelloView,
  type CrossAsset,
  type EdaView,
  type IndexReturnsView,
  type MarketView,
  type RatesView,
  type RegimeView,
  type ReturnBasis,
} from "@/data/marketPipeline";

export type MarketSource = "LIVE" | "DB" | "FILE" | "LOADING";

/**
 * Resilient market_data_pipeline hook. Renders an empty, shape-safe payload by
 * default, then upgrades to whatever `/api/market/[view]` resolves:
 * a local DuckDB/Postgres cache (DB), an exported-file cache (FILE), the live
 * FastAPI service (LIVE). `source` drives the provenance badge.
 */
function emptyMarketView(view: MarketView, basis: ReturnBasis): unknown {
  if (view === "market") return { return_basis: basis, cards: [] };
  if (view === "cross-asset") {
    return {
      return_basis: basis,
      equities: [],
      bonds: [],
      commodities: [],
      credit: [],
      volatility: [],
      currencies: [],
      asof: null,
    } satisfies Partial<CrossAsset> & { return_basis: ReturnBasis };
  }
  if (view === "rates") {
    return {
      asof: null,
      curve: [],
      spreads: { two_s_ten_s_bps: null, three_m_ten_y_bps: null },
      changes: [],
    } satisfies Partial<RatesView>;
  }
  if (view === "inflation") return { cards: [] };
  if (view === "regime") {
    const unavailable = { score: 0, label: "No data" };
    return {
      asof: null,
      risk_on_off: unavailable,
      inflation_pressure: unavailable,
      growth_momentum: unavailable,
      liquidity: unavailable,
      composite: unavailable,
      narrative: "",
    } satisfies Partial<RegimeView>;
  }
  if (view === "bilello") {
    return {
      return_basis: basis,
      asof: null,
      best_worst_ytd: { best: [], worst: [] },
      asset_class_returns_by_year: [],
      asset_monthly_returns: [],
      asset_daily_prices: [],
      current_drawdowns: [],
      rate_moves_ranked: [],
      inflation_vs_policy_gap: {},
      unemployment_vs_longrun: {},
    } satisfies BilelloView;
  }
  if (view === "index-returns") {
    return { return_basis: basis, asof: null, indices: [], matrices: {} } satisfies IndexReturnsView;
  }
  return {
    asof: undefined,
    cross_correlation: [],
    lagged_ols: [],
    granger_causality: [],
    pearson_heatmap: { labels: [], display_names: [], matrix: [] },
    cusum: [],
    pelt: [],
  } satisfies EdaView;
}

function mapMarketSource(source: unknown): MarketSource {
  if (source === "LIVE" || source === "DB" || source === "FILE") return source;
  return "LOADING";
}

export function useMarketView<T>(view: MarketView, basis: ReturnBasis = "total", asof?: string): { data: T; source: MarketSource; earliestAsOf: string | null } {
  const [data, setData] = useState<T>(emptyMarketView(view, basis) as T);
  const [source, setSource] = useState<MarketSource>("LOADING");
  const [earliestAsOf, setEarliestAsOf] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ basis });
    if (asof) params.set("asof", asof);
    const url = `/api/market/${view}?${params.toString()}`;

    const apply = (json: any) => {
      const nextSource = mapMarketSource(json?.source);
      if (Object.prototype.hasOwnProperty.call(json ?? {}, "data") && json.data !== null) setData(json.data as T);
      else if (nextSource === "LOADING") setData(emptyMarketView(view, basis) as T);
      setSource(nextSource);
      if (json?.earliestAsOf) setEarliestAsOf(json.earliestAsOf);
    };

    // Render a shape-safe empty state immediately, upgrading to a cached/live
    // response synchronously when one is fresh.
    const seed = peekFresh<any>(url);
    if (seed) apply(seed);
    else {
      setData(emptyMarketView(view, basis) as T);
      setSource("LOADING");
    }

    fetchJson<any>(url)
      .then((json) => alive && apply(json))
      .catch(() => {
        if (!alive) return;
        setData(emptyMarketView(view, basis) as T);
        setSource("LOADING");
      });
    return () => {
      alive = false;
    };
  }, [view, basis, asof]);

  return { data, source, earliestAsOf };
}
