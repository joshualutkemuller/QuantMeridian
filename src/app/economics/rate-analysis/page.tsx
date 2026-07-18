
import { useMemo } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { Activity, Gauge, Spline, Banknote, BarChart3 } from "lucide-react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { BarChart } from "@/components/charts/BarChart";
import { DataLegend } from "@/components/ui/DataLegend";
import { isRealEconSource, useLiveSeriesSet, type DataSource , useMacroInputs } from "@/lib/useEcon";
import { fmtSigned, pnlClass } from "@/lib/format";
import {
  BENCHMARK_SERIES,
  BENCHMARK_FRED_IDS,
  buildFallback, buildFallbackWithAnchors,
  computeSummary,
  classifyRegime,
  type SeriesMap,
  type RateRegime,
} from "@/data/benchmarkRates";
import {
  computeCurveShape,
  computeCurveSummary,
  type CurveRegime,
} from "@/data/yieldCurveAnalytics";
import {
  computeAllVols,
  classifyVolRegime,
  computeVolSummary,
  type VolRegime,
} from "@/data/rateVolatility";
import {
  computeTierCosts,
  computeFundingCostSummary,
  classifyFundingRegime,
  DEFAULT_TIERS,
  type FundingRegime,
} from "@/data/fundingCost";
import {
  computeUtilizationSnapshot,
  type UtilGroupMetrics,
} from "@/data/utilizationAnalytics";
import { getInventory } from "@/data/securitiesLending";

// ── Regime tone maps ────────────────────────────────────────────────

const RATE_REGIME_TONE: Record<RateRegime, "up" | "down" | "amber" | "neutral"> = {
  Tightening: "down", Restrictive: "amber", Neutral: "neutral", Easing: "up", Accommodative: "up",
};

const CURVE_REGIME_TONE: Record<CurveRegime, "up" | "down" | "amber" | "neutral"> = {
  "Bull Steepening": "up", "Bear Steepening": "amber", "Bull Flattening": "amber", "Bear Flattening": "down",
  "Inversion Deepening": "down", "Inversion Unwinding": "up", "Stable": "neutral",
};

const VOL_REGIME_TONE: Record<VolRegime, "up" | "down" | "amber" | "neutral"> = {
  "Low Vol": "up", "Normal": "neutral", "Elevated": "amber", "Vol Storm": "down",
};

const FUND_REGIME_TONE: Record<FundingRegime, "up" | "down" | "amber" | "neutral"> = {
  Tight: "up", Normal: "neutral", Wide: "amber", Stress: "down",
};

// ── Module card definitions ─────────────────────────────────────────

interface ModuleCard {
  code: string;
  title: string;
  href: string;
  icon: typeof Activity;
  color: string;
}

const MODULES: ModuleCard[] = [
  { code: "BMRK", title: "Benchmark Rates", href: "/economics/benchmark", icon: Activity, color: "#3B9DFF" },
  { code: "YCURV", title: "Yield Curve Analytics", href: "/economics/yield-curve", icon: Spline, color: "#2ECC71" },
  { code: "RVOL", title: "Rate Volatility", href: "/economics/rate-vol", icon: BarChart3, color: "#FF8C00" },
  { code: "FCOST", title: "Funding Cost Monitor", href: "/economics/funding-cost", icon: Banknote, color: "#A78BFA" },
  { code: "UTIL", title: "Utilization Analytics", href: "/economics/utilization", icon: Gauge, color: "#22D3EE" },
];

