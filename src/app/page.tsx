import clsx from "clsx";
import { CalendarClock, Database, Globe2, Landmark, LineChart, ShieldAlert, TrendingUp } from "lucide-react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import {
  type CommandCenterCatalyst,
  type CommandCenterMetric,
  type CommandCenterReturnHorizon,
  type CommandCenterTone,
} from "@/lib/commandCenter";
import { useCommandCenter } from "@/lib/useCommandCenter";
import { fmtNum, fmtSigned, fmtSignedPct, pnlClass } from "@/lib/format";

const toneClass: Record<CommandCenterTone, string> = {
  up: "text-term-up",
  down: "text-term-down",
  amber: "text-term-amber",
  neutral: "text-term-text",
};

function valueText(metric: CommandCenterMetric): string {
  if (metric.unit === "%") return `${fmtNum(metric.value, metric.decimals)}%`;
  if (metric.unit.includes("%")) return `${fmtNum(metric.value, metric.decimals)} ${metric.unit}`;
  if (metric.unit === "bps") return `${fmtNum(metric.value, metric.decimals)} bp`;
  if (metric.unit === "$T") return `$${fmtNum(metric.value, metric.decimals)}T`;
  if (metric.unit === "k") return `${fmtNum(metric.value, metric.decimals)}k`;
  if (metric.unit === "$/oz" || metric.unit === "$/bbl") return `$${fmtNum(metric.value, metric.decimals)}`;
  return fmtNum(metric.value, metric.decimals);
}

function changeText(metric: CommandCenterMetric): string {
  if (metric.changeMode === "pct") return metric.changePct == null ? "-" : fmtSignedPct(metric.changePct, 2);
  if (metric.changeMode === "bps") return metric.change == null ? "-" : `${fmtSigned(metric.change, 0)} bp`;
  if (metric.changeMode === "points") return metric.change == null ? "-" : `${fmtSigned(metric.change, metric.decimals)} pt`;
  return metric.change == null ? "-" : fmtSigned(metric.change, metric.decimals);
}

function changeClass(metric: CommandCenterMetric): string {
  if (metric.changeMode === "pct") return pnlClass(metric.changePct ?? 0);
  return pnlClass(metric.change ?? 0);
}

function levelDeltaText(metric: CommandCenterMetric): string {
  if (metric.change == null) return "-";
  return fmtSigned(metric.change, metric.unit === "$/bbl" ? 2 : metric.decimals);
}

function returnText(metric: CommandCenterMetric, horizon: CommandCenterReturnHorizon): string {
  const ret = metric.marketReturns?.[horizon];
  return ret?.value == null ? "-" : fmtSignedPct(ret.value, 2);
}

function returnClass(metric: CommandCenterMetric, horizon: CommandCenterReturnHorizon): string {
  return pnlClass(metric.marketReturns?.[horizon]?.value ?? 0);
}

function returnTitle(metric: CommandCenterMetric, horizon: CommandCenterReturnHorizon): string {
  const ret = metric.marketReturns?.[horizon];
  if (!ret?.startDate || !ret.endDate) return `${metric.label} ${horizon} return unavailable`;
  const ann = ret.annualized ? "annualized, 252 trading-day basis" : "cumulative";
  return `${metric.label} ${horizon} ${ann}: ${ret.startDate} to ${ret.endDate}, ${ret.tradingDays} trading observations`;
}

function metricColumns(showSection = false): Column<CommandCenterMetric>[] {
  return [
    {
      key: "series",
      header: "Series",
      width: "230px",
      sortVal: (metric) => metric.short,
      render: (metric) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-term-text" title={metric.label}>{metric.short}</div>
          <div className="truncate font-mono text-3xs text-term-text-mute">{metric.id}</div>
        </div>
      ),
    },
    ...(showSection ? [{
      key: "section",
      header: "Block",
      width: "92px",
      sortVal: (metric: CommandCenterMetric) => metric.section,
      render: (metric: CommandCenterMetric) => <Tag>{metric.section}</Tag>,
    } satisfies Column<CommandCenterMetric>] : []),
    {
      key: "value",
      header: "Value",
      align: "right",
      width: "110px",
      sortVal: (metric) => metric.value,
      render: (metric) => <span className={clsx("font-semibold", toneClass[metric.tone])}>{valueText(metric)}</span>,
    },
    {
      key: "change",
      header: "Δ",
      align: "right",
      width: "90px",
      sortVal: (metric) => metric.change ?? metric.changePct ?? 0,
      render: (metric) => <span className={changeClass(metric)}>{changeText(metric)}</span>,
    },
    {
      key: "spark",
      header: "History",
      align: "center",
      width: "90px",
      render: (metric) => <Sparkline data={metric.history} width={70} height={22} />,
    },
    {
      key: "asOf",
      header: "As Of",
      align: "right",
      width: "112px",
      sortVal: (metric) => metric.asOf,
      render: (metric) => (
        <span className="font-mono text-2xs text-term-text-dim" title={metric.realtimeStart ? `Realtime start ${metric.realtimeStart}` : undefined}>
          {metric.asOf}
        </span>
      ),
    },
  ];
}

