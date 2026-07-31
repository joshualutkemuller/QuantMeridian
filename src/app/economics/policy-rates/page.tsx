
import { useEffect, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ChartLink } from "@/components/charting/ChartLink";
import { BarChart } from "@/components/charts/BarChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { Donut } from "@/components/charts/Radial";
import { useDrill } from "@/components/econ/DrillProvider";
import { SourceBadge } from "@/components/econ/SourceBadge";
import { isRealEconSource, useLiveSeriesSet, type DataSource } from "@/lib/useEcon";
import { worstSource } from "@/lib/provenance";
import { getGlobalPolicyRates, getGlobalSummary, livePolicyRate, type PolicyRate, type Region } from "@/data/globalMacro";
import { fmtNum, fmtSigned, pnlClass } from "@/lib/format";

const REGIONS: ("All" | Region)[] = ["All", "AMER", "EMEA", "APAC"];

const cycleTone = (c: PolicyRate["cycle"]): "up" | "down" | "neutral" =>
  c === "CUTTING" ? "up" : c === "HIKING" ? "down" : "neutral";
const biasTone = (b: PolicyRate["bias"]): "up" | "down" | "neutral" =>
  b === "DOVISH" ? "up" : b === "HAWKISH" ? "down" : "neutral";
// cut (negative bps) eases → green; hike (positive bps) tightens → red
const moveClass = (bps: number) => (bps < 0 ? "text-term-up" : bps > 0 ? "text-term-down" : "text-term-flat");
const cycleHex = (c: PolicyRate["cycle"]) => (c === "CUTTING" ? "#2ECC71" : c === "HIKING" ? "#FF3B3B" : "#9A9AA3");

