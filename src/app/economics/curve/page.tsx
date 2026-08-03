
import { useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ChartLink } from "@/components/charting/ChartLink";
import { YieldCurve, type CurveLine } from "@/components/charts/YieldCurve";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { SourceBadge } from "@/components/econ/SourceBadge";
import { TermSelect } from "@/components/ui/TermSelect";
import { isRealEconSource, useCurveSnapshots, useInversions } from "@/lib/useEcon";
import {
  getCurveSnapshots,
  getCurveMetrics,
  currentSpreadBps,
  spreadDef,
  getInversionStats,
  SPREAD_DEFS,
  type CurveSnapshot,
  type CurvePoint,
  type Inversion,
} from "@/data/econCurve";
import { getTermFundingCarry, type TermFundingCarry } from "@/data/econEnhancements";
import {
  computeButterflies,
  computeButterfliesFromHistory,
  computeSpreadZScores,
  computeSpreadZFromHistory,
  computeCarryRoll,
  computeRealBreakeven,
  classifyCurveMove,
  type ButterflySpread,
  type SpreadZRow,
  type CarryRollRow,
  type RealBreakevenRow,
} from "@/data/ratesRV";
import { Sparkline } from "@/components/charts/Sparkline";
import { fmtNum, fmtSigned, fmtBps, fmtPct, fmtUsdAbbr, pnlClass } from "@/lib/format";

const PALETTE = ["#3B9DFF", "#2ECC71", "#A78BFA", "#22D3EE", "#EC4899", "#FFB400"];

/** Distinct, stable color per snapshot id — "now" is always amber. */
function colorFor(id: string, idx: number): string {
  if (id === "now") return "#FF8C00";
  return PALETTE[(idx + PALETTE.length - 1) % PALETTE.length];
}

function shapeTone(shape: string): "up" | "down" | "amber" | "neutral" | "blue" | "violet" {
  if (shape === "Inverted") return "down";
  if (shape === "Steep") return "up";
  if (shape === "Humped") return "violet";
  if (shape === "Flat") return "amber";
  return "neutral";
}

