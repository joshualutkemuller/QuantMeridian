
import { useState, useMemo } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { ProgressBar } from "@/components/charts/Radial";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import {
  getEarlyWarningSignals,
  getFundingFacilities,
  getLiquidityBuckets,
  getLiquidityStressScenarios,
  getLiquiditySummary,
  mergeLiveEWS,
  type EarlyWarningSignal,
  type FundingFacility,
  type LiquidityBucket,
  type LiquidityStressScenario,
} from "@/data/liquidity";
import { isRealEconSource, useLiveSeriesSet } from "@/lib/useEcon";
import { fmtAbbr, fmtBps, fmtNum, fmtPct, fmtUsdAbbr, pnlClass } from "@/lib/format";

const EWS_FRED_IDS = ["SOFR", "EFFR", "BAMLH0A0HYM2"] as const;

const FACILITY_TONE: Record<FundingFacility["type"], "up" | "blue" | "amber" | "violet" | "neutral"> = {
  CASH: "up",
  REPO: "blue",
  CP: "amber",
  FX_SWAP: "violet",
  INTERNAL: "up",
  CONTINGENT: "neutral",
};

const SEVERITY_TONE: Record<LiquidityStressScenario["severity"], "up" | "blue" | "amber" | "down"> = {
  BASE: "up",
  WATCH: "blue",
  STRESS: "amber",
  SEVERE: "down",
};

const SIGNAL_TONE: Record<EarlyWarningSignal["status"], "up" | "amber" | "down"> = {
  OK: "up",
  WATCH: "amber",
  RISK: "down",
};

function signalValue(s: EarlyWarningSignal): string {
  if (s.unit === "$B") return `$${fmtNum(s.latest, 1)}B`;
  if (s.unit === "bps") return fmtBps(s.latest, 0);
  if (s.unit === "%") return fmtPct(s.latest, 1);
  return fmtNum(s.latest, 1);
}

