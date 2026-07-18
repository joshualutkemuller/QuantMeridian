
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
import { generateRateVolPdf } from "@/lib/rateVolPdf";
import {
  BENCHMARK_SERIES,
  BENCHMARK_FRED_IDS,
  buildFallback, buildFallbackWithAnchors,
  type SeriesMap,
} from "@/data/benchmarkRates";
import {
  VOL_WINDOWS,
  VOL_WINDOW_LABELS,
  computeAllVols,
  computeCrossAssetVol,
  classifyVolRegime,
  computeVolSummary,
  buildVolSurface,
  computeVolCone,
  volCorrelation,
  type RealizedVol,
  type CrossAssetVol,
  type VolWindow,
  type VolCone,
  type VolRegime,
} from "@/data/rateVolatility";

const REGIME_TONE: Record<VolRegime, "up" | "down" | "amber" | "neutral"> = {
  "Low Vol": "up",
  "Normal": "neutral",
  "Elevated": "amber",
  "Vol Storm": "down",
};

const STATUS_COLORS: Record<string, string> = {
  low: "text-emerald-400",
  normal: "text-term-text-dim",
  elevated: "text-amber-400",
  extreme: "text-red-400",
};

type Tab = "dashboard" | "surface" | "regime";
const TABS: { value: Tab; label: string }[] = [
  { value: "dashboard", label: "Vol Dashboard" },
  { value: "surface", label: "Surface & Cone" },
  { value: "regime", label: "Vol Regime" },
];

type CatFilter = "ALL" | "Overnight" | "Treasury" | "Credit" | "Swap" | "Mortgage" | "Commodity" | "International";
const CAT_OPTIONS: { value: CatFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "Overnight", label: "O/N" },
  { value: "Treasury", label: "TSY" },
  { value: "Credit", label: "Credit" },
  { value: "Swap", label: "Swap" },
  { value: "Mortgage", label: "Mtg" },
  { value: "Commodity", label: "Cmdty" },
  { value: "International", label: "Intl" },
];

const TREASURY_IDS = BENCHMARK_SERIES.filter((s) => s.category === "Treasury").map((s) => s.id);
const OVERNIGHT_IDS = BENCHMARK_SERIES.filter((s) => s.category === "Overnight").map((s) => s.id);

