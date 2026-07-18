
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNews } from "@/lib/useNews";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { Sparkline } from "@/components/charts/Sparkline";
import { BarChart } from "@/components/charts/BarChart";
import { Treemap } from "@/components/charts/Treemap";
import { CandleChart } from "@/components/charts/CandleChart";
import { CorrelationMatrix } from "@/components/charts/Matrix";
import { MarketDataControls } from "@/components/market/MarketDataControls";
import {
  getQuotes,
  quotesByClass,
  getIndices,
  getHeatmap,
  getMovers,
  getCandles,
  getOrderBook,
  mergeLiveIndices,
  heatmapFromCards,
  moversFromCards,
  INDEX_FRED_IDS,
  HEAT_HORIZONS,
  horizonDateRange,
  isAnnualized,
  type Quote,
  type Mover,
  type IndexQuote,
  type PipelineCard,
  type HeatHorizon,
} from "@/data/markets";
import { isRealEconSource, useLiveSeriesSet } from "@/lib/useEcon";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { bySymbol, type AssetClass } from "@/data/universe";
import { useMarketView, type MarketSource } from "@/lib/useMarket";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import type { ReturnBasis, SnapshotCard } from "@/data/marketPipeline";
import { fmtNum, fmtInt, fmtAbbr, fmtSignedPct, pnlClass } from "@/lib/format";
import { StalenessBar } from "@/components/ui/StalenessBar";
import { marketChartHref } from "@/components/charting/ChartLink";
import Link from "@/components/Link";
import { CandlestickChart } from "lucide-react";

type TabKey = "EQUITY" | "ETF" | "FI" | "FUTURE" | "FX" | "COMMODITY" | "CRYPTO";

const TABS: { key: TabKey; label: string }[] = [
  { key: "EQUITY", label: "Equities" },
  { key: "ETF", label: "ETFs" },
  { key: "FI", label: "Fixed Income" },
  { key: "FUTURE", label: "Futures" },
  { key: "FX", label: "FX" },
  { key: "COMMODITY", label: "Commodities" },
  { key: "CRYPTO", label: "Crypto" },
];

const CHART_CHIPS = ["AAPL", "NVDA", "TSLA", "SPY", "GME", "MSFT", "AMZN"];

// Plausible realistic 7x7 cross-asset correlation matrix (symmetric, diag=1).
const CORR_LABELS = ["SPX", "NDX", "VIX", "UST", "GLD", "BTC", "USD"];
const CORR_VALUES: number[][] = [
  [1.0, 0.94, -0.82, -0.21, 0.18, 0.46, -0.38],
  [0.94, 1.0, -0.79, -0.16, 0.12, 0.52, -0.34],
  [-0.82, -0.79, 1.0, 0.27, 0.05, -0.41, 0.29],
  [-0.21, -0.16, 0.27, 1.0, 0.33, -0.12, -0.44],
  [0.18, 0.12, 0.05, 0.33, 1.0, 0.22, -0.51],
  [0.46, 0.52, -0.41, -0.12, 0.22, 1.0, -0.19],
  [-0.38, -0.34, 0.29, -0.44, -0.51, -0.19, 1.0],
];

function quotesForTab(tab: TabKey): Quote[] {
  if (tab === "FI") {
    return [...quotesByClass("GOVT"), ...quotesByClass("CORP")];
  }
  return quotesByClass(tab as AssetClass);
}

/** Map a security's asset class to the markets monitor tab that lists it. */
function tabForAssetClass(ac: AssetClass): TabKey {
  if (ac === "CORP" || ac === "GOVT") return "FI";
  return ac as TabKey;
}