export default function GlobalPolicyRates() {
  const { open } = useDrill();
  const [region, setRegion] = useState<"All" | Region>("All");
  const [goldData, setGoldData] = useState<Record<string, Partial<PolicyRate>> | null>(null);

  // Fetch Gold policy rate data
  useEffect(() => {
    let alive = true;
    fetch("/api/econ/global-policy-rates")
      .then((r) => r.json())
      .then((data) => {
        if (alive && data.rows) {
          const byIso: Record<string, Partial<PolicyRate>> = {};
          for (const row of data.rows) {
            byIso[row.iso3] = {
              rate: row.policy_rate_pct ?? undefined,
              priorRate: row.change_bps ? row.policy_rate_pct - row.change_bps / 100 : undefined,
              lastMoveBps: row.last_move_bps ?? undefined,
              cycle: (row.stance === "hiking" ? "HIKING" : row.stance === "cutting" ? "CUTTING" : "HOLD") as any,
              realRate: row.real_rate_pct ?? undefined,
              bias: (row.real_rate_pct ? (row.real_rate_pct > 1.5 ? "HAWKISH" : row.real_rate_pct < 0 ? "DOVISH" : "NEUTRAL") : undefined) as any,
              source: "DB" as const,
              asOf: row.observation_date,
            };
          }
          setGoldData(byIso);
        }
      })
      .catch(() => setGoldData({})); // Empty object signals no Gold data
    return () => { alive = false; };
  }, []);

  // Source order: live FRED/OECD snapshots → Gold DB → deterministic SIM.
  const baseAll = getGlobalPolicyRates();
  const baseWithGold = baseAll.map((r) => {
    const gold = goldData?.[r.country] || goldData?.[r.iso3];
    return gold ? { ...r, ...gold } : r;
  });

  const base = getGlobalSummary();
  // Live FRED for central banks with an OECD / ECB rate series.
  const { data: liveMap, source } = useLiveSeriesSet(baseWithGold.map((r) => r.fredId).filter(Boolean) as string[], "lin", 36);
  const all = baseWithGold.map((r) => {
    const L = r.fredId ? liveMap[r.fredId] : undefined;
    return L && isRealEconSource(L.source) && L.observations.length ? { ...livePolicyRate(r, L.observations), source: L.source } : r;
  }).sort((a, b) => b.rate - a.rate);
  const allSources = all.map((r) => r.source).filter((s) => s && s !== "LOADING");
  const pageSource: DataSource = source === "LOADING" && !allSources.length
    ? "LOADING"
    : worstSource(allSources.length ? allSources : ["SIM" as DataSource]) as DataSource;
  const summary = {
    ...base,
    avgPolicyRate: Number((all.reduce((a, r) => a + r.rate, 0) / all.length).toFixed(2)),
    cuttingCount: all.filter((r) => r.cycle === "CUTTING").length,
    hikingCount: all.filter((r) => r.cycle === "HIKING").length,
    holdCount: all.filter((r) => r.cycle === "HOLD").length,
  };
  const rows = region === "All" ? all : all.filter((r) => r.region === region);

  const highest = all.reduce((a, b) => (b.rate > a.rate ? b : a));
  const lowest = all.reduce((a, b) => (b.rate < a.rate ? b : a));
  const total = summary.cuttingCount + summary.hikingCount + summary.holdCount;

  const drill = (r: PolicyRate) =>
    open({
      id: r.fredId ?? r.country,
      label: `${r.country} Policy Rate`,
      units: "lin",
      unitLabel: r.source === "ETL" ? "% · ETL policy snapshot" : r.source === "SIM" ? "simulation" : "%",
      decimals: 2,
    });

  const columns: Column<PolicyRate>[] = [
    {
      key: "country",
      header: "Country",
      sortVal: (r) => r.country,
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <span>{r.flag}</span>
          <span className="font-semibold text-term-text">{r.country}</span>
        </span>
      ),
    },
    {
      key: "centralBank",
      header: "Central Bank",
      sortVal: (r) => r.centralBank,
      render: (r) => <span className="text-term-text-dim">{r.centralBank}</span>,
    },
    {
      key: "rate",
      header: "Policy Rate %",
      align: "right",
      sortVal: (r) => r.rate,
      render: (r) => <span className="font-semibold text-term-amber">{fmtNum(r.rate, 2)}</span>,
    },
    {
      key: "lastMove",
      header: "Last Move",
      align: "right",
      sortVal: (r) => r.lastMoveBps,
      render: (r) => <span className={moveClass(r.lastMoveBps)}>{fmtSigned(r.lastMoveBps, 0)}{" "}bps</span>,
    },
    {
      key: "cycle",
      header: "Cycle",
      align: "center",
      sortVal: (r) => r.cycle,
      render: (r) => <Tag tone={cycleTone(r.cycle)}>{r.cycle}</Tag>,
    },
    {
      key: "streak",
      header: "Streak",
      align: "right",
      sortVal: (r) => r.streak,
      render: (r) => <span className={pnlClass(cycleTone(r.cycle) === "up" ? 1 : cycleTone(r.cycle) === "down" ? -1 : 0)}>{r.streak}m</span>,
    },
    {
      key: "realRate",
      header: "Real Rate %",
      align: "right",
      sortVal: (r) => r.realRate,
      render: (r) => (
        <span className={r.realRate > 0 ? "text-term-amber" : r.realRate < 0 ? "text-term-down" : "text-term-flat"}>
          {fmtSigned(r.realRate, 1)}
        </span>
      ),
    },
    {
      key: "bias",
      header: "Bias",
      align: "center",
      sortVal: (r) => r.bias,
      render: (r) => <Tag tone={biasTone(r.bias)}>{r.bias}</Tag>,
    },
    {
      key: "nextMeeting",
      header: "Next Mtg",
      align: "right",
      sortVal: (r) => r.nextMeeting,
      render: (r) => <span className="text-term-text-mute">{r.nextMeeting}</span>,
    },

    {
      key: "source",
      header: "Src",
      align: "center",
      sortVal: (r) => r.source,
      render: (r) => <Tag tone={r.source === "DB" || r.source === "FRED" ? "up" : r.source === "SNAPSHOT" ? "blue" : r.source === "ETL" ? "amber" : "neutral"}>{r.source}</Tag>,
    },
    {
      key: "history",
      header: "Path",
      align: "right",
      render: (r) => (
        <span className="inline-flex justify-end">
          <Sparkline data={r.history} width={64} height={18} />
        </span>
      ),
    },
  ];

  // cycle breakdown donut
  const cycleSegments = [
    { value: summary.cuttingCount, color: "#2ECC71", label: "Cutting" },
    { value: summary.hikingCount, color: "#FF3B3B", label: "Hiking" },
    { value: summary.holdCount, color: "#9A9AA3", label: "Hold" },
  ];

  // streak surfaces
  const easing = all
    .filter((r) => r.cycle === "CUTTING")
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 6);
  const holds = all
    .filter((r) => r.cycle === "HOLD")
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 6);

  // real rates bar (restrictive positive / accommodative negative)
  const realBars = [...all]
    .sort((a, b) => b.realRate - a.realRate)
    .map((r) => ({ label: r.country, value: r.realRate, color: r.realRate >= 0 ? "#FF8C00" : "#FF3B3B" }));

  // policy rate ranking
  const rankBars = [...all]
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 12)
    .map((r) => ({ label: r.country, value: r.rate, color: "#FF8C00" }));

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="GPOL" title="Global Policy Rates" desc="Central-bank rates, cycles & streaks" right={<span className="flex items-center gap-2"><ChartLink refs={[{ source: "econ", id: "FEDFUNDS" }, { source: "econ", id: "DGS2" }]} range="5Y" /><SourceBadge source={pageSource} /></span>} />

      <KpiStrip>
        <Stat label="Global Avg Policy Rate" value={`${fmtNum(summary.avgPolicyRate, 2)}%`} sub={`${total} central banks`} tone="amber" />
        <Stat label="# Cutting" value={summary.cuttingCount} sub="easing" tone="up" />
        <Stat label="# Hiking" value={summary.hikingCount} sub="tightening" tone="down" />
        <Stat label="# On Hold" value={summary.holdCount} sub="paused" tone="neutral" />
        <Stat label="Highest Rate" value={`${fmtNum(highest.rate, 2)}%`} sub={`${highest.flag} ${highest.country}`} tone="amber" />
        <Stat label="Lowest Rate" value={`${fmtNum(lowest.rate, 2)}%`} sub={`${lowest.flag} ${lowest.country}`} />
      </KpiStrip>

      <div className="flex items-center gap-1.5 border-b border-term-border bg-term-panel px-3 py-1.5">
        <span className="mr-1 text-3xs uppercase tracking-wider text-term-text-mute">Region</span>
        {REGIONS.map((r) => (
          <button key={r} className={`term-btn ${region === r ? "term-btn-active" : ""}`} onClick={() => setRegion(r)}>
            {r}
          </button>
        ))}
        <span className="ml-auto text-3xs text-term-text-mute">{rows.length} banks</span>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        {/* Main table spans 2 cols on xl */}
        <Panel title="Central-Bank Policy Rates" code="RATES" className="xl:col-span-2" accent>
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={(r) => r.country}
            maxHeight="560px"
            onRowClick={drill}
            initialSort={{ key: "rate", dir: "desc" }}
          />
        </Panel>

        {/* Right rail */}
        <div className="flex flex-col gap-2">
          <Panel title="Cycle Breakdown" code="CYCL">
            <div className="flex items-center gap-3 p-3">
              <Donut segments={cycleSegments} size={120} thickness={16} center={String(total)} centerSub="banks" />
              <div className="flex flex-1 flex-col gap-1.5">
                <CycleRow color="#2ECC71" label="Cutting" n={summary.cuttingCount} total={total} />
                <CycleRow color="#FF3B3B" label="Hiking" n={summary.hikingCount} total={total} />
                <CycleRow color="#9A9AA3" label="Hold" n={summary.holdCount} total={total} />
              </div>
            </div>
          </Panel>

          <Panel title="Cycle Streaks" code="STRK">
            <div className="grid grid-cols-2 gap-px bg-term-border">
              <div className="bg-term-panel p-2">
                <div className="mb-1 text-3xs uppercase tracking-wider text-term-up">Longest Easing</div>
                <div className="flex flex-col gap-0.5">
                  {easing.map((r) => (
                    <StreakRow key={r.country} r={r} accent="up" onClick={() => drill(r)} />
                  ))}
                </div>
              </div>
              <div className="bg-term-panel p-2">
                <div className="mb-1 text-3xs uppercase tracking-wider text-term-text-dim">Longest Holds</div>
                <div className="flex flex-col gap-0.5">
                  {holds.length ? (
                    holds.map((r) => <StreakRow key={r.country} r={r} accent="neutral" onClick={() => drill(r)} />)
                  ) : (
                    <span className="text-3xs text-term-text-mute">none on hold</span>
                  )}
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* Real rates */}
        <Panel title="Real Policy Rates — Restrictive vs Accommodative" code="REAL" className="xl:col-span-2">
          <div className="p-2">
            <BarChart data={realBars} horizontal fmt={(n) => `${fmtSigned(n, 1)}`} />
          </div>
        </Panel>

        {/* Ranking */}
        <Panel title="Policy Rate Ranking" code="RANK">
          <div className="p-2">
            <BarChart data={rankBars} horizontal fmt={(n) => `${fmtNum(n, 2)}%`} />
          </div>
        </Panel>
      </div>

      <div className="border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
        Source order: live FRED/OECD snapshots, then committed macro ETL policy snapshots, then deterministic SIM fallback. Cycle &amp; streak = consecutive central-bank meetings in the same action (cut / hike / hold). Real rate = policy rate − CPI YoY;
        positive = restrictive, negative = accommodative. Click any bank to drill into its rolling 24-month rate path.
      </div>
    </div>
  );
}

function CycleRow({ color, label, n, total }: { color: string; label: string; n: number; total: number }) {
  const pct = total ? (n / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-2xs">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      <span className="text-term-text-dim">{label}</span>
      <span className="tnum ml-auto font-semibold text-term-text">{n}</span>
      <span className="tnum w-9 text-right text-term-text-mute">{pct.toFixed(0)}%</span>
    </div>
  );
}

function StreakRow({ r, accent, onClick }: { r: PolicyRate; accent: "up" | "neutral"; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-1.5 py-px text-2xs hover:bg-term-panel-2">
      <span>{r.flag}</span>
      <span className="truncate text-term-text-dim" title={r.country}>{r.country}</span>
      <span className={`tnum ml-auto font-semibold ${accent === "up" ? "text-term-up" : "text-term-text-dim"}`}>{r.streak}m</span>
      <span className="tnum w-12 text-right text-term-amber">{fmtNum(r.rate, 2)}%</span>
    </button>
  );
}
