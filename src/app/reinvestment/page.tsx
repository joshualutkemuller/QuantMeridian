
import { useMemo, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { Donut, ProgressBar } from "@/components/charts/Radial";
import {
  getReinvestmentConstraints,
  getReinvestmentPositions,
  getReinvestmentRecommendations,
  getReinvestmentScenarios,
  getReinvestmentSummary,
  mergeLiveYields,
  computeReinvestmentKpis,
  type ReinvestmentConstraint,
  type ReinvestmentPosition,
  type ReinvestmentRecommendation,
} from "@/data/reinvestment";
import { isRealEconSource, useLiveSeriesSet } from "@/lib/useEcon";
import { fmtAbbr, fmtBps, fmtNum, fmtPct, fmtUsdAbbr, pnlClass } from "@/lib/format";

const REINV_FRED_IDS = ["SOFR", "DGS3MO", "DCPF3M", "DGS6MO", "DGS1"] as const;

const BUCKET_TONE: Record<ReinvestmentPosition["bucket"], "up" | "blue" | "amber" | "violet"> = {
  "T+0": "up",
  "T+1": "blue",
  "T+7": "amber",
  TERM: "violet",
};

const CREDIT_TONE: Record<ReinvestmentPosition["credit"], "up" | "blue" | "amber" | "violet" | "down"> = {
  HQLA: "up",
  AGENCY: "blue",
  "A1/P1": "amber",
  BANK: "violet",
  CREDIT: "down",
};

const STATUS_TONE: Record<ReinvestmentConstraint["status"], "up" | "amber" | "down"> = {
  OK: "up",
  WATCH: "amber",
  BREACH: "down",
};

const PRIORITY_TONE: Record<ReinvestmentRecommendation["priority"], "down" | "amber" | "neutral"> = {
  HIGH: "down",
  MED: "amber",
  LOW: "neutral",
};

const DONUT_COLORS = ["#FF8C00", "#3B9DFF", "#2ECC71", "#A78BFA", "#22D3EE", "#EC4899", "#FFB400"];

function formatConstraint(c: ReinvestmentConstraint, v: number): string {
  if (c.unit === "$") return fmtUsdAbbr(v);
  if (c.unit === "days") return `${fmtNum(v, 0)}d`;
  return fmtPct(v, 1);
}

export default function ReinvestmentPage() {
  const simPositions = getReinvestmentPositions();
  const summary = getReinvestmentSummary();
  const scenarios = getReinvestmentScenarios();
  const constraints = getReinvestmentConstraints();
  const recommendations = getReinvestmentRecommendations();

  const { data: reinvFred } = useLiveSeriesSet([...REINV_FRED_IDS], "lin", 5);
  const anyLive = REINV_FRED_IDS.some((id) => isRealEconSource(reinvFred[id]?.source));
  const positions = useMemo(() => mergeLiveYields(simPositions, reinvFred), [simPositions, reinvFred]);
  const liveKpis = useMemo(() => computeReinvestmentKpis(positions), [positions]);
  const [shockBps, setShockBps] = useState(-25);

  const weightedFedBeta = useMemo(
    () => positions.reduce((a, p) => a + p.allocation * p.fedBeta, 0) / summary.cashCollateral,
    [positions, summary.cashCollateral]
  );
  const shockCarry = (summary.cashCollateral * (shockBps * weightedFedBeta * 0.42)) / 10000 / 100;
  const stressedSpread = summary.netSpreadBps + shockBps * (weightedFedBeta / 100) * 0.42;

  const positionCols: Column<ReinvestmentPosition>[] = [
    { key: "instrument", header: "Instrument", render: (r) => <span className="font-semibold text-term-text">{r.instrument}</span>, sortVal: (r) => r.instrument },
    { key: "bucket", header: "Liq", align: "center", render: (r) => <Tag tone={BUCKET_TONE[r.bucket]}>{r.bucket}</Tag>, sortVal: (r) => r.bucket },
    { key: "credit", header: "Credit", align: "center", render: (r) => <Tag tone={CREDIT_TONE[r.credit]}>{r.credit}</Tag>, sortVal: (r) => r.credit },
    { key: "allocation", header: "Allocation", align: "right", render: (r) => <span className="text-term-text">{fmtUsdAbbr(r.allocation)}</span>, sortVal: (r) => r.allocation },
    { key: "yield", header: "Yield", align: "right", render: (r) => <span className="text-term-amber">{fmtBps(r.yieldBps, 0)}</span>, sortVal: (r) => r.yieldBps },
    { key: "wam", header: "WAM", align: "right", render: (r) => <span className="text-term-text-dim">{fmtNum(r.wamDays, 0)}d</span>, sortVal: (r) => r.wamDays },
    { key: "wal", header: "WAL", align: "right", render: (r) => <span className="text-term-text-dim">{fmtNum(r.walDays, 0)}d</span>, sortVal: (r) => r.walDays },
    {
      key: "util",
      header: "Limit Use",
      width: "130px",
      render: (r) => <ProgressBar value={r.utilizationPct} color={r.utilizationPct > 85 ? "#FF3B3B" : r.utilizationPct > 70 ? "#FF8C00" : "#2ECC71"} showPct />,
      sortVal: (r) => r.utilizationPct,
    },
  ];

  const constraintCols: Column<ReinvestmentConstraint>[] = [
    { key: "constraint", header: "Constraint", render: (r) => <span className="text-term-text">{r.constraint}</span>, sortVal: (r) => r.constraint },
    { key: "current", header: "Current", align: "right", render: (r) => <span className="text-term-text">{formatConstraint(r, r.current)}</span>, sortVal: (r) => r.current },
    { key: "limit", header: "Limit", align: "right", render: (r) => <span className="text-term-text-dim">{formatConstraint(r, r.limit)}</span>, sortVal: (r) => r.limit },
    {
      key: "usage",
      header: "Usage",
      width: "130px",
      render: (r) => <ProgressBar value={r.unit === "days" ? r.current : Math.min(r.current, r.limit)} max={r.limit} color={STATUS_TONE[r.status] === "down" ? "#FF3B3B" : STATUS_TONE[r.status] === "amber" ? "#FF8C00" : "#2ECC71"} showPct />,
      sortVal: (r) => r.current / r.limit,
    },
    { key: "status", header: "Status", align: "center", render: (r) => <Tag tone={STATUS_TONE[r.status]}>{r.status}</Tag>, sortVal: (r) => r.status },
  ];

  const recCols: Column<ReinvestmentRecommendation>[] = [
    { key: "action", header: "Action", align: "center", render: (r) => <Tag tone={r.action === "ADD" ? "up" : r.action === "TRIM" ? "down" : "amber"}>{r.action}</Tag>, sortVal: (r) => r.action },
    { key: "target", header: "Target", render: (r) => <span className="font-semibold text-term-text">{r.target}</span>, sortVal: (r) => r.target },
    { key: "rationale", header: "Rationale", render: (r) => <span className="text-term-text-dim">{r.rationale}</span>, sortVal: (r) => r.rationale },
    { key: "impact", header: "Impact", align: "right", render: (r) => <span className="text-term-up">{fmtUsdAbbr(r.impactUsd)}</span>, sortVal: (r) => r.impactUsd },
    { key: "priority", header: "Pri", align: "center", render: (r) => <Tag tone={PRIORITY_TONE[r.priority]}>{r.priority}</Tag>, sortVal: (r) => r.priority },
  ];

  const donutSegments = positions.map((p, i) => ({ value: p.allocation, color: DONUT_COLORS[i % DONUT_COLORS.length], label: p.instrument }));
  const incomeSeries = scenarios.map((s) => summary.monthlyIncome + s.incomeImpact / 12);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="REINV" title="Cash Collateral Reinvestment" desc="Yield ladder, Fed beta, liquidity and constraints" right={<span className="flex items-center gap-1"><ProvenanceBadge source={anyLive ? "FRED" : "SIM"} />{!anyLive && <Tag tone="amber">FRED/YAHOO READY</Tag>}</span>} />

      <KpiStrip>
        <Stat label="Cash Collateral" value={fmtUsdAbbr(summary.cashCollateral)} sub="reinvestment pool" />
        <Stat label="Reinvest Yield" value={fmtBps(liveKpis.reinvestYieldBps, 0)} sub="asset weighted" tone="amber" />
        <Stat label="Rebate Cost" value={fmtBps(summary.rebateCostBps, 0)} sub="client payable" />
        <Stat label="Net Spread" value={fmtBps(liveKpis.netSpreadBps, 0)} sub="yield minus rebate" tone="up" />
        <Stat label="WAM" value={`${fmtNum(liveKpis.wamDays, 0)}d`} sub="weighted avg maturity" />
        <Stat label="T+0 Liquidity" value={fmtUsdAbbr(liveKpis.t0Liquidity)} sub={fmtPct((liveKpis.t0Liquidity / summary.cashCollateral) * 100, 1)} tone="up" />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        <Panel title="Reinvestment Ladder" code="LADR" className="xl:col-span-2" right={<Tag tone="blue">{positions.length} legs</Tag>}>
          <DataGrid columns={positionCols} rows={positions} rowKey={(r) => r.instrument} maxHeight="315px" initialSort={{ key: "allocation", dir: "desc" }} zebra />
        </Panel>

        <Panel title="Allocation Mix" code="MIX">
          <div className="flex items-center gap-3 p-3">
            <Donut segments={donutSegments} size={128} center={fmtUsdAbbr(summary.cashCollateral)} centerSub="cash" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {positions.slice(0, 6).map((p, i) => (
                <div key={p.instrument} className="flex items-center gap-1.5 text-2xs">
                  <span className="h-2 w-2 shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                  <span className="min-w-0 flex-1 truncate text-term-text-dim">{p.instrument}</span>
                  <span className="tnum text-term-text">{fmtAbbr(p.allocation)}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Fed Path Shock" code="BETA" accent>
          <div className="grid grid-cols-1 gap-2 p-2 md:grid-cols-[260px_1fr]">
            <div>
              <div className="mb-1 flex justify-between text-2xs">
                <span className="text-term-text-dim">Policy Shock</span>
                <span className="tnum text-term-amber">{fmtBps(shockBps, 0)}</span>
              </div>
              <input
                type="range"
                min={-150}
                max={75}
                step={25}
                value={shockBps}
                onChange={(e) => setShockBps(Number(e.target.value))}
                className="w-full accent-term-amber"
              />
              <div className="mt-2 grid grid-cols-2 gap-px bg-term-border">
                <Stat label="Fed Beta" value={fmtPct(weightedFedBeta, 0)} className="bg-term-panel" />
                <Stat label="Stressed Spread" value={fmtBps(stressedSpread, 0)} tone={stressedSpread >= 0 ? "up" : "down"} className="bg-term-panel" />
                <Stat label="Monthly Carry" value={fmtUsdAbbr(summary.monthlyIncome)} className="bg-term-panel" />
                <Stat label="Shock Impact" value={fmtUsdAbbr(shockCarry)} tone={shockCarry >= 0 ? "up" : "down"} className="bg-term-panel" />
              </div>
            </div>
            <div>
              <LineChart height={155} yFmt={(n) => fmtUsdAbbr(n)} labels={scenarios.map((s) => s.scenario)} series={[{ name: "Monthly Income", data: incomeSeries, color: "#FF8C00", area: true }]} />
              <div className="mt-1 grid grid-cols-5 gap-px bg-term-border">
                {scenarios.map((s) => (
                  <div key={s.scenario} className="bg-term-panel px-2 py-1">
                    <div className="truncate text-3xs uppercase text-term-text-mute">{s.scenario}</div>
                    <div className={pnlClass(s.incomeImpact)}>{fmtUsdAbbr(s.incomeImpact)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Scenario Income Impact" code="SCEN">
          <div className="p-2">
            <BarChart horizontal data={scenarios.map((s) => ({ label: s.scenario, value: s.incomeImpact, color: s.color }))} fmt={(n) => fmtUsdAbbr(n)} />
          </div>
        </Panel>

        <Panel title="Liquidity And Investment Constraints" code="CSTR" className="xl:col-span-2">
          <DataGrid columns={constraintCols} rows={constraints} rowKey={(r) => r.constraint} maxHeight="240px" initialSort={{ key: "usage", dir: "desc" }} zebra />
        </Panel>

        <Panel title="Recommended Ladder Actions" code="ACTN" className="xl:col-span-3" right={<Tag tone="down">{recommendations.filter((r) => r.priority === "HIGH").length} high</Tag>}>
          <DataGrid columns={recCols} rows={recommendations} rowKey={(r) => `${r.action}-${r.target}`} maxHeight="260px" initialSort={{ key: "impact", dir: "desc" }} zebra />
        </Panel>
      </div>
    </div>
  );
}
