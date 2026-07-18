
import { useState, useMemo } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ChartLink } from "@/components/charting/ChartLink";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { BarChart } from "@/components/charts/BarChart";
import { HeatGrid } from "@/components/charts/Matrix";
import { ProgressBar } from "@/components/charts/Radial";
import {
  getDeskPlaybooks,
  getRegimeExposures,
  getRegimeFactors,
  getRegimeSummary,
  getRegimeTransitions,
  getImpulseScores,
  getNamedRegime,
  getCrossDeskPlaybooks,
  mergeLiveRegimeFactors,
  computeLiveRegimeSummary,
  REGIME_FRED_IDS,
  type DeskPlaybook,
  type RegimeExposure,
  type RegimeFactor,
  type RegimeTransition,
  type ImpulseScore,
  type CrossDeskPlaybook,
} from "@/data/macroRegime";
import { isRealEconSource, useLiveSeriesSet } from "@/lib/useEcon";
import { fmtBps, fmtNum, fmtPct, fmtUsdAbbr, pnlClass } from "@/lib/format";

const SIGNAL_TONE: Record<RegimeFactor["signal"], "up" | "amber" | "neutral"> = {
  SUPPORTS: "up",
  CONFLICTS: "amber",
  NEUTRAL: "neutral",
};

const URGENCY_TONE: Record<DeskPlaybook["urgency"], "down" | "amber" | "neutral"> = {
  HIGH: "down",
  MED: "amber",
  LOW: "neutral",
};

const BIAS_TONE: Record<RegimeExposure["recommendedBias"], "up" | "amber" | "down"> = {
  ADD_RISK: "up",
  HOLD: "amber",
  DEFEND: "down",
};

const DIR_TONE: Record<ImpulseScore["direction"], "up" | "amber" | "down"> = {
  Accelerating: "down",
  Stable: "amber",
  Decelerating: "up",
};

function factorValue(f: RegimeFactor): string {
  if (f.factor.includes("OAS") || f.factor.includes("spread") || f.factor.includes("slope")) return fmtBps(f.value, 0);
  if (f.factor.includes("return") || f.factor.includes("drawdown")) return fmtPct(f.value, 1);
  return fmtNum(f.value, 1);
}

