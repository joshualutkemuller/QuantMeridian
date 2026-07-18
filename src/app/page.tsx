
import { useMemo, useState } from "react";
import clsx from "clsx";
import Link from "@/components/Link";
import { useNews } from "@/lib/useNews";
import type { Headline } from "@/data/news";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart } from "@/components/charts/LineChart";
import { Treemap } from "@/components/charts/Treemap";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { getSLSummary } from "@/data/securitiesLending";
import { getPrimeSummary } from "@/data/primeFinance";
import { getCollateralSummary } from "@/data/collateral";
import { getCashSummary } from "@/data/cash";
import { getOptimizationRuns } from "@/data/optimization";
import { getIndices, getHeatmap, getMovers, INDEX_FRED_IDS, mergeLiveIndices, mergeSnapshotIndices, latestFredAsOf, heatmapFromCards, moversFromCards, HEAT_HORIZONS, horizonDateRange, isAnnualized, type PipelineCard, type HeatHorizon } from "@/data/markets";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { getActiveAlerts, SEVERITY_TONE, CATEGORY_LABEL, type Alert } from "@/data/alerts";
import { isRealEconSource, useLiveSeriesSet } from "@/lib/useEcon";
import { useMarketView } from "@/lib/useMarket";
import { fmtUsdAbbr, fmtSignedPct, fmtNum, pnlClass, fmtAbbr } from "@/lib/format";
import { NAV } from "@/lib/nav";
import { StalenessBar } from "@/components/ui/StalenessBar";
import { worstSource } from "@/lib/provenance";

function NewsTicker({ headlines }: { headlines: Headline[] }) {
  if (!headlines.length) return null;
  const top = headlines.slice(0, 8);
  return (
    <div className="flex items-center gap-4 overflow-x-auto border-b border-term-border bg-term-panel px-3 py-1 scrollbar-hide">
      <span className="shrink-0 text-3xs font-bold uppercase tracking-widest text-term-amber">NEWS</span>
      {top.map((h) => (
        <span key={h.id} className="flex shrink-0 items-center gap-1.5 text-2xs">
          <span className="text-term-text-mute">{h.time}</span>
          <span className={clsx("font-semibold", h.sentimentScore > 0.15 ? "text-term-up" : h.sentimentScore < -0.15 ? "text-term-down" : "text-term-text")}>{h.headline}</span>
          {h.tickers[0] && <span className="text-3xs text-term-blue">{h.tickers[0]}</span>}
        </span>
      ))}
    </div>
  );
}