export default function RateAnalysisDashboard() {
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

  // ── BMRK ──────────────────────────────────────────────────────────
  const bmrkSummary = useMemo(() => computeSummary(map), [map]);
  const bmrkRegime = useMemo(() => classifyRegime(map), [map]);

  // ── YCURV ─────────────────────────────────────────────────────────
  const curveShape = useMemo(() => computeCurveShape(map), [map]);
  const curveSummary = useMemo(() => computeCurveSummary(curveShape), [curveShape]);

  // ── RVOL ──────────────────────────────────────────────────────────
  const vols = useMemo(() => computeAllVols(map), [map]);
  const volRegime = useMemo(() => classifyVolRegime(vols), [vols]);
  const volSummary = useMemo(() => computeVolSummary(vols, volRegime), [vols, volRegime]);

  // ── FCOST ─────────────────────────────────────────────────────────
  const costs = useMemo(() => computeTierCosts(map), [map]);
  const fundingSummary = useMemo(() => computeFundingCostSummary(map), [map]);
  const fundingRegime = useMemo(() => classifyFundingRegime(costs), [costs]);

  // ── UTIL ──────────────────────────────────────────────────────────
  const inventory = useMemo(() => getInventory(), []);
  const utilSnapshot = useMemo(() => {
    const snap = computeUtilizationSnapshot(inventory, "all");
    return snap["ALL"] ?? { utilization: 0, totalOnLoan: 0, totalAvailable: 0, avgFeeBps: 0, nameCount: 0, htbCount: 0, specialCount: 0 };
  }, [inventory]);

  // ── Sparkline data ────────────────────────────────────────────────
  const sofrHist = useMemo(() => (map["SOFR"] ?? []).slice(-60).map((o) => o.value), [map]);
  const tenYHist = useMemo(() => (map["DGS10"] ?? []).slice(-60).map((o) => o.value), [map]);
  const slopeHist = useMemo(() => {
    return curveShape.history.slice(-60).map((c) => c.slope2s10s ?? 0);
  }, [curveShape]);

  // ── Composite state ───────────────────────────────────────────────
  const compositeScore = useMemo(() => {
    let score = 0;
    score += bmrkRegime.score * 0.3;
    score += volRegime.score * 0.3;
    score += fundingRegime.score * 0.25;
    const curveStress = curveSummary.inversions > 0 ? 70 : curveSummary.regime === "Bear Flattening" ? 60 : curveSummary.regime === "Stable" ? 40 : 50;
    score += curveStress * 0.15;
    return Math.round(Math.max(0, Math.min(100, score)));
  }, [bmrkRegime, volRegime, fundingRegime, curveSummary]);

  const compositeLabel = compositeScore >= 70 ? "Stressed" : compositeScore >= 55 ? "Cautious" : compositeScore >= 40 ? "Balanced" : "Benign";
  const compositeTone: "up" | "down" | "amber" | "neutral" =
    compositeScore >= 70 ? "down" : compositeScore >= 55 ? "amber" : compositeScore >= 40 ? "neutral" : "up";

  return (
    <>
      <PageHeader
        code="BRA"
        title="Benchmark Rate Analysis"
        right={<ProvenanceBadge source={badgeSource} />}
      />
      <KpiStrip>
        <Stat label="Market State" value={compositeLabel} sub={`Score: ${compositeScore}/100`} tone={compositeTone} />
        <Stat label="Rate Regime" value={bmrkSummary.regime} tone={RATE_REGIME_TONE[bmrkSummary.regime]} />
        <Stat label="Curve Regime" value={curveSummary.regime} tone={CURVE_REGIME_TONE[curveSummary.regime]} />
        <Stat label="Vol Regime" value={volSummary.regime} tone={VOL_REGIME_TONE[volSummary.regime]} />
        <Stat label="Funding" value={fundingRegime.regime} tone={FUND_REGIME_TONE[fundingRegime.regime]} />
        <Stat label="Utilization" value={`${utilSnapshot.utilization.toFixed(1)}%`} tone={utilSnapshot.utilization > 85 ? "amber" : "neutral"} />
      </KpiStrip>

      <div className="mt-1 grid grid-cols-12 gap-1 px-1 pb-4">
        {/* ── Composite State ──────────────────────────────────────── */}
        <div className="col-span-12 xl:col-span-4">
          <Panel title="Composite Market State" code="CMS" accent={compositeScore >= 60}>
            <div className="p-3 space-y-3">
              <div className="text-center">
                <div className={clsx("text-4xl font-bold",
                  compositeTone === "up" ? "text-emerald-400" :
                  compositeTone === "down" ? "text-red-400" :
                  compositeTone === "amber" ? "text-amber-400" : "text-term-text"
                )}>
                  {compositeLabel}
                </div>
                <div className="text-2xs text-term-text-dim mt-1">Composite Score: {compositeScore}/100</div>
              </div>

              <div className="h-3 bg-term-panel-3 rounded-sm relative overflow-hidden">
                <div
                  className={clsx("absolute inset-y-0 left-0 rounded-sm",
                    compositeScore >= 70 ? "bg-red-500" : compositeScore >= 55 ? "bg-amber-500" : compositeScore >= 40 ? "bg-blue-500" : "bg-emerald-500"
                  )}
                  style={{ width: `${compositeScore}%` }}
                />
                {[40, 55, 70].map((t) => (
                  <div key={t} className="absolute inset-y-0 w-px bg-term-border" style={{ left: `${t}%` }} />
                ))}
              </div>
              <div className="flex justify-between text-3xs text-term-text-dim">
                <span>Benign</span><span>Balanced</span><span>Cautious</span><span>Stressed</span>
              </div>

              <div className="space-y-1.5 pt-2">
                {([
                  { label: "Rate Regime", value: bmrkSummary.regime, score: bmrkRegime.score, weight: "30%" },
                  { label: "Vol Regime", value: volSummary.regime, score: volRegime.score, weight: "30%" },
                  { label: "Funding", value: fundingRegime.regime, score: fundingRegime.score, weight: "25%" },
                  { label: "Curve", value: curveSummary.regime, score: curveSummary.inversions > 0 ? 70 : 50, weight: "15%" },
                ] as const).map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <span className="w-20 text-2xs text-term-text-dim">{item.label}</span>
                    <div className="flex-1 h-2 bg-term-panel-3 rounded-sm">
                      <div className={clsx("h-full rounded-sm",
                        item.score >= 70 ? "bg-red-500/60" : item.score >= 55 ? "bg-amber-500/60" : "bg-blue-500/40"
                      )} style={{ width: `${item.score}%` }} />
                    </div>
                    <span className="w-16 text-2xs text-term-text truncate">{item.value}</span>
                    <span className="w-8 text-3xs text-term-text-mute text-right">{item.weight}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* ── Key Rates ────────────────────────────────────────────── */}
        <div className="col-span-12 xl:col-span-8">
          <Panel title="Key Rate Snapshot" code="KRATE">
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y divide-term-border-soft">
              <RateCard label="SOFR" value={bmrkSummary.sofr} chgBps={bmrkSummary.sofrChgBps} hist={sofrHist} unit="%" />
              <RateCard label="10Y Treasury" value={bmrkSummary.tenY} chgBps={bmrkSummary.tenYChgBps} hist={tenYHist} unit="%" />
              <RateCard label="2s10s Slope" value={curveSummary.slope2s10s != null ? curveSummary.slope2s10s : null} chgBps={null} hist={slopeHist} unit="bps" inverted />
              <RateCard label="IG OAS" value={bmrkSummary.igOas} chgBps={null} hist={(map["BAMLC0A0CM"] ?? []).slice(-60).map((o) => o.value)} unit="bps" />
              <RateCard label="HY OAS" value={bmrkSummary.hyOas} chgBps={null} hist={(map["BAMLH0A0HYM2"] ?? []).slice(-60).map((o) => o.value)} unit="bps" />
              <RateCard label="30Y Mortgage" value={bmrkSummary.mtg30} chgBps={null} hist={(map["MORTGAGE30US"] ?? []).slice(-60).map((o) => o.value)} unit="%" />
              <RateCard label="Secured (AA)" value={fundingSummary.aaAllIn} chgBps={null} hist={costs.find((c) => c.tier.id === "AA")?.history.slice(-60) ?? []} unit="%" />
              <RateCard label="Utilization" value={utilSnapshot.utilization} chgBps={null} hist={[]} unit="%" />
            </div>
          </Panel>
        </div>

        {/* ── Module Cards ─────────────────────────────────────────── */}
        {MODULES.map((mod) => (
          <div key={mod.code} className="col-span-12 sm:col-span-6 xl:col-span-4 2xl:col-span-12/5">
            <ModuleCardPanel mod={mod} map={map} bmrkSummary={bmrkSummary} curveSummary={curveSummary} volSummary={volSummary} fundingSummary={fundingSummary} fundingRegime={fundingRegime} utilSnapshot={utilSnapshot} />
          </div>
        ))}

        {/* ── Regime Bar ───────────────────────────────────────────── */}
        <div className="col-span-12">
          <Panel title="Regime Overview" code="RBAR">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-3">
              <RegimeBlock label="Rate Regime" regime={bmrkSummary.regime} tone={RATE_REGIME_TONE[bmrkSummary.regime]} score={bmrkRegime.score} drivers={bmrkRegime.drivers} href="/economics/benchmark" />
              <RegimeBlock label="Curve Regime" regime={curveSummary.regime} tone={CURVE_REGIME_TONE[curveSummary.regime]} score={null} drivers={[
                `2s10s: ${curveSummary.slope2s10s != null ? `${fmtSigned(curveSummary.slope2s10s, 0)}bps` : "—"}`,
                `Active inversions: ${curveSummary.inversions}`,
              ]} href="/economics/yield-curve" />
              <RegimeBlock label="Vol Regime" regime={volSummary.regime} tone={VOL_REGIME_TONE[volSummary.regime]} score={volRegime.score} drivers={volRegime.drivers} href="/economics/rate-vol" />
              <RegimeBlock label="Funding Regime" regime={fundingRegime.regime} tone={FUND_REGIME_TONE[fundingRegime.regime]} score={fundingRegime.score} drivers={[
                `AA all-in: ${fundingSummary.aaAllIn != null ? `${fundingSummary.aaAllIn.toFixed(2)}%` : "—"}`,
                `HY all-in: ${fundingSummary.hyAllIn != null ? `${fundingSummary.hyAllIn.toFixed(2)}%` : "—"}`,
              ]} href="/economics/funding-cost" />
            </div>
          </Panel>
        </div>

        {/* ── Funding Tier Bars ────────────────────────────────────── */}
        <div className="col-span-12 xl:col-span-6">
          <Panel title="Funding Cost by Tier" code="FTIER">
            <BarChart
              data={costs.map((c) => ({
                label: c.tier.id,
                value: c.allInRate ?? 0,
                color: c.tier.color,
              }))}
              height={180}
              fmt={(n) => `${n.toFixed(2)}%`}
            />
          </Panel>
        </div>

        <div className="col-span-12 xl:col-span-6">
          <Panel title="Vol by Category" code="VCAT">
            <BarChart
              data={(() => {
                const cats = ["Overnight", "Treasury", "Credit", "Swap", "Mortgage", "Commodity"] as const;
                return cats.map((cat) => {
                  const catVols = vols.filter((v) => v.def.category === cat && v.windows[20].annualized != null);
                  const avgVol = catVols.length > 0 ? catVols.reduce((s, v) => s + v.windows[20].annualized!, 0) / catVols.length : 0;
                  return { label: cat, value: avgVol, color: avgVol > 30 ? "#FF3B3B" : avgVol > 15 ? "#FFB400" : "#3B9DFF" };
                });
              })()}
              height={180}
              fmt={(n) => `${n.toFixed(0)}bps`}
            />
          </Panel>
        </div>
      </div>

      <div className="px-1 pb-4">
        <DataLegend />
      </div>
    </>
  );
}

