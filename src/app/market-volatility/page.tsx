import { useMemo, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { fmtAbbr, fmtNum, fmtPct, fmtSigned, fmtSignedPct } from "@/lib/format";
import { useReserveVixExperiment, type ReserveVixOptions } from "@/lib/useMarketVolatility";
import type { ReserveVixExperimentRow } from "@/lib/marketVolatility";

function nullablePct(value: number | null | undefined, dp = 1): string {
  return value == null ? "-" : fmtPct(value, dp);
}

function nullableSignedPct(value: number | null | undefined, dp = 1): string {
  return value == null ? "-" : fmtSignedPct(value, dp);
}

function nullableNum(value: number | null | undefined, dp = 2): string {
  return value == null ? "-" : fmtNum(value, dp);
}

function hitRateSub(n: number, low: number | null, high: number | null): string {
  const interval = low == null || high == null ? "CI -" : `CI ${fmtPct(low, 0)}-${fmtPct(high, 0)}`;
  return `n=${n} | ${interval}`;
}

function Button({
  active,
  children,
  onClick,
  title,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-7 rounded-sm border px-2 text-2xs font-semibold uppercase tracking-wide transition-colors ${
        active
          ? "border-term-amber/60 bg-term-amber/15 text-term-amber"
          : "border-term-border bg-term-panel-3 text-term-text-dim hover:border-term-amber/40 hover:text-term-text"
      }`}
    >
      {children}
    </button>
  );
}

function linePath(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

function sampleRows(rows: ReserveVixExperimentRow[], max = 260): ReserveVixExperimentRow[] {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  return rows.filter((_, index) => index % step === 0 || index === rows.length - 1);
}

function ReserveMeanChart({ rows }: { rows: ReserveVixExperimentRow[] }) {
  if (rows.length < 2) return <EmptyChart label="Reserve history unavailable" />;

  const data = sampleRows(rows);
  const W = 760;
  const H = 260;
  const padL = 54;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const values = data.flatMap((row) => [row.reserveValue, row.trailing12WeekMean]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (index: number) => padL + (index / Math.max(1, data.length - 1)) * (W - padL - padR);
  const y = (value: number) => padT + (1 - (value - min) / range) * (H - padT - padB);
  const reserve = data.map((row, index) => ({ x: x(index), y: y(row.reserveValue) }));
  const mean = data.map((row, index) => ({ x: x(index), y: y(row.trailing12WeekMean) }));
  const ticks = Array.from({ length: 5 }, (_, index) => min + (range * index) / 4);
  const labelEvery = Math.max(1, Math.ceil(data.length / 5));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[260px] w-full min-w-[520px]">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} stroke="#1F1F23" strokeWidth={1} />
          <text x={padL - 7} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="#5E5E66" fontFamily="var(--font-mono)">
            {fmtAbbr(tick, 1)}
          </text>
        </g>
      ))}
      {data.map((row, index) => {
        if (!row.reserveAboveMean) return null;
        const x0 = index === 0 ? padL : (x(index - 1) + x(index)) / 2;
        const x1 = index === data.length - 1 ? W - padR : (x(index) + x(index + 1)) / 2;
        return <rect key={row.observationDate} x={x0} y={padT} width={Math.max(1, x1 - x0)} height={H - padT - padB} fill="#2ECC71" opacity={0.05} />;
      })}
      {data.map((row, index) =>
        index % labelEvery === 0 || index === data.length - 1 ? (
          <text key={row.observationDate} x={x(index)} y={H - 7} textAnchor="middle" fontSize={9} fill="#5E5E66" fontFamily="var(--font-mono)">
            {row.observationDate.slice(0, 4)}
          </text>
        ) : null,
      )}
      <path d={linePath(reserve)} fill="none" stroke="#FF8C00" strokeWidth={1.7} />
      <path d={linePath(mean)} fill="none" stroke="#3B9DFF" strokeWidth={1.4} strokeDasharray="5 3" />
      <g transform={`translate(${padL + 4},${padT + 4})`}>
        <rect x={0} y={0} width={208} height={19} fill="#0A0A0A" opacity={0.72} />
        <line x1={8} x2={28} y1={10} y2={10} stroke="#FF8C00" strokeWidth={2} />
        <text x={34} y={13} fontSize={9} fill="#C9C9D1" fontFamily="var(--font-mono)">WRESBAL</text>
        <line x1={104} x2={124} y1={10} y2={10} stroke="#3B9DFF" strokeWidth={2} strokeDasharray="5 3" />
        <text x={130} y={13} fontSize={9} fill="#C9C9D1" fontFamily="var(--font-mono)">12W MEAN</text>
      </g>
    </svg>
  );
}

function OutcomeChart({ rows }: { rows: ReserveVixExperimentRow[] }) {
  if (!rows.length) return <EmptyChart label="Signal outcomes unavailable" />;

  const data = sampleRows(rows, 220);
  const W = 760;
  const H = 240;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const maxAbs = Math.max(...data.map((row) => Math.abs(row.vixPointChange)), 0.25);
  const zero = padT + (H - padT - padB) / 2;
  const xStep = (W - padL - padR) / data.length;
  const barW = Math.max(1.2, Math.min(8, xStep * 0.72));
  const y = (value: number) => zero - (value / maxAbs) * ((H - padT - padB) / 2);
  const ticks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[240px] w-full min-w-[520px]">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#5E5E66" : "#1F1F23"} strokeWidth={tick === 0 ? 1.2 : 1} />
          <text x={padL - 7} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="#5E5E66" fontFamily="var(--font-mono)">
            {fmtSigned(tick, 1)}
          </text>
        </g>
      ))}
      {data.map((row, index) => {
        const x = padL + index * xStep + (xStep - barW) / 2;
        const top = Math.min(y(row.vixPointChange), zero);
        const height = Math.max(1, Math.abs(y(row.vixPointChange) - zero));
        const fill = row.vixFell ? "#2ECC71" : "#FF3B3B";
        return <rect key={`${row.anchorDate}-${index}`} x={x} y={top} width={barW} height={height} fill={fill} opacity={row.signalEligible ? 0.86 : 0.24} />;
      })}
      <text x={padL} y={H - 6} fontSize={9} fill="#5E5E66" fontFamily="var(--font-mono)">
        VIX point change by anchor
      </text>
    </svg>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center border border-term-border-soft bg-term-panel-2 text-2xs uppercase tracking-wide text-term-text-mute">
      {label}
    </div>
  );
}

export default function MarketVolatilityPage() {
  const [mode, setMode] = useState<ReserveVixOptions["mode"]>("research");
  const [signal, setSignal] = useState<ReserveVixOptions["signal"]>("above_mean");
  const [forwardDays, setForwardDays] = useState<ReserveVixOptions["forwardDays"]>(7);
  const [start, setStart] = useState("2009-01-01");
  const [claimThresholdPct, setClaimThresholdPct] = useState(71);

  const options = useMemo(
    () => ({ mode, signal, forwardDays, start, claimThresholdPct }),
    [claimThresholdPct, forwardDays, mode, signal, start],
  );
  const { data, source } = useReserveVixExperiment(options);
  const signalRows = useMemo(() => data.rows.filter((row) => row.signalEligible), [data.rows]);
  const latestDate = data.inputs.latestVixDate ?? data.inputs.latestReserveDate;
  const lift = data.stats.liftPctPoints;
  const claimDelta = data.stats.claimDeltaPctPoints;

  const eventCols: Column<ReserveVixExperimentRow>[] = [
    { key: "anchor", header: "Anchor", render: (row) => row.anchorDate, sortVal: (row) => row.anchorDate },
    { key: "reserve", header: "Reserve", align: "right", render: (row) => fmtAbbr(row.reserveValue, 1), sortVal: (row) => row.reserveValue },
    { key: "mean", header: "12W Mean", align: "right", render: (row) => fmtAbbr(row.trailing12WeekMean, 1), sortVal: (row) => row.trailing12WeekMean },
    { key: "rpct", header: "Res Chg", align: "right", render: (row) => nullableSignedPct(row.reservePctChange, 2), sortVal: (row) => row.reservePctChange ?? -Infinity },
    {
      key: "vix",
      header: "VIX Chg",
      align: "right",
      render: (row) => <span className={row.vixFell ? "text-term-up" : "text-term-down"}>{fmtSigned(row.vixPointChange, 2)}</span>,
      sortVal: (row) => row.vixPointChange,
    },
    {
      key: "hit",
      header: "Fell",
      align: "center",
      render: (row) => <Tag tone={row.vixFell ? "up" : "down"}>{row.vixFell ? "YES" : "NO"}</Tag>,
      sortVal: (row) => (row.vixFell ? 1 : 0),
    },
    { key: "end", header: "End", render: (row) => row.vixEndDate, sortVal: (row) => row.vixEndDate },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        code="MVOL"
        title="Market Volatility"
        desc="Reserve balances vs VIX claim audit"
        asOf={latestDate}
        showStreaming={false}
        right={
          <>
            <ProvenanceBadge source={source} asOf={latestDate} />
            <Tag tone={mode === "research" ? "blue" : "amber"}>{mode}</Tag>
            <Tag tone={signal === "above_mean" ? "up" : "violet"}>{signal.replace("_", " ")}</Tag>
          </>
        }
      />

      <KpiStrip>
        <Stat
          label="Base VIX Fall"
          value={nullablePct(data.stats.unconditional.hitRatePct, 1)}
          sub={hitRateSub(data.stats.unconditional.n, data.stats.unconditional.ciLowPct, data.stats.unconditional.ciHighPct)}
        />
        <Stat
          label="Signal VIX Fall"
          value={nullablePct(data.stats.conditional.hitRatePct, 1)}
          sub={hitRateSub(data.stats.conditional.n, data.stats.conditional.ciLowPct, data.stats.conditional.ciHighPct)}
          tone={claimDelta != null && claimDelta >= 0 ? "up" : "amber"}
        />
        <Stat label="Lift" value={nullableSignedPct(lift, 1)} sub="pct points vs base" tone={lift != null && lift > 0 ? "up" : lift != null && lift < 0 ? "down" : "neutral"} />
        <Stat label="Mean VIX Chg" value={nullableNum(data.stats.meanVixPointChange, 2)} sub="signal rows" tone={data.stats.meanVixPointChange != null && data.stats.meanVixPointChange < 0 ? "up" : "down"} />
        <Stat label="Reserve/VIX Corr" value={nullableNum(data.stats.reservePctChangeVixPointChangeCorr, 2)} sub="reserve pct vs VIX points" />
        <Stat label="Claim Gap" value={nullableSignedPct(claimDelta, 1)} sub={`${claimThresholdPct}% threshold`} tone={claimDelta != null && claimDelta >= 0 ? "up" : "down"} />
      </KpiStrip>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <Panel
          title="Experiment Controls"
          code="CTRL"
          bodyClassName="p-2"
          resizable={false}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button active={mode === "research"} onClick={() => setMode("research")} title="Anchor on WRESBAL observation dates">Research</Button>
              <Button active={mode === "tradability"} onClick={() => setMode("tradability")} title="Requires approved Gold release timing">Tradability</Button>
            </div>
            <div className="h-5 w-px bg-term-border" />
            <div className="flex items-center gap-1">
              <Button active={signal === "above_mean"} onClick={() => setSignal("above_mean")}>Above Mean</Button>
              <Button active={signal === "cross_above"} onClick={() => setSignal("cross_above")}>Cross Above</Button>
            </div>
            <div className="h-5 w-px bg-term-border" />
            <div className="flex items-center gap-1">
              <Button active={forwardDays === 7} onClick={() => setForwardDays(7)}>+7D</Button>
              <Button active={forwardDays === 14} onClick={() => setForwardDays(14)}>+14D</Button>
            </div>
            <label className="ml-auto flex items-center gap-1 text-2xs uppercase tracking-wide text-term-text-mute">
              Start
              <input
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value || "2009-01-01")}
                className="h-7 rounded-sm border border-term-border bg-term-panel-3 px-2 text-xs text-term-text"
              />
            </label>
            <label className="flex items-center gap-1 text-2xs uppercase tracking-wide text-term-text-mute">
              Claim
              <input
                type="number"
                min={0}
                max={100}
                value={claimThresholdPct}
                onChange={(event) => setClaimThresholdPct(Number(event.target.value) || 0)}
                className="h-7 w-16 rounded-sm border border-term-border bg-term-panel-3 px-2 text-right text-xs text-term-text"
              />
            </label>
          </div>
        </Panel>

        {source === "ERR" && (
          <Panel title="Data State" code="ERR" bodyClassName="p-3" resizable={false}>
            <div className="text-xs text-term-text-dim">{data.error ?? "Market volatility data unavailable."}</div>
          </Panel>
        )}

        <div className="grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-12">
          <Panel title="Reserve Balance Signal" code="WRESBAL" className="xl:col-span-7" scroll>
            <ReserveMeanChart rows={data.rows} />
          </Panel>
          <Panel title="Forward VIX Outcomes" code="VIXCLS" className="xl:col-span-5" scroll>
            <OutcomeChart rows={data.rows} />
          </Panel>
          <Panel title="Signal Rows" code="OBS" className="xl:col-span-8" scroll>
            <DataGrid
              columns={eventCols}
              rows={signalRows.slice(-80).reverse()}
              rowKey={(row) => `${row.anchorDate}-${row.vixEndDate}`}
              maxHeight="360px"
              initialSort={{ key: "anchor", dir: "desc" }}
              zebra
            />
          </Panel>
          <Panel title="Diagnostics" code="DQ" className="xl:col-span-4" bodyClassName="p-3">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Rows" value={fmtNum(data.rows.length, 0)} sub="eligible anchors" className="min-w-0 px-0 py-0" />
              <Stat label="Signals" value={fmtNum(signalRows.length, 0)} sub={signal.replace("_", " ")} className="min-w-0 px-0 py-0" />
              <Stat label="Dropped" value={fmtNum(data.diagnostics.droppedRows, 0)} sub="excluded rows" className="min-w-0 px-0 py-0" />
              <Stat label="Missing End" value={fmtNum(data.diagnostics.missingVixEndpoint, 0)} sub={`+${forwardDays}D VIX`} className="min-w-0 px-0 py-0" />
            </div>
            <div className="mt-3 space-y-2 border-t border-term-border pt-3 text-2xs text-term-text-dim">
              <div className="flex items-center justify-between gap-2">
                <span>Interval</span>
                <Tag tone="blue">{data.diagnostics.confidenceIntervalMethod}</Tag>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>History</span>
                <Tag tone="neutral">REVISED GOLD</Tag>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Inputs</span>
                <span className="tnum text-term-text">{fmtNum(data.inputs.reservesRows, 0)} / {fmtNum(data.inputs.vixRows, 0)}</span>
              </div>
              {data.diagnostics.warnings.map((warning) => (
                <div key={warning} className="border border-term-amber/30 bg-term-amber/10 p-2 text-term-amber">
                  {warning}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Citations" code="SRC" className="xl:col-span-12" bodyClassName="p-3" resizable={false}>
            <div className="grid gap-2 md:grid-cols-2">
              {data.citations.length ? data.citations.map((citation) => (
                <a
                  key={citation.seriesId}
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block min-w-0 border border-term-border bg-term-panel-2 p-2 text-xs text-term-text-dim hover:border-term-amber/50"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Tag tone="blue">{citation.seriesId}</Tag>
                    <span className="truncate font-semibold text-term-text" title={citation.title}>{citation.title}</span>
                  </div>
                  <div className="truncate" title={citation.source}>{citation.source}</div>
                  {citation.note && <div className="mt-1 text-2xs text-term-text-mute">{citation.note}</div>}
                </a>
              )) : (
                <div className="text-2xs text-term-text-mute">Citations unavailable until the DB route returns.</div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
