
import { useMemo, useState } from "react";
import { useNews } from "@/lib/useNews";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { SourceBadge } from "@/components/econ/SourceBadge";
import { useDrill } from "@/components/econ/DrillProvider";
import { useEconSeries, useLiveIndicators, type LiveIndicator } from "@/lib/useEcon";
import {
  FRED_CATALOG,
  resolveFred,
  seriesById,
  ECON_CATEGORY_LABEL,
  type IndicatorRow,
  type EconCategory,
  type FredSeries,
} from "@/data/econSeries";
import { fmtNum, fmtSigned, pnlClass } from "@/lib/format";
import clsx from "clsx";
import { DataLegend } from "@/components/ui/DataLegend";
import { StalenessBar } from "@/components/ui/StalenessBar";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { econChartHref } from "@/components/charting/ChartLink";
import Link from "@/components/Link";
import { AreaChart } from "lucide-react";

type Tone = "up" | "down" | "amber" | "neutral";

/** Pick a tone from an indicator's bullish semantics + the direction of its change. */
function toneFor(bullish: boolean | null, change: number): Tone {
  if (change === 0) return "neutral";
  if (bullish === null) return "amber";
  // "improving" = change agrees with the bullish direction.
  const improving = bullish ? change > 0 : change < 0;
  return improving ? "up" : "down";
}

/** Format a value with its unit suffix where the unit reads as a suffix. */
function fmtVal(v: number, decimals: number, unit: string): string {
  const n = fmtNum(v, decimals);
  if (unit === "%" || unit.startsWith("%")) return `${n}%`;
  if (unit === "bps") return `${n} bps`;
  return `${n} ${unit}`;
}

function pct(now: number, then: number, decimals = 2): number | null {
  if (then === 0) return null;
  return Number((((now - then) / Math.abs(then)) * 100).toFixed(decimals));
}

function metricClass(v: number | null | undefined) {
  return v == null ? "text-term-text-dim" : pnlClass(v);
}

const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

function periodLabel(r: IndicatorRow, asOf: string): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(asOf);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  if (r.freq === "Q") return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
  if (r.freq === "M") return MONTH_YEAR_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)));
  return null;
}

const KPI_IDS = ["GDPNOW", "PCEPILFE", "UNRATE", "FEDFUNDS", "DGS10", "T10Y2Y"] as const;
const KPI_LABEL: Record<string, string> = {
  GDPNOW: "Real GDP (Nowcast)",
  PCEPILFE: "Core PCE",
  UNRATE: "Unemployment",
  FEDFUNDS: "Effective Fed Funds",
  DGS10: "10Y Treasury",
  T10Y2Y: "2s10s Spread",
};

const SELECTOR_IDS = ["DGS10", "DGS2", "CPIAUCSL", "UNRATE", "FEDFUNDS"] as const;
const SELECTOR_LABEL: Record<string, string> = {
  DGS10: "UST 10Y",
  DGS2: "UST 2Y",
  CPIAUCSL: "CPI",
  UNRATE: "U-3",
  FEDFUNDS: "EFFR",
};


/** Drill extra growth diagnostics where a raw level can produce meaningful MoM/YoY rates. */
function hasGrowthDrill(r: IndicatorRow): boolean {
  const meta = seriesById(r.id) as FredSeries | undefined;
  if (!meta || meta.freq !== "M") return false;
  const resolved = resolveFred(r.id);
  if (resolved.simOnly || resolved.units === "lin") return false;
  return r.category === "INFLATION" || r.unit.includes("y/y") || r.unit.includes("m/m");
}

const CATEGORY_ORDER: EconCategory[] = [
  "GROWTH",
  "INFLATION",
  "LABOR",
  "RATES",
  "HOUSING",
  "CONSUMER",
  "MONEY",
  "ACTIVITY",
];

/** Merged display values: Gold DB data overlaid on catalog metadata only. */
function effective(r: IndicatorRow, L: LiveIndicator | undefined) {
  return {
    value: L ? L.value : r.value,
    prior: L ? L.prior : r.prior,
    change: L ? L.change : r.change,
    changePct: L ? L.changePct : pct(r.value, r.prior, 2),
    mom: L ? L.mom : null,
    momDelta: L ? L.momDelta : null,
    qoq: L ? L.qoq : null,
    yoy: L ? L.yoy : r.yoy,
    yoyDelta: L ? L.yoyDelta : null,
    monthlyPrint: L ? L.monthlyPrint : null,
    indexValue: L ? L.indexValue ?? null : null,
    spark: L && L.history.length ? L.history : r.spark,
    asOf: L ? L.asOf : r.asOf,
    source: L ? L.source : "ERR" as const,
  };
}