export default function CommandCenter() {
  const { headlines } = useNews(20);
  const sl = getSLSummary();
  const pb = getPrimeSummary();
  const coll = getCollateralSummary();
  const cash = getCashSummary();
  const runs = getOptimizationRuns();
  const simIndices = getIndices();
  const simHeat = getHeatmap();
  const simMovers = getMovers();
  const alerts = getActiveAlerts().slice(0, 7);
  const [heatHorizon, setHeatHorizon] = useState<HeatHorizon>("1D");

  const { data: indexFred } = useLiveSeriesSet(INDEX_FRED_IDS, "lin", 30);
  const anyIndexLive = INDEX_FRED_IDS.some((id) => isRealEconSource(indexFred[id]?.source));
  const fredAsOf = useMemo(() => latestFredAsOf(indexFred), [indexFred]);

  const { data: marketData, source: mktSource } = useMarketView<{ cards: PipelineCard[] }>("market");
  const pipelineLive = mktSource !== "SNAPSHOT" && mktSource !== "LOADING" && !!marketData?.cards?.length;
  const hasCards = !!marketData?.cards?.length;
  const pipelineAsOf = useMemo(() => {
    if (!marketData?.cards?.length) return null;
    return marketData.cards.reduce((best: string | null, c) => {
      const d = (c as any).asof ?? null;
      return d && (!best || d > best) ? d : best;
    }, null);
  }, [marketData]);

  const indices = useMemo(() => {
    let idx = simIndices;
    if (hasCards && marketData?.cards) idx = mergeSnapshotIndices(idx, marketData.cards, pipelineAsOf);
    if (anyIndexLive) idx = mergeLiveIndices(idx, indexFred);
    return idx;
  }, [simIndices, indexFred, anyIndexLive, marketData, hasCards, pipelineAsOf]);

  const heat = useMemo(() => hasCards ? heatmapFromCards(marketData!.cards, heatHorizon) : simHeat, [hasCards, marketData, simHeat, heatHorizon]);
  const heatRange = useMemo(() => horizonDateRange(heatHorizon, pipelineAsOf), [heatHorizon, pipelineAsOf]);
  const movers = useMemo(() => {
    if (hasCards) { const m = moversFromCards(marketData!.cards); return { ...simMovers, gainers: m.gainers, losers: m.losers }; }
    return simMovers;
  }, [hasCards, marketData, simMovers]);

  const marketAsOf = fredAsOf ?? pipelineAsOf;
  const sourceTiers: string[] = [];
  if (anyIndexLive) sourceTiers.push(...INDEX_FRED_IDS.map((id) => indexFred[id]?.source).filter(isRealEconSource));
  if (hasCards) sourceTiers.push(pipelineLive ? "LIVE" as any : "SNAPSHOT");
  if (!sourceTiers.length) sourceTiers.push("SIM");
  const badgeSource = worstSource(sourceTiers);

  const alertCols: Column<Alert>[] = [
    { key: "sev", header: "", width: "8px", render: (a) => <span className={`inline-block h-2 w-2 rounded-full ${a.severity === "CRITICAL" ? "bg-term-down" : a.severity === "HIGH" ? "bg-term-amber" : "bg-term-blue"}`} /> },
    { key: "ts", header: "Time", render: (a) => <span className="text-term-text-mute">{a.ts}</span> },
    { key: "cat", header: "Desk", render: (a) => <Tag tone={SEVERITY_TONE[a.severity]}>{CATEGORY_LABEL[a.category]}</Tag> },
    { key: "title", header: "Alert", render: (a) => <span className="text-term-text">{a.title}</span> },
    { key: "metric", header: "Metric", align: "right", render: (a) => <span className="text-term-amber">{a.metric}</span> },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="HOME" title="Command Center" desc="Cross-desk securities finance intelligence" right={
        <span className="flex items-center gap-2">
          {marketAsOf && <span className="text-3xs text-term-text-mute">Data as of {marketAsOf}</span>}
          <ProvenanceBadge source={badgeSource} />
        </span>
      } />

      <StalenessBar asOf={marketAsOf} />

      <NewsTicker headlines={headlines} />

      <KpiStrip>
        <Stat label="SL Revenue (Day)" value={fmtUsdAbbr(sl.dayRevenue)} sub={<span className={pnlClass(sl.dayChgPct)}>{fmtSignedPct(sl.dayChgPct)} vs prior</span>} tone="amber" />
        <Stat label="Prime Financing Rev" value={fmtUsdAbbr(pb.financingRevenue)} sub={`${pb.clientCount} active clients`} />
        <Stat label="Gross Exposure" value={fmtUsdAbbr(pb.grossExposure)} sub={`Net ${fmtUsdAbbr(pb.netExposure)}`} />
        <Stat label="Collateral Savings" value={fmtUsdAbbr(coll.optimizedSavings)} sub="today's optimization" tone="up" />
        <Stat label="Funding Cost" value={`${cash.blendedRateBps.toFixed(1)}bps`} sub={<span className={pnlClass(-cash.fundingGap)}>{fmtUsdAbbr(cash.fundingGap)} gap</span>} />
        <Stat label="Excess Collateral" value={fmtUsdAbbr(coll.excessCollateral)} sub={`${coll.deficitCount} deficits`} tone={coll.deficitCount > 0 ? "down" : "up"} />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        {/* Left column: module launchpad + revenue */}
        <div className="flex flex-col gap-2">
          <Panel title="Desk Revenue — Trailing 60d" code="ALL DESKS">
            <div className="p-2">
              <LineChart
                height={150}
                yFmt={(n) => fmtAbbr(n)}
                series={[
                  { name: "Sec Lending", data: sl.revenueTrend, color: "#FF8C00", area: true },
                  { name: "Prime", data: pb.revenueTrend, color: "#3B9DFF" },
                ]}
              />
              <div className="mt-1 flex gap-4 px-1 text-2xs">
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 bg-term-amber" /> Securities Lending</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 bg-term-blue" /> Prime Finance</span>
              </div>
            </div>
          </Panel>

          <Panel title="Module Launchpad" code="GO">
            <div className="grid grid-cols-2 gap-px bg-term-border">
              {NAV.slice(1).map((n) => {
                const Icon = n.icon;
                return (
                  <Link key={n.href} href={n.href} className="flex items-center gap-2 bg-term-panel px-2.5 py-2 hover:bg-term-panel-2">
                    <Icon size={15} className="text-term-amber" />
                    <span className="min-w-0">
                      <span className="block truncate text-2xs font-semibold text-term-text">{n.label}</span>
                      <span className="block font-mono text-3xs text-term-text-mute">{n.code}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* Middle column: markets */}
        <div className="flex flex-col gap-2">
          <Panel title="Global Markets" code="WEI" right={
            <span className="flex items-center gap-1.5 text-3xs text-term-text-mute">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${badgeSource === "SIM" ? "bg-term-amber" : "bg-term-up"}`} />
              {badgeSource}{marketAsOf ? ` ${marketAsOf}` : ""}
            </span>
          }>
            <div className="grid grid-cols-2 gap-px bg-term-border">
              {indices.slice(0, 8).map((q) => (
                <div key={q.symbol} className="flex items-center justify-between bg-term-panel px-2.5 py-1.5">
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="text-2xs font-semibold text-term-text-dim">{q.symbol}</span>
                      {q.seriesId && <span className="text-3xs text-term-text-mute font-mono" title={`${q.source ?? "SIM"}${q.asOf ? ` ${q.asOf}` : ""}`}>{q.seriesId}</span>}
                    </div>
                    <div className="tnum text-xs text-term-text">{fmtNum(q.last, q.last > 1000 ? 0 : 2)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Sparkline data={q.spark} width={48} height={20} />
                    <span className={`tnum w-12 text-right text-2xs ${pnlClass(q.chgPct)}`}>{fmtSignedPct(q.chgPct)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Equity Heat Map" code="HEAT" toolbar={
            <div className="flex w-full items-center justify-between gap-2">
              <TermToggleGroup value={heatHorizon} onChange={setHeatHorizon} options={HEAT_HORIZONS} size="sm" />
              <span className="text-3xs text-term-text-mute">
                {heatRange && <span className="font-mono">{heatRange}</span>}
                {isAnnualized(heatHorizon) && <span className="ml-1 text-term-amber">ANNUALIZED</span>}
              </span>
            </div>
          } right={
            <span className="flex items-center gap-1.5 text-3xs text-term-text-mute">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${hasCards ? "bg-term-up" : "bg-term-amber"}`} />
              {pipelineLive ? "PIPELINE" : hasCards ? "SNAPSHOT" : "SIM"}
            </span>
          }>
            <div className="p-1">
              <Treemap cells={heat.map((h) => ({ label: h.ticker, weight: h.weight, value: h.chgPct, group: h.sector }))} height={200} maxAbs={isAnnualized(heatHorizon) ? 30 : heatHorizon === "YTD" || heatHorizon === "1Y" ? 20 : 4} />
            </div>
          </Panel>
        </div>

        {/* Right column: alerts + movers */}
        <div className="flex flex-col gap-2">
          <Panel title="Live Alert Stream" code="ALRT" accent right={<Tag tone="down">{getActiveAlerts().filter((a) => a.severity === "CRITICAL").length} CRIT</Tag>}>
            <DataGrid columns={alertCols} rows={alerts} rowKey={(a) => a.id} maxHeight="220px" />
          </Panel>

          <div className="grid grid-cols-2 gap-2">
            <Panel title="Top Gainers" code="MOV+" right={<span className={`text-3xs ${hasCards ? "text-term-up" : "text-term-text-mute"}`}>{pipelineLive ? "LIVE" : hasCards ? "SNAPSHOT" : "SIM"}</span>}>
              <div className="divide-y divide-term-border-soft">
                {movers.gainers.slice(0, 6).map((m) => (
                  <div key={m.ticker} className="flex items-center justify-between px-2 py-1 text-2xs">
                    <span className="font-semibold text-term-text">{m.ticker}</span>
                    <span className="tnum text-term-up">{fmtSignedPct(m.chgPct)}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Top Losers" code="MOV-" right={<span className={`text-3xs ${hasCards ? "text-term-up" : "text-term-text-mute"}`}>{pipelineLive ? "LIVE" : hasCards ? "SNAPSHOT" : "SIM"}</span>}>
              <div className="divide-y divide-term-border-soft">
                {movers.losers.slice(0, 6).map((m) => (
                  <div key={m.ticker} className="flex items-center justify-between px-2 py-1 text-2xs">
                    <span className="font-semibold text-term-text">{m.ticker}</span>
                    <span className="tnum text-term-down">{fmtSignedPct(m.chgPct)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Latest Optimization Runs" code="OPT">
            <div className="divide-y divide-term-border-soft">
              {runs.slice(0, 4).map((r) => (
                <div key={r.id} className="flex items-center justify-between px-2 py-1.5 text-2xs">
                  <div className="flex items-center gap-2">
                    <Tag tone={r.status === "OPTIMAL" ? "up" : r.status === "INFEASIBLE" ? "down" : "amber"}>{r.status}</Tag>
                    <span className="text-term-text-dim">{r.type}</span>
                  </div>
                  <span className="tnum text-term-up">{fmtUsdAbbr(r.savings)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
