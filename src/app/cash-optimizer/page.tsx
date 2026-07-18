
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { LineChart } from "@/components/charts/LineChart";
import { Sankey } from "@/components/charts/Sankey";
import { Donut, Gauge, ProgressBar } from "@/components/charts/Radial";
import { useMemo } from "react";
import {
  getFundingSources,
  getFundingUses,
  getCashSummary,
  getFundingPath,
  mergeLiveFundingRates,
  computeCashKpis,
  type FundingSource,
  type FundingUse,
  type FundingPath,
} from "@/data/cash";
import { isRealEconSource, useLiveSeriesSet } from "@/lib/useEcon";
import { fmtUsdAbbr, fmtAbbr, fmtNum, pnlClass } from "@/lib/format";

const CASH_FRED_IDS = ["SOFR", "DFF", "DCPF3M"] as const;

const SRC_TONE: Record<FundingSource["type"], "amber" | "blue" | "up" | "violet" | "neutral"> = {
  CASH: "up",
  REPO: "blue",
  SECLENDING_CASH: "violet",
  INTERNAL: "amber",
  FX_SWAP: "neutral",
  CP: "neutral",
};

const USE_TONE: Record<FundingUse["type"], "amber" | "blue" | "up" | "violet" | "down" | "neutral"> = {
  MARGIN_CALL: "down",
  SETTLEMENT: "blue",
  CLIENT_FINANCING: "amber",
  TREASURY_INVEST: "up",
  REDEMPTION: "violet",
};

const DONUT_COLORS = ["#FF8C00", "#3B9DFF", "#2ECC71", "#A78BFA", "#22D3EE", "#EC4899", "#FFB400", "#5E5E66"];