function MetricTable({ rows, maxHeight = "260px", showSection = false }: { rows: CommandCenterMetric[]; maxHeight?: string; showSection?: boolean }) {
  return (
    <DataGrid
      columns={metricColumns(showSection)}
      rows={rows}
      rowKey={(row) => row.id}
      maxHeight={maxHeight}
      initialSort={{ key: "asOf", dir: "desc" }}
      zebra
    />
  );
}

function marketColumns(): Column<CommandCenterMetric>[] {
  const returnColumn = (horizon: CommandCenterReturnHorizon, header = horizon): Column<CommandCenterMetric> => ({
    key: horizon,
    header,
    align: "right",
    width: "82px",
    sortVal: (metric) => metric.marketReturns?.[horizon]?.value ?? -Infinity,
    render: (metric) => (
      <span className={returnClass(metric, horizon)} title={returnTitle(metric, horizon)}>
        {returnText(metric, horizon)}
      </span>
    ),
  });

  return [
    {
      key: "series",
      header: "Series",
      width: "170px",
      sortVal: (metric) => metric.short,
      render: (metric) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-term-text" title={metric.label}>{metric.short}</div>
          <div className="truncate font-mono text-3xs text-term-text-mute">{metric.id}</div>
        </div>
      ),
    },
    {
      key: "level",
      header: "Level",
      align: "right",
      width: "96px",
      sortVal: (metric) => metric.value,
      render: (metric) => <span className="font-semibold text-term-text">{valueText(metric)}</span>,
    },
    {
      key: "delta",
      header: "Δ Level",
      align: "right",
      width: "88px",
      sortVal: (metric) => metric.change ?? 0,
      render: (metric) => <span className={pnlClass(metric.change ?? 0)}>{levelDeltaText(metric)}</span>,
    },
    returnColumn("1D", "1D %"),
    returnColumn("5D"),
    returnColumn("MTD"),
    returnColumn("1M"),
    returnColumn("3M"),
    returnColumn("QTD"),
    returnColumn("YTD"),
    returnColumn("1Y", "1Y Ann."),
    returnColumn("3Y", "3Y Ann."),
    returnColumn("5Y", "5Y Ann."),
    {
      key: "asOf",
      header: "As Of",
      align: "right",
      width: "112px",
      sortVal: (metric) => metric.asOf,
      render: (metric) => <span className="font-mono text-2xs text-term-text-dim">{metric.asOf}</span>,
    },
  ];
}

function MarketTable({ rows }: { rows: CommandCenterMetric[] }) {
  return (
    <DataGrid
      columns={marketColumns()}
      rows={rows}
      rowKey={(row) => row.id}
      maxHeight="300px"
      initialSort={{ key: "asOf", dir: "desc" }}
      zebra
    />
  );
}