export default function EconRateVol() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [catFilter, setCatFilter] = useState<CatFilter>("ALL");
  const [volWindow, setVolWindow] = useState<VolWindow>(20);
  const [coneSeriesIdx, setConeSeriesIdx] = useState(0);

  const volChartRef = useRef<HTMLDivElement>(null);
  const surfaceChartRef = useRef<HTMLDivElement>(null);
  const coneChartRef = useRef<HTMLDivElement>(null);

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

  const vols = useMemo(() => computeAllVols(map), [map]);
  const crossAsset = useMemo(() => computeCrossAssetVol(map), [map]);
  const regime = useMemo(() => classifyVolRegime(vols), [vols]);
  const summary = useMemo(() => computeVolSummary(vols, regime), [vols, regime]);

  const filteredVols = useMemo(() => {
    if (catFilter === "ALL") return vols;
    return vols.filter((v) => v.def.category === catFilter);
  }, [vols, catFilter]);

  const filteredCrossAsset = useMemo(() => {
    if (catFilter === "ALL") return crossAsset;
    return crossAsset.filter((c) => c.category === catFilter);
  }, [crossAsset, catFilter]);

  const tsySurface = useMemo(() => buildVolSurface(map, TREASURY_IDS), [map]);
  const onSurface = useMemo(() => buildVolSurface(map, OVERNIGHT_IDS), [map]);

  const coneSeriesDefs = useMemo(() => BENCHMARK_SERIES.filter((s) => {
    if (catFilter === "ALL") return true;
    return s.category === catFilter;
  }), [catFilter]);

  const selectedConeDef = coneSeriesDefs[coneSeriesIdx] ?? coneSeriesDefs[0];
  const cone = useMemo(() => {
    if (!selectedConeDef) return null;
    const obs = map[selectedConeDef.id] ?? [];
    return computeVolCone(obs, selectedConeDef);
  }, [map, selectedConeDef]);

  const volCorrIds = useMemo(() => {
    const ids = catFilter === "ALL" ? TREASURY_IDS : BENCHMARK_SERIES.filter((s) => s.category === catFilter).map((s) => s.id);
    return ids.slice(0, 10);
  }, [catFilter]);
  const corrResult = useMemo(() => volCorrelation(map, volCorrIds, 60), [map, volCorrIds]);

  const handlePdf = useCallback(async () => {
    await generateRateVolPdf({
      vols,
      regime,
      crossAsset,
      source: anyReal ? "FRED" : "SIM",
      tab,
      volChartRef: volChartRef.current,
      surfaceChartRef: surfaceChartRef.current,
      coneChartRef: coneChartRef.current,
    });
  }, [vols, regime, crossAsset, source, tab]);

  // ── Top vol movers (biggest 20/60 ratio deviation) ────────────────
  const topMovers = useMemo(() => {
    return [...filteredCrossAsset]
      .filter((c) => c.vol20d != null && c.vol60d != null)
      .sort((a, b) => Math.abs(b.volRatio ?? 1) - Math.abs(a.volRatio ?? 1))
      .slice(0, 10);
  }, [filteredCrossAsset]);

  // ── Vol time series for chart ─────────────────────────────────────
  const volChartData = useMemo(() => {
    const pick = filteredVols.slice(0, 4);
    return {
      series: pick.map((v) => ({
        name: `${v.def.short} ${VOL_WINDOW_LABELS[volWindow]}`,
        data: v.windows[volWindow].history,
        color: ["#3B9DFF", "#FF8C00", "#2ECC71", "#A78BFA"][pick.indexOf(v) % 4],
      })),
      labels: pick[0]?.windows[volWindow].dates ?? [],
    };
  }, [filteredVols, volWindow]);

  return (
    <>
      <PageHeader
        code="RVOL"
        title="Rate Volatility"
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
        <Stat label="Vol Regime" value={summary.regime} tone={REGIME_TONE[summary.regime]} />
        <Stat label="Avg 20D Vol" value={summary.avg20dVol != null ? `${summary.avg20dVol}bps` : "—"} />
        <Stat label="Score" value={`${summary.regimeScore}/100`} />
        <Stat label="Elevated" value={String(summary.elevatedCount)} tone={summary.elevatedCount > 3 ? "amber" : "neutral"} />
        <Stat label="Extreme" value={String(summary.extremeCount)} tone={summary.extremeCount > 0 ? "down" : "up"} />
        <Stat label="Vol Trend" value={summary.volTrend} tone={summary.volTrend === "rising" ? "amber" : summary.volTrend === "falling" ? "up" : "neutral"} />
      </KpiStrip>

      <div className="mt-1 flex items-center gap-3 px-1">
        <TermToggleGroup value={tab} onChange={setTab} options={TABS} size="sm" />
        <TermToggleGroup label="Category" value={catFilter} onChange={setCatFilter} options={CAT_OPTIONS} size="sm" />
      </div>

      <div className="mt-1 grid grid-cols-12 gap-1 px-1 pb-4">
        {tab === "dashboard" && <DashboardTab
          vols={filteredVols}
          crossAsset={filteredCrossAsset}
          topMovers={topMovers}
          volWindow={volWindow}
          setVolWindow={setVolWindow}
          volChartData={volChartData}
          volChartRef={volChartRef}
        />}
        {tab === "surface" && <SurfaceTab
          tsySurface={tsySurface}
          onSurface={onSurface}
          cone={cone}
          coneDefs={coneSeriesDefs}
          coneIdx={coneSeriesIdx}
          setConeIdx={setConeSeriesIdx}
          surfaceChartRef={surfaceChartRef}
          coneChartRef={coneChartRef}
          filteredVols={filteredVols}
          volWindow={volWindow}
        />}
        {tab === "regime" && <RegimeTab
          regime={regime}
          vols={filteredVols}
          corrResult={corrResult}
        />}
      </div>

      <div className="px-1 pb-4">
        <DataLegend />
      </div>
    </>
  );
}