export default function RegimePage() {
  const { data: regimeFred, source } = useLiveSeriesSet([...REGIME_FRED_IDS], "lin", 60);
  const anyReal = REGIME_FRED_IDS.some((id) => isRealEconSource(regimeFred[id]?.source));
  const simFactors = getRegimeFactors();
  const factors = useMemo(() => mergeLiveRegimeFactors(simFactors, regimeFred), [simFactors, regimeFred]);
  const summary = useMemo(() => anyReal ? computeLiveRegimeSummary(factors) : getRegimeSummary(), [anyReal, factors]);
  const playbooks = getDeskPlaybooks();
  const transitions = getRegimeTransitions();
  const exposures = getRegimeExposures();
  const impulses = getImpulseScores();
  const namedRegime = getNamedRegime();
  const crossPlaybooks = getCrossDeskPlaybooks();

  const [deskFilter, setDeskFilter] = useState("ALL");
  const allDesks = useMemo(() => [...new Set([...playbooks.map((p) => p.desk), ...crossPlaybooks.map((p) => p.desk)])].sort(), [playbooks, crossPlaybooks]);
  const deskOptions = useMemo(() => [{ value: "ALL", label: "All Desks" }, ...allDesks.map((d) => ({ value: d, label: d }))], [allDesks]);
  const filteredPlaybooks = deskFilter === "ALL" ? playbooks : playbooks.filter((p) => p.desk === deskFilter);
  const filteredCrossPlaybooks = deskFilter === "ALL" ? crossPlaybooks : crossPlaybooks.filter((p) => p.desk === deskFilter);

  const factorCols: Column<RegimeFactor>[] = [
    { key: "factor", header: "Factor", render: (r) => <span className="font-semibold text-term-text">{r.factor}</span>, sortVal: (r) => r.factor },
    { key: "source", header: "Source", align: "center", render: (r) => <Tag tone={r.source === "FRED" ? "up" : r.source === "YAHOO" ? "blue" : "neutral"}>{r.source}</Tag>, sortVal: (r) => r.source },
    { key: "value", header: "Value", align: "right", render: (r) => <span className="text-term-text">{factorValue(r)}</span>, sortVal: (r) => r.value },
    { key: "z", header: "Z", align: "right", render: (r) => <span className={pnlClass(r.zScore)}>{fmtNum(r.zScore, 1)}</span>, sortVal: (r) => r.zScore },
    { key: "signal", header: "Signal", align: "center", render: (r) => <Tag tone={SIGNAL_TONE[r.signal]}>{r.signal}</Tag>, sortVal: (r) => r.signal },
    { key: "weight", header: "Weight", align: "right", render: (r) => <span className="text-term-amber">{fmtPct(r.weight, 0)}</span>, sortVal: (r) => r.weight },
    { key: "state", header: "State Link", align: "center", render: (r) => <Tag tone="violet">{r.stateLink.replace("_", " ")}</Tag>, sortVal: (r) => r.stateLink },
  ];

  const playbookCols: Column<DeskPlaybook>[] = [
    { key: "desk", header: "Desk", align: "center", render: (r) => <Tag tone="blue">{r.desk}</Tag>, sortVal: (r) => r.desk },
    { key: "action", header: "Action", render: (r) => <span className="font-semibold text-term-text">{r.action}</span>, sortVal: (r) => r.action },
    { key: "rationale", header: "Rationale", render: (r) => <span className="text-term-text-dim">{r.rationale}</span>, sortVal: (r) => r.rationale },
    { key: "factor", header: "Factor", render: (r) => <span className="text-term-amber">{r.linkedFactor}</span>, sortVal: (r) => r.linkedFactor },
    { key: "impact", header: "Impact", align: "right", render: (r) => <span className="text-term-up">{fmtUsdAbbr(r.expectedImpact)}</span>, sortVal: (r) => r.expectedImpact },
    { key: "urgency", header: "Urg", align: "center", render: (r) => <Tag tone={URGENCY_TONE[r.urgency]}>{r.urgency}</Tag>, sortVal: (r) => r.urgency },
  ];

  const crossCols: Column<CrossDeskPlaybook>[] = [
    { key: "desk", header: "Desk", align: "center", render: (r) => <Tag tone="blue">{r.desk}</Tag>, sortVal: (r) => r.desk },
    { key: "action", header: "Action", render: (r) => <span className="font-semibold text-term-text">{r.action}</span>, sortVal: (r) => r.action },
    { key: "rationale", header: "Rationale", render: (r) => <span className="text-term-text-dim">{r.rationale}</span>, sortVal: (r) => r.rationale },
    { key: "impactBps", header: "Impact", align: "right", render: (r) => <span className="text-term-amber">{fmtBps(r.impactBps, 0)}</span>, sortVal: (r) => r.impactBps },
    { key: "urgency", header: "Urg", align: "center", render: (r) => <Tag tone={URGENCY_TONE[r.urgency]}>{r.urgency}</Tag>, sortVal: (r) => r.urgency },
  ];

  const transitionCols: Column<RegimeTransition>[] = [
    { key: "to", header: "Next State", render: (r) => <Tag tone={r.to === "RISK_OFF" || r.to === "RECESSION_WATCH" ? "down" : r.to === "RISK_ON" ? "up" : "amber"}>{r.to.replace("_", " ")}</Tag>, sortVal: (r) => r.to },
    { key: "prob", header: "Prob", align: "right", render: (r) => <span className="text-term-amber">{fmtPct(r.probability, 0)}</span>, sortVal: (r) => r.probability },
    { key: "trigger", header: "Trigger", render: (r) => <span className="text-term-text-dim">{r.trigger}</span>, sortVal: (r) => r.trigger },
  ];

  const exposureCols: Column<RegimeExposure>[] = [
    { key: "desk", header: "Desk", align: "center", render: (r) => <Tag tone="blue">{r.desk}</Tag>, sortVal: (r) => r.desk },
    { key: "carry", header: "Carry", align: "right", render: (r) => <span className={pnlClass(r.carryImpact)}>{fmtUsdAbbr(r.carryImpact)}</span>, sortVal: (r) => r.carryImpact },
    { key: "margin", header: "Margin", align: "right", render: (r) => <span className={pnlClass(r.marginImpact)}>{fmtUsdAbbr(r.marginImpact)}</span>, sortVal: (r) => r.marginImpact },
    { key: "liquidity", header: "Liquidity", align: "right", render: (r) => <span className={pnlClass(r.liquidityImpact)}>{fmtUsdAbbr(r.liquidityImpact)}</span>, sortVal: (r) => r.liquidityImpact },
    { key: "bias", header: "Bias", align: "center", render: (r) => <Tag tone={BIAS_TONE[r.recommendedBias]}>{r.recommendedBias.replace("_", " ")}</Tag>, sortVal: (r) => r.recommendedBias },
  ];

  const matrixLabels = exposures.map((e) => e.desk);
  const matrixValues = exposures.map((e) => [e.carryImpact / 1e6, e.marginImpact / 1e6, e.liquidityImpact / 1e6]);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="REGIME" title="Macro Regime Playbook" desc="Impulse scores · named regimes · cross-desk actions" right={<span className="flex items-center gap-2"><ChartLink refs={[{ source: "econ", id: "UNRATE" }, { source: "econ", id: "T10Y2Y" }, { source: "econ", id: "VIXCLS" }]} range="5Y" /><ProvenanceBadge source={anyReal && isRealEconSource(source) ? source : "SIM"} /></span>} />

      <KpiStrip>
        <Stat label="Named Regime" value={namedRegime.regime} sub={`${fmtPct(namedRegime.probability, 0)} prob`} tone="amber" />
        <Stat label="Policy State" value={summary.state.replace("_", " ")} sub={`${fmtPct(summary.probability, 0)} confidence`} />
        <Stat label="Growth" value={fmtNum(summary.growthScore, 0)} sub="momentum" tone={summary.growthScore < 50 ? "down" : "up"} />
        <Stat label="Inflation" value={fmtNum(summary.inflationScore, 0)} sub="pressure" tone={summary.inflationScore > 60 ? "down" : "neutral"} />
        <Stat label="Liquidity" value={fmtNum(summary.liquidityScore, 0)} sub="funding backdrop" tone="up" />
        <Stat label="Policy Bias" value={summary.policyBias} sub={`${summary.activePlaybooks} playbooks`} tone={summary.policyBias === "DOVISH" ? "up" : summary.policyBias === "HAWKISH" ? "down" : "neutral"} />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        {/* Impulse Scores */}
        <Panel title="Macro Impulse Scores" code="IMP" accent>
          <div className="divide-y divide-term-border-soft">
            {impulses.map((imp) => (
              <div key={imp.label} className="px-3 py-2">
                <div className="mb-1 flex items-center justify-between text-2xs">
                  <span className="font-semibold text-term-text">{imp.label}</span>
                  <span className="flex items-center gap-2">
                    <Tag tone={DIR_TONE[imp.direction]}>{imp.direction}</Tag>
                    <Tag tone={imp.source === "FRED" ? "up" : imp.source === "YAHOO" ? "blue" : "neutral"}>{imp.source}</Tag>
                  </span>
                </div>
                <ProgressBar value={imp.value} color={imp.value >= 65 ? "#FF3B3B" : imp.value >= 45 ? "#FF8C00" : "#2ECC71"} height={6} showPct />
                <div className="mt-1 text-3xs text-term-text-mute">{imp.detail}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Named Regime Probabilities */}
        <Panel title="Named Regime Probabilities" code="NREG" className="xl:col-span-2">
          <div className="grid grid-cols-1 gap-2 p-2 lg:grid-cols-[1fr_1fr]">
            <div>
              <BarChart
                horizontal
                data={namedRegime.history.map((r) => ({
                  label: r.regime,
                  value: r.probability,
                  color: r.regime === namedRegime.regime ? "#FF8C00" : "#3B9DFF",
                }))}
                fmt={(n) => `${n.toFixed(0)}%`}
              />
            </div>
            <div className="flex flex-col justify-center gap-2 text-2xs">
              <div className="flex items-center gap-2">
                <span className="text-term-text-mute">Current Regime:</span>
                <Tag tone="amber">{namedRegime.regime}</Tag>
                <span className="tnum text-term-text">{namedRegime.probability}%</span>
              </div>
              <p className="text-term-text-dim">{namedRegime.drivers}</p>
            </div>
          </div>
        </Panel>

        {/* Regime Factor Stack */}
        <Panel title="Regime Factor Stack" code="FACT" className="xl:col-span-2">
          <DataGrid columns={factorCols} rows={factors} rowKey={(r) => r.factor} maxHeight="300px" initialSort={{ key: "weight", dir: "desc" }} zebra />
        </Panel>

        <Panel title="Factor Weights" code="WGHT">
          <div className="p-2">
            <BarChart horizontal data={factors.map((f) => ({ label: f.factor, value: f.weight, color: f.signal === "SUPPORTS" ? "#2ECC71" : f.signal === "CONFLICTS" ? "#FF8C00" : "#3B9DFF" }))} fmt={(n) => fmtPct(n, 0)} />
          </div>
        </Panel>

        {/* Cross-Desk Playbooks (Agency/Prime/E-Trading/Repo/Financing/Treasury) */}
        <Panel
          title="Cross-Desk Regime Playbooks"
          code="XPLAY"
          className="xl:col-span-3"
          accent
          toolbar={<TermToggleGroup label="Desk" value={deskFilter} onChange={setDeskFilter} options={deskOptions} size="sm" />}
          right={<span className="text-3xs text-term-text-mute">actions for {namedRegime.regime} regime</span>}
        >
          <DataGrid columns={crossCols} rows={filteredCrossPlaybooks} rowKey={(r) => r.desk} maxHeight="340px" initialSort={{ key: "urgency", dir: "desc" }} zebra />
        </Panel>

        {/* Sec-Finance Desk Playbooks */}
        <Panel title="Sec-Finance Playbooks" code="PLAY" className="xl:col-span-3" right={<Tag tone="down">{filteredPlaybooks.filter((p) => p.urgency === "HIGH").length} high</Tag>}>
          <DataGrid columns={playbookCols} rows={filteredPlaybooks} rowKey={(r) => `${r.desk}-${r.action}`} maxHeight="340px" initialSort={{ key: "impact", dir: "desc" }} zebra />
        </Panel>

        <Panel title="Transition Risk" code="TRAN">
          <DataGrid columns={transitionCols} rows={transitions} rowKey={(r) => r.to} maxHeight="260px" initialSort={{ key: "prob", dir: "desc" }} zebra />
        </Panel>

        <Panel title="Desk Exposure Matrix" code="EXPO" className="xl:col-span-2">
          <div className="grid grid-cols-1 gap-2 p-2 lg:grid-cols-[1fr_260px]">
            <DataGrid columns={exposureCols} rows={exposures} rowKey={(r) => r.desk} maxHeight="240px" zebra />
            <HeatGrid rows={matrixLabels} cols={["Carry", "Margin", "Liquidity"]} values={matrixValues} fmt={(n) => fmtUsdAbbr(n * 1e6)} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
