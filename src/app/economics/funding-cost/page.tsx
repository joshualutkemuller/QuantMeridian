
import { useCallback, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { FileDown } from "lucide-react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { DataLegend } from "@/components/ui/DataLegend";
import { isRealEconSource, useLiveSeriesSet, type DataSource , useMacroInputs } from "@/lib/useEcon";
import { fmtSigned, pnlClass } from "@/lib/format";
import { generateFundingCostPdf } from "@/lib/fundingCostPdf";
import {
  BENCHMARK_FRED_IDS,
  buildFallback, buildFallbackWithAnchors,
  type SeriesMap,
} from "@/data/benchmarkRates";
import {
  DEFAULT_TIERS,
  computeTierCosts,
  computeDeskFunding,
  computeTermLadder,
  computeTierSpreads,
  computeFundingCostSummary,
  classifyFundingRegime,
  type TierCost,
  type DeskFundingProfile,
  type TermFundingLadder,
  type TierSpreadResult,
  type FundingRegime,
} from "@/data/fundingCost";

const REGIME_TONE: Record<FundingRegime, "up" | "down" | "amber" | "neutral"> = {
  Tight: "up",
  Normal: "neutral",
  Wide: "amber",
  Stress: "down",
};

const SIGNAL_TONE: Record<string, "up" | "down" | "neutral"> = {
  cheap: "up", normal: "neutral", expensive: "down",
};

type Tab = "dashboard" | "desk" | "spreads";
const TABS: { value: Tab; label: string }[] = [
  { value: "dashboard", label: "Cost Dashboard" },
  { value: "desk", label: "Desk Attribution" },
  { value: "spreads", label: "Spread Analysis" },
];

export default function FundingCostPage() {
  const { data: macroInputs } = useMacroInputs();
  const fallback = useMemo<SeriesMap>(() => macroInputs ? buildFallbackWithAnchors(macroInputs.benchmarks, 520) : {}, [macroInputs]);
  const { data: live, source } = useLiveSeriesSet(BENCHMARK_FRED_IDS, "lin", 520);

  const map = useMemo<SeriesMap>(() => {
    const m: SeriesMap = { ...fallback };
    for (const id of BENCHMARK_FRED_IDS) {
      const L = live[id];
      if (L && isRealEconSource(L.source) && L.observations.length) m[id] = L.observations;
    }
    return m;
  }, [live, fallback]);

  const anyReal = BENCHMARK_FRED_IDS.some((id) => isRealEconSource(live[id]?.source));
  const badgeSource: DataSource = anyReal && isRealEconSource(source) ? source : "SIM";

  const [tab, setTab] = useState<Tab>("dashboard");

  const tierChartRef = useRef<HTMLDivElement>(null);
  const deskChartRef = useRef<HTMLDivElement>(null);
  const spreadChartRef = useRef<HTMLDivElement>(null);

  const costs = useMemo(() => computeTierCosts(map), [map]);
  const desks = useMemo(() => computeDeskFunding(map), [map]);
  const ladder = useMemo(() => computeTermLadder(map), [map]);
  const spreads = useMemo(() => computeTierSpreads(costs), [costs]);
  const summary = useMemo(() => computeFundingCostSummary(map), [map]);
  const { regime, score: regimeScore } = useMemo(() => classifyFundingRegime(costs), [costs]);

  const handlePdf = useCallback(async () => {
    await generateFundingCostPdf({
      costs, desks, ladder, spreads, regime, regimeScore,
      source: badgeSource,
      tab,
      tierChartRef: tierChartRef.current,
      deskChartRef: deskChartRef.current,
      spreadChartRef: spreadChartRef.current,
    });
  }, [costs, desks, ladder, spreads, regime, regimeScore, badgeSource, tab]);

  return (
    <>
      <PageHeader
        code="FCOST"
        title="Funding Cost Monitor"
        right={
          <div className="flex items-center gap-2">
            <ProvenanceBadge source={badgeSource} />
            <button onClick={handlePdf} className="term-btn flex items-center gap-1 text-2xs">
              <FileDown size={12} /> PDF
            </button>
          </div>
        }
      />
      <KpiStrip>
        <Stat label="Secured" value={summary.securedRate != null ? `${summary.securedRate.toFixed(2)}%` : "—"} />
        <Stat label="AA All-In" value={summary.aaAllIn != null ? `${summary.aaAllIn.toFixed(2)}%` : "—"} />
        <Stat label="BBB All-In" value={summary.bbbAllIn != null ? `${summary.bbbAllIn.toFixed(2)}%` : "—"} />
        <Stat label="HY All-In" value={summary.hyAllIn != null ? `${summary.hyAllIn.toFixed(2)}%` : "—"} />
        <Stat label="IG-HY Δ20D" value={summary.spreadCompression != null ? `${fmtSigned(summary.spreadCompression, 0)}bps` : "—"} tone={summary.spreadCompression != null && summary.spreadCompression > 10 ? "down" : summary.spreadCompression != null && summary.spreadCompression < -10 ? "up" : "neutral"} />
        <Stat label="Regime" value={regime} tone={REGIME_TONE[regime]} />
      </KpiStrip>

      <div className="mt-1 flex items-center gap-3 px-1">
        <TermToggleGroup value={tab} onChange={setTab} options={TABS} size="sm" />
      </div>

      <div className="mt-1 grid grid-cols-12 gap-1 px-1 pb-4">
        {tab === "dashboard" && <DashboardTab costs={costs} ladder={ladder} regime={regime} regimeScore={regimeScore} tierChartRef={tierChartRef} />}
        {tab === "desk" && <DeskTab desks={desks} costs={costs} deskChartRef={deskChartRef} />}
        {tab === "spreads" && <SpreadTab spreads={spreads} regime={regime} regimeScore={regimeScore} spreadChartRef={spreadChartRef} />}
      </div>

      <div className="px-1 pb-4">
        <DataLegend />
      </div>
    </>
  );
}

// ── Dashboard Tab ───────────────────────────────────────────────────

function DashboardTab({
  costs, ladder, regime, regimeScore, tierChartRef,
}: {
  costs: TierCost[];
  ladder: TermFundingLadder[];
  regime: FundingRegime;
  regimeScore: number;
  tierChartRef: React.RefObject<HTMLDivElement>;
}) {
  const tierCols: Column<TierCost>[] = useMemo(() => [
    { key: "tier", header: "Tier", width: "140px", render: (r) => (
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.tier.color }} />
        <span className="font-medium">{r.tier.label}</span>
      </div>
    ), sortVal: (r) => r.tier.id },
    { key: "base", header: "Base (%)", align: "right", width: "80px", render: (r) => r.baseRate != null ? r.baseRate.toFixed(2) : "—", sortVal: (r) => r.baseRate ?? 0 },
    { key: "spread", header: "Spread (bps)", align: "right", width: "90px", render: (r) => r.spreadBps != null ? r.spreadBps.toFixed(0) : "—", sortVal: (r) => r.spreadBps ?? 0 },
    { key: "allin", header: "All-In (%)", align: "right", width: "80px", render: (r) => r.allInRate != null ? <span className="font-medium">{r.allInRate.toFixed(2)}</span> : "—", sortVal: (r) => r.allInRate ?? 0 },
    { key: "chg1d", header: "Chg 1D", align: "right", width: "65px", render: (r) => r.chg1d != null ? <span className={pnlClass(r.chg1d)}>{fmtSigned(r.chg1d, 1)}</span> : "—", sortVal: (r) => r.chg1d ?? 0 },
    { key: "chg20d", header: "Chg 20D", align: "right", width: "65px", render: (r) => r.chg20d != null ? <span className={pnlClass(r.chg20d)}>{fmtSigned(r.chg20d, 1)}</span> : "—", sortVal: (r) => r.chg20d ?? 0 },
    { key: "pct", header: "Pctl", align: "right", width: "50px", render: (r) => r.percentile != null ? `${r.percentile}%` : "—", sortVal: (r) => r.percentile ?? 0 },
    { key: "z", header: "Z-Score", align: "right", width: "65px", render: (r) => r.zScore != null ? r.zScore.toFixed(2) : "—", sortVal: (r) => r.zScore ?? 0 },
  ], []);

  const ladderCols: Column<TermFundingLadder>[] = useMemo(() => [
    { key: "tenor", header: "Tenor", width: "60px", render: (r) => <span className="font-medium">{r.tenor}</span>, sortVal: (r) => r.years },
    { key: "sec", header: "Secured", align: "right", width: "75px", render: (r) => r.secured != null ? `${r.secured.toFixed(2)}%` : "—", sortVal: (r) => r.secured ?? 0 },
    { key: "aa", header: "AA", align: "right", width: "75px", render: (r) => r.aa != null ? `${r.aa.toFixed(2)}%` : "—", sortVal: (r) => r.aa ?? 0 },
    { key: "bbb", header: "BBB", align: "right", width: "75px", render: (r) => r.bbb != null ? `${r.bbb.toFixed(2)}%` : "—", sortVal: (r) => r.bbb ?? 0 },
    { key: "hy", header: "HY", align: "right", width: "75px", render: (r) => r.hy != null ? `${r.hy.toFixed(2)}%` : "—", sortVal: (r) => r.hy ?? 0 },
  ], []);

  const chartSeries = useMemo(() => {
    return costs.filter((c) => c.history.length > 0).map((c) => ({
      name: c.tier.id,
      data: c.history.slice(-260),
      color: c.tier.color,
    }));
  }, [costs]);

  const chartLabels = useMemo(() => {
    const c = costs.find((c) => c.dates.length > 0);
    return c?.dates.slice(-260) ?? [];
  }, [costs]);

  return (
    <>
      <div className="col-span-12 xl:col-span-8">
        <Panel title="Tier Cost Comparison" code="TCST">
          <DataGrid
            columns={tierCols}
            rows={costs}
            rowKey={(r) => r.tier.id}
            maxHeight="300px"
            zebra
          />
        </Panel>
      </div>

      <div className="col-span-12 xl:col-span-4">
        <Panel title="Funding Regime" code="FRGM">
          <div className="p-3 space-y-3">
            <div className="text-center">
              <div className={clsx("text-3xl font-bold",
                REGIME_TONE[regime] === "up" ? "text-emerald-400" :
                REGIME_TONE[regime] === "down" ? "text-red-400" :
                REGIME_TONE[regime] === "amber" ? "text-amber-400" : "text-term-text-dim"
              )}>
                {regime}
              </div>
              <div className="text-2xs text-term-text-dim mt-1">Score: {regimeScore}/100</div>
            </div>

            <div className="h-3 bg-term-panel-3 rounded-sm relative overflow-hidden">
              <div
                className={clsx("absolute inset-y-0 left-0 rounded-sm",
                  regimeScore >= 75 ? "bg-red-500" : regimeScore >= 60 ? "bg-amber-500" : regimeScore >= 40 ? "bg-blue-500" : "bg-emerald-500"
                )}
                style={{ width: `${regimeScore}%` }}
              />
              {[40, 60, 75].map((t) => (
                <div key={t} className="absolute inset-y-0 w-px bg-term-border" style={{ left: `${t}%` }} />
              ))}
            </div>
            <div className="flex justify-between text-3xs text-term-text-dim">
              <span>Tight</span><span>Normal</span><span>Wide</span><span>Stress</span>
            </div>
          </div>

          <div className="border-t border-term-border p-2">
            <BarChart
              data={costs.map((c) => ({
                label: c.tier.id,
                value: c.allInRate ?? 0,
                color: c.tier.color,
              }))}
              height={140}
              fmt={(n) => `${n.toFixed(2)}%`}
            />
          </div>
        </Panel>
      </div>

      <div className="col-span-12">
        <Panel title="All-In Rate History" code="AIRHX">
          <div ref={tierChartRef}>
            {chartSeries.length > 0 && (
              <LineChart
                series={chartSeries}
                labels={chartLabels}
                height={220}
                yFmt={(n) => `${n.toFixed(1)}%`}
              />
            )}
          </div>
        </Panel>
      </div>

      <div className="col-span-12">
        <Panel title="Term Funding Ladder" code="TFLDR">
          <DataGrid
            columns={ladderCols}
            rows={ladder}
            rowKey={(r) => r.tenor}
            zebra
          />
          <div className="p-2">
            <LadderHeatmap ladder={ladder} />
          </div>
        </Panel>
      </div>
    </>
  );
}