// ── Dashboard Tab ───────────────────────────────────────────────────

function DashboardTab({
  vols, crossAsset, topMovers, volWindow, setVolWindow, volChartData, volChartRef,
}: {
  vols: RealizedVol[];
  crossAsset: CrossAssetVol[];
  topMovers: CrossAssetVol[];
  volWindow: VolWindow;
  setVolWindow: (w: VolWindow) => void;
  volChartData: { series: { name: string; data: number[]; color: string }[]; labels: string[] };
  volChartRef: React.RefObject<HTMLDivElement>;
}) {
  const volCols: Column<CrossAssetVol>[] = useMemo(() => [
    { key: "label", header: "Rate", render: (r) => <span className="font-medium">{r.label}</span>, sortVal: (r) => r.label, width: "90px" },
    { key: "cat", header: "Category", render: (r) => <span className="text-term-text-dim">{r.category}</span>, sortVal: (r) => r.category, width: "90px" },
    { key: "v5d", header: "5D Vol", align: "right", render: (r) => r.vol5d != null ? r.vol5d.toFixed(1) : "—", sortVal: (r) => r.vol5d ?? 0, width: "70px" },
    { key: "v20d", header: "20D Vol", align: "right", render: (r) => r.vol20d != null ? <span className="font-medium">{r.vol20d.toFixed(1)}</span> : "—", sortVal: (r) => r.vol20d ?? 0, width: "70px" },
    { key: "v60d", header: "60D Vol", align: "right", render: (r) => r.vol60d != null ? r.vol60d.toFixed(1) : "—", sortVal: (r) => r.vol60d ?? 0, width: "70px" },
    { key: "ratio", header: "20/60", align: "right", render: (r) => {
      if (r.volRatio == null) return "—";
      const c = r.volRatio > 1.2 ? "text-red-400" : r.volRatio < 0.8 ? "text-emerald-400" : "text-term-text-dim";
      return <span className={c}>{r.volRatio.toFixed(2)}</span>;
    }, sortVal: (r) => r.volRatio ?? 0, width: "60px" },
    { key: "pct", header: "Pctl", align: "right", render: (r) => r.percentile != null ? `${r.percentile}%` : "—", sortVal: (r) => r.percentile ?? 0, width: "55px" },
    { key: "regime", header: "Regime", render: (r) => (
      <Tag tone={r.regime === "extreme" ? "down" : r.regime === "elevated" ? "amber" : r.regime === "low" ? "up" : "neutral"}>
        {r.regime.toUpperCase()}
      </Tag>
    ), sortVal: (r) => r.percentile ?? 50, width: "80px" },
  ], []);

  return (
    <>
      <div className="col-span-12 xl:col-span-8">
        <Panel title="Cross-Asset Volatility" code="XVOL">
          <DataGrid
            columns={volCols}
            rows={crossAsset}
            rowKey={(r) => r.seriesId}
            maxHeight="380px"
            initialSort={{ key: "v20d", dir: "desc" }}
            zebra
          />
        </Panel>
      </div>

      <div className="col-span-12 xl:col-span-4 flex flex-col gap-1">
        <Panel title="Top Vol Movers" code="VMOV">
          <BarChart
            data={topMovers.map((m) => ({
              label: m.label,
              value: m.volRatio ?? 1,
              color: (m.volRatio ?? 1) > 1.2 ? "#FF3B3B" : (m.volRatio ?? 1) < 0.8 ? "#2ECC71" : "#FF8C00",
            }))}
            horizontal
            height={200}
            fmt={(n) => `${n.toFixed(2)}x`}
          />
        </Panel>

        <Panel title="Vol Heatmap" code="VHEAT">
          <div className="p-1 overflow-x-auto">
            <VolHeatmap vols={vols} />
          </div>
        </Panel>
      </div>

      <div className="col-span-12">
        <Panel title="Vol Time Series" code="VTS" right={
          <TermToggleGroup
            value={String(volWindow) as any}
            onChange={(v) => setVolWindow(Number(v) as VolWindow)}
            options={VOL_WINDOWS.map((w) => ({ value: String(w), label: VOL_WINDOW_LABELS[w] }))}
            size="sm"
          />
        }>
          <div ref={volChartRef}>
            {volChartData.series.length > 0 && (
              <LineChart
                series={volChartData.series}
                labels={volChartData.labels}
                height={200}
                yFmt={(n) => `${n.toFixed(0)}`}
              />
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

// ── Surface Tab ─────────────────────────────────────────────────────

function SurfaceTab({
  tsySurface, onSurface, cone, coneDefs, coneIdx, setConeIdx, surfaceChartRef, coneChartRef, filteredVols, volWindow,
}: {
  tsySurface: ReturnType<typeof buildVolSurface>;
  onSurface: ReturnType<typeof buildVolSurface>;
  cone: VolCone | null;
  coneDefs: typeof BENCHMARK_SERIES;
  coneIdx: number;
  setConeIdx: (i: number) => void;
  surfaceChartRef: React.RefObject<HTMLDivElement>;
  coneChartRef: React.RefObject<HTMLDivElement>;
  filteredVols: RealizedVol[];
  volWindow: VolWindow;
}) {
  const termStructure = useMemo(() => {
    const tsyVols = filteredVols.filter((v) => v.def.category === "Treasury");
    return {
      series: [{
        name: "20D Ann. Vol",
        data: tsyVols.map((v) => v.windows[20].annualized ?? 0),
        color: "#3B9DFF",
      }],
      labels: tsyVols.map((v) => v.def.short),
    };
  }, [filteredVols]);

  return (
    <>
      <div className="col-span-12 xl:col-span-6">
        <Panel title="Treasury Vol Surface" code="TSURF">
          <div ref={surfaceChartRef} className="p-2 overflow-x-auto">
            <SurfaceGrid surface={tsySurface} />
          </div>
        </Panel>
      </div>

      <div className="col-span-12 xl:col-span-6">
        <Panel title="Overnight Vol Surface" code="OSURF">
          <div className="p-2 overflow-x-auto">
            <SurfaceGrid surface={onSurface} />
          </div>
        </Panel>
      </div>

      <div className="col-span-12 xl:col-span-6">
        <Panel title="Vol Cone" code="VCONE" right={
          <select
            className="term-select text-2xs"
            value={coneIdx}
            onChange={(e) => setConeIdx(Number(e.target.value))}
          >
            {coneDefs.map((d, i) => (
              <option key={d.id} value={i}>{d.short}</option>
            ))}
          </select>
        }>
          <div ref={coneChartRef} className="p-2">
            {cone && <VolConeChart cone={cone} />}
          </div>
        </Panel>
      </div>

      <div className="col-span-12 xl:col-span-6">
        <Panel title="Term Structure of Vol" code="TVOL">
          {termStructure.series[0].data.length > 0 && (
            <BarChart
              data={termStructure.labels.map((l, i) => ({
                label: l,
                value: termStructure.series[0].data[i],
                color: "#3B9DFF",
              }))}
              height={220}
              fmt={(n) => `${n.toFixed(0)}`}
            />
          )}
        </Panel>
      </div>
    </>
  );
}

// ── Regime Tab ──────────────────────────────────────────────────────

function RegimeTab({
  regime, vols, corrResult,
}: {
  regime: ReturnType<typeof classifyVolRegime>;
  vols: RealizedVol[];
  corrResult: ReturnType<typeof volCorrelation>;
}) {
  const playbook: Record<VolRegime, { desk: string; action: string }[]> = {
    "Low Vol": [
      { desk: "SLAB", action: "Tighten rebate spreads — low vol compresses lending fees" },
      { desk: "COLL", action: "Reduce margin buffers — stable conditions allow lower haircuts" },
      { desk: "CASH", action: "Extend duration — lock in rates while volatility is low" },
      { desk: "REINV", action: "Increase allocation to longer-duration reinvestment" },
    ],
    "Normal": [
      { desk: "SLAB", action: "Maintain standard rebate schedule" },
      { desk: "COLL", action: "Standard margin multipliers" },
      { desk: "CASH", action: "Balanced duration profile" },
      { desk: "REINV", action: "Standard reinvestment ladder" },
    ],
    "Elevated": [
      { desk: "SLAB", action: "Widen rebate spreads — elevated vol creates borrowing demand" },
      { desk: "COLL", action: "Increase haircuts by 15-25% on volatile asset classes" },
      { desk: "CASH", action: "Shorten duration — protect against rate moves" },
      { desk: "PB", action: "Review client exposure limits — increased margin call risk" },
    ],
    "Vol Storm": [
      { desk: "SLAB", action: "Defensive positioning — widen spreads, reduce specials" },
      { desk: "COLL", action: "Emergency haircut increases — apply stressed margins" },
      { desk: "CASH", action: "Maximize overnight allocation — avoid duration risk" },
      { desk: "PB", action: "Active client deleveraging — enforce position limits" },
      { desk: "REPO", action: "Prefer tri-party over bilateral — reduce counterparty risk" },
    ],
  };

  const currentPlaybook = playbook[regime.regime];

  return (
    <>
      <div className="col-span-12 xl:col-span-4 flex flex-col gap-1">
        <Panel title="Regime Classification" code="VRGM">
          <div className="p-3 space-y-3">
            <div className="text-center">
              <div className={clsx("text-3xl font-bold", REGIME_TONE[regime.regime] === "up" ? "text-emerald-400" : REGIME_TONE[regime.regime] === "down" ? "text-red-400" : REGIME_TONE[regime.regime] === "amber" ? "text-amber-400" : "text-term-text-dim")}>
                {regime.regime}
              </div>
              <div className="text-2xs text-term-text-dim mt-1">Score: {regime.score}/100 · Transition: {regime.transition}</div>
            </div>

            <div className="h-3 bg-term-panel-3 rounded-sm relative overflow-hidden">
              <div
                className={clsx("absolute inset-y-0 left-0 rounded-sm", regime.score >= 75 ? "bg-red-500" : regime.score >= 50 ? "bg-amber-500" : regime.score >= 25 ? "bg-blue-500" : "bg-emerald-500")}
                style={{ width: `${regime.score}%` }}
              />
              {[25, 50, 75].map((t) => (
                <div key={t} className="absolute inset-y-0 w-px bg-term-border" style={{ left: `${t}%` }} />
              ))}
            </div>

            <div className="flex justify-between text-3xs text-term-text-dim">
              <span>Low Vol</span>
              <span>Normal</span>
              <span>Elevated</span>
              <span>Storm</span>
            </div>
          </div>
        </Panel>

        <Panel title="Regime Drivers" code="VDRV">
          <div className="divide-y divide-term-border-soft">
            {regime.drivers.length === 0 && (
              <div className="p-2 text-2xs text-term-text-dim">No significant drivers detected</div>
            )}
            {regime.drivers.map((d, i) => (
              <div key={i} className="px-2 py-1.5 text-2xs text-term-text">{d}</div>
            ))}
          </div>
        </Panel>

        <Panel title="Vol Distribution" code="VDST">
          <div className="p-2 space-y-1">
            {(["low", "normal", "elevated", "extreme"] as const).map((level) => {
              const count = vols.filter((v) => v.currentVsHistoric === level).length;
              const pct = vols.length > 0 ? (count / vols.length) * 100 : 0;
              return (
                <div key={level} className="flex items-center gap-2">
                  <span className={clsx("w-16 text-2xs", STATUS_COLORS[level])}>{level.toUpperCase()}</span>
                  <div className="flex-1 h-2.5 bg-term-panel-3 rounded-sm relative">
                    <div
                      className={clsx("absolute inset-y-0 left-0 rounded-sm",
                        level === "extreme" ? "bg-red-500/60" :
                        level === "elevated" ? "bg-amber-500/60" :
                        level === "low" ? "bg-emerald-500/60" : "bg-blue-500/40"
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-2xs tnum">{count}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="col-span-12 xl:col-span-4">
        <Panel title="Desk Playbook" code="VPLB">
          <div className="divide-y divide-term-border-soft">
            {currentPlaybook.map((p, i) => (
              <div key={i} className="px-2 py-1.5">
                <Tag tone="neutral">{p.desk}</Tag>
                <div className="text-2xs text-term-text mt-0.5">{p.action}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="col-span-12 xl:col-span-4">
        <Panel title="Vol Change Correlation" code="VCOR">
          <div className="p-2">
            <CorrelationMatrix
              labels={corrResult.labels}
              values={corrResult.matrix}
              height={280}
            />
          </div>
        </Panel>
      </div>

      <div className="col-span-12">
        <Panel title="Vol Regime Timeline" code="VTLN">
          <div className="p-2">
            <VolTimeline vols={vols} />
          </div>
        </Panel>
      </div>
    </>
  );
}

// ── Shared Components ───────────────────────────────────────────────

function VolHeatmap({ vols }: { vols: RealizedVol[] }) {
  const windows: VolWindow[] = [5, 10, 20, 60, 120];
  const maxVol = Math.max(
    ...vols.flatMap((v) => windows.map((w) => v.windows[w].annualized ?? 0)),
    1,
  );

  return (
    <table className="w-full text-2xs">
      <thead>
        <tr className="text-term-text-dim">
          <th className="text-left px-1 py-0.5 font-normal">Rate</th>
          {windows.map((w) => (
            <th key={w} className="text-right px-1 py-0.5 font-normal">{VOL_WINDOW_LABELS[w]}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {vols.map((v) => (
          <tr key={v.seriesId} className="border-t border-term-border-soft">
            <td className="px-1 py-0.5 font-medium">{v.def.short}</td>
            {windows.map((w) => {
              const val = v.windows[w].annualized;
              if (val == null) return <td key={w} className="px-1 py-0.5 text-right text-term-text-dim">—</td>;
              const intensity = Math.min(val / maxVol, 1);
              return (
                <td key={w} className="px-1 py-0.5 text-right tnum" style={{
                  backgroundColor: `rgba(255, 140, 0, ${(0.1 + intensity * 0.6).toFixed(2)})`,
                }}>
                  {val.toFixed(1)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SurfaceGrid({ surface }: { surface: ReturnType<typeof buildVolSurface> }) {
  const maxVal = Math.max(...surface.grid.flat().filter((v): v is number => v != null), 1);

  return (
    <table className="w-full text-2xs">
      <thead>
        <tr className="text-term-text-dim">
          <th className="text-left px-1 py-0.5 font-normal">Window</th>
          {surface.labels.map((l) => (
            <th key={l} className="text-right px-1 py-0.5 font-normal">{l}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {surface.windows.map((w, wi) => (
          <tr key={w} className="border-t border-term-border-soft">
            <td className="px-1 py-0.5 font-medium">{VOL_WINDOW_LABELS[w]}</td>
            {surface.grid[wi].map((val, ci) => {
              if (val == null) return <td key={ci} className="px-1 py-0.5 text-right text-term-text-dim">—</td>;
              const intensity = Math.min(val / maxVal, 1);
              return (
                <td key={ci} className="px-1 py-0.5 text-right tnum" style={{
                  backgroundColor: `rgba(59, 157, 255, ${(0.1 + intensity * 0.6).toFixed(2)})`,
                }}>
                  {val.toFixed(1)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VolConeChart({ cone }: { cone: VolCone }) {
  const W = 600;
  const H = 200;
  const padL = 48;
  const padR = 10;
  const padT = 10;
  const padB = 22;

  const pts = cone.points.filter((p) => p.max != null);
  if (pts.length === 0) return <div className="text-2xs text-term-text-dim p-2">Insufficient data</div>;

  const allVals = pts.flatMap((p) => [p.min!, p.max!]);
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  const x = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - minV) / range) * (H - padT - padB);

  const bandPath = (
    getter: (p: typeof pts[0]) => number | null,
    getter2: (p: typeof pts[0]) => number | null,
  ) => {
    const top = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(getter(p) ?? 0).toFixed(1)}`).join(" ");
    const bottom = pts.map((p, i) => `L${x(pts.length - 1 - i).toFixed(1)},${y(getter2(pts[pts.length - 1 - i]) ?? 0).toFixed(1)}`).join(" ");
    return `${top} ${bottom} Z`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} preserveAspectRatio="none">
      <path d={bandPath((p) => p.max, (p) => p.min)} fill="rgba(59,157,255,0.08)" />
      <path d={bandPath((p) => p.p75, (p) => p.p25)} fill="rgba(59,157,255,0.18)" />
      <polyline
        points={pts.map((p, i) => `${x(i)},${y(p.median ?? 0)}`).join(" ")}
        fill="none" stroke="#3B9DFF" strokeWidth={1.5} strokeDasharray="4,3"
      />
      <polyline
        points={pts.map((p, i) => `${x(i)},${y(p.current ?? 0)}`).join(" ")}
        fill="none" stroke="#FF8C00" strokeWidth={2}
      />
      {pts.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.current ?? 0)} r={3} fill="#FF8C00" />
      ))}
      {pts.map((p, i) => (
        <text key={`l${i}`} x={x(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="#9A9AA3" fontFamily="var(--font-mono)">
          {VOL_WINDOW_LABELS[p.window]}
        </text>
      ))}
      <text x={4} y={10} fontSize={8} fill="#9A9AA3" fontFamily="var(--font-mono)">Ann. Vol</text>
    </svg>
  );
}

function VolTimeline({ vols }: { vols: RealizedVol[] }) {
  const pick = vols.find((v) => v.def.id === "SOFR") ?? vols[0];
  if (!pick) return null;

  const hist = pick.windows[20].history;
  const dates = pick.windows[20].dates;
  if (hist.length === 0) return <div className="text-2xs text-term-text-dim p-2">No history</div>;

  const segments: { regime: string; count: number }[] = [];
  for (const v of hist) {
    const r = v >= 40 ? "Storm" : v >= 25 ? "Elevated" : v >= 10 ? "Normal" : "Low";
    if (segments.length > 0 && segments[segments.length - 1].regime === r) {
      segments[segments.length - 1].count++;
    } else {
      segments.push({ regime: r, count: 1 });
    }
  }

  const total = hist.length;
  const colors: Record<string, string> = {
    Storm: "#FF3B3B", Elevated: "#FFB400", Normal: "#3B9DFF", Low: "#2ECC71",
  };

  return (
    <div>
      <div className="flex h-5 rounded-sm overflow-hidden">
        {segments.map((s, i) => (
          <div
            key={i}
            style={{ width: `${(s.count / total) * 100}%`, backgroundColor: colors[s.regime] ?? "#555" }}
            title={`${s.regime} (${s.count}d)`}
          />
        ))}
      </div>
      <div className="flex justify-between text-3xs text-term-text-dim mt-0.5">
        <span>{dates[0]}</span>
        <span>{dates[dates.length - 1]}</span>
      </div>
    </div>
  );
}
