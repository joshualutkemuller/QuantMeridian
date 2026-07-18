
import { useCallback, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { FileDown } from "lucide-react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { CorrelationMatrix } from "@/components/charts/Matrix";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { DataLegend } from "@/components/ui/DataLegend";
import { isRealEconSource, useLiveSeriesSet, type DataSource , useMacroInputs } from "@/lib/useEcon";
import { fmtSigned, pnlClass } from "@/lib/format";
import { generateYieldCurvePdf } from "@/lib/yieldCurvePdf";
import {
  BENCHMARK_FRED_IDS,
  buildFallback, buildFallbackWithAnchors,
  type SeriesMap,
} from "@/data/benchmarkRates";
import {
  CURVE_TENORS,
  CURVE_IDS,
  buildCurveHistory,
  computeCurveShape,
  computeCurveSummary,
  curveDiff,
  curveCorrelation,
  type CurveShapeMetrics,
  type InversionSegment,
  type ButterflyTrade,
  type CurveDiff as CurveDiffType,
} from "@/data/yieldCurveAnalytics";

const REGIME_TONE: Record<string, "up" | "down" | "amber" | "neutral"> = {
  "Bull Steepening": "up",
  "Bear Steepening": "amber",
  "Bull Flattening": "amber",
  "Bear Flattening": "down",
  "Inversion Deepening": "down",
  "Inversion Unwinding": "up",
  "Stable": "neutral",
};

const SIGNAL_TONE: Record<string, "up" | "down" | "neutral"> = { rich: "down", cheap: "up", fair: "neutral" };

const TIME_RANGES = [
  { value: "3M", label: "3M", days: 66 },
  { value: "6M", label: "6M", days: 130 },
  { value: "1Y", label: "1Y", days: 260 },
  { value: "2Y", label: "2Y", days: 520 },
];

const DIFF_PERIODS = [
  { value: "1W", label: "1W", days: 5 },
  { value: "1M", label: "1M", days: 22 },
  { value: "3M", label: "3M", days: 66 },
  { value: "1Y", label: "1Y", days: 260 },
];

const PALETTE = ["#3B9DFF", "#2ECC71", "#A78BFA", "#22D3EE", "#FF8C00", "#EC4899"];

export default function YieldCurvePage() {
  const { data: macroInputs } = useMacroInputs();
  const fallback = useMemo<SeriesMap>(() => buildFallbackWithAnchors(macroInputs.benchmarks, 520), [macroInputs.benchmarks]);
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
  const badgeSource: DataSource = anyReal ? (source === "FRED" ? "FRED" : "SNAPSHOT") : "SIM";

  const [tab, setTab] = useState<"shape" | "slopes" | "rv">("shape");
  const [timeRange, setTimeRange] = useState("1Y");
  const [diffPeriod, setDiffPeriod] = useState("1M");
  const [exporting, setExporting] = useState(false);

  const curveChartRef = useRef<HTMLDivElement>(null);
  const slopeChartRef = useRef<HTMLDivElement>(null);

  const shape = useMemo(() => computeCurveShape(map), [map]);
  const summary = useMemo(() => computeCurveSummary(shape), [shape]);
  const corrResult = useMemo(() => curveCorrelation(map, 60), [map]);

  const rangeDays = TIME_RANGES.find((r) => r.value === timeRange)?.days ?? 260;
  const diffDays = DIFF_PERIODS.find((d) => d.value === diffPeriod)?.days ?? 22;

  const curveHistory = shape.history;
  const currentCurve = shape.current;

  // Curve overlays for shape tab
  const overlayIndices = useMemo(() => {
    const n = curveHistory.length;
    return {
      now: n - 1,
      w1: Math.max(0, n - 6),
      m1: Math.max(0, n - 23),
      y1: Math.max(0, n - 261),
    };
  }, [curveHistory.length]);

  const curveOverlays = useMemo(() => {
    if (curveHistory.length === 0) return [];
    const lines = [
      { label: "Current", idx: overlayIndices.now, color: "#FF8C00" },
      { label: "1W Ago", idx: overlayIndices.w1, color: "#3B9DFF" },
      { label: "1M Ago", idx: overlayIndices.m1, color: "#2ECC71" },
      { label: "1Y Ago", idx: overlayIndices.y1, color: "#A78BFA" },
    ];
    return lines.filter((l) => l.idx >= 0 && l.idx < curveHistory.length).map((l) => ({
      ...l,
      curve: curveHistory[l.idx],
    }));
  }, [curveHistory, overlayIndices]);

  // Curve diff bar chart
  const diffData = useMemo<CurveDiffType[]>(() => {
    if (curveHistory.length < diffDays + 1) return [];
    const now = curveHistory[curveHistory.length - 1];
    const then = curveHistory[curveHistory.length - 1 - diffDays];
    return curveDiff(now, then);
  }, [curveHistory, diffDays]);

  // Slope time series
  const slopeSlice = useMemo(() => curveHistory.slice(-rangeDays), [curveHistory, rangeDays]);

  const handleExportPdf = useCallback(async () => {
    setExporting(true);
    try {
      await generateYieldCurvePdf({
        map,
        source: badgeSource,
        tab,
        timeRange,
        curveChartRef: curveChartRef.current,
        slopeChartRef: slopeChartRef.current,
      });
    } finally {
      setExporting(false);
    }
  }, [map, badgeSource, tab, timeRange]);

  // ── Column defs ──────────────────────────────────────────────────

  const inversionCols: Column<InversionSegment>[] = [
    { key: "pair", header: "Pair", width: "64px", render: (r) => <span className="font-semibold text-term-amber">{r.pairLabel}</span>, sortVal: (r) => r.pairLabel },
    { key: "start", header: "Start", width: "80px", render: (r) => <span className="tnum text-term-text-dim">{r.startDate}</span>, sortVal: (r) => r.startDate },
    { key: "end", header: "End", width: "80px", render: (r) => <span className={clsx("tnum", r.endDate ? "text-term-text-dim" : "font-semibold text-term-down")}>{r.endDate ?? "ACTIVE"}</span>, sortVal: (r) => r.endDate ?? "9999" },
    { key: "days", header: "Days", align: "right", width: "52px", render: (r) => <span className="tnum text-term-text">{r.durationDays}</span>, sortVal: (r) => r.durationDays },
    { key: "depth", header: "Max Depth", align: "right", width: "72px", render: (r) => <span className="tnum font-semibold text-term-down">{r.maxDepthBps.toFixed(1)}bps</span>, sortVal: (r) => r.maxDepthBps },
    { key: "current", header: "Current", align: "right", width: "72px", render: (r) => <span className={clsx("tnum", r.currentBps != null && r.currentBps < 0 ? "text-term-down" : "text-term-text-dim")}>{r.currentBps != null ? `${r.currentBps.toFixed(1)}bps` : "—"}</span>, sortVal: (r) => r.currentBps ?? 0 },
  ];

  const butterflyCols: Column<ButterflyTrade>[] = [
    { key: "label", header: "Butterfly", width: "140px", render: (r) => <span className="font-semibold text-term-text">{r.label}</span>, sortVal: (r) => r.label },
    { key: "value", header: "Value (bps)", align: "right", width: "80px", render: (r) => <span className="tnum font-semibold text-term-text">{r.valueBps != null ? fmtSigned(r.valueBps, 1) : "—"}</span>, sortVal: (r) => r.valueBps ?? 0 },
    { key: "z", header: "Z-Score", align: "right", width: "64px", render: (r) => <span className={clsx("tnum", r.zScore != null && Math.abs(r.zScore) > 1.5 ? "font-semibold text-term-down" : "text-term-text-dim")}>{r.zScore != null ? fmtSigned(r.zScore, 2) : "—"}</span>, sortVal: (r) => Math.abs(r.zScore ?? 0) },
    { key: "pctl", header: "Pctl", align: "right", width: "52px", render: (r) => <span className="tnum text-term-text-dim">{r.percentile != null ? `${r.percentile}%` : "—"}</span>, sortVal: (r) => r.percentile ?? 50 },
    { key: "signal", header: "Signal", width: "64px", render: (r) => <Tag tone={SIGNAL_TONE[r.signal]}>{r.signal}</Tag>, sortVal: (r) => r.signal },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="YCURV"
        title="Yield Curve Analytics"
        desc="Daily curve construction, shape metrics & regime tracking"
        right={
          <span className="flex items-center gap-2">
            <button onClick={handleExportPdf} disabled={exporting} className="flex items-center gap-1 rounded border border-term-border bg-term-panel px-2 py-0.5 text-2xs text-term-text-dim hover:text-term-amber disabled:opacity-40">
              <FileDown size={12} />
              {exporting ? "Exporting…" : "PDF"}
            </button>
            <ProvenanceBadge source={badgeSource} />
          </span>
        }
      />

      <KpiStrip>
        <Stat label="2s10s Slope" value={summary.slope2s10s != null ? `${fmtSigned(summary.slope2s10s, 0)}bps` : "—"} tone={summary.slope2s10s != null && summary.slope2s10s < 0 ? "down" : "up"} />
        <Stat label="3m10y Slope" value={summary.slope3m10y != null ? `${fmtSigned(summary.slope3m10y, 0)}bps` : "—"} tone={summary.slope3m10y != null && summary.slope3m10y < 0 ? "down" : "up"} />
        <Stat label="Curvature" value={summary.curvature != null ? `${fmtSigned(summary.curvature, 1)}bps` : "—"} sub="2-5-10 butterfly" />
        <Stat label="Long End" value={summary.longEnd != null ? `${fmtSigned(summary.longEnd, 0)}bps` : "—"} sub="10s30s" />
        <Stat label="Regime" value={summary.regime} tone={REGIME_TONE[summary.regime] ?? "neutral"} />
        <Stat label="Inversions" value={String(summary.inversions)} sub="active" tone={summary.inversions > 0 ? "down" : "up"} />
      </KpiStrip>

      <div className="flex items-center gap-3 border-b border-term-border bg-term-panel px-3 py-1.5">
        <TermToggleGroup value={tab} onChange={setTab} options={[
          { value: "shape", label: "Curve Shape" },
          { value: "slopes", label: "Slope History" },
          { value: "rv", label: "Relative Value" },
        ]} size="sm" />
        <TermToggleGroup label="Range" value={timeRange} onChange={setTimeRange} options={TIME_RANGES.map((r) => ({ value: r.value, label: r.label }))} size="sm" />
        {tab === "shape" && (
          <TermToggleGroup label="Diff" value={diffPeriod} onChange={setDiffPeriod} options={DIFF_PERIODS.map((d) => ({ value: d.value, label: d.label }))} size="sm" />
        )}
      </div>

      <div className="grid grid-cols-12 gap-2 p-2">

        {/* ── TAB: Curve Shape ──────────────────────────────────── */}
        {tab === "shape" && (
          <>
            <div className="col-span-12 xl:col-span-8 flex flex-col gap-2">
              <Panel title="Treasury Yield Curve" code="CURV" accent>
                <div ref={curveChartRef} className="p-2">
                  <LineChart
                    series={curveOverlays.map((o) => ({
                      name: o.label,
                      data: o.curve.points.map((p) => p.yield ?? 0),
                      color: o.color,
                      dashed: o.label !== "Current",
                    }))}
                    labels={CURVE_TENORS.map((t) => t.label)}
                    height={320}
                    yFmt={(v) => `${v.toFixed(2)}%`}
                  />
                </div>
              </Panel>

              <Panel title={`Curve Change — ${diffPeriod}`} code="DIFF">
                <div className="p-2">
                  <BarChart
                    data={diffData.map((d) => ({
                      label: d.label,
                      value: d.diffBps,
                      color: d.diffBps >= 0 ? "#FF3B3B" : "#2ECC71",
                    }))}
                    height={180}
                    fmt={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}bps`}
                  />
                </div>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4 flex flex-col gap-2">
              <Panel title="Shape Metrics" code="SHPE">
                <div className="divide-y divide-term-border-soft">
                  {[
                    { label: "2s10s Slope", val: shape.slope2s10s },
                    { label: "3m10Y Slope", val: shape.slope3m10y },
                    { label: "Curvature (2-5-10)", val: shape.curvature },
                    { label: "Long End (10s30s)", val: shape.longEnd },
                  ].map((m) => (
                    <div key={m.label} className="flex items-center justify-between px-3 py-2">
                      <span className="text-2xs text-term-text-mute">{m.label}</span>
                      <div className="text-right">
                        <div className="tnum text-2xs font-semibold text-term-text">{m.val.current != null ? `${fmtSigned(m.val.current, 1)}bps` : "—"}</div>
                        <div className={clsx("tnum text-3xs", pnlClass(m.val.chg1d != null ? -m.val.chg1d : 0))}>
                          {m.val.chg1d != null ? `${fmtSigned(m.val.chg1d, 1)} 1D` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Current Yields" code="YLDS">
                <div className="divide-y divide-term-border-soft">
                  {currentCurve.points.map((p) => (
                    <div key={p.tenor} className="flex items-center justify-between px-3 py-1 text-2xs">
                      <span className="text-term-text-mute">{p.label}</span>
                      <span className="tnum font-semibold text-term-text">{p.yield != null ? `${p.yield.toFixed(2)}%` : "—"}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Curve Regime" code="RGME">
                <div className="p-3">
                  <Tag tone={REGIME_TONE[summary.regime] ?? "neutral"}>{summary.regime}</Tag>
                  <div className="mt-2 text-2xs text-term-text-dim">
                    {summary.regime === "Bull Steepening" && "Yields falling, long end falling less → curve steepens. Typically seen in early easing cycles."}
                    {summary.regime === "Bear Steepening" && "Yields rising, short end rising less → curve steepens. Often driven by term premium expansion."}
                    {summary.regime === "Bull Flattening" && "Yields falling, long end falling more → curve flattens. Late-cycle easing expectations."}
                    {summary.regime === "Bear Flattening" && "Yields rising, short end rising more → curve flattens. Classic tightening cycle."}
                    {summary.regime === "Inversion Deepening" && "Curve inversion is getting deeper. Recession signal strengthening."}
                    {summary.regime === "Inversion Unwinding" && "Curve inversion is normalizing. Historically precedes recession onset."}
                    {summary.regime === "Stable" && "No significant directional move in curve shape."}
                  </div>
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ── TAB: Slope History ────────────────────────────────── */}
        {tab === "slopes" && (
          <>
            <div className="col-span-12 xl:col-span-8 flex flex-col gap-2">
              <Panel title="Slope History" code="SLPE" accent>
                <div ref={slopeChartRef} className="p-2">
                  <LineChart
                    series={[
                      { name: "2s10s", data: slopeSlice.map((c) => c.slope2s10s ?? 0), color: "#FF8C00" },
                      { name: "3m10y", data: slopeSlice.map((c) => c.slope3m10y ?? 0), color: "#3B9DFF" },
                    ]}
                    labels={slopeSlice.map((c) => c.date)}
                    height={300}
                    yFmt={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}bps`}
                  />
                </div>
              </Panel>

              <Panel title="Curvature & Long End" code="CRVE">
                <div className="p-2">
                  <LineChart
                    series={[
                      { name: "Curvature (2-5-10)", data: slopeSlice.map((c) => c.curvature ?? 0), color: "#A78BFA" },
                      { name: "Long End (10s30s)", data: slopeSlice.map((c) => c.longEnd ?? 0), color: "#22D3EE" },
                    ]}
                    labels={slopeSlice.map((c) => c.date)}
                    height={240}
                    yFmt={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}bps`}
                  />
                </div>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4 flex flex-col gap-2">
              <Panel title="Inversion Tracker" code="INVR">
                {shape.inversions.length > 0 ? (
                  <DataGrid columns={inversionCols} rows={shape.inversions} rowKey={(r, i) => `${r.pair}-${i}`} maxHeight="400px" zebra />
                ) : (
                  <div className="p-4 text-center text-2xs text-term-text-dim">No inversions in current history window</div>
                )}
              </Panel>

              <Panel title="Slope Trend Metrics" code="STND">
                <div className="divide-y divide-term-border-soft">
                  {[
                    { label: "2s10s", trend: shape.slope2s10s },
                    { label: "3m10y", trend: shape.slope3m10y },
                    { label: "Curvature", trend: shape.curvature },
                    { label: "Long End", trend: shape.longEnd },
                  ].map((m) => (
                    <div key={m.label} className="px-3 py-2 text-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-term-amber">{m.label}</span>
                        <span className="tnum font-semibold text-term-text">{m.trend.current != null ? `${fmtSigned(m.trend.current, 1)}bps` : "—"}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-3xs text-term-text-dim">
                        <span>Pctl: {m.trend.percentile ?? "—"}%</span>
                        <span>Dir: {m.trend.direction}</span>
                        <span>Mom: {m.trend.momentum}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ── TAB: Relative Value ──────────────────────────────── */}
        {tab === "rv" && (
          <>
            <div className="col-span-12 xl:col-span-8 flex flex-col gap-2">
              <Panel title="Butterfly Trades" code="BFLY" accent>
                <DataGrid columns={butterflyCols} rows={shape.butterflies} rowKey={(r) => r.label} zebra />
              </Panel>

              <Panel title="Tenor Correlation (60D)" code="TCOR">
                <div className="p-2">
                  <CorrelationMatrix
                    labels={CURVE_TENORS.map((t) => t.label)}
                    values={corrResult.matrix}
                  />
                </div>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4 flex flex-col gap-2">
              <Panel title="Butterfly Summary" code="BSUM">
                <div className="divide-y divide-term-border-soft">
                  {shape.butterflies.map((b) => (
                    <div key={b.label} className="flex items-center justify-between px-3 py-2 text-2xs">
                      <span className="text-term-text-mute">{b.label.replace(" Butterfly", "")}</span>
                      <span className="flex items-center gap-2">
                        <span className="tnum font-semibold text-term-text">{b.valueBps != null ? `${fmtSigned(b.valueBps, 1)}bps` : "—"}</span>
                        <Tag tone={SIGNAL_TONE[b.signal]}>{b.signal}</Tag>
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Yield Change Summary" code="YCHG">
                <div className="divide-y divide-term-border-soft">
                  {CURVE_TENORS.map((t) => {
                    const obs = map[t.id] ?? [];
                    const cur = obs.length > 0 ? obs[obs.length - 1].value : null;
                    const prev = obs.length > 1 ? obs[obs.length - 2].value : null;
                    const chg = cur != null && prev != null ? (cur - prev) * 100 : null;
                    return (
                      <div key={t.id} className="flex items-center justify-between px-3 py-1 text-2xs">
                        <span className="text-term-text-mute">{t.label}</span>
                        <span className="flex items-center gap-3">
                          <span className="tnum text-term-text">{cur != null ? `${cur.toFixed(2)}%` : "—"}</span>
                          <span className={clsx("tnum", chg != null ? pnlClass(-chg) : "")}>{chg != null ? `${fmtSigned(chg, 1)}bps` : ""}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>

      <div className="p-2">
        <DataLegend />
      </div>
    </div>
  );
}
