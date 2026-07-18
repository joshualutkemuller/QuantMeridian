
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { FileDown, Plus, Trash2, Gauge } from "lucide-react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { ProgressBar } from "@/components/charts/Radial";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { TermSelect } from "@/components/ui/TermSelect";
import { DataLegend } from "@/components/ui/DataLegend";
import { isRealEconSource, useLiveSeriesSet, type DataSource , useMacroInputs } from "@/lib/useEcon";
import { fmtNum, fmtSigned, pnlClass } from "@/lib/format";
import { generateUtilizationPdf } from "@/lib/utilizationPdf";
import {
  BENCHMARK_SERIES,
  BENCHMARK_FRED_IDS,
  buildFallback, buildFallbackWithAnchors,
  defOf,
  type SeriesMap,
} from "@/data/benchmarkRates";
import { getInventory, type InventoryRow } from "@/data/securitiesLending";
import { getSqueezeBoard, getSectorHeat, type SqueezeRow } from "@/data/squeeze";
import {
  PRESET_BLENDS,
  computeUtilizationSnapshot,
  buildUtilizationTimeSeries,
  computeAllBlends,
  computeBlend,
  computeRateUtilCorrelation,
  computeRateSensitivity,
  computeUtilSummary,
  normalizeForOverlay,
  validateBlend,
  loadUserBlends,
  saveUserBlends,
  deleteUserBlend,
  type UtilGroupBy,
  type UtilGroupMetrics,
  type UtilizationTimeSeries,
  type CustomBlend,
  type BlendComponent,
  type BlendResult,
  type RateUtilCorrelation,
  type RateSensitivity,
} from "@/data/utilizationAnalytics";

const IMPACT_TONE: Record<string, "up" | "down" | "neutral"> = { positive: "up", negative: "down", neutral: "neutral" };
const MAG_TONE: Record<string, "up" | "amber" | "down" | "neutral"> = { high: "down", moderate: "amber", low: "neutral" };
const CLS_COLORS: Record<string, string> = { GC: "#3B9DFF", WARM: "#FFB400", SPECIAL: "#FF8C00", HTB: "#FF3B3B" };

const TIME_RANGES = [
  { value: "1M", label: "1M", days: 22 },
  { value: "3M", label: "3M", days: 66 },
  { value: "6M", label: "6M", days: 130 },
  { value: "1Y", label: "1Y", days: 260 },
];

const GROUP_OPTIONS: { value: UtilGroupBy; label: string }[] = [
  { value: "all", label: "Overall" },
  { value: "sector", label: "Sector" },
  { value: "assetClass", label: "Asset Class" },
  { value: "classification", label: "Classification" },
  { value: "source", label: "Source" },
];

const RATE_OPTIONS = BENCHMARK_SERIES
  .filter((s) => s.unit === "%" || s.unit === "bps")
  .map((s) => ({ value: s.id, label: `${s.short} — ${s.label}` }));