export default function LiveMarkets() {
  const { headlines } = useNews(30);
  const marketHeadlines = useMemo(() => headlines.filter(h => h.assetClass === "EQUITY" || h.assetClass === "COMMODITY").sort((a, b) => b.importance - a.importance), [headlines]);
  const [tab, setTab] = useState<TabKey>("EQUITY");
  const [chartTicker, setChartTicker] = useState("AAPL");
  const [basis, setBasis] = useState<ReturnBasis>("total");
  const [asof, setAsOf] = useState("");
  const [heatHorizon, setHeatHorizon] = useState<HeatHorizon>("1D");

  // Deep-link from the command palette / watchlists: /markets?sym=NVDA focuses
  // the intraday chart on that security and switches to its asset-class tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sym = new URLSearchParams(window.location.search).get("sym")?.toUpperCase();
    if (!sym) return;
    const sec = bySymbol(sym);
    setChartTicker(sym);
    if (sec) setTab(tabForAssetClass(sec.assetClass));
  }, []);

  const { data: marketData, source, earliestAsOf } = useMarketView<{ cards: SnapshotCard[] }>("market", basis, asof);
  const pipelineQuotes = useMemo(() => cardsToQuotes(marketData?.cards ?? []), [marketData]);
  const dataAsOf = marketData?.cards?.[0]?.asof ?? null;
  const hasCards = !!marketData?.cards?.length;

  const { data: indexFred } = useLiveSeriesSet([...INDEX_FRED_IDS], "lin", 30);
  const anyFredLive = INDEX_FRED_IDS.some((id) => isRealEconSource(indexFred[id]?.source));

  const indices = useMemo(() => {
    let idx = mergeIndexQuotes(getIndices(), marketData?.cards ?? []);
    if (anyFredLive) idx = mergeLiveIndices(idx, indexFred);
    return idx;
  }, [marketData, indexFred, anyFredLive]);
  const heat = useMemo(() => hasCards ? heatmapFromCards(marketData!.cards as PipelineCard[], heatHorizon) : getHeatmap(), [hasCards, marketData, heatHorizon]);
  const heatRange = useMemo(() => horizonDateRange(heatHorizon, dataAsOf), [heatHorizon, dataAsOf]);
  const simMovers = useMemo(() => getMovers(), []);
  const movers = useMemo(() => {
    if (hasCards) { const m = moversFromCards(marketData!.cards as PipelineCard[]); return { ...simMovers, gainers: m.gainers, losers: m.losers }; }
    return simMovers;
  }, [hasCards, marketData, simMovers]);
  const allQuotes = useMemo(() => getQuotes(), []);

  const idx = (sym: string): IndexQuote | undefined => indices.find((i) => i.symbol === sym);
  const spx = idx("SPX");
  const ndx = idx("NDX");
  const vix = idx("VIX");
  const ust = idx("UST10Y");
  const dxy = idx("DXY");
  const btc = idx("BTC");
  const move = idx("MOVE");

  const rows = useMemo(() => {
    return quotesForTabFromPipeline(tab, pipelineQuotes, allQuotes);
  }, [pipelineQuotes, allQuotes, tab]);
  const candles = useMemo(() => getCandles(chartTicker, 60), [chartTicker]);
  const book = useMemo(() => getOrderBook(chartTicker), [chartTicker]);

  const maxBookSize = Math.max(
    1,
    ...book.bids.map((b) => b.bidSize),
    ...book.asks.map((a) => a.askSize)
  );

  const volBars = movers.volume.map((m) => ({ label: m.ticker, value: m.vol, color: "#FF8C00" }));

  const volIndices = indices.filter((i) => i.symbol === "VIX" || i.symbol === "MOVE");

  const cols: Column<Quote>[] = [
    {
      key: "ticker",
      header: "Ticker",
      width: "64px",
      render: (q) => <span className="font-semibold text-term-amber">{q.ticker}</span>,
      sortVal: (q) => q.ticker,
    },
    {
      key: "name",
      header: "Name",
      width: "150px",
      render: (q) => <span className="block max-w-[150px] truncate text-term-text-dim">{q.name}</span>,
      sortVal: (q) => q.name,
    },
    {
      key: "last",
      header: "Last",
      align: "right",
      render: (q) => <span className={`tnum ${pnlClass(q.chg)}`}>{fmtNum(q.last, q.last > 1000 ? 2 : 2)}</span>,
      sortVal: (q) => q.last,
    },
    {
      key: "chg",
      header: "Chg",
      align: "right",
      render: (q) => <span className={`tnum ${pnlClass(q.chg)}`}>{q.chg >= 0 ? "+" : ""}{fmtNum(q.chg, 2)}</span>,
      sortVal: (q) => q.chg,
    },
    {
      key: "chgPct",
      header: "Chg%",
      align: "right",
      render: (q) => <span className={`tnum ${pnlClass(q.chgPct)}`}>{fmtSignedPct(q.chgPct)}</span>,
      sortVal: (q) => q.chgPct,
    },
    {
      key: "bid",
      header: "Bid",
      align: "right",
      render: (q) => <span className="tnum text-term-text-dim">{fmtNum(q.bid, 2)}</span>,
      sortVal: (q) => q.bid,
    },
    {
      key: "ask",
      header: "Ask",
      align: "right",
      render: (q) => <span className="tnum text-term-text-dim">{fmtNum(q.ask, 2)}</span>,
      sortVal: (q) => q.ask,
    },
    {
      key: "vol",
      header: "Vol",
      align: "right",
      render: (q) => <span className="tnum text-term-text">{fmtAbbr(q.vol)}</span>,
      sortVal: (q) => q.vol,
    },
    {
      key: "vwap",
      header: "VWAP",
      align: "right",
      render: (q) => <span className="tnum text-term-text-mute">{fmtNum(q.vwap, 2)}</span>,
      sortVal: (q) => q.vwap,
    },
    {
      key: "spark",
      header: "Trend",
      align: "right",
      width: "90px",
      render: (q) => (
        <span className="inline-flex justify-end">
          <Sparkline data={q.spark} width={80} height={20} />
        </span>
      ),
    },
  ];

  const moverRow = (m: Mover, tone: "up" | "down" | "neutral"): ReactNode => (
    <div key={m.ticker} className="flex items-center justify-between px-2 py-1 text-2xs hover:bg-term-panel-2">
      <span className="font-semibold text-term-text">{m.ticker}</span>
      <span className="flex items-center gap-3">
        <span className="tnum text-term-text-mute">{fmtNum(m.last, 2)}</span>
        {tone === "neutral" ? (
          <span className="tnum w-14 text-right text-term-text-dim">{fmtAbbr(m.vol)}</span>
        ) : (
          <span className={`tnum w-14 text-right ${pnlClass(m.chgPct)}`}>{fmtSignedPct(m.chgPct)}</span>
        )}
      </span>
    </div>
  );

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="MKT"
        title="Live Markets"
        desc="Real-time multi-asset monitor"
        asOf={asof || dataAsOf}
        right={<span className="flex items-center gap-2"><MarketDataControls basis={basis} onBasisChange={setBasis} asof={asof} onAsOfChange={setAsOf} latestAsOf={dataAsOf} earliestAsOf={earliestAsOf} /><PipelineTag source={source} asOf={dataAsOf} /></span>}
      />

      <StalenessBar asOf={asof || dataAsOf} />

      <KpiStrip>
        <Stat label="S&P 500" value={fmtNum(spx?.last ?? 0, 1)} sub={<span className={pnlClass(spx?.chgPct ?? 0)}>{fmtSignedPct(spx?.chgPct ?? 0)}</span>} tone={(spx?.chgPct ?? 0) >= 0 ? "up" : "down"} />
        <Stat label="Nasdaq 100" value={fmtNum(ndx?.last ?? 0, 1)} sub={<span className={pnlClass(ndx?.chgPct ?? 0)}>{fmtSignedPct(ndx?.chgPct ?? 0)}</span>} tone={(ndx?.chgPct ?? 0) >= 0 ? "up" : "down"} />
        <Stat label="CBOE VIX" value={fmtNum(vix?.last ?? 0, 2)} sub={<span className={pnlClass(vix?.chgPct ?? 0)}>{fmtSignedPct(vix?.chgPct ?? 0)}</span>} tone={(vix?.chgPct ?? 0) >= 0 ? "down" : "up"} />
        <Stat label="US 10Y Yield" value={`${fmtNum(ust?.last ?? 0, 2)}%`} sub={<span className={pnlClass(ust?.chgPct ?? 0)}>{fmtSignedPct(ust?.chgPct ?? 0)}</span>} tone="amber" />
        <Stat label="Dollar Index" value={fmtNum(dxy?.last ?? 0, 2)} sub={<span className={pnlClass(dxy?.chgPct ?? 0)}>{fmtSignedPct(dxy?.chgPct ?? 0)}</span>} tone={(dxy?.chgPct ?? 0) >= 0 ? "up" : "down"} />
        <Stat label="Bitcoin" value={fmtNum(btc?.last ?? 0, 0)} sub={<span className={pnlClass(btc?.chgPct ?? 0)}>{fmtSignedPct(btc?.chgPct ?? 0)}</span>} tone={(btc?.chgPct ?? 0) >= 0 ? "up" : "down"} />
      </KpiStrip>

      <div className="grid grid-cols-12 gap-2 p-2">
        {/* Main quote board with asset-class tabs */}
        <div className="col-span-12 xl:col-span-8">
          <Panel
            title="Live Quote Board"
            code="WEI"
            accent
            right={<span className="tnum text-3xs text-term-text-mute">{source} · {rows.length} instruments · {basis === "total" ? "adjusted close" : "raw close"} · {asof || dataAsOf || "latest"}</span>}
          >
            <div className="flex flex-wrap gap-px border-b border-term-border bg-term-border">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide transition-colors ${
                    tab === t.key ? "bg-term-panel text-term-amber" : "bg-term-panel-2 text-term-text-mute hover:text-term-text"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <DataGrid
              columns={cols}
              rows={rows}
              rowKey={(q) => q.ticker}
              maxHeight="360px"
              zebra
              initialSort={{ key: "chgPct", dir: "desc" }}
              onRowClick={(q) => allQuotes.some((a) => a.ticker === q.ticker) && setChartTicker(q.ticker)}
              selectedKey={chartTicker}
            />
          </Panel>
        </div>

        {/* Heat map */}
        <div className="col-span-12 xl:col-span-4">
          <Panel title="Equity Heat Map" code="HEAT" toolbar={
            <div className="flex w-full items-center justify-between gap-2">
              <TermToggleGroup value={heatHorizon} onChange={setHeatHorizon} options={HEAT_HORIZONS} size="sm" />
              <span className="shrink-0 text-3xs text-term-text-mute">
                {heatRange && <span className="font-mono">{heatRange}</span>}
                {isAnnualized(heatHorizon) && <span className="ml-1 text-term-amber">ANNUALIZED</span>}
              </span>
            </div>
          }>
            <div className="p-1">
              <Treemap cells={heat.map((h) => ({ label: h.ticker, weight: h.weight, value: h.chgPct, group: h.sector }))} height={360} maxAbs={isAnnualized(heatHorizon) ? 30 : heatHorizon === "YTD" || heatHorizon === "1Y" ? 20 : 4} />
            </div>
          </Panel>
        </div>

        {/* Intraday candle chart */}
        <div className="col-span-12 xl:col-span-8">
          <Panel
            title={`Intraday — ${chartTicker}`}
            code="GIP"
            right={
              <span className="flex items-center gap-3">
                <Link href={marketChartHref(chartTicker, "EQUITY")} className="inline-flex items-center gap-1 text-3xs text-term-amber hover:text-term-text transition-colors">
                  <CandlestickChart className="h-3 w-3" /> Full Chart
                </Link>
                <span className="text-3xs text-term-amber">VWAP overlay (dashed)</span>
              </span>
            }
          >
            <div className="flex flex-wrap gap-px border-b border-term-border bg-term-border">
              {(CHART_CHIPS.includes(chartTicker) ? CHART_CHIPS : [chartTicker, ...CHART_CHIPS]).map((c) => (
                <button
                  key={c}
                  onClick={() => setChartTicker(c)}
                  className={`px-2.5 py-1 text-2xs font-semibold transition-colors ${
                    chartTicker === c ? "bg-term-panel text-term-amber" : "bg-term-panel-2 text-term-text-mute hover:text-term-text"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="p-1">
              <CandleChart candles={candles} height={260} vwap />
            </div>
          </Panel>
        </div>

        {/* Order flow / depth ladder */}
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <Panel title={`Order Flow — ${chartTicker}`} code="DEPTH" scroll bodyClassName="max-h-[300px]">
            <div className="grid grid-cols-2 gap-px bg-term-border text-2xs">
              <div className="bg-term-panel-2 px-2 py-1 text-center font-semibold uppercase tracking-wide text-term-up">Bids</div>
              <div className="bg-term-panel-2 px-2 py-1 text-center font-semibold uppercase tracking-wide text-term-down">Asks</div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-term-border">
              <div>
                {book.bids.map((b, i) => (
                  <div key={`b${i}`} className="relative flex items-center justify-between bg-term-panel px-2 py-[2px]">
                    <div className="absolute inset-y-0 right-0 bg-term-up/15" style={{ width: `${(b.bidSize / maxBookSize) * 100}%` }} />
                    <span className="relative tnum text-term-up">{fmtNum(b.px, 2)}</span>
                    <span className="relative tnum text-term-text-dim">{fmtInt(b.bidSize)}</span>
                  </div>
                ))}
              </div>
              <div>
                {book.asks.map((a, i) => (
                  <div key={`a${i}`} className="relative flex items-center justify-between bg-term-panel px-2 py-[2px]">
                    <div className="absolute inset-y-0 left-0 bg-term-down/15" style={{ width: `${(a.askSize / maxBookSize) * 100}%` }} />
                    <span className="relative tnum text-term-text-dim">{fmtInt(a.askSize)}</span>
                    <span className="relative tnum text-term-down">{fmtNum(a.px, 2)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-term-border bg-term-panel-2 px-2 py-1 text-center">
              <span className="text-3xs uppercase tracking-wide text-term-text-mute">Last </span>
              <span className="tnum text-2xs font-semibold text-term-amber">{fmtNum(book.last, 2)}</span>
            </div>
          </Panel>
        </div>

        {/* Market movers */}
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <Panel title="Market Movers" code="MOST">
            <div className="grid grid-cols-1 divide-y divide-term-border">
              <div>
                <div className="bg-term-panel-2 px-2 py-1 text-3xs font-semibold uppercase tracking-wide text-term-up">Gainers</div>
                {movers.gainers.slice(0, 6).map((m) => moverRow(m, "up"))}
              </div>
              <div>
                <div className="bg-term-panel-2 px-2 py-1 text-3xs font-semibold uppercase tracking-wide text-term-down">Losers</div>
                {movers.losers.slice(0, 6).map((m) => moverRow(m, "down"))}
              </div>
              <div>
                <div className="bg-term-panel-2 px-2 py-1 text-3xs font-semibold uppercase tracking-wide text-term-amber">Most Active</div>
                {movers.volume.slice(0, 6).map((m) => moverRow(m, "neutral"))}
              </div>
            </div>
          </Panel>
        </div>

        {/* Correlation matrix */}
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <Panel title="Cross-Asset Correlation" code="CORR" right={<Tag tone="blue">30D</Tag>}>
            <div className="p-2">
              <CorrelationMatrix labels={CORR_LABELS} values={CORR_VALUES} height={280} />
            </div>
          </Panel>
        </div>

        {/* Volume / VWAP analysis */}
        <div className="col-span-12 md:col-span-6 xl:col-span-5">
          <Panel title="Volume Leaders" code="VWAP" right={<span className="text-3xs text-term-text-mute">shares traded</span>}>
            <div className="p-2">
              <BarChart data={volBars} height={220} fmt={(n) => fmtAbbr(n)} />
            </div>
          </Panel>
        </div>

        {/* Volatility indices */}
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <Panel title="Volatility Indices" code="VOLC">
            <div className="divide-y divide-term-border-soft">
              {volIndices.map((v) => (
                <div key={v.symbol} className="flex items-center justify-between px-2.5 py-2">
                  <div>
                    <div className="text-2xs font-semibold text-term-text-dim">{v.symbol}</div>
                    <div className="tnum text-xs text-term-text">{fmtNum(v.last, 2)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Sparkline data={v.spark} width={56} height={22} />
                    <span className={`tnum w-14 text-right text-2xs ${pnlClass(v.chgPct)}`}>{fmtSignedPct(v.chgPct)}</span>
                  </div>
                </div>
              ))}
              {move && (
                <div className="px-2.5 py-2 text-3xs text-term-text-mute">
                  Rates vol (MOVE) {fmtNum(move.last, 1)} · equity vol (VIX) elevated regime monitor.
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="col-span-12">
          <Panel title="Market Headlines" code="NEWS" right={<Link href="/news" className="text-3xs text-term-blue hover:underline">Full News →</Link>}>
            <div className="divide-y divide-term-border-soft">
              {marketHeadlines.slice(0, 6).map((h) => (
                <div key={h.id} className="flex items-center gap-2 px-2 py-1.5 text-2xs">
                  <span className="tnum w-10 shrink-0 text-term-text-mute">{h.time}</span>
                  <Tag tone={h.sentimentScore > 0.15 ? "up" : h.sentimentScore < -0.15 ? "down" : "neutral"}>{h.sentiment}</Tag>
                  <span className="min-w-0 flex-1 truncate text-term-text">{h.headline}</span>
                  {h.tickers.slice(0, 2).map((t, i) => <span key={i} className="text-3xs text-term-blue">{t}</span>)}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function cardsToQuotes(cards: SnapshotCard[]): Quote[] {
  return cards
    .filter((c) => c.price !== null)
    .map((c) => {
      const last = c.price ?? 0;
      const chgPct = (c.ret_1d ?? 0) * 100;
      const prior = chgPct === -100 ? last : last / (1 + chgPct / 100);
      const chg = last - prior;
      const spread = Math.max(0.01, last * 0.0004);
      return {
        ticker: c.series_id,
        name: c.display_name,
        assetClass: marketAssetClass(c.asset_class),
        sector: c.asset_class,
        last,
        chg,
        chgPct,
        bid: last - spread / 2,
        ask: last + spread / 2,
        vol: 0,
        notional: 0,
        vwap: last,
        high: last * (1 + Math.max(0, -(c.pct_from_52w_high ?? 0))),
        low: last * (1 + Math.min(0, c.max_drawdown ?? 0)),
        open: prior,
        spark: [prior, last],
      };
    });
}

function marketAssetClass(assetClass: string): AssetClass {
  const ac = assetClass.toUpperCase();
  if (ac === "BOND") return "GOVT";
  if (ac === "CREDIT") return "CORP";
  if (ac === "COMMODITY") return "COMMODITY" as AssetClass;
  if (ac === "CURRENCY" || ac === "FX") return "FX" as AssetClass;
  if (ac === "VOLATILITY") return "ETF" as AssetClass;
  if (ac === "EQUITY") return "EQUITY" as AssetClass;
  if (ac === "CRYPTO") return "CRYPTO" as AssetClass;
  if (ac === "FUTURE") return "FUTURE" as AssetClass;
  return "ETF" as AssetClass;
}

function quotesForTabFromPipeline(tab: TabKey, pipelineQuotes: Quote[], simQuotes: Quote[]): Quote[] {
  const pipelineForTab = (() => {
    if (tab === "ETF") return pipelineQuotes.filter((q) => q.assetClass === "ETF");
    if (tab === "FI") return pipelineQuotes.filter((q) => q.assetClass === "GOVT" || q.assetClass === "CORP");
    if (tab === "COMMODITY") return pipelineQuotes.filter((q) => q.assetClass === "COMMODITY");
    if (tab === "FX") return pipelineQuotes.filter((q) => q.assetClass === "FX");
    if (tab === "EQUITY") return pipelineQuotes.filter((q) => q.assetClass === "EQUITY");
    if (tab === "CRYPTO") return pipelineQuotes.filter((q) => q.assetClass === "CRYPTO");
    if (tab === "FUTURE") return pipelineQuotes.filter((q) => q.assetClass === "FUTURE");
    return [];
  })();
  if (pipelineForTab.length) {
    const pipelineTickers = new Set(pipelineForTab.map((q) => q.ticker));
    const simFill = simQuotes.filter((q) => !pipelineTickers.has(q.ticker));
    const simForTab = quotesForTab(tab).filter((q) => simFill.some((s) => s.ticker === q.ticker));
    return [...pipelineForTab, ...simForTab];
  }
  return quotesForTab(tab);
}

function mergeIndexQuotes(base: IndexQuote[], cards: SnapshotCard[]): IndexQuote[] {
  const bySeries = new Map(cards.map((c) => [c.series_id, c]));
  const map: Record<string, string> = { SPX: "SPY", NDX: "QQQ", RUT: "IWM", INDU: "DIA", DXY: "UUP", GC: "GLD" };
  return base.map((idx) => {
    const card = bySeries.get(map[idx.symbol]);
    if (!card || card.price === null) return idx;
    const chgPct = (card.ret_1d ?? 0) * 100;
    return { ...idx, last: card.price, chgPct, chg: card.price - card.price / (1 + chgPct / 100), spark: [card.price / (1 + chgPct / 100), card.price] };
  });
}

function PipelineTag({ source, asOf }: { source: MarketSource; asOf?: string | null }) {
  return <ProvenanceBadge source={source} asOf={asOf} />;
}