function CatalystList({ catalysts }: { catalysts: CommandCenterCatalyst[] }) {
  if (!catalysts.length) {
    return <div className="px-3 py-5 text-center text-2xs text-term-text-mute">No Gold release calendar rows available.</div>;
  }
  return (
    <div className="divide-y divide-term-border-soft">
      {catalysts.map((event) => (
        <div key={event.id} className="flex items-center justify-between gap-3 px-2.5 py-2 text-2xs">
          <div className="min-w-0">
            <div className="truncate font-semibold text-term-text" title={event.name}>{event.name}</div>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-3xs text-term-text-mute">
              <span className="font-mono">{event.date}</span>
              <span>{event.category}</span>
              {event.representativeSeriesId && <span className="font-mono">{event.representativeSeriesId}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Tag tone={event.importance === "HIGH" ? "amber" : "neutral"}>{event.importance}</Tag>
            <span className="tnum w-14 text-right text-term-text-dim">{event.daysOut === 0 ? "Today" : `${event.daysOut}d`}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusPanel({ source, error, missing, warnings }: { source: string; error?: string; missing: string[]; warnings: string[] }) {
  const hasDetail = source === "ERR" || !!error || missing.length > 0 || warnings.length > 0;
  if (!hasDetail) return null;
  return (
    <Panel title="Data Coverage" code="GOLD" right={<Tag tone={source === "ERR" ? "down" : "amber"}>{source}</Tag>}>
      <div className="space-y-2 p-3 text-2xs">
        {error && <div className="border border-term-down/30 bg-term-down/10 px-2 py-1.5 text-term-down">{error}</div>}
        {warnings.map((warning) => (
          <div key={warning} className="border border-term-amber/30 bg-term-amber/10 px-2 py-1.5 text-term-amber">{warning}</div>
        ))}
        {missing.length > 0 && (
          <div>
            <div className="mb-1 text-3xs font-semibold uppercase tracking-wide text-term-text-mute">Missing Gold Series</div>
            <div className="flex flex-wrap gap-1">
              {missing.map((id) => <Tag key={id} tone="neutral">{id}</Tag>)}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function CommandCenter() {
  const { data, source } = useCommandCenter();
  const topline = data.topline.slice(0, 6);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="HOME"
        title="Command Center"
        desc="Gold-sourced macro, rates, volatility, and market health"
        asOf={data.asOf}
        showStreaming={false}
        right={
          <span className="flex items-center gap-2">
            <Tag tone="blue">FRED/GOLD SQLITE</Tag>
            <ProvenanceBadge source={source} asOf={data.asOf} />
          </span>
        }
      />

      <KpiStrip>
        {topline.length ? topline.map((metric) => (
          <Stat
            key={metric.id}
            label={metric.short}
            value={valueText(metric)}
            sub={<span>As of {metric.asOf} · <span className={changeClass(metric)}>{changeText(metric)}</span></span>}
            tone={metric.tone === "neutral" ? undefined : metric.tone}
          />
        )) : (
          <>
            <Stat label="Gold Status" value={source} sub={data.error ?? "Waiting for /api/command-center"} tone={source === "ERR" ? "down" : "amber"} />
            <Stat label="Source Boundary" value="FRED Gold" sub="No sample, snapshot, or market API fallback" tone="amber" />
            <Stat label="As Of" value={data.asOf ?? "-"} sub="Per-row dates shown below" />
          </>
        )}
      </KpiStrip>

      <div className="p-2 pb-0">
        <Panel
          title="High-Level Indices"
          code="MKT"
          subtitle="1Y+ annualized on 252 trading days"
          right={<LineChart size={14} className="text-term-blue" />}
        >
          <MarketTable rows={data.highLevelMarkets} />
        </Panel>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        <div className="flex min-h-0 flex-col gap-2">
          <Panel title="Domestic Rates" code="RATES" right={<Landmark size={14} className="text-term-amber" />}>
            <MetricTable rows={data.domesticRates} />
          </Panel>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <Panel title="Volatility & Credit Risk" code="VOL" accent right={<ShieldAlert size={14} className="text-term-amber" />}>
            <MetricTable rows={data.volatility} />
          </Panel>

          <Panel title="Domestic Economic Health" code="US" right={<TrendingUp size={14} className="text-term-up" />}>
            <MetricTable rows={data.domesticHealth} />
          </Panel>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <Panel title="Global Economic Health" code="GLBL" right={<Globe2 size={14} className="text-term-blue" />}>
            <MetricTable rows={data.globalHealth} />
          </Panel>

          <Panel title="Upcoming Macro Catalysts" code="CAL" right={<CalendarClock size={14} className="text-term-amber" />}>
            <CatalystList catalysts={data.catalysts} />
          </Panel>

          <StatusPanel source={source} error={data.error} missing={data.missingSeries} warnings={data.warnings} />

          <Panel title="Gold Boundary" code="LINEAGE" right={<Database size={14} className="text-term-up" />}>
            <div className="grid grid-cols-2 gap-px bg-term-border text-2xs">
              <div className="bg-term-panel px-2.5 py-2">
                <div className="term-label">Observations</div>
                <div className="font-mono text-term-text">gold_fred_latest_observation</div>
              </div>
              <div className="bg-term-panel px-2.5 py-2">
                <div className="term-label">Catalysts</div>
                <div className="font-mono text-term-text">gold_release_calendar</div>
              </div>
              <div className="bg-term-panel px-2.5 py-2">
                <div className="term-label">Generated At</div>
                <div className="font-mono text-term-text">{data.generatedAt ? data.generatedAt.slice(0, 19).replace("T", " ") : "-"}</div>
              </div>
              <div className="bg-term-panel px-2.5 py-2">
                <div className="term-label">Fallbacks</div>
                <div className="font-mono text-term-text">disabled</div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