export default function UtilizationPage() {
  // ── Benchmark rate data ──────────────────────────────────────────
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

  // ── Securities lending data ──────────────────────────────────────
  const inventory = useMemo(() => getInventory(), []);
  const squeezeBoard = useMemo(() => getSqueezeBoard(), []);
  const sectorHeat = useMemo(() => getSectorHeat(), []);

  // ── State ────────────────────────────────────────────────────────
  const [tab, setTab] = useState<"dashboard" | "overlay" | "blends" | "impact">("dashboard");
  const [groupBy, setGroupBy] = useState<UtilGroupBy>("sector");
  const [timeRange, setTimeRange] = useState("1Y");
  const [selectedRate, setSelectedRate] = useState("SOFR");
  const [selectedBlend, setSelectedBlend] = useState(PRESET_BLENDS[0].id);
  const [userBlends, setUserBlends] = useState<CustomBlend[]>([]);
  const [exporting, setExporting] = useState(false);

  // Blend builder state
  const [showBuilder, setShowBuilder] = useState(false);
  const [blendName, setBlendName] = useState("");
  const [blendDesc, setBlendDesc] = useState("");
  const [blendSpread, setBlendSpread] = useState(0);
  const [blendComponents, setBlendComponents] = useState<BlendComponent[]>([
    { seriesId: "SOFR", weight: 1, label: "SOFR" },
  ]);

  // Load user blends on mount
  useEffect(() => {
    setUserBlends(loadUserBlends());
  }, []);

  // ── Refs ─────────────────────────────────────────────────────────
  const overlayChartRef = useRef<HTMLDivElement>(null);
  const blendChartRef = useRef<HTMLDivElement>(null);

  // ── Derived data ─────────────────────────────────────────────────
  const snapshot = useMemo(() => computeUtilizationSnapshot(inventory, groupBy), [inventory, groupBy]);
  const utilTimeSeries = useMemo(() => buildUtilizationTimeSeries(inventory, squeezeBoard, groupBy), [inventory, squeezeBoard, groupBy]);
  const overallSeries = useMemo(() => buildUtilizationTimeSeries(inventory, squeezeBoard, "all"), [inventory, squeezeBoard]);
  const clsSeries = useMemo(() => buildUtilizationTimeSeries(inventory, squeezeBoard, "classification"), [inventory, squeezeBoard]);

  const allBlendResults = useMemo(() => computeAllBlends(map, PRESET_BLENDS, userBlends), [map, userBlends]);
  const selectedBlendResult = useMemo(() => allBlendResults.find((b) => b.blend.id === selectedBlend), [allBlendResults, selectedBlend]);

  const rateIds = useMemo(() => BENCHMARK_SERIES.filter((s) => s.unit === "%" || s.unit === "bps").map((s) => s.id), []);
  const correlations = useMemo(() => computeRateUtilCorrelation(map, overallSeries, rateIds, 60), [map, overallSeries, rateIds]);
  const sensitivity = useMemo(() => computeRateSensitivity(map, overallSeries), [map, overallSeries]);
  const summary = useMemo(() => computeUtilSummary(inventory, allBlendResults, sensitivity), [inventory, allBlendResults, sensitivity]);

  const rangeDays = TIME_RANGES.find((r) => r.value === timeRange)?.days ?? 260;

  // Overlay data
  const overlayUtil = overallSeries[0];
  const overlayRate = map[selectedRate] ?? [];
  const overlay = useMemo(() => {
    if (!overlayUtil) return null;
    return normalizeForOverlay(overlayRate, overlayUtil.history, rangeDays);
  }, [overlayRate, overlayUtil, rangeDays]);

  // Scatter data for correlation
  const scatterData = useMemo(() => {
    if (!overlayUtil || overlayRate.length < 30) return [];
    const rSlice = overlayRate.slice(-rangeDays);
    const uSlice = overlayUtil.history.slice(-rangeDays);
    const len = Math.min(rSlice.length, uSlice.length);
    const points: { x: number; y: number }[] = [];
    for (let i = 1; i < len; i++) {
      points.push({
        x: rSlice[rSlice.length - len + i].value - rSlice[rSlice.length - len + i - 1].value,
        y: uSlice[uSlice.length - len + i].value - uSlice[uSlice.length - len + i - 1].value,
      });
    }
    return points;
  }, [overlayRate, overlayUtil, rangeDays]);

  // ── Handlers ─────────────────────────────────────────────────────
  const handleExportPdf = useCallback(async () => {
    setExporting(true);
    try {
      await generateUtilizationPdf({
        map,
        inventory,
        squeezeBoard,
        blends: allBlendResults,
        source: badgeSource,
        tab,
        groupBy,
        selectedRate,
        selectedBlend,
        timeRange,
        chartRef: overlayChartRef.current,
        blendChartRef: blendChartRef.current,
      });
    } finally {
      setExporting(false);
    }
  }, [map, inventory, squeezeBoard, allBlendResults, badgeSource, tab, groupBy, selectedRate, selectedBlend, timeRange]);

  const handleSaveBlend = () => {
    const blend: CustomBlend = {
      id: `user-${Date.now()}`,
      name: blendName || "Custom Blend",
      components: blendComponents,
      spreadBps: blendSpread,
      description: blendDesc,
    };
    const errs = validateBlend(blend, Object.keys(map));
    if (errs.length > 0) return;
    const updated = [...userBlends, blend];
    setUserBlends(updated);
    saveUserBlends(updated);
    setSelectedBlend(blend.id);
    setShowBuilder(false);
    setBlendName("");
    setBlendDesc("");
    setBlendSpread(0);
    setBlendComponents([{ seriesId: "SOFR", weight: 1, label: "SOFR" }]);
  };

  const handleDeleteBlend = (id: string) => {
    deleteUserBlend(id);
    const updated = userBlends.filter((b) => b.id !== id);
    setUserBlends(updated);
    if (selectedBlend === id) setSelectedBlend(PRESET_BLENDS[0].id);
  };

  // ── Column defs ──────────────────────────────────────────────────

  const utilCols: Column<UtilizationTimeSeries>[] = [
    { key: "group", header: "Group", width: "100px", render: (r) => <span className="font-semibold text-term-amber">{r.groupKey}</span>, sortVal: (r) => r.groupKey },
    { key: "util", header: "Util %", align: "right", width: "64px", render: (r) => <span className="tnum font-semibold text-term-text">{r.current.utilization.toFixed(1)}%</span>, sortVal: (r) => r.current.utilization },
    { key: "fee", header: "Avg Fee", align: "right", width: "64px", render: (r) => <span className="tnum text-term-text-dim">{r.current.avgFeeBps.toFixed(0)}bps</span>, sortVal: (r) => r.current.avgFeeBps },
    { key: "names", header: "Names", align: "right", width: "52px", render: (r) => <span className="tnum text-term-text-dim">{r.current.nameCount}</span>, sortVal: (r) => r.current.nameCount },
    { key: "htb", header: "HTB", align: "right", width: "44px", render: (r) => <span className={clsx("tnum", r.current.htbCount > 0 ? "text-term-down font-semibold" : "text-term-text-dim")}>{r.current.htbCount}</span>, sortVal: (r) => r.current.htbCount },
    { key: "spec", header: "SPCL", align: "right", width: "44px", render: (r) => <span className={clsx("tnum", r.current.specialCount > 0 ? "text-term-amber" : "text-term-text-dim")}>{r.current.specialCount}</span>, sortVal: (r) => r.current.specialCount },
    {
      key: "range", header: "Util Range", width: "90px",
      render: (r) => <ProgressBar value={r.current.utilization} max={100} color={r.current.utilization > 80 ? "#FF3B3B" : r.current.utilization > 60 ? "#FFB400" : "#2ECC71"} height={6} />,
      sortVal: (r) => r.current.utilization,
    },
    { key: "spark", header: "60D", width: "80px", render: (r) => <Sparkline data={r.history.slice(-60).map((o) => o.value)} width={70} height={18} /> },
  ];

  const corrCols: Column<RateUtilCorrelation>[] = [
    { key: "rate", header: "Benchmark", width: "80px", render: (r) => <span className="font-semibold text-term-amber">{r.rateLabel}</span>, sortVal: (r) => r.rateLabel },
    { key: "corr", header: "Correlation", align: "right", width: "80px", render: (r) => <span className={clsx("tnum font-semibold", r.correlation != null && Math.abs(r.correlation) > 0.4 ? "text-term-amber" : "text-term-text-dim")}>{r.correlation?.toFixed(3) ?? "—"}</span>, sortVal: (r) => Math.abs(r.correlation ?? 0) },
    { key: "beta", header: "Beta", align: "right", width: "64px", render: (r) => <span className="tnum text-term-text-dim">{r.beta?.toFixed(4) ?? "—"}</span>, sortVal: (r) => Math.abs(r.beta ?? 0) },
    { key: "r2", header: "R²", align: "right", width: "52px", render: (r) => <span className="tnum text-term-text-dim">{r.rSquared?.toFixed(3) ?? "—"}</span>, sortVal: (r) => r.rSquared ?? 0 },
    { key: "interp", header: "Interpretation", render: (r) => <span className="text-term-text-mute">{r.interpretation}</span>, sortVal: (r) => r.interpretation },
  ];

  const blendCols: Column<BlendResult>[] = [
    { key: "name", header: "Blend", width: "140px", render: (r) => <button className="text-left font-semibold text-term-amber hover:underline" onClick={() => setSelectedBlend(r.blend.id)}>{r.blend.name}</button>, sortVal: (r) => r.blend.name },
    { key: "current", header: "Current", align: "right", width: "72px", render: (r) => <span className="tnum font-semibold text-term-text">{r.current != null ? `${r.current.toFixed(2)}%` : "—"}</span>, sortVal: (r) => r.current ?? 0 },
    { key: "chg1d", header: "Δ1D", align: "right", width: "60px", render: (r) => <span className={clsx("tnum", pnlClass(-(r.chg1d ?? 0)))}>{r.chg1d != null ? `${fmtSigned(r.chg1d * 100, 1)}bps` : "—"}</span>, sortVal: (r) => r.chg1d ?? 0 },
    { key: "chg20d", header: "Δ20D", align: "right", width: "60px", render: (r) => <span className={clsx("tnum", pnlClass(-(r.chg20d ?? 0)))}>{r.chg20d != null ? `${fmtSigned(r.chg20d * 100, 1)}bps` : "—"}</span>, sortVal: (r) => r.chg20d ?? 0 },
    { key: "pctl", header: "Pctl", align: "right", width: "52px", render: (r) => <span className="tnum text-term-text-dim">{r.percentile != null ? `${r.percentile}%` : "—"}</span>, sortVal: (r) => r.percentile ?? 50 },
    { key: "z", header: "Z", align: "right", width: "52px", render: (r) => <span className={clsx("tnum", r.zScore != null && Math.abs(r.zScore) > 1.5 ? "text-term-down font-semibold" : "text-term-text-dim")}>{r.zScore != null ? fmtSigned(r.zScore, 2) : "—"}</span>, sortVal: (r) => r.zScore ?? 0 },
    { key: "desc", header: "Description", render: (r) => <span className="text-term-text-mute text-3xs">{r.blend.description}</span>, sortVal: (r) => r.blend.description },
    {
      key: "actions", header: "", width: "32px",
      render: (r) => r.blend.id.startsWith("user-") ? (
        <button onClick={() => handleDeleteBlend(r.blend.id)} className="text-term-text-dim hover:text-term-down"><Trash2 size={12} /></button>
      ) : null,
    },
  ];

  const sensCols: Column<RateSensitivity>[] = [
    { key: "rate", header: "Benchmark", width: "80px", render: (r) => <span className="font-semibold text-term-amber">{r.rateLabel}</span>, sortVal: (r) => r.rateLabel },
    { key: "impact", header: "Impact", width: "72px", render: (r) => <Tag tone={IMPACT_TONE[r.impact]}>{r.impact}</Tag>, sortVal: (r) => r.impact },
    { key: "mag", header: "Magnitude", width: "72px", render: (r) => <Tag tone={MAG_TONE[r.magnitude] as "up" | "down" | "neutral"}>{r.magnitude}</Tag>, sortVal: (r) => r.magnitude },
    { key: "beta", header: "Beta", align: "right", width: "64px", render: (r) => <span className="tnum text-term-text-dim">{r.beta?.toFixed(4) ?? "—"}</span>, sortVal: (r) => Math.abs(r.beta ?? 0) },
    { key: "desc", header: "Description", render: (r) => <span className="text-term-text-mute">{r.description}</span>, sortVal: (r) => r.description },
  ];

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="UTIL"
        title="Utilization Analytics"
        desc="Securities lending utilization, benchmark rate overlays & custom rate blends"
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
        <Stat label="Overall Util" value={summary.overallUtil != null ? `${summary.overallUtil.toFixed(1)}%` : "—"} tone={summary.overallUtil != null && summary.overallUtil > 75 ? "down" : "neutral"} />
        <Stat label="HTB Util" value={summary.htbUtil != null ? `${summary.htbUtil.toFixed(1)}%` : "—"} tone="down" />
        <Stat label="GC Util" value={summary.gcUtil != null ? `${summary.gcUtil.toFixed(1)}%` : "—"} />
        <Stat label="Avg Fee" value={summary.avgFeeBps != null ? `${summary.avgFeeBps.toFixed(0)}bps` : "—"} tone="amber" />
        <Stat label="Top Driver" value={summary.topSensitivity} sub="rate sensitivity" />
        <Stat label="Blends" value={String(summary.blendCount)} sub="active" />
      </KpiStrip>

      {/* View tabs + controls */}
      <div className="flex items-center gap-3 border-b border-term-border bg-term-panel px-3 py-1.5">
        <TermToggleGroup value={tab} onChange={setTab} options={[
          { value: "dashboard", label: "Dashboard" },
          { value: "overlay", label: "Benchmark Overlay" },
          { value: "blends", label: "Custom Blends" },
          { value: "impact", label: "Rate Impact" },
        ]} size="sm" />
        <TermToggleGroup label="Range" value={timeRange} onChange={setTimeRange} options={TIME_RANGES.map((r) => ({ value: r.value, label: r.label }))} size="sm" />
        {tab === "dashboard" && (
          <TermToggleGroup label="Group" value={groupBy} onChange={setGroupBy as (v: string) => void} options={GROUP_OPTIONS} size="sm" />
        )}
      </div>

      <div className="grid grid-cols-12 gap-2 p-2">

        {/* ── TAB: Dashboard ──────────────────────────────────────── */}
        {tab === "dashboard" && (
          <>
            <div className="col-span-12 xl:col-span-8">
              <Panel title="Utilization by Group" code="UTIL" accent right={<span className="text-3xs text-term-text-dim">{Object.keys(snapshot).length} groups</span>}>
                <DataGrid columns={utilCols} rows={utilTimeSeries} rowKey={(r) => r.groupKey} maxHeight="520px" zebra initialSort={{ key: "util", dir: "desc" }} />
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4 flex flex-col gap-2">
              <Panel title="Utilization by Classification" code="CLS">
                <div className="p-2">
                  <BarChart
                    data={["GC", "WARM", "SPECIAL", "HTB"].map((cls) => {
                      const m = computeUtilizationSnapshot(inventory, "classification")[cls];
                      return { label: cls, value: m?.utilization ?? 0, color: CLS_COLORS[cls] };
                    })}
                    height={160}
                    fmt={(v) => `${v.toFixed(1)}%`}
                  />
                </div>
              </Panel>

              <Panel title="Sector Heat" code="HEAT">
                <div className="p-2">
                  <BarChart
                    data={sectorHeat.slice(0, 10).map((s) => ({
                      label: s.sector.length > 12 ? s.sector.slice(0, 12) + "…" : s.sector,
                      value: s.avgUtil,
                      color: s.heat > 65 ? "#FF3B3B" : s.heat > 45 ? "#FFB400" : "#3B9DFF",
                    }))}
                    height={200}
                    horizontal
                    fmt={(v) => `${v}%`}
                  />
                </div>
              </Panel>

              <Panel title="Overall Utilization Trend" code="TRND">
                <div className="p-2">
                  {overallSeries[0] && (
                    <LineChart
                      series={[{ name: "Utilization", data: overallSeries[0].history.slice(-rangeDays).map((o) => o.value), color: "#FF8C00" }]}
                      labels={overallSeries[0].history.slice(-rangeDays).map((o) => o.date)}
                      height={140}
                      yFmt={(v) => `${v.toFixed(1)}%`}
                    />
                  )}
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ── TAB: Benchmark Overlay ──────────────────────────────── */}
        {tab === "overlay" && (
          <>
            <div className="col-span-12 xl:col-span-8 flex flex-col gap-2">
              <Panel
                title="Utilization vs Benchmark Rate"
                code="OVLY"
                accent
                right={
                  <TermSelect value={selectedRate} onChange={setSelectedRate} options={RATE_OPTIONS} size="sm" />
                }
              >
                <div ref={overlayChartRef} className="p-2">
                  {overlay && (
                    <LineChart
                      series={[
                        { name: "Utilization (norm)", data: overlay.utilPct, color: "#FF8C00" },
                        { name: `${defOf(selectedRate)?.short ?? selectedRate} (norm)`, data: overlay.ratePct, color: "#3B9DFF", dashed: true },
                      ]}
                      labels={overlay.dates}
                      height={300}
                      yFmt={(v) => `${v.toFixed(0)}%`}
                    />
                  )}
                </div>
                <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">
                  Both series normalized to 0–100% range for visual comparison
                </div>
              </Panel>

              <Panel title="Rate Change vs Utilization Change" code="SCTR">
                <div className="p-2">
                  <ScatterPlot
                    points={scatterData}
                    height={220}
                    xLabel={`Δ ${defOf(selectedRate)?.short ?? selectedRate}`}
                    yLabel="Δ Utilization"
                    color="#FF8C00"
                  />
                </div>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4 flex flex-col gap-2">
              <Panel title="Rate-Utilization Correlation" code="CORR">
                <DataGrid columns={corrCols} rows={correlations.slice(0, 15)} rowKey={(r) => `${r.rateId}-${r.utilGroup}`} maxHeight="400px" zebra initialSort={{ key: "corr", dir: "desc" }} />
              </Panel>

              <Panel title="Rate Sensitivity" code="SENS">
                <div className="divide-y divide-term-border-soft">
                  {sensitivity.slice(0, 8).map((s) => (
                    <div key={s.rateId} className="flex items-center justify-between px-3 py-1.5 text-2xs">
                      <span className="font-semibold text-term-amber">{s.rateLabel}</span>
                      <span className="flex items-center gap-2">
                        <Tag tone={IMPACT_TONE[s.impact]}>{s.impact}</Tag>
                        <Tag tone={MAG_TONE[s.magnitude] as "up" | "down" | "neutral"}>{s.magnitude}</Tag>
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ── TAB: Custom Blends ──────────────────────────────────── */}
        {tab === "blends" && (
          <>
            <div className="col-span-12 xl:col-span-8 flex flex-col gap-2">
              <Panel
                title="Benchmark Blends"
                code="BLND"
                accent
                right={
                  <button onClick={() => setShowBuilder(!showBuilder)} className="flex items-center gap-1 rounded border border-term-border bg-term-panel px-2 py-0.5 text-2xs text-term-text-dim hover:text-term-amber">
                    <Plus size={12} />
                    New Blend
                  </button>
                }
              >
                <DataGrid columns={blendCols} rows={allBlendResults} rowKey={(r) => r.blend.id} maxHeight="400px" zebra />
              </Panel>

              {selectedBlendResult && (
                <Panel title={`Blend Chart — ${selectedBlendResult.blend.name}`} code="BCRT">
                  <div ref={blendChartRef} className="p-2">
                    <LineChart
                      series={[{ name: selectedBlendResult.blend.name, data: selectedBlendResult.history.slice(-rangeDays).map((o) => o.value), color: "#A78BFA" }]}
                      labels={selectedBlendResult.history.slice(-rangeDays).map((o) => o.date)}
                      height={240}
                      yFmt={(v) => `${v.toFixed(2)}%`}
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-px border-t border-term-border bg-term-border text-center text-2xs">
                    <div className="bg-term-panel px-2 py-1.5">
                      <div className="text-3xs text-term-text-mute">Current</div>
                      <div className="tnum font-semibold text-term-text">{selectedBlendResult.current != null ? `${selectedBlendResult.current.toFixed(2)}%` : "—"}</div>
                    </div>
                    <div className="bg-term-panel px-2 py-1.5">
                      <div className="text-3xs text-term-text-mute">Δ1D</div>
                      <div className={clsx("tnum font-semibold", pnlClass(-(selectedBlendResult.chg1d ?? 0)))}>{selectedBlendResult.chg1d != null ? `${fmtSigned(selectedBlendResult.chg1d * 100, 1)}bps` : "—"}</div>
                    </div>
                    <div className="bg-term-panel px-2 py-1.5">
                      <div className="text-3xs text-term-text-mute">Percentile</div>
                      <div className="tnum text-term-text-dim">{selectedBlendResult.percentile != null ? `${selectedBlendResult.percentile}%` : "—"}</div>
                    </div>
                    <div className="bg-term-panel px-2 py-1.5">
                      <div className="text-3xs text-term-text-mute">Z-Score</div>
                      <div className={clsx("tnum font-semibold", selectedBlendResult.zScore != null && Math.abs(selectedBlendResult.zScore) > 1.5 ? "text-term-down" : "text-term-text")}>
                        {selectedBlendResult.zScore != null ? fmtSigned(selectedBlendResult.zScore, 2) : "—"}
                      </div>
                    </div>
                  </div>
                </Panel>
              )}
            </div>

            <div className="col-span-12 xl:col-span-4 flex flex-col gap-2">
              {showBuilder && (
                <Panel title="Blend Builder" code="BLDR">
                  <div className="space-y-3 p-3">
                    <div>
                      <label className="mb-1 block text-3xs font-semibold uppercase tracking-wider text-term-text-mute">Name</label>
                      <input type="text" value={blendName} onChange={(e) => setBlendName(e.target.value)} placeholder="Custom Blend" className="w-full rounded border border-term-border bg-term-bg px-2 py-1 text-2xs text-term-text outline-none focus:border-term-amber" />
                    </div>
                    <div>
                      <label className="mb-1 block text-3xs font-semibold uppercase tracking-wider text-term-text-mute">Description</label>
                      <input type="text" value={blendDesc} onChange={(e) => setBlendDesc(e.target.value)} placeholder="Optional description" className="w-full rounded border border-term-border bg-term-bg px-2 py-1 text-2xs text-term-text outline-none focus:border-term-amber" />
                    </div>
                    <div>
                      <label className="mb-1 block text-3xs font-semibold uppercase tracking-wider text-term-text-mute">Components</label>
                      {blendComponents.map((c, i) => (
                        <div key={i} className="mb-1 flex items-center gap-1">
                          <select
                            value={c.seriesId}
                            onChange={(e) => {
                              const updated = [...blendComponents];
                              const def = defOf(e.target.value);
                              updated[i] = { ...c, seriesId: e.target.value, label: def?.short ?? e.target.value };
                              setBlendComponents(updated);
                            }}
                            className="flex-1 rounded border border-term-border bg-term-bg px-1 py-0.5 text-2xs text-term-text outline-none"
                          >
                            {BENCHMARK_SERIES.map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}
                          </select>
                          <input
                            type="number"
                            value={Math.round(c.weight * 100)}
                            onChange={(e) => {
                              const updated = [...blendComponents];
                              updated[i] = { ...c, weight: Number(e.target.value) / 100 };
                              setBlendComponents(updated);
                            }}
                            className="w-14 rounded border border-term-border bg-term-bg px-1 py-0.5 text-right text-2xs text-term-text outline-none"
                            min={0} max={100}
                          />
                          <span className="text-3xs text-term-text-mute">%</span>
                          {blendComponents.length > 1 && (
                            <button onClick={() => setBlendComponents(blendComponents.filter((_, j) => j !== i))} className="text-term-text-dim hover:text-term-down"><Trash2 size={11} /></button>
                          )}
                        </div>
                      ))}
                      <button onClick={() => setBlendComponents([...blendComponents, { seriesId: "EFFR", weight: 0, label: "EFFR" }])} className="mt-1 text-2xs text-term-amber hover:underline">+ Add Component</button>
                      <div className="mt-1 text-3xs text-term-text-mute">
                        Total: {Math.round(blendComponents.reduce((a, c) => a + c.weight, 0) * 100)}%
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-3xs font-semibold uppercase tracking-wider text-term-text-mute">Fixed Spread (bps)</label>
                      <input type="number" value={blendSpread} onChange={(e) => setBlendSpread(Number(e.target.value))} className="w-20 rounded border border-term-border bg-term-bg px-2 py-1 text-right text-2xs text-term-text outline-none focus:border-term-amber" />
                    </div>
                    <button onClick={handleSaveBlend} className="w-full rounded border border-term-amber bg-term-amber/10 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-term-amber hover:bg-term-amber/20">
                      Save Blend
                    </button>
                  </div>
                </Panel>
              )}

              {selectedBlendResult && (
                <Panel title="Blend Components" code="COMP">
                  <div className="divide-y divide-term-border-soft">
                    {selectedBlendResult.blend.components.map((c) => (
                      <div key={c.seriesId} className="flex items-center justify-between px-3 py-1.5 text-2xs">
                        <span className="text-term-text-mute">{c.label}</span>
                        <span className="tnum font-semibold text-term-text">{Math.round(c.weight * 100)}%</span>
                      </div>
                    ))}
                    {selectedBlendResult.blend.spreadBps !== 0 && (
                      <div className="flex items-center justify-between px-3 py-1.5 text-2xs">
                        <span className="text-term-text-mute">Fixed Spread</span>
                        <span className="tnum font-semibold text-term-amber">{fmtSigned(selectedBlendResult.blend.spreadBps, 0)}bps</span>
                      </div>
                    )}
                  </div>
                </Panel>
              )}

              <Panel title="Blend Comparison" code="BCMP">
                <div className="p-2">
                  <LineChart
                    series={allBlendResults.slice(0, 5).map((b, i) => ({
                      name: b.blend.name,
                      data: b.history.slice(-rangeDays).map((o) => o.value),
                      color: ["#A78BFA", "#3B9DFF", "#2ECC71", "#FF8C00", "#FF3B3B"][i % 5],
                    }))}
                    labels={allBlendResults[0]?.history.slice(-rangeDays).map((o) => o.date) ?? []}
                    height={200}
                    yFmt={(v) => `${v.toFixed(2)}%`}
                  />
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ── TAB: Rate Impact ────────────────────────────────────── */}
        {tab === "impact" && (
          <>
            <div className="col-span-12 xl:col-span-8 flex flex-col gap-2">
              <Panel title="Rate Sensitivity Rankings" code="SNSR" accent>
                <DataGrid columns={sensCols} rows={sensitivity} rowKey={(r) => r.rateId} maxHeight="520px" zebra initialSort={{ key: "mag", dir: "desc" }} />
              </Panel>

              <Panel title="Sensitivity by Magnitude" code="SBAR">
                <div className="p-2">
                  <BarChart
                    data={sensitivity.slice(0, 12).map((s) => ({
                      label: s.rateLabel,
                      value: Math.abs(s.beta ?? 0) * 100,
                      color: s.impact === "positive" ? "#2ECC71" : s.impact === "negative" ? "#FF3B3B" : "#3B9DFF",
                    }))}
                    height={220}
                    horizontal
                    fmt={(v) => `${v.toFixed(2)}`}
                  />
                </div>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4 flex flex-col gap-2">
              <Panel title="Utilization by Classification" code="UCLS">
                <div className="divide-y divide-term-border-soft">
                  {clsSeries.map((s) => (
                    <div key={s.groupKey} className="flex items-center justify-between px-3 py-2 text-2xs">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CLS_COLORS[s.groupKey] ?? "#3B9DFF" }} />
                        <span className="font-semibold text-term-text">{s.groupKey}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tnum text-term-text-dim">{s.current.nameCount} names</span>
                        <span className="tnum font-semibold text-term-text">{s.current.utilization.toFixed(1)}%</span>
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Classification Utilization Trend" code="CLST">
                <div className="p-2">
                  <LineChart
                    series={clsSeries.slice(0, 4).map((s, i) => ({
                      name: s.groupKey,
                      data: s.history.slice(-rangeDays).map((o) => o.value),
                      color: CLS_COLORS[s.groupKey] ?? ["#3B9DFF", "#FFB400", "#FF8C00", "#FF3B3B"][i % 4],
                    }))}
                    labels={clsSeries[0]?.history.slice(-rangeDays).map((o) => o.date) ?? []}
                    height={200}
                    yFmt={(v) => `${v.toFixed(1)}%`}
                  />
                </div>
              </Panel>

              <Panel title="Fee Trend by Classification" code="FEET">
                <div className="p-2">
                  <LineChart
                    series={clsSeries.slice(0, 4).map((s, i) => ({
                      name: s.groupKey,
                      data: s.feeHistory.slice(-rangeDays).map((o) => o.value),
                      color: CLS_COLORS[s.groupKey] ?? ["#3B9DFF", "#FFB400", "#FF8C00", "#FF3B3B"][i % 4],
                    }))}
                    labels={clsSeries[0]?.feeHistory.slice(-rangeDays).map((o) => o.date) ?? []}
                    height={200}
                    yFmt={(v) => `${v.toFixed(0)}bps`}
                  />
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