export default function CashOptimizer() {
  const simSources = getFundingSources();
  const uses = getFundingUses();
  const sum = getCashSummary();
  const path = getFundingPath();

  const { data: cashFred } = useLiveSeriesSet([...CASH_FRED_IDS], "lin", 5);
  const anyLive = CASH_FRED_IDS.some((id) => isRealEconSource(cashFred[id]?.source));
  const sources = useMemo(() => mergeLiveFundingRates(simSources, cashFred), [simSources, cashFred]);
  const liveKpis = useMemo(() => computeCashKpis(sources, uses), [sources, uses]);

  const srcCols: Column<FundingSource>[] = [
    { key: "source", header: "Source", render: (r) => <span className="text-term-text">{r.source}</span> },
    { key: "type", header: "Type", render: (r) => <Tag tone={SRC_TONE[r.type]}>{r.type.replace("_", " ")}</Tag> },
    { key: "available", header: "Available", align: "right", sortVal: (r) => r.available, render: (r) => <span className="text-term-text">{fmtUsdAbbr(r.available)}</span> },
    { key: "used", header: "Used", align: "right", sortVal: (r) => r.used, render: (r) => <span className="text-term-text-dim">{fmtUsdAbbr(r.used)}</span> },
    {
      key: "util",
      header: "Utilization",
      width: "120px",
      sortVal: (r) => r.used / r.available,
      render: (r) => <ProgressBar value={r.used} max={r.available} showPct height={5} />,
    },
    { key: "rate", header: "Rate", align: "right", sortVal: (r) => r.rateBps, render: (r) => <span className="text-term-amber">{fmtNum(r.rateBps, 0)} bps</span> },
    { key: "tenor", header: "Tenor", align: "right", render: (r) => <span className="text-term-text-mute">{r.tenor}</span> },
  ];

  const useCols: Column<FundingUse>[] = [
    { key: "use", header: "Use", render: (r) => <span className="text-term-text">{r.use}</span> },
    { key: "type", header: "Type", render: (r) => <Tag tone={USE_TONE[r.type]}>{r.type.replace("_", " ")}</Tag> },
    { key: "amount", header: "Amount", align: "right", sortVal: (r) => r.amount, render: (r) => <span className="text-term-text">{fmtUsdAbbr(r.amount)}</span> },
    { key: "rate", header: "Rate", align: "right", sortVal: (r) => r.rateBps, render: (r) => <span className="text-term-amber">{r.rateBps ? `${fmtNum(r.rateBps, 0)} bps` : "—"}</span> },
    { key: "dueBy", header: "Due By", align: "right", render: (r) => <span className="text-term-text-dim">{r.dueBy}</span> },
    {
      key: "priority",
      header: "Pri",
      align: "right",
      sortVal: (r) => (r.priority === "HIGH" ? 3 : r.priority === "MED" ? 2 : 1),
      render: (r) => <Tag tone={r.priority === "HIGH" ? "down" : r.priority === "MED" ? "amber" : "neutral"}>{r.priority}</Tag>,
    },
  ];

  const pathCols: Column<FundingPath>[] = [
    { key: "use", header: "Use", render: (r) => <span className="text-term-text">{r.use}</span> },
    { key: "arrow", header: "", width: "16px", render: () => <span className="text-term-text-mute">←</span> },
    { key: "source", header: "Matched Source", render: (r) => <span className="text-term-amber">{r.source}</span> },
    { key: "amount", header: "Amount", align: "right", sortVal: (r) => r.amount, render: (r) => <span className="text-term-text">{fmtUsdAbbr(r.amount)}</span> },
    { key: "rate", header: "Rate", align: "right", sortVal: (r) => r.rateBps, render: (r) => <span className="text-term-text-dim">{fmtNum(r.rateBps, 0)} bps</span> },
    { key: "saved", header: "Saved", align: "right", sortVal: (r) => r.savedBps, render: (r) => <span className="text-term-up">-{fmtNum(r.savedBps, 1)} bps</span> },
  ];

  // Source mix donut (by available)
  const donutSegs = [...sources]
    .sort((a, b) => b.available - a.available)
    .map((s, i) => ({ value: s.available, color: DONUT_COLORS[i % DONUT_COLORS.length], label: s.source }));

  // Sankey: sources (col 0) -> uses (col 1) from funding path
  const pathSourceIds = Array.from(new Set(path.map((p) => p.source)));
  const pathUseIds = Array.from(new Set(path.map((p) => p.use)));
  const sankeyNodes = [
    ...pathSourceIds.map((s) => ({ id: `S:${s}`, label: s.length > 22 ? s.slice(0, 20) + "…" : s, col: 0 })),
    ...pathUseIds.map((u) => ({ id: `U:${u}`, label: u.length > 22 ? u.slice(0, 20) + "…" : u, col: 1 })),
  ];
  const sankeyLinks = path.map((p) => ({ source: `S:${p.source}`, target: `U:${p.use}`, value: p.amount }));

  // Recommendations derived from data
  const cheapest = [...sources].sort((a, b) => a.rateBps - b.rateBps)[0];
  const dearest = [...sources].sort((a, b) => b.rateBps - a.rateBps)[0];
  const highUses = uses.filter((u) => u.priority === "HIGH");
  const highTotal = highUses.reduce((a, u) => a + u.amount, 0);
  const totalSaved = path.reduce((a, p) => a + (p.amount * p.savedBps) / 10000, 0);

  const recs: { text: string; tone: "up" | "amber" | "down" | "blue"; tag: string }[] = [
    { text: `Shift incremental funding to ${cheapest.source} (${fmtNum(cheapest.rateBps, 0)} bps) away from ${dearest.source} (${fmtNum(dearest.rateBps, 0)} bps).`, tone: "up", tag: `${fmtNum(dearest.rateBps - cheapest.rateBps, 0)} bps` },
    { text: `Cover ${highUses.length} HIGH-priority uses first (${fmtUsdAbbr(highTotal)}) — margin & client financing due intraday.`, tone: "down", tag: `${highUses.length} HIGH` },
    { text: `Execute cheapest funding path across ${path.length} legs to realize blended-rate savings.`, tone: "amber", tag: fmtUsdAbbr(totalSaved) },
    { text: liveKpis.fundingGap >= 0 ? `Surplus of ${fmtUsdAbbr(liveKpis.fundingGap)} — deploy excess into Money Market / Reverse Repo.` : `Deficit of ${fmtUsdAbbr(Math.abs(liveKpis.fundingGap))} — raise term repo to close gap.`, tone: liveKpis.fundingGap >= 0 ? "up" : "down", tag: fmtUsdAbbr(Math.abs(liveKpis.fundingGap)) },
    { text: `Maintain liquidity buffer of ${fmtUsdAbbr(sum.liquidityBuffer)} vs intraday peak ${fmtUsdAbbr(sum.intradayPeak)}.`, tone: "blue", tag: `LCR ${fmtNum(sum.lcr, 0)}` },
  ];

  const trendLabels = sum.projTrend.map((_, i) => `${String(Math.floor(i / 4) + 9).padStart(2, "0")}:${(i % 4) * 15 === 0 ? "00" : (i % 4) * 15}`);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="CASH" title="Cash Optimizer" desc="Treasury Funding Optimization" right={<ProvenanceBadge source={anyLive ? "FRED" : "SIM"} />} />

      <KpiStrip>
        <Stat label="Total Sources" value={fmtUsdAbbr(sum.totalSources)} sub={`${sources.length} facilities`} />
        <Stat label="Total Uses" value={fmtUsdAbbr(sum.totalUses)} sub={`${uses.length} obligations`} />
        <Stat label="Funding Gap" value={fmtUsdAbbr(liveKpis.fundingGap)} sub={liveKpis.fundingGap >= 0 ? "surplus" : "deficit"} tone={liveKpis.fundingGap >= 0 ? "up" : "down"} />
        <Stat label="Blended Rate" value={`${fmtNum(liveKpis.blendedRateBps, 1)} bps`} sub="current cost of funds" />
        <Stat label="Optimized Rate" value={`${fmtNum(liveKpis.optimizedRateBps, 1)} bps`} sub={<span className="text-term-up">-{fmtNum(liveKpis.savingsBps, 1)} bps</span>} tone="up" />
        <Stat label="Savings" value={fmtUsdAbbr(liveKpis.savingsUsd)} sub={`${fmtNum(liveKpis.savingsBps, 1)} bps captured`} tone="amber" />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        {/* Sources */}
        <Panel title="Funding Sources" code="SRC" className="xl:col-span-2" right={<Tag tone="blue">{sources.length}</Tag>}>
          <DataGrid columns={srcCols} rows={sources} rowKey={(r) => r.source} maxHeight="260px" initialSort={{ key: "available", dir: "desc" }} zebra />
        </Panel>

        <Panel title="Source Mix — by Available" code="MIX">
          <div className="flex items-center gap-3 p-2">
            <Donut segments={donutSegs} size={120} center={fmtUsdAbbr(sum.totalSources)} centerSub="total" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {donutSegs.slice(0, 6).map((s) => (
                <div key={s.label} className="flex items-center gap-1.5 text-2xs">
                  <span className="h-2 w-2 shrink-0" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate text-term-text-dim">{s.label}</span>
                  <span className="tnum text-term-text">{fmtUsdAbbr(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* Uses */}
        <Panel title="Funding Uses" code="USE" className="xl:col-span-2" right={<Tag tone="amber">{uses.length}</Tag>}>
          <DataGrid columns={useCols} rows={uses} rowKey={(r) => r.use} maxHeight="260px" initialSort={{ key: "amount", dir: "desc" }} zebra />
        </Panel>

        {/* Liquidity stress */}
        <Panel title="Liquidity Stress" code="LIQ" accent>
          <div className="p-2">
            <LineChart
              height={120}
              yFmt={(n) => fmtAbbr(n)}
              labels={trendLabels}
              series={[{ name: "Projected Need", data: sum.projTrend, color: "#FF8C00", area: true }]}
            />
            <div className="mt-1 grid grid-cols-2 gap-2">
              <div className="flex flex-col items-center">
                <Gauge value={sum.lcr} max={200} size={104} label="LCR %" warn={130} danger={150} />
              </div>
              <div className="flex flex-col items-center">
                <Gauge value={sum.nsfr} max={200} size={104} label="NSFR %" warn={130} danger={150} />
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-term-border border-t border-term-border">
              <Stat label="Intraday Peak" value={fmtUsdAbbr(sum.intradayPeak)} />
              <Stat label="Liquidity Buffer" value={fmtUsdAbbr(sum.liquidityBuffer)} tone="up" />
            </div>
          </div>
        </Panel>

        {/* Cheapest funding path */}
        <Panel title="Cheapest Funding Path" code="OPT" className="xl:col-span-2" right={<Tag tone="up">OPTIMAL</Tag>}>
          <DataGrid columns={pathCols} rows={path} rowKey={(r, i) => `${r.use}-${i}`} maxHeight="260px" zebra />
        </Panel>

        {/* Recommendations */}
        <Panel title="Funding Recommendations" code="REC" right={<Tag tone="amber">{recs.length}</Tag>}>
          <div className="divide-y divide-term-border-soft">
            {recs.map((r, i) => (
              <div key={i} className="flex items-start gap-2 px-2 py-1.5">
                <span className="mt-px text-2xs text-term-text-mute">{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 text-2xs leading-snug text-term-text-dim">{r.text}</span>
                <Tag tone={r.tone}>{r.tag}</Tag>
              </div>
            ))}
          </div>
        </Panel>

        {/* Sankey flow */}
        <Panel title="Funding Flow — Sources → Uses" code="FLOW" className="xl:col-span-3">
          <div className="p-2">
            <Sankey nodes={sankeyNodes} links={sankeyLinks} height={320} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
