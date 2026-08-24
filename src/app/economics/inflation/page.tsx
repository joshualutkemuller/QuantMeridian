
import { useState, useEffect } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ChartLink } from "@/components/charting/ChartLink";
import { BarChart } from "@/components/charts/BarChart";
import { useDrill } from "@/components/econ/DrillProvider";
import { SourceBadge } from "@/components/econ/SourceBadge";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { isRealEconSource, useLiveSeriesSet, type DataSource } from "@/lib/useEcon";
import { worstSource } from "@/lib/provenance";
import {
  getInflationHeadlines,
  getInflationComponents,
  liveInflationItem,
  type ComponentLevel,
  type InflationItem,
  type SeasonalAdjustment,
} from "@/data/inflation";
import { fmtNum, fmtSigned, fmtSignedPct } from "@/lib/format";

// Metric the user is viewing — drives emphasis in the table.
type Metric = "index" | "mom" | "yoy" | "momAccel" | "yoyAccel";
const METRICS: { key: Metric; label: string }[] = [
  { key: "index", label: "Index reading" },
  { key: "mom", label: "MoM %" },
  { key: "yoy", label: "YoY %" },
  { key: "momAccel", label: "ΔMoM" },
  { key: "yoyAccel", label: "ΔYoY" },
];

type Basket = "CPI" | "PCE";

interface GoldInflationRow {
  series_id: string;
  basket?: string;
  sa_nsa?: string;
  observation_date?: string;
  weight?: number | null;
}

interface CpiCoverageRow {
  series_id: string;
  seasonality: SeasonalAdjustment;
  level: ComponentLevel;
  latest_transform_date: string | null;
  null_observation_rows: number;
  latest_null_observation_date: string | null;
  has_transform: boolean;
  has_null_observation: boolean;
  has_weight: boolean;
}

interface CpiCoverageData {
  ok?: boolean;
  coverage?: {
    summary: {
      total_series: number;
      transform_missing: number;
      null_observation_series: number;
      missing_weight_series: number;
      latest_transform_date: string | null;
    };
    rows: CpiCoverageRow[];
  };
}

/** Inflation sense: hotter/rising prices read red (down tone), cooling reads green (up). */
function inflClass(n: number): string {
  if (n > 0) return "text-term-down";
  if (n < 0) return "text-term-up";
  return "text-term-text-dim";
}

function contributionFromWeight(weight: number | null, yoy: number): number | null {
  return weight == null ? null : Number(((weight / 100) * yoy).toFixed(2));
}