// ── Sub-Components ──────────────────────────────────────────────────

function RateCard({ label, value, chgBps, hist, unit, inverted }: {
  label: string;
  value: number | null;
  chgBps: number | null;
  hist: number[];
  unit: string;
  inverted?: boolean;
}) {
  const fmt = unit === "bps" ? (v: number) => `${v.toFixed(0)}${unit}` : (v: number) => `${v.toFixed(2)}${unit}`;
  return (
    <div className="p-2.5 space-y-1">
      <div className="text-2xs text-term-text-dim">{label}</div>
      <div className="flex items-end gap-2">
        <span className="text-lg font-semibold tnum">{value != null ? fmt(value) : "—"}</span>
        {chgBps != null && (
          <span className={clsx("text-2xs tnum", pnlClass(inverted ? -chgBps : chgBps))}>
            {fmtSigned(chgBps, 1)}bps
          </span>
        )}
      </div>
      {hist.length > 1 && <Sparkline data={hist} width={100} height={18} fill />}
    </div>
  );
}

function ModuleCardPanel({ mod, map, bmrkSummary, curveSummary, volSummary, fundingSummary, fundingRegime, utilSnapshot }: {
  mod: ModuleCard;
  map: SeriesMap;
  bmrkSummary: ReturnType<typeof computeSummary>;
  curveSummary: ReturnType<typeof computeCurveSummary>;
  volSummary: ReturnType<typeof computeVolSummary>;
  fundingSummary: ReturnType<typeof computeFundingCostSummary>;
  fundingRegime: { regime: FundingRegime; score: number };
  utilSnapshot: UtilGroupMetrics;
}) {
  const Icon = mod.icon;
  const metrics = getModuleMetrics(mod.code, bmrkSummary, curveSummary, volSummary, fundingSummary, fundingRegime, utilSnapshot);

  return (
    <Link to={mod.href} className="block no-underline">
      <Panel title={mod.title} code={mod.code}>
        <div className="p-2.5 space-y-2 hover:bg-term-panel-2/50 transition-colors">
          <div className="flex items-center gap-2">
            <Icon size={16} style={{ color: mod.color }} />
            <span className="text-xs font-medium" style={{ color: mod.color }}>{mod.code}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {metrics.map((m) => (
              <div key={m.label} className="flex justify-between">
                <span className="text-2xs text-term-text-dim">{m.label}</span>
                <span className={clsx("text-2xs tnum font-medium", m.tone === "up" ? "text-emerald-400" : m.tone === "down" ? "text-red-400" : m.tone === "amber" ? "text-amber-400" : "text-term-text")}>
                  {m.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </Link>
  );
}

function getModuleMetrics(
  code: string,
  bmrk: ReturnType<typeof computeSummary>,
  curve: ReturnType<typeof computeCurveSummary>,
  vol: ReturnType<typeof computeVolSummary>,
  funding: ReturnType<typeof computeFundingCostSummary>,
  fundingRegime: { regime: FundingRegime; score: number },
  util: UtilGroupMetrics,
): { label: string; value: string; tone?: "up" | "down" | "amber" | "neutral" }[] {
  switch (code) {
    case "BMRK": return [
      { label: "SOFR", value: bmrk.sofr != null ? `${bmrk.sofr.toFixed(2)}%` : "—" },
      { label: "10Y", value: bmrk.tenY != null ? `${bmrk.tenY.toFixed(2)}%` : "—" },
      { label: "Regime", value: bmrk.regime, tone: RATE_REGIME_TONE[bmrk.regime] },
      { label: "Score", value: `${bmrk.regimeScore}` },
    ];
    case "YCURV": return [
      { label: "2s10s", value: curve.slope2s10s != null ? `${fmtSigned(curve.slope2s10s, 0)}bps` : "—", tone: curve.slope2s10s != null && curve.slope2s10s < 0 ? "down" : "up" },
      { label: "Regime", value: curve.regime, tone: CURVE_REGIME_TONE[curve.regime] },
      { label: "Inversions", value: String(curve.inversions), tone: curve.inversions > 0 ? "down" : "up" },
      { label: "Steepest", value: curve.steepest },
    ];
    case "RVOL": return [
      { label: "Regime", value: vol.regime, tone: VOL_REGIME_TONE[vol.regime] },
      { label: "Avg 20D", value: vol.avg20dVol != null ? `${vol.avg20dVol}bps` : "—" },
      { label: "Elevated", value: String(vol.elevatedCount), tone: vol.elevatedCount > 3 ? "amber" : "neutral" },
      { label: "Top Mover", value: vol.topMover },
    ];
    case "FCOST": return [
      { label: "Regime", value: fundingRegime.regime, tone: FUND_REGIME_TONE[fundingRegime.regime] },
      { label: "AA All-In", value: funding.aaAllIn != null ? `${funding.aaAllIn.toFixed(2)}%` : "—" },
      { label: "HY All-In", value: funding.hyAllIn != null ? `${funding.hyAllIn.toFixed(2)}%` : "—" },
      { label: "IG-HY Δ", value: funding.spreadCompression != null ? `${fmtSigned(funding.spreadCompression, 0)}` : "—" },
    ];
    case "UTIL": return [
      { label: "Overall", value: `${util.utilization.toFixed(1)}%` },
      { label: "Avg Fee", value: `${util.avgFeeBps.toFixed(0)}bps` },
      { label: "HTB Count", value: String(util.htbCount), tone: util.htbCount > 20 ? "amber" : "neutral" },
      { label: "Names", value: String(util.nameCount) },
    ];
    default: return [];
  }
}

function RegimeBlock({ label, regime, tone, score, drivers, href }: {
  label: string;
  regime: string;
  tone: "up" | "down" | "amber" | "neutral";
  score: number | null;
  drivers: string[];
  href: string;
}) {
  return (
    <Link to={href} className="block no-underline group">
      <div className="space-y-2 p-1 rounded hover:bg-term-panel-2/50 transition-colors">
        <div className="text-2xs text-term-text-dim">{label}</div>
        <div className="flex items-center gap-2">
          <Tag tone={tone}>{regime}</Tag>
          {score != null && <span className="text-2xs tnum text-term-text-dim">{score}/100</span>}
        </div>
        <div className="space-y-0.5">
          {drivers.slice(0, 2).map((d, i) => (
            <div key={i} className="text-3xs text-term-text-dim truncate">{d}</div>
          ))}
        </div>
        <div className="text-3xs text-term-text-mute group-hover:text-term-text-dim transition-colors">
          View details →
        </div>
      </div>
    </Link>
  );
}
