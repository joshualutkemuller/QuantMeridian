
import { useCallback, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { FileDown } from "lucide-react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { CorrelationMatrix } from "@/components/charts/Matrix";
import { ProgressBar } from "@/components/charts/Radial";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { TermSelect } from "@/components/ui/TermSelect";
import { ChartLink } from "@/components/charting/ChartLink";
import { DataLegend } from "@/components/ui/DataLegend";
import { isRealEconSource, useLiveSeriesSet, type DataSource , useMacroInputs } from "@/lib/useEcon";
import { fmtNum, fmtSigned, fmtBps, pnlClass } from "@/lib/format";
import { generateBenchmarkPdf } from "@/lib/benchmarkPdf";
import {
  BENCHMARK_SERIES,
  BENCHMARK_FRED_IDS,
  CATEGORIES,
  SPREAD_PAIRS,
  buildFallback, buildFallbackWithAnchors,
  computeSummary,
  computeStatusBoard,
  computeAllSpreads,
  computeSpread,
  computeTrend,
  computeCorrelation,
  classifyRegime,
  defOf,
  type BenchmarkCategory,
  type BenchmarkDef,
  type BenchmarkStatus,
  type SpreadResult,
  type SeriesMap,
  type StatusLevel,
} from "@/data/benchmarkRates";

const STATUS_TONE: Record<StatusLevel, "up" | "down" | "neutral"> = { elevated: "down", depressed: "up", normal: "neutral" };
const DIRECTION_TONE: Record<string, "up" | "down" | "neutral"> = { rising: "down", falling: "up", flat: "neutral" };
const REGIME_TONE: Record<string, "up" | "amber" | "down" | "neutral"> = {
  Tightening: "down",
  Restrictive: "amber",
  Neutral: "neutral",
  Easing: "up",
  Accommodative: "up",
};

const TIME_RANGES = [
  { value: "1M", label: "1M", days: 22 },
  { value: "3M", label: "3M", days: 66 },
  { value: "6M", label: "6M", days: 130 },
  { value: "1Y", label: "1Y", days: 260 },
  { value: "2Y", label: "2Y", days: 520 },
];

const CORR_GROUPS = [
  { value: "overnight", label: "Overnight", ids: ["SOFR", "EFFR", "OBFR", "IORB", "BGCR", "TGCR"] },
  { value: "curve", label: "Curve", ids: ["DGS1MO", "DGS3MO", "DGS1", "DGS2", "DGS5", "DGS10", "DGS30"] },
  { value: "credit", label: "Credit", ids: ["BAMLC0A1CAAA", "BAMLC0A0CM", "BAMLC0A4CBBB", "BAMLH0A0HYM2"] },
  { value: "cross", label: "Cross-Asset", ids: ["SOFR", "DGS2", "DGS10", "BAMLH0A0HYM2", "MORTGAGE30US", "DCOILWTICO", "GOLDPMGBD228NLBM"] },
];

function fmtVal(def: BenchmarkDef, v: number | null): string {
  if (v == null) return "—";
  if (def.unit === "bps") return `${v.toFixed(0)}`;
  if (def.unit === "$/bbl" || def.unit === "$/oz") return `${v.toFixed(def.decimals)}`;
  return `${v.toFixed(def.decimals)}%`;
}

function chgBps(def: BenchmarkDef, cur: number | null, prev: number | null): { text: string; n: number } {
  if (cur == null || prev == null) return { text: "—", n: 0 };
  if (def.unit === "%") {
    const bps = (cur - prev) * 100;
    return { text: `${bps >= 0 ? "+" : ""}${bps.toFixed(1)}`, n: bps };
  }
  const d = cur - prev;
  return { text: fmtSigned(d, def.decimals), n: d };
}

export default function BenchmarkRatesPage() {
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
  const badgeSource: DataSource = anyReal ? (source === "FRED" ? "FRED" : "SNAPSHOT") : "SIM";

  // State
  const [catFilter, setCatFilter] = useState<string>("ALL");
  const [timeRange, setTimeRange] = useState("1Y");
  const [spreadId, setSpreadId] = useState(SPREAD_PAIRS[2].id); // 10Y-2Y default
  const [corrGroup, setCorrGroup] = useState("cross");
  const [detailId, setDetailId] = useState("DGS10");
  const [tab, setTab] = useState<"status" | "trends" | "spreads">("status");
  const [exporting, setExporting] = useState(false);

  // Refs for chart capture during PDF export
  const trendChartRef = useRef<HTMLDivElement>(null);
  const spreadChartRef = useRef<HTMLDivElement>(null);

  const handleExportPdf = useCallback(async () => {
    setExporting(true);
    try {
      await generateBenchmarkPdf({
        map,
        source: badgeSource,
        tab,
        catFilter,
        timeRange,
        detailId,
        spreadId,
        chartRef: trendChartRef.current,
        spreadChartRef: spreadChartRef.current,
      });
    } finally {
      setExporting(false);
    }
  }, [map, badgeSource, tab, catFilter, timeRange, detailId, spreadId]);

  // Derived data
  const summary = useMemo(() => computeSummary(map), [map]);
  const statusBoard = useMemo(() => computeStatusBoard(map), [map]);
  const allSpreads = useMemo(() => computeAllSpreads(map), [map]);
  const selectedSpread = useMemo(() => computeSpread(map, spreadId), [map, spreadId]);
  const regime = useMemo(() => classifyRegime(map), [map]);
  const detailTrend = useMemo(() => computeTrend(map[detailId] ?? []), [map, detailId]);
  const detailDef = defOf(detailId);

  const corrConfig = CORR_GROUPS.find((g) => g.value === corrGroup) ?? CORR_GROUPS[3];
  const corrResult = useMemo(() => computeCorrelation(map, corrConfig.ids, 60), [map, corrConfig.ids]);

  const rangeDays = TIME_RANGES.find((r) => r.value === timeRange)?.days ?? 260;

  const filteredStatus = catFilter === "ALL" ? statusBoard : statusBoard.filter((s) => s.def.category === catFilter);

  // Chart series for detail panel
  const detailObs = map[detailId] ?? [];
  const detailSlice = detailObs.slice(-rangeDays);
  const detailChartData = detailSlice.map((o) => o.value);
  const detailChartDates = detailSlice.map((o) => o.date);

  // Spread chart
  const spreadSlice = selectedSpread ? selectedSpread.hist.slice(-rangeDays) : [];
  const spreadDates = selectedSpread ? selectedSpread.dates.slice(-rangeDays) : [];

  // Status grid columns
  const statusCols: Column<BenchmarkStatus>[] = [
    {
      key: "short",
      header: "Rate",
      width: "72px",
      render: (s) => (
        <button className="text-left font-semibold text-term-amber hover:underline" onClick={() => setDetailId(s.def.id)}>
          {s.def.short}
        </button>
      ),
      sortVal: (s) => s.def.short,
    },
    {
      key: "category",
      header: "Class",
      width: "80px",
      render: (s) => <span className="text-term-text-mute">{s.def.category}</span>,
      sortVal: (s) => s.def.category,
    },
    {
      key: "current",
      header: "Current",
      align: "right",
      width: "80px",
      render: (s) => <span className="tnum font-semibold text-term-text">{fmtVal(s.def, s.current)}</span>,
      sortVal: (s) => s.current ?? 0,
    },
    {
      key: "chg1d",
      header: "Chg 1D",
      align: "right",
      width: "72px",
      render: (s) => {
        const c = chgBps(s.def, s.current, s.current != null && s.chg1d != null ? s.current - s.chg1d : null);
        return <span className={clsx("tnum", pnlClass(s.def.unit === "bps" ? -c.n : -c.n))}>{c.text}</span>;
      },
      sortVal: (s) => s.chg1dBps ?? 0,
    },
    {
      key: "percentile",
      header: "Pctl",
      align: "right",
      width: "52px",
      render: (s) => <span className="tnum text-term-text-dim">{s.percentile != null ? `${s.percentile}%` : "—"}</span>,
      sortVal: (s) => s.percentile ?? 50,
    },
    {
      key: "range",
      header: "52W Range",
      width: "100px",
      render: (s) => (
        <div className="flex items-center gap-1 px-1">
          <ProgressBar
            value={s.rangePosition ?? 50}
            max={100}
            color={s.rangePosition != null && s.rangePosition > 75 ? "#FF3B3B" : s.rangePosition != null && s.rangePosition < 25 ? "#2ECC71" : "#FF8C00"}
            height={6}
          />
        </div>
      ),
      sortVal: (s) => s.rangePosition ?? 50,
    },
    {
      key: "direction",
      header: "Trend",
      width: "64px",
      render: (s) => <Tag tone={DIRECTION_TONE[s.direction] ?? "neutral"}>{s.direction}</Tag>,
      sortVal: (s) => s.direction,
    },
    {
      key: "status",
      header: "Status",
      width: "72px",
      render: (s) => <Tag tone={STATUS_TONE[s.status]}>{s.status}</Tag>,
      sortVal: (s) => s.status,
    },
    {
      key: "spark",
      header: "60D",
      width: "80px",
      align: "right",
      render: (s) => (
        <span className="inline-flex justify-end">
          <Sparkline data={s.sparkHist} width={70} height={18} />
        </span>
      ),
    },
    {
      key: "chart",
      header: "",
      width: "32px",
      render: (s) => s.def.hasFred ? <ChartLink refs={[{ source: "econ", id: s.def.id }]} range="2Y" /> : null,
    },
  ];

  // Spread comparison columns
  const spreadCols: Column<SpreadResult>[] = [
    {
      key: "label",
      header: "Spread",
      width: "120px",
      render: (s) => (
        <button className="text-left font-semibold text-term-amber hover:underline" onClick={() => setSpreadId(s.pair.id)}>
          {s.pair.label}
        </button>
      ),
      sortVal: (s) => s.pair.label,
    },
    {
      key: "desc",
      header: "Description",
      render: (s) => <span className="text-term-text-mute">{s.pair.desc}</span>,
      sortVal: (s) => s.pair.desc,
    },
    {
      key: "current",
      header: "Current",
      align: "right",
      width: "72px",
      render: (s) => <span className="tnum font-semibold text-term-text">{s.current != null ? `${fmtSigned(s.current, 1)}` : "—"}</span>,
      sortVal: (s) => s.current ?? 0,
    },
    {
      key: "chg1d",
      header: "Δ1D",
      align: "right",
      width: "60px",
      render: (s) => <span className={clsx("tnum", pnlClass(-(s.chg1d ?? 0)))}>{s.chg1d != null ? fmtSigned(s.chg1d, 1) : "—"}</span>,
      sortVal: (s) => s.chg1d ?? 0,
    },
    {
      key: "chg20d",
      header: "Δ20D",
      align: "right",
      width: "60px",
      render: (s) => <span className={clsx("tnum", pnlClass(-(s.chg20d ?? 0)))}>{s.chg20d != null ? fmtSigned(s.chg20d, 1) : "—"}</span>,
      sortVal: (s) => s.chg20d ?? 0,
    },
    {
      key: "pctl",
      header: "Pctl",
      align: "right",
      width: "52px",
      render: (s) => <span className="tnum text-term-text-dim">{s.percentile != null ? `${s.percentile}%` : "—"}</span>,
      sortVal: (s) => s.percentile ?? 50,
    },
    {
      key: "z",
      header: "Z",
      align: "right",
      width: "52px",
      render: (s) => (
        <span className={clsx("tnum", s.zScore != null && Math.abs(s.zScore) > 1.5 ? "text-term-down font-semibold" : "text-term-text-dim")}>
          {s.zScore != null ? fmtSigned(s.zScore, 2) : "—"}
        </span>
      ),
      sortVal: (s) => s.zScore ?? 0,
    },
    {
      key: "spark",
      header: "History",
      width: "80px",
      align: "right",
      render: (s) => (
        <span className="inline-flex justify-end">
          <Sparkline data={s.hist.slice(-60)} width={70} height={18} />
        </span>
      ),
    },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="BMRK"
        title="Benchmark Rates"
        desc="Daily rates across asset classes — trend, status, comparison & regime"
        right={
          <span className="flex items-center gap-2">
            <button
              onClick={handleExportPdf}
              disabled={exporting}
              className="flex items-center gap-1 rounded border border-term-border bg-term-panel px-2 py-0.5 text-2xs text-term-text-dim hover:text-term-amber disabled:opacity-40"
            >
              <FileDown size={12} />
              {exporting ? "Exporting…" : "PDF"}
            </button>
            <ProvenanceBadge source={badgeSource} />
          </span>
        }
      />

      <KpiStrip>
        <Stat label="SOFR" value={summary.sofr != null ? `${summary.sofr.toFixed(2)}%` : "—"} sub={summary.sofrChgBps != null ? `${fmtSigned(summary.sofrChgBps, 1)}bps` : ""} tone="amber" />
        <Stat label="10Y Yield" value={summary.tenY != null ? `${summary.tenY.toFixed(2)}%` : "—"} sub={summary.tenYChgBps != null ? `${fmtSigned(summary.tenYChgBps, 1)}bps` : ""} tone={(summary.tenYChgBps ?? 0) <= 0 ? "up" : "down"} />
        <Stat label="2s10s Slope" value={summary.twoTenSlope != null ? `${fmtSigned(Number(summary.twoTenSlope), 0)}bps` : "—"} sub="curve shape" tone={(summary.twoTenSlope ?? 0) < 0 ? "down" : "up"} />
        <Stat label="IG OAS" value={summary.igOas != null ? `${summary.igOas.toFixed(0)}bps` : "—"} sub="investment grade" />
        <Stat label="HY OAS" value={summary.hyOas != null ? `${summary.hyOas.toFixed(0)}bps` : "—"} sub="high yield" tone={(summary.hyOas ?? 0) > 400 ? "down" : "neutral"} />
        <Stat label="30Y Mtg" value={summary.mtg30 != null ? `${summary.mtg30.toFixed(2)}%` : "—"} sub="fixed rate" />
        <Stat label="Regime" value={summary.regime} sub={`score ${summary.regimeScore}`} tone={REGIME_TONE[summary.regime] ?? "neutral"} />
      </KpiStrip>

      {/* View tabs */}
      <div className="flex items-center gap-3 border-b border-term-border bg-term-panel px-3 py-1.5">
        <TermToggleGroup value={tab} onChange={setTab} options={[{ value: "status", label: "Status Board" }, { value: "trends", label: "Trend Analysis" }, { value: "spreads", label: "Spread Analysis" }]} size="sm" />
        <TermToggleGroup label="Range" value={timeRange} onChange={setTimeRange} options={TIME_RANGES.map((r) => ({ value: r.value, label: r.label }))} size="sm" />
        {tab === "status" && (
          <TermToggleGroup label="Class" value={catFilter} onChange={setCatFilter} options={[{ value: "ALL", label: "All" }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]} size="sm" />
        )}
      </div>

      <div className="grid grid-cols-12 gap-2 p-2">
        {/* ── STATUS BOARD TAB ─────────────────────────────── */}
        {tab === "status" && (
          <>
            <div className="col-span-12 xl:col-span-9">
              <Panel
                title="Benchmark Status Board"
                code="STAT"
                accent
                right={<span className="tnum text-3xs text-term-text-mute">{filteredStatus.length} rates · {timeRange} window</span>}
              >
                <DataGrid
                  columns={statusCols}
                  rows={filteredStatus}
                  rowKey={(s) => s.def.id}
                  maxHeight="520px"
                  zebra
                  initialSort={{ key: "category", dir: "asc" }}
                  onRowClick={(s) => setDetailId(s.def.id)}
                  selectedKey={detailId}
                />
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-3 flex flex-col gap-2">
              <Panel title="Rate Regime" code="RGME" right={<Tag tone={REGIME_TONE[regime.regime] ?? "neutral"}>{regime.regime}</Tag>}>
                <div className="p-3">
                  <div className="flex items-end justify-between">
                    <span className="tnum text-3xl font-bold text-term-text">{regime.score}</span>
                    <span className="text-2xs text-term-text-mute">/ 100</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-sm bg-term-panel-3">
                    <div
                      className={clsx("h-full rounded-sm", regime.score >= 65 ? "bg-term-down" : regime.score >= 45 ? "bg-term-amber" : "bg-term-up")}
                      style={{ width: `${regime.score}%` }}
                    />
                  </div>
                  <div className="mt-3 flex flex-col gap-1">
                    {regime.drivers.map((d, i) => (
                      <div key={i} className="text-3xs text-term-text-dim">• {d}</div>
                    ))}
                  </div>
                </div>
              </Panel>

              <Panel title="Category Distribution" code="DIST">
                <div className="flex flex-col gap-2 p-2">
                  {CATEGORIES.map((cat) => {
                    const rows = statusBoard.filter((s) => s.def.category === cat);
                    const elevated = rows.filter((s) => s.status === "elevated").length;
                    const depressed = rows.filter((s) => s.status === "depressed").length;
                    return (
                      <button key={cat} onClick={() => { setCatFilter(cat); setTab("status"); }} className="flex flex-col gap-0.5 text-left hover:bg-term-panel-2 px-1 py-0.5 rounded">
                        <div className="flex items-center justify-between text-2xs">
                          <span className="font-semibold text-term-text">{cat}</span>
                          <span className="tnum text-term-text-dim">{rows.length}</span>
                        </div>
                        <div className="flex gap-1 text-3xs">
                          {elevated > 0 && <Tag tone="down">{elevated} elevated</Tag>}
                          {depressed > 0 && <Tag tone="up">{depressed} depressed</Tag>}
                          {elevated === 0 && depressed === 0 && <Tag tone="neutral">normal</Tag>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ── TREND ANALYSIS TAB ──────────────────────────── */}
        {tab === "trends" && (
          <>
            <div className="col-span-12 xl:col-span-8">
              <Panel
                title={`${detailDef?.label ?? detailId} — ${timeRange} History`}
                code="HIST"
                accent
                right={
                  <span className="flex items-center gap-2">
                    <TermSelect
                      value={detailId}
                      onChange={setDetailId}
                      options={BENCHMARK_SERIES.map((s) => ({ value: s.id, label: `${s.short} — ${s.label}` }))}
                      size="sm"
                    />
                    {detailDef?.hasFred && <ChartLink refs={[{ source: "econ", id: detailId }]} range="2Y" />}
                  </span>
                }
              >
                <div ref={trendChartRef} className="p-2">
                  <LineChart
                    series={[{ name: detailDef?.short ?? detailId, data: detailChartData, color: "#FF8C00" }]}
                    labels={detailChartDates}
                    height={300}
                    yFmt={(v) => detailDef?.unit === "bps" ? `${v.toFixed(0)}` : `${v.toFixed(2)}%`}
                  />
                </div>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4 flex flex-col gap-2">
              <Panel title="Trend Metrics" code="TRND">
                <div className="divide-y divide-term-border-soft">
                  {[
                    { label: "Current", value: detailTrend.current != null ? fmtVal(detailDef!, detailTrend.current) : "—" },
                    { label: "Δ 1D", value: detailTrend.chg1d != null ? fmtSigned(detailDef?.unit === "%" ? detailTrend.chg1d * 100 : detailTrend.chg1d, 1) + (detailDef?.unit === "%" ? "bps" : "") : "—", n: detailTrend.chg1d ?? 0 },
                    { label: "Δ 5D", value: detailTrend.chg5d != null ? fmtSigned(detailDef?.unit === "%" ? detailTrend.chg5d * 100 : detailTrend.chg5d, 1) + (detailDef?.unit === "%" ? "bps" : "") : "—", n: detailTrend.chg5d ?? 0 },
                    { label: "Δ 20D", value: detailTrend.chg20d != null ? fmtSigned(detailDef?.unit === "%" ? detailTrend.chg20d * 100 : detailTrend.chg20d, 1) + (detailDef?.unit === "%" ? "bps" : "") : "—", n: detailTrend.chg20d ?? 0 },
                    { label: "Δ 60D", value: detailTrend.chg60d != null ? fmtSigned(detailDef?.unit === "%" ? detailTrend.chg60d * 100 : detailTrend.chg60d, 1) + (detailDef?.unit === "%" ? "bps" : "") : "—", n: detailTrend.chg60d ?? 0 },
                    { label: "Δ 120D", value: detailTrend.chg120d != null ? fmtSigned(detailDef?.unit === "%" ? detailTrend.chg120d * 100 : detailTrend.chg120d, 1) + (detailDef?.unit === "%" ? "bps" : "") : "—", n: detailTrend.chg120d ?? 0 },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between px-3 py-1.5 text-2xs">
                      <span className="text-term-text-mute">{r.label}</span>
                      <span className={clsx("tnum font-semibold", r.n != null ? pnlClass(detailDef?.unit === "bps" ? -r.n : -(r.n ?? 0)) : "")}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Moving Averages" code="MA">
                <div className="divide-y divide-term-border-soft">
                  {[
                    { label: "5-Day MA", value: detailTrend.ma5 },
                    { label: "20-Day MA", value: detailTrend.ma20 },
                    { label: "60-Day MA", value: detailTrend.ma60 },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between px-3 py-1.5 text-2xs">
                      <span className="text-term-text-mute">{r.label}</span>
                      <span className="tnum font-semibold text-term-text">{r.value != null && detailDef ? fmtVal(detailDef, r.value) : "—"}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-1.5 text-2xs">
                    <span className="text-term-text-mute">Percentile (2Y)</span>
                    <span className="tnum text-term-text-dim">{detailTrend.percentile != null ? `${detailTrend.percentile}%` : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-1.5 text-2xs">
                    <span className="text-term-text-mute">52W Range</span>
                    <span className="tnum text-term-text-dim">
                      {detailTrend.min52w != null && detailTrend.max52w != null && detailDef
                        ? `${fmtVal(detailDef, detailTrend.min52w)} — ${fmtVal(detailDef, detailTrend.max52w)}`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-1.5 text-2xs">
                    <span className="text-term-text-mute">Direction</span>
                    <Tag tone={DIRECTION_TONE[detailTrend.direction] ?? "neutral"}>{detailTrend.direction}</Tag>
                  </div>
                  <div className="flex items-center justify-between px-3 py-1.5 text-2xs">
                    <span className="text-term-text-mute">Momentum</span>
                    <Tag tone={detailTrend.momentum === "strong" ? "down" : detailTrend.momentum === "weak" ? "up" : "neutral"}>{detailTrend.momentum}</Tag>
                  </div>
                </div>
              </Panel>
            </div>

            {/* Correlation matrix */}
            <div className="col-span-12 xl:col-span-6">
              <Panel
                title="Rate Correlation (60D Returns)"
                code="CORR"
                right={<TermToggleGroup value={corrGroup} onChange={setCorrGroup} options={CORR_GROUPS.map((g) => ({ value: g.value, label: g.label }))} size="sm" />}
              >
                <div className="p-2">
                  <CorrelationMatrix labels={corrResult.labels} values={corrResult.matrix} height={280} />
                </div>
              </Panel>
            </div>

            {/* Top movers bar chart */}
            <div className="col-span-12 xl:col-span-6">
              <Panel title="Biggest 20D Moves (bps)" code="MOVR">
                <div className="p-2">
                  <BarChart
                    data={statusBoard
                      .filter((s) => s.def.unit === "%" || s.def.unit === "bps")
                      .map((s) => {
                        const trend = computeTrend(map[s.def.id] ?? []);
                        const move = s.def.unit === "%" && trend.chg20d != null ? trend.chg20d * 100 : trend.chg20d ?? 0;
                        return { label: s.def.short, value: move, color: move >= 0 ? "#FF3B3B" : "#2ECC71" };
                      })
                      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                      .slice(0, 12)}
                    horizontal
                    height={280}
                    fmt={(n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`}
                  />
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ── SPREAD ANALYSIS TAB ─────────────────────────── */}
        {tab === "spreads" && (
          <>
            <div className="col-span-12 xl:col-span-8">
              <Panel
                title={`${selectedSpread?.pair.label ?? "Spread"} — ${timeRange} History`}
                code="SPHX"
                accent
                right={
                  <TermSelect
                    value={spreadId}
                    onChange={setSpreadId}
                    options={SPREAD_PAIRS.map((p) => ({ value: p.id, label: `${p.label} — ${p.desc}` }))}
                    size="sm"
                  />
                }
              >
                <div ref={spreadChartRef} className="p-2">
                  <LineChart
                    series={[{ name: selectedSpread?.pair.label ?? "", data: spreadSlice, color: "#3B9DFF" }]}
                    labels={spreadDates}
                    height={300}
                    yFmt={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}bps`}
                  />
                </div>
                {selectedSpread && (
                  <div className="grid grid-cols-6 gap-px border-t border-term-border bg-term-border text-center text-2xs">
                    <div className="bg-term-panel px-2 py-1.5">
                      <div className="text-3xs text-term-text-mute">Current</div>
                      <div className="tnum font-semibold text-term-text">{selectedSpread.current != null ? `${fmtSigned(selectedSpread.current, 1)}bps` : "—"}</div>
                    </div>
                    <div className="bg-term-panel px-2 py-1.5">
                      <div className="text-3xs text-term-text-mute">Δ1D</div>
                      <div className={clsx("tnum font-semibold", pnlClass(-(selectedSpread.chg1d ?? 0)))}>{selectedSpread.chg1d != null ? `${fmtSigned(selectedSpread.chg1d, 1)}` : "—"}</div>
                    </div>
                    <div className="bg-term-panel px-2 py-1.5">
                      <div className="text-3xs text-term-text-mute">Δ20D</div>
                      <div className={clsx("tnum font-semibold", pnlClass(-(selectedSpread.chg20d ?? 0)))}>{selectedSpread.chg20d != null ? `${fmtSigned(selectedSpread.chg20d, 1)}` : "—"}</div>
                    </div>
                    <div className="bg-term-panel px-2 py-1.5">
                      <div className="text-3xs text-term-text-mute">Mean</div>
                      <div className="tnum text-term-text">{selectedSpread.mean != null ? `${fmtSigned(selectedSpread.mean, 1)}` : "—"}</div>
                    </div>
                    <div className="bg-term-panel px-2 py-1.5">
                      <div className="text-3xs text-term-text-mute">Z-Score</div>
                      <div className={clsx("tnum font-semibold", selectedSpread.zScore != null && Math.abs(selectedSpread.zScore) > 1.5 ? "text-term-down" : "text-term-text")}>
                        {selectedSpread.zScore != null ? fmtSigned(selectedSpread.zScore, 2) : "—"}
                      </div>
                    </div>
                    <div className="bg-term-panel px-2 py-1.5">
                      <div className="text-3xs text-term-text-mute">Pctl</div>
                      <div className="tnum text-term-text-dim">{selectedSpread.percentile != null ? `${selectedSpread.percentile}%` : "—"}</div>
                    </div>
                  </div>
                )}
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4">
              <Panel title="Spread Comparison" code="SCMP" right={<span className="text-3xs text-term-text-mute">bps · click to chart</span>}>
                <DataGrid
                  columns={spreadCols}
                  rows={allSpreads}
                  rowKey={(s) => s.pair.id}
                  maxHeight="400px"
                  zebra
                  initialSort={{ key: "z", dir: "desc" }}
                  onRowClick={(s) => setSpreadId(s.pair.id)}
                  selectedKey={spreadId}
                />
              </Panel>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
        <span className="text-term-amber">BMRK</span> — daily benchmark rates across overnight, Treasury, credit, swap, mortgage, commodity & international asset classes.
        {" "}All series live from FRED when FRED_API_KEY is set; deterministic SIM otherwise. Analytics (trend, spreads, correlation, regime) are computed client-side from the resolved series map.
      </div>

      <div className="px-2 pb-2">
        <DataLegend />
      </div>
    </div>
  );
}