export default function InflationExplorer() {
  const { open } = useDrill();

  const [metric, setMetric] = useState<Metric>("yoy");
  const [basket, setBasket] = useState<Basket>("CPI");
  const [componentLevel, setComponentLevel] = useState<ComponentLevel>("core");
  const [componentSeasonality, setComponentSeasonality] = useState<SeasonalAdjustment>("SA");
  const [goldData, setGoldData] = useState<any>(null);
  const [coverageData, setCoverageData] = useState<CpiCoverageData | null>(null);

  // Fetch Gold inflation data
  useEffect(() => {
    let alive = true;
    fetch("/api/econ/inflation")
      .then((r) => r.json())
      .then((data) => {
        if (alive && data.ok) {
          setGoldData(data);
        }
      })
      .catch(() => setGoldData(null));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/econ/inflation/coverage")
      .then((r) => r.json())
      .then((data) => {
        if (alive) setCoverageData(data);
      })
      .catch(() => setCoverageData(null));
    return () => { alive = false; };
  }, []);

  const goldWeightById = new Map<string, GoldInflationRow>();
  for (const row of (Array.isArray(goldData?.explorer) ? goldData.explorer as GoldInflationRow[] : [])) {
    if (row.weight == null || !Number.isFinite(row.weight)) continue;
    const current = goldWeightById.get(row.series_id);
    if (!current || (row.observation_date ?? "") > (current.observation_date ?? "")) {
      goldWeightById.set(row.series_id, row);
    }
  }

  const applyGoldWeight = (it: InflationItem): InflationItem => {
    const row = goldWeightById.get(it.id);
    if (!row) {
      if (goldData?.ok && it.group === "CPI" && it.kind === "COMPONENT") {
        return { ...it, weight: null, contribution: null, contributionEligible: false };
      }
      return it;
    }
    return {
      ...it,
      weight: row.weight ?? null,
      contribution: contributionFromWeight(row.weight ?? null, it.yoy),
      contributionEligible: it.kind === "COMPONENT" && row.weight != null,
    };
  };

  const coverageRows = coverageData?.ok && coverageData.coverage ? coverageData.coverage.rows : [];
  const cpiCoverageById = new Map(coverageRows.map((row) => [row.series_id, row]));
  const coverageReady = coverageRows.length > 0;

  // Take headline + component face values fully live from Gold index series.
  const cpiBaseComps = getInflationComponents("CPI", componentLevel, componentSeasonality);
  const cpiComps = coverageReady ? cpiBaseComps.filter((item) => cpiCoverageById.get(item.id)?.has_transform) : cpiBaseComps;
  const pceComps = getInflationComponents("PCE", componentLevel);
  const headBase = getInflationHeadlines();
  const cpiWeightedComps = cpiComps.map(applyGoldWeight);
  const pceWeightedComps = pceComps.map(applyGoldWeight);
  const allIds = [...headBase, ...cpiWeightedComps, ...pceWeightedComps].map((i) => i.id);
  const { data: liveMap, source } = useLiveSeriesSet(allIds, "lin", 15);
  const merge = (it: InflationItem) => {
    const L = liveMap[it.id];
    return L && isRealEconSource(L.source) && L.observations.length ? liveInflationItem(it, L.observations) : it;
  };

  const headlines = headBase.map(merge);
  const cpiMerged = cpiWeightedComps.map(merge);
  const components = (basket === "CPI" ? cpiMerged : pceWeightedComps.map(merge));
  const weightedComponents = components.filter((c) => c.contributionEligible && c.contribution != null);
  const currentCoverageRows = basket === "CPI" ? components.map((item) => cpiCoverageById.get(item.id)).filter(Boolean) as CpiCoverageRow[] : [];
  const dbCoveredCount = currentCoverageRows.filter((row) => row.has_transform).length;
  const nullObservationCount = currentCoverageRows.filter((row) => row.has_null_observation).length;
  const latestNullDate = currentCoverageRows.map((row) => row.latest_null_observation_date).filter(Boolean).sort().at(-1);
  const head = (g: string) => headlines.find((h) => h.group === g)!;

  // Determine page source: prefer Gold if available, otherwise FRED/SIM
  const pageSource: DataSource = goldData?.ok ? "DB" : source === "LOADING" ? "LOADING" : source === "ERR" ? "ERR" : source || "SIM";

  const summary = {
    cpiYoY: head("CPI").yoy,
    coreCpiYoY: head("CORE_CPI").yoy,
    pceYoY: head("PCE").yoy,
    corePceYoY: head("CORE_PCE").yoy,
    cpiMoM: head("CPI").mom,
    coreCpiMoM: head("CORE_CPI").mom,
    acceleratingCount: cpiMerged.filter((c) => c.yoyAccel > 0).length,
    deceleratingCount: cpiMerged.filter((c) => c.yoyAccel < 0).length,
  };

  const drillItem = (it: InflationItem) => {
    open({ id: it.id, label: it.label, units: "lin", unitLabel: "level · derived MoM/YoY", decimals: 2, growthMetrics: true });
  };

  // KPI tone: high/rising inflation reads down/red, cooling reads up/green.
  const yoyTone = (yoy: number, accel: number): "up" | "down" =>
    accel > 0 || yoy >= 2.5 ? "down" : "up";
  const cpiH = headlines.find((h) => h.group === "CPI");
  const coreCpiH = headlines.find((h) => h.group === "CORE_CPI");
  const pceH = headlines.find((h) => h.group === "PCE");
  const corePceH = headlines.find((h) => h.group === "CORE_PCE");

  // Headline grid.
  const headCols: Column<InflationItem>[] = [
    {
      key: "label",
      header: "Series",
      render: (r) => <span className="font-semibold text-term-text">{r.label}</span>,
      sortVal: (r) => r.label,
    },
    {
      key: "id",
      header: "FRED",
      render: (r) => <span className="text-term-text-mute">{r.id}</span>,
    },
    {
      key: "index",
      header: "Index",
      align: "right",
      render: (r) => <span className="text-term-text">{fmtNum(r.index, 2)}</span>,
      sortVal: (r) => r.index,
      className: () => (metric === "index" ? "bg-term-amber/5" : ""),
    },
    {
      key: "mom",
      header: "MoM %",
      align: "right",
      render: (r) => <span className={inflClass(r.mom)}>{fmtSignedPct(r.mom)}</span>,
      sortVal: (r) => r.mom,
      className: () => (metric === "mom" ? "bg-term-amber/5" : ""),
    },
    {
      key: "yoy",
      header: "YoY %",
      align: "right",
      render: (r) => <span className={inflClass(r.yoy)}>{fmtSignedPct(r.yoy)}</span>,
      sortVal: (r) => r.yoy,
      className: () => (metric === "yoy" ? "bg-term-amber/5" : ""),
    },
    {
      key: "momAccel",
      header: "ΔMoM",
      align: "right",
      render: (r) => <span className={inflClass(r.momAccel)}>{fmtSigned(r.momAccel, 2)}</span>,
      sortVal: (r) => r.momAccel,
      className: () => (metric === "momAccel" ? "bg-term-amber/5" : ""),
    },
    {
      key: "yoyAccel",
      header: "ΔYoY",
      align: "right",
      render: (r) => <span className={inflClass(r.yoyAccel)}>{fmtSigned(r.yoyAccel, 2)}</span>,
      sortVal: (r) => r.yoyAccel,
      className: () => (metric === "yoyAccel" ? "bg-term-amber/5" : ""),
    },
  ];

  // Component table.
  const compCols: Column<InflationItem>[] = [
    {
      key: "label",
      header: "Component",
      render: (r) => <span className="font-semibold text-term-text">{r.label}</span>,
      sortVal: (r) => r.label,
    },
    {
      key: "id",
      header: "Series ID",
      width: "150px",
      render: (r) => (
        <div className="flex flex-col leading-tight">
          <span className="text-term-text-mute">{r.id}</span>
          {r.legacyId && <span className="text-3xs text-term-text-dim">legacy {r.legacyId}</span>}
        </div>
      ),
      sortVal: (r) => r.id,
    },
    {
      key: "weight",
      header: "Weight %",
      align: "right",
      render: (r) => (
        r.weight == null
          ? <span className="text-term-text-dim">-</span>
          : <span className="text-term-text-dim">{fmtNum(r.weight, 1)}</span>
      ),
      sortVal: (r) => r.weight ?? -1,
    },
    {
      key: "index",
      header: "Index",
      align: "right",
      render: (r) => <span className="text-term-text">{fmtNum(r.index, 2)}</span>,
      sortVal: (r) => r.index,
      className: () => (metric === "index" ? "bg-term-amber/5" : ""),
    },
    {
      key: "mom",
      header: "MoM %",
      align: "right",
      render: (r) => <span className={inflClass(r.mom)}>{fmtSignedPct(r.mom)}</span>,
      sortVal: (r) => r.mom,
      className: () => (metric === "mom" ? "bg-term-amber/5" : ""),
    },
    {
      key: "yoy",
      header: "YoY %",
      align: "right",
      render: (r) => <span className={inflClass(r.yoy)}>{fmtSignedPct(r.yoy)}</span>,
      sortVal: (r) => r.yoy,
      className: () => (metric === "yoy" ? "bg-term-amber/5" : ""),
    },
    {
      key: "momAccel",
      header: "ΔMoM",
      align: "right",
      render: (r) => <span className={inflClass(r.momAccel)}>{fmtSigned(r.momAccel, 2)}</span>,
      sortVal: (r) => r.momAccel,
      className: () => (metric === "momAccel" ? "bg-term-amber/5" : ""),
    },
    {
      key: "yoyAccel",
      header: "ΔYoY",
      align: "right",
      render: (r) => <span className={inflClass(r.yoyAccel)}>{fmtSigned(r.yoyAccel, 2)}</span>,
      sortVal: (r) => r.yoyAccel,
      className: () => (metric === "yoyAccel" ? "bg-term-amber/5" : ""),
    },
    {
      key: "contribution",
      header: "Contrib pp",
      align: "right",
      render: (r) => (
        r.contribution == null
          ? <span className="text-term-text-dim">-</span>
          : <span className={inflClass(r.contribution)}>{fmtSigned(r.contribution, 2)}</span>
      ),
      sortVal: (r) => r.contribution ?? Number.NEGATIVE_INFINITY,
    },
  ];

  // Contribution bars (weighted YoY pp) sorted desc.
  const contribBars = [...weightedComponents]
    .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0))
    .map((c) => ({
      label: c.label,
      value: c.contribution ?? 0,
      color: (c.contribution ?? 0) >= 0 ? "#FF3B3B" : "#2ECC71",
    }));

  // Hot / cool lists by yoyAccel.
  const byAccel = [...components].sort((a, b) => b.yoyAccel - a.yoyAccel);
  const accelerating = byAccel.slice(0, 6);
  const decelerating = [...byAccel].reverse().slice(0, 6);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="INFL"
        title="Inflation Explorer"
        desc="CPI · Core CPI · PCE · Core PCE to item level"
        right={<span className="flex items-center gap-2"><ChartLink refs={[{ source: "econ", id: "CPIAUCSL" }, { source: "econ", id: "PCEPI" }]} range="5Y" transform="yoy" /><SourceBadge source={pageSource} /></span>}
      />

      <KpiStrip>
        <Stat
          label="CPI YoY"
          value={`${fmtNum(summary.cpiYoY, 1)}%`}
          sub={cpiH ? <span className={inflClass(cpiH.yoyAccel)}>{fmtSigned(cpiH.yoyAccel, 2)} ΔYoY</span> : undefined}
          tone={yoyTone(summary.cpiYoY, cpiH?.yoyAccel ?? 0)}
        />
        <Stat
          label="Core CPI YoY"
          value={`${fmtNum(summary.coreCpiYoY, 1)}%`}
          sub={coreCpiH ? <span className={inflClass(coreCpiH.yoyAccel)}>{fmtSigned(coreCpiH.yoyAccel, 2)} ΔYoY</span> : undefined}
          tone={yoyTone(summary.coreCpiYoY, coreCpiH?.yoyAccel ?? 0)}
        />
        <Stat
          label="PCE YoY"
          value={`${fmtNum(summary.pceYoY, 1)}%`}
          sub={pceH ? <span className={inflClass(pceH.yoyAccel)}>{fmtSigned(pceH.yoyAccel, 2)} ΔYoY</span> : undefined}
          tone={yoyTone(summary.pceYoY, pceH?.yoyAccel ?? 0)}
        />
        <Stat
          label="Core PCE YoY"
          value={`${fmtNum(summary.corePceYoY, 1)}%`}
          sub={corePceH ? <span className={inflClass(corePceH.yoyAccel)}>{fmtSigned(corePceH.yoyAccel, 2)} ΔYoY</span> : undefined}
          tone={yoyTone(summary.corePceYoY, corePceH?.yoyAccel ?? 0)}
        />
        <Stat
          label="CPI MoM"
          value={fmtSignedPct(summary.cpiMoM)}
          sub={`Core ${fmtSignedPct(summary.coreCpiMoM)}`}
          tone={summary.cpiMoM > 0 ? "down" : "up"}
        />
        <Stat
          label="Accelerating"
          value={String(summary.acceleratingCount)}
          sub={<span className="text-term-up">{summary.deceleratingCount} decelerating</span>}
          tone={summary.acceleratingCount > summary.deceleratingCount ? "down" : "up"}
        />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        {/* HEADLINES */}
        <Panel
          title="Headline Aggregates"
          code="HEAD"
          accent
          className="xl:col-span-2"
          right={<span className="text-3xs text-term-text-mute">click a row → drill 24m</span>}
        >
          <DataGrid
            columns={headCols}
            rows={headlines}
            rowKey={(r) => r.id}
            onRowClick={drillItem}
            initialSort={{ key: "yoy", dir: "desc" }}
          />
        </Panel>

        {/* TOGGLES */}
        <Panel title="View Controls" code="VIEW">
          <div className="space-y-3 px-3 py-3">
            <TermToggleGroup label="Primary Metric" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.key, label: m.label }))} />
            <TermToggleGroup label="Basket" value={basket} onChange={setBasket} options={[{ value: "CPI" as Basket, label: "CPI" }, { value: "PCE" as Basket, label: "PCE" }]} />
            <TermToggleGroup label="Level" value={componentLevel} onChange={setComponentLevel} options={[{ value: "core" as ComponentLevel, label: "Core View" }, { value: "expanded" as ComponentLevel, label: "Expanded" }]} />
            {basket === "CPI" && (
              <TermToggleGroup label="CPI Adj." value={componentSeasonality} onChange={setComponentSeasonality} options={[{ value: "SA" as SeasonalAdjustment, label: "SA" }, { value: "NSA" as SeasonalAdjustment, label: "NSA" }]} />
            )}
            {basket === "CPI" && (
              <div className="flex flex-wrap items-center gap-1 border-t border-term-border pt-2">
                <span className="term-label">Coverage</span>
                <Tag tone={coverageReady && dbCoveredCount === components.length ? "up" : "amber"}>{dbCoveredCount}/{components.length} DB</Tag>
                <Tag tone={weightedComponents.length ? "blue" : "neutral"}>{weightedComponents.length} weighted</Tag>
                {nullObservationCount > 0 && <Tag tone="amber">{nullObservationCount} null obs</Tag>}
                {componentSeasonality === "NSA" && <Tag tone="violet">CUUR</Tag>}
                {latestNullDate && <span className="text-3xs text-term-text-mute">latest null {latestNullDate}</span>}
              </div>
            )}
            <div className="space-y-1 border-t border-term-border pt-2 text-3xs text-term-text-mute">
              <p>
                <span className="text-term-amber">ΔMoM / ΔYoY</span> = change in the % print vs the prior
                month (acceleration). Positive = hotter.
              </p>
              <p>
                Click any item to drill to raw index levels with derived <span className="text-term-amber">MoM / YoY / ΔMoM / ΔYoY</span>.
              </p>
              {basket === "CPI" && componentSeasonality === "NSA" && (
                <p>NSA shows DB-backed CUUR rows only; SA-only detail rows stay out of this view.</p>
              )}
            </div>
          </div>
        </Panel>

        {/* COMPONENT TABLE */}
        <Panel
          title={`${basket} Components — ${componentLevel === "expanded" ? "Expanded" : "Core"}`}
          code="COMP"
          accent
          className="xl:col-span-2"
          right={
            <div className="flex items-center gap-2">
              <Tag tone="blue">{components.length} items</Tag>
              {basket === "CPI" && <Tag tone="violet">{componentSeasonality}</Tag>}
              {basket === "CPI" && coverageReady && <Tag tone={dbCoveredCount === components.length ? "up" : "amber"}>{dbCoveredCount} DB</Tag>}
              {componentLevel === "expanded" && <Tag tone="amber">{weightedComponents.length} weighted</Tag>}
              {nullObservationCount > 0 && <Tag tone="amber">{nullObservationCount} nulls</Tag>}
              <span className="text-3xs text-term-text-mute">{METRICS.find((m) => m.key === metric)?.label}</span>
            </div>
          }
        >
          <DataGrid
            columns={compCols}
            rows={components}
            rowKey={(r) => r.id}
            onRowClick={drillItem}
            maxHeight="420px"
            initialSort={{ key: "weight", dir: "desc" }}
          />
        </Panel>

        {/* CONTRIBUTION */}
        <Panel title="YoY Contribution" code="CTRB" right={<span className="text-3xs text-term-text-mute">{weightedComponents.length} weighted pp</span>}>
          <div className="px-2 py-2">
            <BarChart data={contribBars} horizontal fmt={(n) => fmtSigned(n, 2)} />
            <div className="mt-2 px-1 text-3xs text-term-text-mute">
              Weight × YoY = contribution to headline {basket}. <span className="text-term-down">Red</span> adds to
              inflation, <span className="text-term-up">green</span> subtracts. Rows without verified weights are excluded.
            </div>
          </div>
        </Panel>

        {/* HOT / COOL */}
        <Panel title="Acceleration Leaders" code="ACCL" className="xl:col-span-3">
          <div className="grid grid-cols-1 gap-px bg-term-border sm:grid-cols-2">
            <div className="bg-term-panel">
              <div className="term-label flex items-center gap-2 px-3 py-1.5">
                <Tag tone="down">HOTTEST</Tag> Top Accelerating (ΔYoY desc)
              </div>
              <div className="divide-y divide-term-border-soft">
                {accelerating.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => drillItem(c)}
                    className="flex w-full items-center justify-between px-3 py-1 text-left text-2xs hover:bg-term-panel-2"
                  >
                    <span className="text-term-text">{c.label}</span>
                    <span className="flex items-center gap-3">
                      <span className="tnum text-term-text-dim">{fmtSignedPct(c.yoy)} YoY</span>
                      <span className={`tnum w-12 text-right ${inflClass(c.yoyAccel)}`}>{fmtSigned(c.yoyAccel, 2)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-term-panel">
              <div className="term-label flex items-center gap-2 px-3 py-1.5">
                <Tag tone="up">COOLEST</Tag> Top Decelerating (ΔYoY asc)
              </div>
              <div className="divide-y divide-term-border-soft">
                {decelerating.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => drillItem(c)}
                    className="flex w-full items-center justify-between px-3 py-1 text-left text-2xs hover:bg-term-panel-2"
                  >
                    <span className="text-term-text">{c.label}</span>
                    <span className="flex items-center gap-3">
                      <span className="tnum text-term-text-dim">{fmtSignedPct(c.yoy)} YoY</span>
                      <span className={`tnum w-12 text-right ${inflClass(c.yoyAccel)}`}>{fmtSigned(c.yoyAccel, 2)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="border-t border-term-border px-3 py-1.5 text-3xs text-term-text-mute">
            ΔMoM / ΔYoY measure the change in the % print vs the prior month (acceleration / deceleration). Click any
            item to drill into its rolling 24-month live history.
          </div>
        </Panel>
      </div>
    </div>
  );
}