export default function LiquidityPage() {
  const buckets = getLiquidityBuckets();
  const facilities = getFundingFacilities();
  const scenarios = getLiquidityStressScenarios();
  const simSignals = getEarlyWarningSignals();
  const summary = getLiquiditySummary();

  const { data: ewsFred } = useLiveSeriesSet([...EWS_FRED_IDS], "lin", 10);
  const anyEwsLive = EWS_FRED_IDS.some((id) => isRealEconSource(ewsFred[id]?.source));
  const signals = useMemo(() => mergeLiveEWS(simSignals, ewsFred), [simSignals, ewsFred]);

  const [sevFilter, setSevFilter] = useState("ALL");
  const filteredScenarios = useMemo(() => sevFilter === "ALL" ? scenarios : scenarios.filter((s) => s.severity === sevFilter), [scenarios, sevFilter]);

  const bucketCols: Column<LiquidityBucket>[] = [
    { key: "horizon", header: "Horizon", align: "center", render: (r) => <Tag tone="blue">{r.horizon}</Tag>, sortVal: (r) => r.horizon },
    { key: "opening", header: "Opening", align: "right", render: (r) => <span className="text-term-text-dim">{fmtUsdAbbr(r.openingCash)}</span>, sortVal: (r) => r.openingCash },
    { key: "inflows", header: "Inflows", align: "right", render: (r) => <span className="text-term-up">{fmtUsdAbbr(r.inflows)}</span>, sortVal: (r) => r.inflows },
    { key: "outflows", header: "Outflows", align: "right", render: (r) => <span className="text-term-down">{fmtUsdAbbr(r.outflows)}</span>, sortVal: (r) => r.outflows },
    { key: "margin", header: "Margin Calls", align: "right", render: (r) => <span className="text-term-amber">{fmtUsdAbbr(r.marginCalls)}</span>, sortVal: (r) => r.marginCalls },
    { key: "funding", header: "Secured Funding", align: "right", render: (r) => <span className="text-term-blue">{fmtUsdAbbr(r.securedFunding)}</span>, sortVal: (r) => r.securedFunding },
    { key: "closing", header: "Closing Liq", align: "right", render: (r) => <span className={pnlClass(r.closingLiquidity - r.minimumBuffer)}>{fmtUsdAbbr(r.closingLiquidity)}</span>, sortVal: (r) => r.closingLiquidity },
    {
      key: "buffer",
      header: "Buffer Use",
      width: "130px",
      render: (r) => <ProgressBar value={r.minimumBuffer} max={r.closingLiquidity} color={r.closingLiquidity < r.minimumBuffer ? "#FF3B3B" : "#2ECC71"} showPct />,
      sortVal: (r) => r.closingLiquidity / r.minimumBuffer,
    },
  ];

  const facilityCols: Column<FundingFacility>[] = [
    { key: "facility", header: "Facility", render: (r) => <span className="font-semibold text-term-text">{r.facility}</span>, sortVal: (r) => r.facility },
    { key: "type", header: "Type", align: "center", render: (r) => <Tag tone={FACILITY_TONE[r.type]}>{r.type.replace("_", " ")}</Tag>, sortVal: (r) => r.type },
    { key: "capacity", header: "Capacity", align: "right", render: (r) => <span className="text-term-text">{fmtUsdAbbr(r.capacity)}</span>, sortVal: (r) => r.capacity },
    { key: "drawn", header: "Drawn", align: "right", render: (r) => <span className="text-term-text-dim">{fmtUsdAbbr(r.drawn)}</span>, sortVal: (r) => r.drawn },
    { key: "cost", header: "Cost", align: "right", render: (r) => <span className="text-term-amber">{fmtBps(r.costBps, 0)}</span>, sortVal: (r) => r.costBps },
    {
      key: "reliability",
      header: "Reliability",
      width: "130px",
      render: (r) => <ProgressBar value={r.reliability} color={r.reliability < 82 ? "#FF3B3B" : r.reliability < 90 ? "#FF8C00" : "#2ECC71"} showPct />,
      sortVal: (r) => r.reliability,
    },
    { key: "time", header: "Time", align: "right", render: (r) => <span className="text-term-text-mute">{r.timeToFund}</span>, sortVal: (r) => r.timeToFund },
  ];

  const scenarioCols: Column<LiquidityStressScenario>[] = [
    { key: "scenario", header: "Scenario", render: (r) => <span className="font-semibold text-term-text">{r.scenario}</span>, sortVal: (r) => r.scenario },
    { key: "severity", header: "Severity", align: "center", render: (r) => <Tag tone={SEVERITY_TONE[r.severity]}>{r.severity}</Tag>, sortVal: (r) => r.severity },
    { key: "margin", header: "Margin Shock", align: "right", render: (r) => <span className="text-term-down">{fmtUsdAbbr(r.marginShock)}</span>, sortVal: (r) => r.marginShock },
    { key: "collateral", header: "Collat Shock", align: "right", render: (r) => <span className="text-term-amber">{fmtUsdAbbr(r.collateralShock)}</span>, sortVal: (r) => r.collateralShock },
    { key: "cost", header: "Funding Cost", align: "right", render: (r) => <span className="text-term-text">{fmtBps(r.fundingCostBps, 0)}</span>, sortVal: (r) => r.fundingCostBps },
    { key: "buffer", header: "Post-Shock Buffer", align: "right", render: (r) => <span className={pnlClass(r.bufferAfterShock)}>{fmtUsdAbbr(r.bufferAfterShock)}</span>, sortVal: (r) => r.bufferAfterShock },
    { key: "survival", header: "Survival", align: "right", render: (r) => <span className={r.survivalDays < 3 ? "text-term-down" : "text-term-up"}>{fmtNum(r.survivalDays, 1)}d</span>, sortVal: (r) => r.survivalDays },
  ];

  const signalCols: Column<EarlyWarningSignal>[] = [
    { key: "signal", header: "Signal", render: (r) => <span className="font-semibold text-term-text">{r.signal}</span>, sortVal: (r) => r.signal },
    { key: "source", header: "Source", align: "center", render: (r) => <Tag tone={r.source === "FRED" ? "up" : r.source === "YAHOO" ? "blue" : "neutral"}>{r.source}</Tag>, sortVal: (r) => r.source },
    { key: "latest", header: "Latest", align: "right", render: (r) => <span className="text-term-text">{signalValue(r)}</span>, sortVal: (r) => r.latest },
    { key: "threshold", header: "Threshold", align: "right", render: (r) => <span className="text-term-text-dim">{r.unit === "$B" ? `$${fmtNum(r.threshold, 1)}B` : r.unit === "bps" ? fmtBps(r.threshold, 0) : r.unit === "%" ? fmtPct(r.threshold, 1) : fmtNum(r.threshold, 1)}</span>, sortVal: (r) => r.threshold },
    { key: "status", header: "Status", align: "center", render: (r) => <Tag tone={SIGNAL_TONE[r.status]}>{r.status}</Tag>, sortVal: (r) => r.status },
    { key: "impact", header: "Desk Impact", render: (r) => <span className="text-term-text-dim">{r.deskImpact}</span>, sortVal: (r) => r.deskImpact },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="LIQ" title="Liquidity & Funding Stress" desc="Margin shocks, funding capacity and early warning signals" right={<span className="flex items-center gap-1"><ProvenanceBadge source={anyEwsLive ? "FRED" : "SIM"} />{!anyEwsLive && <Tag tone="amber">FRED/YAHOO READY</Tag>}</span>} />

      <KpiStrip>
        <Stat label="Liquid Assets" value={fmtUsdAbbr(summary.totalLiquidAssets)} sub="cash plus undrawn capacity" />
        <Stat label="Outflows Today" value={fmtUsdAbbr(summary.totalOutflowsToday)} sub={`${summary.highPriorityCalls} high-priority calls`} tone="down" />
        <Stat label="Net Liquidity" value={fmtUsdAbbr(summary.netLiquidityToday)} sub="after minimum buffer" tone={summary.netLiquidityToday >= 0 ? "up" : "down"} />
        <Stat label="Stress Buffer" value={fmtUsdAbbr(summary.stressBuffer)} sub="minimum across horizons" tone={summary.stressBuffer >= 0 ? "up" : "down"} />
        <Stat label="Survival" value={`${fmtNum(summary.survivalDays, 1)}d`} sub="base burn rate" />
        <Stat label="Funding Cost" value={fmtBps(summary.weightedFundingCostBps, 0)} sub={fmtUsdAbbr(summary.contingencyCapacity) + " contingency"} tone="amber" />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        <Panel title="Liquidity Ladder" code="LADR" className="xl:col-span-2">
          <DataGrid columns={bucketCols} rows={buckets} rowKey={(r) => r.horizon} maxHeight="260px" zebra />
        </Panel>

        <Panel title="Net Liquidity Path" code="PATH">
          <div className="p-2">
            <LineChart
              height={170}
              labels={buckets.map((b) => b.horizon)}
              yFmt={(n) => fmtAbbr(n)}
              series={[
                { name: "Closing Liquidity", data: buckets.map((b) => b.closingLiquidity), color: "#2ECC71", area: true },
                { name: "Minimum Buffer", data: buckets.map((b) => b.minimumBuffer), color: "#FF3B3B", dashed: true },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Funding Facilities" code="SRC" className="xl:col-span-2">
          <DataGrid columns={facilityCols} rows={facilities} rowKey={(r) => r.facility} maxHeight="280px" initialSort={{ key: "capacity", dir: "desc" }} zebra />
        </Panel>

        <Panel title="Undrawn Capacity" code="CAP">
          <div className="p-2">
            <BarChart horizontal data={facilities.map((f) => ({ label: f.facility, value: Math.max(0, f.capacity - f.drawn), color: f.type === "CONTINGENT" ? "#A78BFA" : "#3B9DFF" }))} fmt={(n) => fmtUsdAbbr(n)} />
          </div>
        </Panel>

        <Panel title="Stress Scenarios" code="STRESS" className="xl:col-span-2" accent toolbar={<TermToggleGroup label="Severity" value={sevFilter} onChange={setSevFilter} options={[{ value: "ALL", label: "All" }, { value: "BASE", label: "Base" }, { value: "WATCH", label: "Watch" }, { value: "STRESS", label: "Stress" }]} size="sm" />}>
          <DataGrid columns={scenarioCols} rows={filteredScenarios} rowKey={(r) => r.scenario} maxHeight="280px" initialSort={{ key: "buffer", dir: "asc" }} zebra />
        </Panel>

        <Panel title="Post-Shock Buffers" code="BUF">
          <div className="p-2">
            <BarChart horizontal data={filteredScenarios.map((s) => ({ label: s.scenario, value: s.bufferAfterShock, color: s.bufferAfterShock < 0 ? "#FF3B3B" : "#2ECC71" }))} fmt={(n) => fmtUsdAbbr(n)} />
          </div>
        </Panel>

        <Panel title="Early Warning Signals" code="EWS" className="xl:col-span-3" right={<Tag tone="amber">{signals.filter((s) => s.status !== "OK").length} active</Tag>}>
          <DataGrid columns={signalCols} rows={signals} rowKey={(r) => r.signal} maxHeight="285px" initialSort={{ key: "status", dir: "desc" }} zebra />
        </Panel>
      </div>
    </div>
  );
}