// ── Desk Tab ────────────────────────────────────────────────────────

function DeskTab({
  desks, costs, deskChartRef,
}: {
  desks: DeskFundingProfile[];
  costs: TierCost[];
  deskChartRef: React.RefObject<HTMLDivElement>;
}) {
  const deskCols: Column<DeskFundingProfile>[] = useMemo(() => [
    { key: "desk", header: "Desk", width: "130px", render: (r) => <span className="font-medium">{r.label}</span>, sortVal: (r) => r.label },
    { key: "tier", header: "Primary Tier", width: "90px", render: (r) => <Tag tone="neutral">{r.primaryTier}</Tag>, sortVal: (r) => r.primaryTier },
    { key: "cost", header: "Cost (bps)", align: "right", width: "85px", render: (r) => r.weightedCostBps != null ? <span className="font-medium">{r.weightedCostBps.toFixed(0)}</span> : "—", sortVal: (r) => r.weightedCostBps ?? 0 },
    { key: "vs1d", header: "vs 1D", align: "right", width: "65px", render: (r) => r.vsYesterday != null ? <span className={pnlClass(r.vsYesterday)}>{fmtSigned(r.vsYesterday, 1)}</span> : "—", sortVal: (r) => r.vsYesterday ?? 0 },
    { key: "vs20d", header: "vs 20D", align: "right", width: "65px", render: (r) => r.vs20dAgo != null ? <span className={pnlClass(r.vs20dAgo)}>{fmtSigned(r.vs20dAgo, 1)}</span> : "—", sortVal: (r) => r.vs20dAgo ?? 0 },
    { key: "signal", header: "Signal", width: "80px", render: (r) => (
      <Tag tone={SIGNAL_TONE[r.signal]}>{r.signal.toUpperCase()}</Tag>
    ), sortVal: (r) => r.vs20dAgo ?? 0 },
  ], []);

  return (
    <>
      <div className="col-span-12 xl:col-span-7">
        <Panel title="Desk Funding Attribution" code="DFND">
          <DataGrid
            columns={deskCols}
            rows={desks}
            rowKey={(r) => r.desk}
            initialSort={{ key: "cost", dir: "desc" }}
            zebra
          />
        </Panel>
      </div>

      <div className="col-span-12 xl:col-span-5">
        <Panel title="Desk Cost Comparison" code="DCMP">
          <div ref={deskChartRef}>
            <BarChart
              data={desks.map((d) => ({
                label: d.label,
                value: d.weightedCostBps ?? 0,
                color: d.signal === "expensive" ? "#FF3B3B" : d.signal === "cheap" ? "#2ECC71" : "#3B9DFF",
              }))}
              horizontal
              height={200}
              fmt={(n) => `${n.toFixed(0)}bps`}
            />
          </div>
        </Panel>
      </div>

      <div className="col-span-12">
        <Panel title="Tier Breakdown by Desk" code="TBKD">
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-2 p-2">
            {desks.map((d) => (
              <div key={d.desk} className="border border-term-border rounded p-2">
                <div className="text-xs font-medium mb-1">{d.label}</div>
                <div className="space-y-1">
                  {d.tierBreakdown.map((b) => {
                    const tierDef = DEFAULT_TIERS.find((t) => t.id === b.tier);
                    return (
                      <div key={b.tier} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tierDef?.color ?? "#888" }} />
                        <span className="text-2xs text-term-text-dim w-14">{b.tier}</span>
                        <div className="flex-1 h-2 bg-term-panel-3 rounded-sm">
                          <div className="h-full rounded-sm" style={{ width: `${b.weight * 100}%`, backgroundColor: tierDef?.color ?? "#888", opacity: 0.6 }} />
                        </div>
                        <span className="text-2xs tnum w-10 text-right">{(b.weight * 100).toFixed(0)}%</span>
                        <span className="text-2xs tnum w-14 text-right">{b.costBps != null ? `${b.costBps.toFixed(0)}bps` : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

// ── Spread Tab ──────────────────────────────────────────────────────

function SpreadTab({
  spreads, regime, regimeScore, spreadChartRef,
}: {
  spreads: TierSpreadResult[];
  regime: FundingRegime;
  regimeScore: number;
  spreadChartRef: React.RefObject<HTMLDivElement>;
}) {
  const spreadCols: Column<TierSpreadResult>[] = useMemo(() => [
    { key: "label", header: "Spread", width: "140px", render: (r) => <span className="font-medium">{r.label}</span>, sortVal: (r) => r.label },
    { key: "current", header: "Current (bps)", align: "right", width: "100px", render: (r) => r.current != null ? <span className="font-medium">{r.current.toFixed(1)}</span> : "—", sortVal: (r) => r.current ?? 0 },
    { key: "mean", header: "Mean", align: "right", width: "70px", render: (r) => r.mean != null ? r.mean.toFixed(1) : "—", sortVal: (r) => r.mean ?? 0 },
    { key: "z", header: "Z-Score", align: "right", width: "70px", render: (r) => {
      if (r.zScore == null) return "—";
      const c = Math.abs(r.zScore) > 1.5 ? "text-amber-400" : Math.abs(r.zScore) > 2 ? "text-red-400" : "";
      return <span className={c}>{r.zScore.toFixed(2)}</span>;
    }, sortVal: (r) => r.zScore ?? 0 },
    { key: "pct", header: "Pctl", align: "right", width: "55px", render: (r) => r.percentile != null ? `${r.percentile}%` : "—", sortVal: (r) => r.percentile ?? 0 },
    { key: "dir", header: "Direction", width: "80px", render: (r) => (
      <Tag tone={r.trend.direction === "rising" ? "down" : r.trend.direction === "falling" ? "up" : "neutral"}>
        {r.trend.direction.toUpperCase()}
      </Tag>
    ), sortVal: (r) => r.trend.chg20d ?? 0 },
  ], []);

  const chartSeries = useMemo(() => {
    return spreads.filter((s) => s.history.length > 0).map((s, i) => ({
      name: s.label,
      data: s.history.slice(-260),
      color: ["#3B9DFF", "#FF8C00", "#2ECC71", "#A78BFA", "#FF3B3B"][i % 5],
    }));
  }, [spreads]);

  const chartLabels = useMemo(() => {
    const s = spreads.find((s) => s.dates.length > 0);
    return s?.dates.slice(-260) ?? [];
  }, [spreads]);

  return (
    <>
      <div className="col-span-12 xl:col-span-8">
        <Panel title="Tier Spread Statistics" code="TSPR">
          <DataGrid
            columns={spreadCols}
            rows={spreads}
            rowKey={(r) => r.label}
            zebra
          />
        </Panel>
      </div>

      <div className="col-span-12 xl:col-span-4">
        <Panel title="Funding Stress Gauge" code="FSTRS">
          <div className="p-3 space-y-3">
            <div className="text-center">
              <div className={clsx("text-2xl font-bold",
                REGIME_TONE[regime] === "up" ? "text-emerald-400" :
                REGIME_TONE[regime] === "down" ? "text-red-400" :
                REGIME_TONE[regime] === "amber" ? "text-amber-400" : "text-term-text-dim"
              )}>
                {regime}
              </div>
              <div className="text-2xs text-term-text-dim mt-1">Funding Stress Score: {regimeScore}</div>
            </div>

            <div className="space-y-2">
              {spreads.map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-28 text-2xs text-term-text-dim truncate">{s.label}</span>
                  <div className="flex-1 h-2.5 bg-term-panel-3 rounded-sm relative">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm bg-blue-500/50"
                      style={{ width: `${Math.min(100, (s.percentile ?? 50))}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-2xs tnum">{s.percentile ?? "—"}%</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="col-span-12">
        <Panel title="Tier Spread History" code="TSPHX">
          <div ref={spreadChartRef}>
            {chartSeries.length > 0 && (
              <LineChart
                series={chartSeries}
                labels={chartLabels}
                height={220}
                yFmt={(n) => `${n.toFixed(0)}bps`}
              />
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

// ── Shared Components ───────────────────────────────────────────────

function LadderHeatmap({ ladder }: { ladder: TermFundingLadder[] }) {
  const tiers = ["secured", "aa", "bbb", "hy"] as const;
  const tierLabels = ["Secured", "AA", "BBB", "HY"];
  const allVals = ladder.flatMap((l) => tiers.map((t) => l[t]).filter((v): v is number => v != null));
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  return (
    <table className="w-full text-2xs">
      <thead>
        <tr className="text-term-text-dim">
          <th className="text-left px-1 py-0.5 font-normal">Tenor</th>
          {tierLabels.map((l) => (
            <th key={l} className="text-right px-1 py-0.5 font-normal">{l}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ladder.map((l) => (
          <tr key={l.tenor} className="border-t border-term-border-soft">
            <td className="px-1 py-0.5 font-medium">{l.tenor}</td>
            {tiers.map((t) => {
              const val = l[t];
              if (val == null) return <td key={t} className="px-1 py-0.5 text-right text-term-text-dim">—</td>;
              const intensity = (val - minV) / range;
              return (
                <td key={t} className="px-1 py-0.5 text-right tnum" style={{
                  backgroundColor: `rgba(255, 140, 0, ${(0.08 + intensity * 0.5).toFixed(2)})`,
                }}>
                  {val.toFixed(2)}%
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