export default function MacroDashboard() {
  // Unconditional, fixed-id live hook — drives the featured live chart.
  const { headlines } = useNews(30);
  const macroHeadlines = useMemo(() => headlines.filter(h => h.assetClass === "MACRO" || h.assetClass === "RATES" || h.assetClass === "CREDIT").sort((a, b) => b.importance - a.importance), [headlines]);
  const live = useEconSeries("DGS10", 120);
  // All-indicator live feed (FRED, unit-corrected server-side) keyed by series id.
  const { data: liveInd, source: indSource } = useLiveIndicators();
  const { open } = useDrill();

  const [selectedId, setSelectedId] = useState<string>("DGS2");
  const [catFilter, setCatFilter] = useState<string>("ALL");

  const indicators = useMemo<IndicatorRow[]>(
    () =>
      FRED_CATALOG.map((s) => ({
        id: s.id,
        label: s.label,
        short: s.short,
        category: s.category,
        unit: s.unit,
        value: s.level,
        prior: s.level,
        change: 0,
        yoy: s.unit.includes("y/y") ? s.level : 0,
        surprise: 0,
        spark: [],
        bullish: s.bullish,
        decimals: s.decimals,
        asOf: "",
      })),
    []
  );
  const byId = (id: string): IndicatorRow | undefined => indicators.find((i) => i.id === id);

  /** Open the 24-month drill-down for an indicator row. */
  const drill = (r: IndicatorRow) => {
    const growthMetrics = hasGrowthDrill(r);
    const qoqAnnualizedMetrics = resolveFred(r.id).units === "pca" && seriesById(r.id)?.freq === "Q";
    open({
      id: r.id,
      label: r.label,
      units: resolveFred(r.id).units,
      unitLabel: qoqAnnualizedMetrics ? "index · QoQ annualized" : growthMetrics ? "level · derived MoM/YoY" : r.unit,
      decimals: growthMetrics ? 2 : r.decimals,
      growthMetrics,
      qoqAnnualizedMetrics,
    });
  };

  // Latest data date across all live indicators (the dashboard's "as of").
  const dashAsOf =
    Object.values(liveInd)
      .map((i) => i.asOf)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

  const liveValues = live.data.map((o) => o.value);
  const liveLabels = live.data.map((o) => o.date);

  const selLive = liveInd[selectedId];
  const selValues = selLive?.history?.length ? selLive.history : [];
  const selLabels = selValues.map((_, i) => `T-${selValues.length - 1 - i}`);
  const selMeta = byId(selectedId);

  // Economic surprise: high-signal series with non-trivial surprise magnitude.
  const HIGH_SIGNAL = new Set([
    "GDPNOW",
    "CPIAUCSL",
    "PCEPILFE",
    "UNRATE",
    "PAYEMS",
    "ICSA",
    "ISM-MFG",
    "ISM-SVC",
    "RSAFS",
  ]);
  const displayRows = indicators.map((r) => ({ ...r, live: effective(r, liveInd[r.id]) }));

  const surpriseBars = indicators
    .filter((i) => HIGH_SIGNAL.has(i.id))
    .map((i) => ({
      label: i.short,
      value: i.surprise,
      color: i.surprise >= 0 ? "#2ECC71" : "#FF3B3B",
    }))
    .sort((a, b) => b.value - a.value);

  // Macro heat: per-category improving vs deteriorating counts.
  const heatTiles = CATEGORY_ORDER.map((cat) => {
    const rows = indicators.filter((i) => i.category === cat);
    let improving = 0;
    let deteriorating = 0;
    for (const r of rows) {
      const { change } = effective(r, liveInd[r.id]);
      const t = toneFor(r.bullish, change);
      if (t === "up") improving++;
      else if (t === "down") deteriorating++;
    }
    return { cat, total: rows.length, improving, deteriorating };
  });

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="ECON"
        title="Macro Dashboard"
        desc="FRED-connected economic analytics"
        asOf={dashAsOf}
        right={<SourceBadge source={indSource} />}
      />

      <StalenessBar asOf={dashAsOf} />

      <KpiStrip>
        {KPI_IDS.map((id) => {
          const r = byId(id);
          if (!r) return <Stat key={id} label={KPI_LABEL[id]} value="—" />;
          const { value, change, asOf } = effective(r, liveInd[r.id]);
          const tone = toneFor(r.bullish, change);
          const period = periodLabel(r, asOf);
          return (
            <div key={id} onClick={() => drill(r)} className="cursor-pointer transition-colors hover:bg-term-panel-2">
              <Stat
                label={KPI_LABEL[id]}
                value={fmtVal(value, r.decimals, r.unit)}
                sub={
                  <span>
                    {period && <span className="text-term-text">{period} · </span>}
                    <span className={pnlClass(change)}>Δ {fmtSigned(change, r.decimals)} {r.unit}</span>
                    {asOf && <span> · as of {asOf}</span>}
                  </span>
                }
                tone={tone}
              />
            </div>
          );
        })}
      </KpiStrip>

      <div className="grid grid-cols-12 gap-2 p-2">
        {/* Key indicators by category */}
        <div className="col-span-12 xl:col-span-7">
          <Panel
            title="Key Indicators by Category"
            code="ECDB"
            accent
            toolbar={<TermToggleGroup label="Category" value={catFilter} onChange={setCatFilter} options={[{ value: "ALL", label: "All" }, ...CATEGORY_ORDER.map((c) => ({ value: c, label: ECON_CATEGORY_LABEL[c] }))]} size="sm" />}
            right={<span className="tnum text-3xs text-term-text-mute">{indicators.length} series · inflation value = MoM % · Δ MoM/YoY in pp</span>}
          >
            <div className="grid grid-cols-1 gap-px bg-term-border md:grid-cols-2">
              {CATEGORY_ORDER.filter((cat) => catFilter === "ALL" || cat === catFilter).map((cat) => {
                const rows = displayRows.filter((i) => i.category === cat);
                if (rows.length === 0) return null;
                const isInflation = cat === "INFLATION";
                const gridCols = isInflation
                  ? "grid-cols-[minmax(4.5rem,1fr)_1.5rem_4.25rem_4.75rem_4rem_4rem_4rem_4rem_1.25rem_3.5rem]"
                  : "grid-cols-[minmax(4.5rem,1fr)_1.5rem_4.75rem_4.25rem_4rem_4rem_3.5rem_3.5rem_3.5rem_4rem_1.25rem_3.5rem]";
                return (
                  <div key={cat} className="bg-term-panel">
                    <div className="flex items-center justify-between bg-term-panel-2 px-2 py-1">
                      <span className="text-2xs font-semibold uppercase tracking-wide text-term-amber">
                        {ECON_CATEGORY_LABEL[cat]}
                      </span>
                      <span className="text-3xs text-term-text-mute">{rows.length}</span>
                    </div>
                    <div className="divide-y divide-term-border-soft">
                      <div className={`grid ${gridCols} items-center gap-1 px-2 py-1 text-3xs uppercase tracking-wide text-term-text-mute`}>
                        {isInflation ? (
                          <>
                            <span>Series</span>
                            <span title="Publication frequency">F</span>
                            <span className="text-right" title="Month-over-month percent change from raw index levels">MoM %</span>
                            <span className="text-right" title="Latest raw index level/value">Index</span>
                            <span className="text-right" title="Absolute change in MoM percent change, in percentage points">Δ MoM</span>
                            <span className="text-right" title="Year-over-year percent change from raw index levels">YoY %</span>
                            <span className="text-right" title="Absolute change in YoY percent change, in percentage points">Δ YoY</span>
                            <span className="text-right">As of</span>
                            <span className="text-center" title="Data source for this indicator">Src</span>
                            <span />
                          </>
                        ) : (
                          <>
                            <span>Series</span>
                            <span title="Publication frequency">F</span>
                            <span className="text-right">Value</span>
                            <span className="text-right">As of</span>
                            <span className="text-right" title="Absolute change vs prior print (for YoY series this is the change in the YoY rate, not monthly price change)">Δ Prior</span>
                            <span className="text-right" title="Percent change vs prior print">Δ% Prior</span>
                            <span className="text-right" title="Month-over-month percent change from raw level/index values">MoM %</span>
                            <span className="text-right" title="Quarter-over-quarter percent change from raw level/index values">QoQ %</span>
                            <span className="text-right" title="Year-over-year percent change from raw level/index values, or the YoY display print">YoY %</span>
                            <span className="text-right" title="Inflation monthly print derived from index levels">Infl. print</span>
                            <span className="text-center" title="Data source for this indicator">Src</span>
                            <span />
                          </>
                        )}
                      </div>
                      {rows.map((r) => {
                        const e = r.live;
                        return (
                          <div
                            key={r.id}
                            onClick={() => drill(r)}
                            className={`grid cursor-pointer ${gridCols} items-center gap-1 px-2 py-1 text-2xs transition-colors hover:bg-term-panel-2`}
                            title={`${r.label} — click to drill 24m`}
                          >
                            <span className="truncate font-semibold text-term-text" title={r.label}>
                              {r.short}
                            </span>
                            <span className="text-3xs text-term-text-mute" title={`${({D:"Daily",W:"Weekly",M:"Monthly",Q:"Quarterly"} as Record<string,string>)[seriesById(r.id)?.freq ?? ""] ?? ""} frequency`}>
                              {seriesById(r.id)?.freq ?? ""}
                            </span>
                            {isInflation ? (
                              <>
                                <span className={`tnum text-right ${metricClass(e.mom)}`} title="Month-over-month percent change from raw index levels">
                                  {e.mom == null ? "—" : `${fmtSigned(e.mom, 2)}%`}
                                </span>
                                <span className="tnum text-right text-term-text" title="Latest raw index level/value">
                                  {e.indexValue == null ? "—" : fmtNum(e.indexValue, r.decimals)}
                                </span>
                                <span className={`tnum text-right ${metricClass(e.momDelta)}`} title="Change in MoM percent change, in percentage points">
                                  {e.momDelta == null ? "—" : `${fmtSigned(e.momDelta, 2)}pp`}
                                </span>
                                <span className={`tnum text-right ${metricClass(e.yoy)}`} title="Year-over-year percent change from raw index levels">
                                  {e.yoy == null ? "—" : `${fmtSigned(e.yoy, 1)}%`}
                                </span>
                                <span className={`tnum text-right ${metricClass(e.yoyDelta)}`} title="Change in YoY percent change, in percentage points">
                                  {e.yoyDelta == null ? "—" : `${fmtSigned(e.yoyDelta, 2)}pp`}
                                </span>
                                <span className="tnum truncate text-right text-term-text-mute" title={e.asOf}>
                                  {e.asOf.slice(5)}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="tnum text-right text-term-text">
                                  {fmtVal(e.value, r.decimals, r.unit)}
                                </span>
                                <span className="tnum truncate text-right text-term-text-mute" title={e.asOf}>
                                  {e.asOf.slice(5)}
                                </span>
                                <span className={`tnum text-right ${pnlClass(e.change)}`} title={`Change vs prior print${r.unit.includes("y/y") ? " (change in YoY rate, not monthly)" : ""}: ${fmtSigned(e.change, r.decimals)} ${r.unit}`}>
                                  {fmtSigned(e.change, r.decimals)}
                                </span>
                                <span className={`tnum text-right ${metricClass(e.changePct)}`} title="Percent change vs prior print">
                                  {e.changePct == null ? "—" : `${fmtSigned(e.changePct, 2)}%`}
                                </span>
                                <span className={`tnum text-right ${metricClass(e.mom)}`}>
                                  {e.mom == null ? "—" : `${fmtSigned(e.mom, 2)}%`}
                                </span>
                                <span className={`tnum text-right ${metricClass(e.qoq)}`}>
                                  {e.qoq == null ? "—" : `${fmtSigned(e.qoq, 2)}%`}
                                </span>
                                <span className={`tnum text-right ${metricClass(e.yoy)}`}>
                                  {e.yoy == null ? "—" : `${fmtSigned(e.yoy, 1)}%`}
                                </span>
                                <span className={`tnum text-right ${metricClass(e.monthlyPrint)}`} title="Inflation monthly print: percent change from raw index level, not a change in the YoY print">
                                  {e.monthlyPrint == null ? "—" : `${fmtSigned(e.monthlyPrint, 2)}%`}
                                </span>
                              </>
                            )}
                            <span className="flex items-center justify-center" title={`Source: ${e.source}`}>
                              <span className={clsx("h-1.5 w-1.5 rounded-full", e.source === "DB" || e.source === "FRED" ? "bg-term-up" : e.source === "SNAPSHOT" ? "bg-term-violet" : "bg-term-amber")} />
                            </span>
                            <span className="inline-flex justify-end">
                              <Sparkline data={e.spark} width={56} height={18} />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* Right column: featured live + selector */}
        <div className="col-span-12 flex flex-col gap-2 xl:col-span-5">
          <Panel
            title="Live Series — UST 10Y"
            code="DGS10"
            right={<SourceBadge source={live.source} />}
          >
            <div className="p-2">
              <LineChart
                height={160}
                labels={liveLabels}
                yFmt={(n) => `${n.toFixed(2)}%`}
                series={[{ name: "UST 10Y", data: liveValues, color: "#FF8C00", area: true }]}
              />
              <div className="mt-1 flex items-center justify-between px-1 text-3xs text-term-text-mute">
                <span>120 observations · daily</span>
                <span className="tnum">
                  latest {liveValues.length ? liveValues[liveValues.length - 1].toFixed(2) : "—"}%
                </span>
              </div>
            </div>
          </Panel>

          <Panel
            title="Series Explorer"
            code="GRAPH"
            right={<Tag tone="blue">SIM HISTORY</Tag>}
          >
            <div className="flex flex-wrap gap-px border-b border-term-border bg-term-border">
              {SELECTOR_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => setSelectedId(id)}
                  className={`px-2.5 py-1 text-2xs font-semibold transition-colors ${
                    selectedId === id
                      ? "bg-term-panel text-term-amber"
                      : "bg-term-panel-2 text-term-text-mute hover:text-term-text"
                  }`}
                >
                  {SELECTOR_LABEL[id]}
                </button>
              ))}
            </div>
            <div className="p-2">
              <LineChart
                height={150}
                labels={selLabels}
                yFmt={(n) => fmtNum(n, selMeta?.decimals ?? 2)}
                series={[{ name: selectedId, data: selValues, color: "#3B9DFF", area: true }]}
              />
              <div className="mt-1 flex items-center justify-between px-1 text-3xs text-term-text-mute">
                <span>{selMeta ? `${selMeta.label} · ${selMeta.unit}` : selectedId}</span>
                <Link href={econChartHref(selectedId)} className="inline-flex items-center gap-1 text-term-amber hover:text-term-text transition-colors">
                  <AreaChart className="h-3 w-3" /> Open in Chart Studio
                </Link>
              </div>
            </div>
          </Panel>
        </div>

        {/* Economic surprise */}
        <div className="col-span-12 md:col-span-6 xl:col-span-5">
          <Panel
            title="Economic Surprise Index"
            code="SURP"
            right={<span className="text-3xs text-term-text-mute">actual − consensus</span>}
          >
            <div className="p-2">
              <BarChart
                data={surpriseBars}
                horizontal
                fmt={(n) => fmtSigned(n, 1)}
              />
            </div>
          </Panel>
        </div>

        {/* Macro heat strip */}
        <div className="col-span-12 md:col-span-6 xl:col-span-7">
          <Panel title="Macro Heat — Breadth" code="HEAT">
            <div className="grid grid-cols-2 gap-px bg-term-border sm:grid-cols-4">
              {heatTiles.map((t) => {
                const net = t.improving - t.deteriorating;
                const tone: Tone = net > 0 ? "up" : net < 0 ? "down" : "neutral";
                return (
                  <div key={t.cat} className="bg-term-panel px-2.5 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-2xs font-semibold uppercase tracking-wide text-term-text-dim">
                        {ECON_CATEGORY_LABEL[t.cat]}
                      </span>
                      <Tag tone={tone}>{net >= 0 ? `+${net}` : `${net}`}</Tag>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-2xs">
                      <span className="tnum text-term-up">▲ {t.improving}</span>
                      <span className="tnum text-term-down">▼ {t.deteriorating}</span>
                      <span className="tnum ml-auto text-term-text-mute">{t.total} tot</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-2 px-2 pb-2">
        <div className="col-span-12 xl:col-span-5">
          <Panel title="Macro Headlines" code="NEWS" right={<Link href="/news" className="text-3xs text-term-blue hover:underline">Full News →</Link>}>
            <div className="divide-y divide-term-border-soft">
              {macroHeadlines.slice(0, 5).map((h) => (
                <div key={h.id} className="flex items-center gap-2 px-2 py-1.5 text-2xs">
                  <span className="tnum w-10 shrink-0 text-term-text-mute">{h.time}</span>
                  <Tag tone={h.sentimentScore > 0.15 ? "up" : h.sentimentScore < -0.15 ? "down" : "neutral"}>{h.sentiment}</Tag>
                  <span className="min-w-0 flex-1 truncate text-term-text">{h.headline}</span>
                  {h.tickers.slice(0, 2).map((t, i) => <span key={i} className="text-3xs text-term-blue">{t}</span>)}
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <div className="col-span-12 xl:col-span-7">
          <DataLegend />
        </div>
      </div>
    </div>
  );
}