export default function TreasuryCurveLab() {
  // Real point-in-time snapshots (Today + historical) from each tenor's FRED
  // daily history; falls back to the simulated presets without a key.
  const { data: snapshots, source } = useCurveSnapshots();
  const fallbackSnapshots = getCurveSnapshots();
  const curveSnapshots = snapshots.length ? snapshots : fallbackSnapshots;
  const today = curveSnapshots.find((s) => s.id === "now") ?? curveSnapshots[0] ?? fallbackSnapshots[0];
  const todayY = (t: string) => today.points.find((p) => p.tenor === t)?.yield ?? 0;

  // The live "now" curve drives the KPI strip.
  const liveMetrics = getCurveMetrics(today);

  const [overlay, setOverlay] = useState<Set<string>>(new Set(["now", "1y", "2y"]));
  const [focusedId, setFocusedId] = useState<string>("now");
  const [spreadId, setSpreadId] = useState<string>("10Y2Y");
  const [showTable, setShowTable] = useState<boolean>(false);
  const focused = curveSnapshots.find((s) => s.id === focusedId) ?? today;
  const focusedMetrics = getCurveMetrics(focused);

  const toggleOverlay = (id: string) => {
    setOverlay((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) next.add("now");
      return next;
    });
  };

  // Build overlay lines in snapshot order so colors stay stable.
  const lines: CurveLine[] = curveSnapshots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => overlay.has(s.id))
    .map(({ s, i }) => ({
      label: s.label,
      color: colorFor(s.id, i),
      dashed: s.id !== "now",
      points: s.points.map((p) => ({ months: p.months, tenor: p.tenor, yield: p.yield })),
    }));

  // Overlaid snapshots (in snapshot order) → columns of the comparison table.
  const overlaySnaps = curveSnapshots.filter((s) => overlay.has(s.id));

  // Tenor table for the focused snapshot.
  interface TenorRow extends CurvePoint {
    deltaBps: number;
  }
  const tenorRows: TenorRow[] = focused.points.map((p) => ({
    ...p,
    deltaBps: (p.yield - todayY(p.tenor)) * 100,
  }));

  const tenorCols: Column<TenorRow>[] = [
    { key: "tenor", header: "Tenor", render: (r) => <span className="font-semibold text-term-text">{r.tenor}</span>, sortVal: (r) => r.months },
    { key: "fredId", header: "FRED ID", render: (r) => <span className="text-term-text-mute">{r.fredId}</span> },
    { key: "yield", header: "Yield %", align: "right", render: (r) => <span className="text-term-amber">{fmtNum(r.yield, 2)}</span>, sortVal: (r) => r.yield },
    {
      key: "delta",
      header: "Δ vs Today",
      align: "right",
      render: (r) =>
        focused.id === "now" ? (
          <span className="text-term-text-mute">—</span>
        ) : (
          <span className={pnlClass(r.deltaBps)}>{fmtSigned(r.deltaBps, 0)}</span>
        ),
      sortVal: (r) => r.deltaBps,
    },
  ];

  // User-selectable spread for the inversion analysis (default 10Y-2Y).
  const def = spreadDef(spreadId);
  const currentSpread = currentSpreadBps(spreadId, today);
  const termCarry = getTermFundingCarry();

  // Live inversion detection — real FRED daily history for the selected spread.
  const { data: invData, source: invSource } = useInversions(spreadId);
  const spreadHist = invData?.timeline ?? [];
  const inversions = invData?.inversions ?? [];
  const stats = invData?.stats;
  // Condense recession months into distinct period ranges for the footnote.
  const recessionPeriods = (() => {
    const out: string[] = [];
    let runStart: string | null = null;
    let prev: string | null = null;
    for (const d of spreadHist) {
      if (d.recession) {
        if (!runStart) runStart = d.date;
        prev = d.date;
      } else if (runStart) {
        out.push(runStart === prev ? runStart : `${runStart}–${prev}`);
        runStart = null;
        prev = null;
      }
    }
    if (runStart) out.push(runStart === prev ? runStart : `${runStart}–${prev}`);
    return out;
  })();

  const invCols: Column<Inversion>[] = [
    { key: "inv", header: "Inverted", render: (r) => <span className="text-term-text">{r.invertedDate}</span>, sortVal: (r) => r.id },
    { key: "uninv", header: "Un-inverted", render: (r) => <span className="text-term-text-dim">{r.unInvertedDate}</span> },
    { key: "dur", header: "Dur (mo)", align: "right", render: (r) => <span className="text-term-text">{r.durationMonths}</span>, sortVal: (r) => r.durationMonths },
    { key: "depth", header: "Max Depth", align: "right", render: (r) => <span className="text-term-down">{fmtSigned(r.maxDepthBps, 0)}</span>, sortVal: (r) => r.maxDepthBps },
    {
      key: "rec",
      header: "Recession?",
      align: "center",
      render: (r) => (r.recessionFollowed ? <Tag tone="down">RECESSION</Tag> : <Tag tone="up">NO REC</Tag>),
      sortVal: (r) => (r.recessionFollowed ? 1 : 0),
    },
    { key: "recStart", header: "Rec Start", render: (r) => <span className="text-term-text-dim">{r.recessionStart ?? "—"}</span> },
    {
      key: "lead",
      header: "Lead (mo)",
      align: "right",
      render: (r) => <span className="text-term-amber">{r.leadTimeMonths ?? "—"}</span>,
      sortVal: (r) => r.leadTimeMonths ?? -1,
    },
    { key: "note", header: "Note", render: (r) => <span className="text-2xs text-term-text-mute">{r.note}</span> },
  ];

  const carryCols: Column<TermFundingCarry>[] = [
    { key: "tenor", header: "Tenor", align: "center", render: (r) => <Tag tone={r.tenor === "O/N" ? "up" : r.tenor === "6M" ? "amber" : "blue"}>{r.tenor}</Tag>, sortVal: (r) => r.tenor },
    { key: "funding", header: "Funding", align: "right", render: (r) => <span className="text-term-text-dim">{fmtBps(r.fundingBps, 0)}</span>, sortVal: (r) => r.fundingBps },
    { key: "yield", header: "Reinvest", align: "right", render: (r) => <span className="text-term-amber">{fmtBps(r.reinvestYieldBps, 0)}</span>, sortVal: (r) => r.reinvestYieldBps },
    { key: "carry", header: "Carry", align: "right", render: (r) => <span className={pnlClass(r.carryBps)}>{fmtSigned(r.carryBps, 0)}</span>, sortVal: (r) => r.carryBps },
    { key: "cut", header: "After -25", align: "right", render: (r) => <span className={pnlClass(r.cut25CarryBps)}>{fmtSigned(r.cut25CarryBps, 0)}</span>, sortVal: (r) => r.cut25CarryBps },
    { key: "bs", header: "BS Cost", align: "right", render: (r) => <span className="text-term-down">{fmtBps(r.balanceSheetCostBps, 0)}</span>, sortVal: (r) => r.balanceSheetCostBps },
    { key: "pnl", header: "Monthly P&L", align: "right", render: (r) => <span className={pnlClass(r.monthlyPnl)}>{fmtUsdAbbr(r.monthlyPnl)}</span>, sortVal: (r) => r.monthlyPnl },
  ];

  const leadBars = inversions
    .filter((i) => i.leadTimeMonths !== null)
    .map((i) => ({ label: i.id, value: i.leadTimeMonths as number, color: "#3B9DFF" }));
  const depthBars = inversions.map((i) => ({ label: i.id, value: Math.abs(i.maxDepthBps), color: "#FF3B3B" }));

  const spreadBars = [
    { label: "2s10s", value: liveMetrics.s2s10, color: liveMetrics.s2s10 < 0 ? "#FF3B3B" : "#2ECC71" },
    { label: "3m10y", value: liveMetrics.s3m10, color: liveMetrics.s3m10 < 0 ? "#FF3B3B" : "#2ECC71" },
    { label: "5s30s", value: liveMetrics.s5s30, color: liveMetrics.s5s30 < 0 ? "#FF3B3B" : "#2ECC71" },
  ];

  // 2s10s for each overlaid line, for the legend.
  const legendItems = curveSnapshots
    .filter((s) => overlay.has(s.id))
    .map((s) => {
      const idx = curveSnapshots.findIndex((x) => x.id === s.id);
      return { id: s.id, label: s.label, color: colorFor(s.id, idx), s2s10: getCurveMetrics(s).s2s10 };
    });

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="CURV"
        title="Treasury Curve Lab"
        desc="Curve shape, history & inversions"
        asOf={today.date}
        right={<span className="flex items-center gap-2"><ChartLink refs={[{ source: "econ", id: "DGS10" }, { source: "econ", id: "DGS2" }]} range="5Y" /><SourceBadge source={source} /></span>}
      />

      <KpiStrip>
        <Stat label="10Y" value={`${fmtNum(todayY("10Y"), 2)}%`} sub="DGS10" tone="amber" />
        <Stat label="2Y" value={`${fmtNum(todayY("2Y"), 2)}%`} sub="DGS2" />
        <Stat
          label="2s10s"
          value={fmtBps(liveMetrics.s2s10, 0)}
          sub={liveMetrics.inverted2s10 ? "inverted" : "positive"}
          tone={liveMetrics.inverted2s10 ? "down" : "up"}
        />
        <Stat label="3m10y" value={fmtBps(liveMetrics.s3m10, 0)} sub={liveMetrics.inverted3m10 ? "inverted" : "positive"} tone={liveMetrics.inverted3m10 ? "down" : "up"} />
        <Stat label="Curve Shape" value={<Tag tone={shapeTone(liveMetrics.shape)}>{liveMetrics.shape}</Tag>} sub={`slope ${fmtBps(liveMetrics.slope, 0)}`} />
        <Stat label="Curvature" value={fmtBps(liveMetrics.curvature, 0)} sub="2·5Y − 2Y − 10Y" tone={liveMetrics.curvature < -25 ? "amber" : "neutral"} />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        {/* MAIN curve overlay */}
        <Panel
          title="Yield Curve — Overlay"
          code="CRV"
          subtitle="Daily · %"
          accent
          className="xl:col-span-2"
          right={
            <div className="flex flex-wrap items-center gap-1">
              {curveSnapshots.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleOverlay(s.id)}
                  className={`term-btn ${overlay.has(s.id) ? "term-btn-active" : ""}`}
                >
                  {s.label}
                </button>
              ))}
              <button
                onClick={() => setShowTable((v) => !v)}
                className={`term-btn ml-1 ${showTable ? "term-btn-active" : ""}`}
                title="Toggle a tenor × period comparison table"
              >
                ⊞ Table
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-2 p-2 lg:flex-row">
            <div className="min-w-0 flex-1">
              <YieldCurve lines={lines} height={300} shadeInversion />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-2xs">
                {legendItems.map((l) => (
                  <span key={l.id} className="flex items-center gap-1.5">
                    <span className="h-1.5 w-3" style={{ background: l.color }} />
                    <span className="text-term-text-dim">{l.label}</span>
                    <span className={`tnum ${pnlClass(l.s2s10)}`}>2s10s {fmtSigned(l.s2s10, 0)}</span>
                  </span>
                ))}
              </div>
            </div>
            {showTable && (
              <div className="shrink-0 overflow-x-auto border-t border-term-border pt-2 lg:border-l lg:border-t-0 lg:pl-2 lg:pt-0">
                <table className="tnum text-2xs">
                  <thead>
                    <tr className="border-b border-term-border">
                      <th className="px-1.5 py-1 text-left text-3xs uppercase tracking-wide text-term-text-mute">Tenor</th>
                      {overlaySnaps.map((s) => (
                        <th key={s.id} className="px-1.5 py-1 text-right text-3xs font-semibold" style={{ color: colorFor(s.id, curveSnapshots.findIndex((x) => x.id === s.id)) }} title={`${s.label} · ${s.date}`}>
                          {s.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {today.points.map((p) => (
                      <tr key={p.tenor} className="border-b border-term-border-soft hover:bg-term-panel-2">
                        <td className="px-1.5 py-0.5 font-semibold text-term-text-dim">{p.tenor}</td>
                        {overlaySnaps.map((s) => {
                          const v = s.points.find((pp) => pp.tenor === p.tenor)?.yield;
                          return (
                            <td key={s.id} className="px-1.5 py-0.5 text-right text-term-text">
                              {v !== undefined ? v.toFixed(2) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Panel>

        {/* SHAPE ANALYTICS */}
        <Panel title="Shape Analytics" code="SHP">
          <div className="grid grid-cols-3 divide-x divide-term-border border-b border-term-border">
            <Stat label="Level (avg)" value={`${fmtNum(liveMetrics.level, 2)}%`} />
            <Stat label="Slope 30s−1m" value={fmtBps(liveMetrics.slope, 0)} tone={liveMetrics.slope < 0 ? "down" : "up"} />
            <Stat label="Curvature" value={fmtBps(liveMetrics.curvature, 0)} />
          </div>
          <div className="space-y-1 px-3 py-2 text-2xs text-term-text-dim">
            <p><span className="text-term-amber">Level</span> — average yield across all tenors; tracks the overall rate regime.</p>
            <p><span className="text-term-amber">Slope</span> — 30Y minus 1M; positive = upward-sloping, negative = inverted front-to-back.</p>
            <p><span className="text-term-amber">Curvature</span> — belly richness (2·5Y − 2Y − 10Y); negative = humped belly.</p>
          </div>
          <div className="border-t border-term-border px-2 py-2">
            <div className="term-label mb-1 px-1">Key Spreads (bps)</div>
            <BarChart data={spreadBars} horizontal fmt={(n) => fmtSigned(n, 0)} />
          </div>
        </Panel>

        {/* CURVE AT A POINT IN TIME scrubber */}
        <Panel
          title="Curve At A Point In Time"
          code="SCRB"
          className="xl:col-span-2"
          right={
            <span className="flex items-center gap-2 text-3xs text-term-text-mute">
              <span className="tnum rounded-sm border border-term-border bg-term-panel-2 px-1.5 py-px font-semibold uppercase tracking-wide text-term-text-dim">
                AS OF {focused.date}
              </span>
              <span className="hidden md:inline">{focused.regime}</span>
            </span>
          }
        >
          <div className="flex flex-wrap gap-1 border-b border-term-border px-2 py-2">
            {curveSnapshots.map((s) => (
              <button
                key={s.id}
                onClick={() => setFocusedId(s.id)}
                className={`term-btn ${focusedId === s.id ? "term-btn-active" : ""}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-px bg-term-border sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Level" value={`${fmtNum(focusedMetrics.level, 2)}%`} className="bg-term-panel" />
            <Stat label="Slope" value={fmtBps(focusedMetrics.slope, 0)} className="bg-term-panel" tone={focusedMetrics.slope < 0 ? "down" : "up"} />
            <Stat label="Curvature" value={fmtBps(focusedMetrics.curvature, 0)} className="bg-term-panel" />
            <Stat label="Shape" value={<Tag tone={shapeTone(focusedMetrics.shape)}>{focusedMetrics.shape}</Tag>} className="bg-term-panel" />
            <Stat label="2s10s" value={fmtBps(focusedMetrics.s2s10, 0)} className="bg-term-panel" tone={focusedMetrics.inverted2s10 ? "down" : "up"} />
            <Stat label="3m10y" value={fmtBps(focusedMetrics.s3m10, 0)} className="bg-term-panel" tone={focusedMetrics.inverted3m10 ? "down" : "up"} />
          </div>
          <DataGrid columns={tenorCols} rows={tenorRows} rowKey={(r) => r.tenor} maxHeight="240px" initialSort={{ key: "tenor", dir: "asc" }} />
        </Panel>

        {/* INVERSION TIMELINE */}
        <Panel
          title={`${def.label} Inversion Timeline`}
          code="HIST"
          subtitle="Daily · bps"
          right={
            <div className="flex items-center gap-2">
              <SourceBadge source={invSource} />
              <span className={`tnum text-2xs ${pnlClass(currentSpread)}`}>{fmtSigned(currentSpread, 0)}bps</span>
              <TermSelect value={spreadId} onChange={setSpreadId} options={SPREAD_DEFS.map((s) => ({ value: s.id, label: s.label }))} />
            </div>
          }
        >
          <div className="p-2">
            <LineChart
              series={[{ name: def.label, data: spreadHist.map((d) => d.value), color: "#FF8C00", area: true }]}
              labels={spreadHist.map((d) => d.date)}
              height={200}
              yFmt={(n) => `${n.toFixed(0)}`}
            />
            <div className="mt-1 px-1 text-3xs text-term-text-mute">
              <span className="text-term-amber">{def.label}</span> ({def.desc}) in bps; values below the{" "}
              <span className="text-term-down">zero line</span> mark inverted regimes ({def.longT} below {def.shortT}).
            </div>
            <div className="mt-1 px-1 text-3xs text-term-text-dim">
              <span className="text-term-text-mute">Recession periods:</span>{" "}
              <span className="tnum">{recessionPeriods.join(" · ") || "none in window"}</span>
            </div>
          </div>
        </Panel>

        {/* HISTORICAL INVERSIONS */}
        <Panel title={`Historical Inversions — ${def.label}`} code="INVT" accent className="xl:col-span-2">
          {stats ? (
            <div className="grid grid-cols-2 divide-x divide-term-border border-b border-term-border sm:grid-cols-4">
              <Stat label="Recession Hit-Rate" value={`${fmtNum(stats.recessionRate, 0)}%`} sub={`${stats.total} inversions`} tone="down" />
              <Stat label="Avg Lead" value={`${fmtNum(stats.avgLeadMonths, 1)} mo`} sub={`${stats.minLeadMonths}–${stats.maxLeadMonths} mo range`} tone="amber" />
              <Stat label="Deepest" value={fmtBps(stats.deepestBps, 0)} sub={`avg ${fmtBps(stats.avgDepthBps, 0)}`} tone="down" />
              <Stat label="Longest" value={`${stats.longestMonths} mo`} sub="duration" />
            </div>
          ) : (
            <div className="px-3 py-3 text-2xs text-term-text-mute">No statistical data available from the configured source.</div>
          )}
          <DataGrid columns={invCols} rows={inversions} rowKey={(r) => r.id} maxHeight="260px" initialSort={{ key: "inv", dir: "asc" }} />
          <div className="grid grid-cols-1 gap-px border-t border-term-border bg-term-border sm:grid-cols-2">
            <div className="bg-term-panel px-2 py-2">
              <div className="term-label mb-1 px-1">Lead Time To Recession (mo)</div>
              <BarChart data={leadBars} horizontal fmt={(n) => `${n.toFixed(0)}`} />
            </div>
            <div className="bg-term-panel px-2 py-2">
              <div className="term-label mb-1 px-1">Max Inversion Depth (bps)</div>
              <BarChart data={depthBars} horizontal fmt={(n) => `-${n.toFixed(0)}`} />
            </div>
          </div>
        </Panel>

        {/* PLAYBOOK */}
        <Panel title="Curve Inversion Playbook" code="PLAY">
          <ul className="space-y-2 px-3 py-2 text-2xs text-term-text-dim">
            {stats && (
              <li className="flex gap-2">
                <span className="text-term-amber">▸</span>
                <span>
                  Since the mid-1970s, <span className="text-term-amber">{fmtNum(stats.recessionRate, 0)}%</span> of <span className="text-term-amber">{def.label}</span> inversions
                  preceded an NBER recession, with an average lead of <span className="text-term-amber">{fmtNum(stats.avgLeadMonths, 1)} months</span>{" "}
                  (range {stats.minLeadMonths}–{stats.maxLeadMonths}mo) — a slow, not immediate, signal.
                </span>
              </li>
            )}
            <li className="flex gap-2">
              <span className="text-term-amber">▸</span>
              <span>
                The selected <span className="text-term-amber">{def.label}</span> spread is <span className={pnlClass(currentSpread)}>{fmtSigned(currentSpread, 0)}bps</span>;
                2s10s is <span className={pnlClass(liveMetrics.s2s10)}>{fmtSigned(liveMetrics.s2s10, 0)}bps</span> and 3m10y is{" "}
                <span className={pnlClass(liveMetrics.s3m10)}>{fmtSigned(liveMetrics.s3m10, 0)}bps</span>; the curve reads{" "}
                <span className="text-term-amber">{liveMetrics.shape}</span>
                {liveMetrics.inverted2s10 ? " — still flashing the classic warning." : " — having re-steepened out of inversion."}
              </span>
            </li>
            {stats && (
              <li className="flex gap-2">
                <span className="text-term-amber">▸</span>
                <span>
                  Depth & duration matter: the deepest inversion ran <span className="text-term-down">{fmtBps(stats.deepestBps, 0)}</span> and the
                  longest lasted <span className="text-term-amber">{stats.longestMonths}mo</span> (2022–24, which has so far avoided a recession — the lone soft-landing case).
                </span>
              </li>
            )}
            <li className="flex gap-2">
              <span className="text-term-amber">▸</span>
              <span>
                Watch the <span className="text-term-amber">re-steepening</span>: recessions historically begin <em>after</em> the curve dis-inverts, not while inverted — the un-inversion is the tighter timing trigger.
              </span>
            </li>
          </ul>
        </Panel>

        <Panel title="Term Funding Carry - O/N vs 1M/3M/6M" code="CARRY" accent className="xl:col-span-2">
          <div className="grid grid-cols-1 gap-2 p-2 lg:grid-cols-[1.2fr_0.8fr]">
            <DataGrid columns={carryCols} rows={termCarry} rowKey={(r) => r.tenor} maxHeight="220px" initialSort={{ key: "pnl", dir: "desc" }} zebra />
            <BarChart horizontal data={termCarry.map((r) => ({ label: r.tenor, value: r.monthlyPnl, color: r.monthlyPnl >= 0 ? "#2ECC71" : "#FF3B3B" }))} fmt={(n) => fmtUsdAbbr(n)} />
          </div>
          <div className="border-t border-term-border px-2 py-1.5 text-2xs text-term-text-mute">
            Carry = reinvestment yield minus funding and balance-sheet charge. This feeds REINV ladder choices and CASH funding path costs.
          </div>
        </Panel>

        {/* ── Rates Relative Value ─────────────────────────────────────── */}
        {(() => {
          const histSnaps = isRealEconSource(source) ? curveSnapshots.filter((s) => s.id !== "now") : [];
          const butterflies = histSnaps.length >= 20 ? computeButterfliesFromHistory(today, histSnaps) : computeButterflies(today);
          const spreadZs = histSnaps.length >= 20 ? computeSpreadZFromHistory(today, histSnaps) : computeSpreadZScores(today);
          const carryRoll = computeCarryRoll(today);
          const realBe = computeRealBreakeven();
          const priorSnap = curveSnapshots.find((s) => s.id === "1m") ?? curveSnapshots[1] ?? today;
          const curveMove = classifyCurveMove(today, priorSnap);

          const SIGNAL_TONE_RV: Record<string, "up" | "amber" | "down" | "violet"> = { Rich: "down", Fair: "amber", Cheap: "up" };
          const TREND_TONE: Record<string, "up" | "amber" | "down"> = { Widening: "down", Stable: "amber", Tightening: "up" };
          const MOVE_TONE: Record<string, "up" | "amber" | "down" | "blue" | "violet"> = {
            "Bull Steepener": "up", "Bear Steepener": "amber", "Bull Flattener": "blue", "Bear Flattener": "down", "Parallel Shift": "neutral" as any, "Twist": "violet",
          };

          const flyCols: Column<ButterflySpread>[] = [
            { key: "label", header: "Fly", render: (r) => <span className="font-semibold text-term-text">{r.label}</span>, sortVal: (r) => r.label },
            { key: "wings", header: "Wings", render: (r) => <span className="text-term-text-mute">{r.wings}</span> },
            { key: "belly", header: "Belly", render: (r) => <span className="text-term-amber">{r.belly}</span> },
            { key: "value", header: "Value", align: "right", render: (r) => <span className="tnum text-term-text">{fmtSigned(r.valueBps, 1)}</span>, sortVal: (r) => r.valueBps },
            { key: "spark", header: "20d", align: "right", width: "70px", render: (r) => <Sparkline data={r.hist20d} width={60} height={16} /> },
            { key: "z", header: "Z", align: "right", render: (r) => <span className={pnlClass(-Math.abs(r.zScore))}>{fmtNum(r.zScore, 2)}</span>, sortVal: (r) => r.zScore },
            { key: "pctile", header: "%ile", align: "right", render: (r) => <span className="tnum text-term-text-dim">{r.percentile}%</span>, sortVal: (r) => r.percentile },
            { key: "signal", header: "Signal", align: "center", render: (r) => <Tag tone={SIGNAL_TONE_RV[r.signal] ?? "amber"}>{r.signal}</Tag>, sortVal: (r) => r.signal },
          ];

          const szCols: Column<SpreadZRow>[] = [
            { key: "label", header: "Spread", render: (r) => <span className="font-semibold text-term-text">{r.label}</span>, sortVal: (r) => r.label },
            { key: "value", header: "Value", align: "right", render: (r) => <span className={pnlClass(r.valueBps)}>{fmtSigned(r.valueBps, 1)}bps</span>, sortVal: (r) => r.valueBps },
            { key: "z3", header: "Z (3m)", align: "right", render: (r) => <span className={pnlClass(-Math.abs(r.zScore3m))}>{fmtNum(r.zScore3m, 2)}</span>, sortVal: (r) => r.zScore3m },
            { key: "z1", header: "Z (1y)", align: "right", render: (r) => <span className={pnlClass(-Math.abs(r.zScore1y))}>{fmtNum(r.zScore1y, 2)}</span>, sortVal: (r) => r.zScore1y },
            { key: "pctile", header: "%ile (1y)", align: "right", render: (r) => <span className="tnum text-term-text-dim">{r.percentile1y}%</span>, sortVal: (r) => r.percentile1y },
            { key: "trend", header: "Trend", align: "center", render: (r) => <Tag tone={TREND_TONE[r.trend]}>{r.trend}</Tag>, sortVal: (r) => r.trend },
          ];

          const crCols: Column<CarryRollRow>[] = [
            { key: "tenor", header: "Tenor", render: (r) => <span className="font-semibold text-term-text">{r.tenor}</span>, sortVal: (r) => r.rank },
            { key: "yield", header: "Yield", align: "right", render: (r) => <span className="text-term-text">{fmtNum(r.yield, 2)}%</span>, sortVal: (r) => r.yield },
            { key: "carry", header: "Carry 3m", align: "right", render: (r) => <span className={pnlClass(r.carryBps3m)}>{fmtSigned(r.carryBps3m, 0)}bps</span>, sortVal: (r) => r.carryBps3m },
            { key: "roll", header: "Roll 3m", align: "right", render: (r) => <span className={pnlClass(r.rollBps3m)}>{fmtSigned(r.rollBps3m, 0)}bps</span>, sortVal: (r) => r.rollBps3m },
            { key: "total", header: "Total", align: "right", render: (r) => <span className={`font-semibold ${pnlClass(r.totalBps3m)}`}>{fmtSigned(r.totalBps3m, 0)}bps</span>, sortVal: (r) => r.totalBps3m },
            { key: "rank", header: "Rank", align: "right", render: (r) => <span className={r.rank <= 2 ? "font-bold text-term-amber" : "text-term-text-mute"}>{r.rank}</span>, sortVal: (r) => r.rank },
          ];

          const rbCols: Column<RealBreakevenRow>[] = [
            { key: "tenor", header: "Tenor", render: (r) => <span className="font-semibold text-term-text">{r.tenor}</span> },
            { key: "nominal", header: "Nominal", align: "right", render: (r) => <span className="text-term-text">{fmtNum(r.nominal, 2)}%</span>, sortVal: (r) => r.nominal },
            { key: "real", header: "Real Yield", align: "right", render: (r) => <span className="text-term-amber">{fmtNum(r.realYield, 2)}%</span>, sortVal: (r) => r.realYield },
            { key: "be", header: "Breakeven", align: "right", render: (r) => <span className="text-term-up">{fmtNum(r.breakeven, 2)}%</span>, sortVal: (r) => r.breakeven },
            { key: "tp", header: "Term Prem", align: "right", render: (r) => <span className="text-term-text-dim">{fmtNum(r.termPremium, 2)}%</span>, sortVal: (r) => r.termPremium },
          ];

          return (
            <>
              {/* Curve Move Classifier */}
              <Panel title="Curve Move Classifier" code="MOVE" accent className="xl:col-span-3">
                <div className="grid grid-cols-2 gap-px bg-term-border sm:grid-cols-5">
                  <Stat label="Classification" value={<Tag tone={(MOVE_TONE[curveMove.classification] ?? "amber") as any}>{curveMove.classification}</Tag>} className="bg-term-panel" />
                  <Stat label="Front Δ (2Y)" value={`${fmtSigned(curveMove.frontChange, 1)}bps`} className="bg-term-panel" tone={curveMove.frontChange > 0 ? "down" : "up"} />
                  <Stat label="Back Δ (10Y)" value={`${fmtSigned(curveMove.backChange, 1)}bps`} className="bg-term-panel" tone={curveMove.backChange > 0 ? "down" : "up"} />
                  <Stat label="Slope Δ" value={`${fmtSigned(curveMove.slopeChange, 1)}bps`} className="bg-term-panel" tone={curveMove.slopeChange > 0 ? "up" : "down"} />
                  <Stat label="vs" value={priorSnap.label} sub={priorSnap.date} className="bg-term-panel" />
                </div>
                <div className="px-3 py-2 text-2xs text-term-text-dim">{curveMove.description}</div>
              </Panel>

              {/* Butterfly Spreads */}
              <Panel title="Butterfly Spreads" code="FLY" className="xl:col-span-2" right={<span className="text-3xs text-term-text-mute">2·belly − wing1 − wing2</span>}>
                <DataGrid columns={flyCols} rows={butterflies} rowKey={(r) => r.id} maxHeight="200px" zebra />
              </Panel>

              {/* Spread Z-Scores */}
              <Panel title="Spread Z-Scores & Percentiles" code="ZSPR">
                <DataGrid columns={szCols} rows={spreadZs} rowKey={(r) => r.id} maxHeight="280px" zebra />
              </Panel>

              {/* Carry & Roll */}
              <Panel title="Carry & Roll Proxy (3m)" code="C&R" className="xl:col-span-2" right={<span className="text-3xs text-term-text-mute">funded at 3M bill rate</span>}>
                <DataGrid columns={crCols} rows={carryRoll} rowKey={(r) => r.tenor} maxHeight="280px" zebra />
              </Panel>

              {/* Real Yield vs Breakeven */}
              <Panel title="Real Yield vs Breakeven Decomposition" code="TIPS" right={<span className="text-3xs text-term-text-mute">TIPS-implied</span>}>
                <DataGrid columns={rbCols} rows={realBe} rowKey={(r) => r.tenor} maxHeight="260px" zebra />
                <div className="border-t border-term-border px-3 py-1.5 text-3xs text-term-text-mute">
                  Nominal = Real Yield + Breakeven Inflation. Term premium is model-implied residual.
                </div>
              </Panel>
            </>
          );
        })()}
      </div>
    </div>
  );
}
