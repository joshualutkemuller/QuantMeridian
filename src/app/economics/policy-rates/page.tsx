
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

/** Flag emoji for countries the BIS-backed Gold table covers but the SIM seed
 *  (RATE_DEFS, 18 countries) does not. Gold now spans 38 central banks via
 *  gold.global_policy_rates (BIS WS_CBPOL) — see fred-bronze-to-gold-pipeline
 *  docs/handoffs/bis_policy_rates_source.md. */
const EXTRA_FLAG_BY_ISO3: Record<string, string> = {
  ARG: "🇦🇷", CHL: "🇨🇱", COL: "🇨🇴", CZE: "🇨🇿", DNK: "🇩🇰", HKG: "🇭🇰",
  HUN: "🇭🇺", ISL: "🇮🇸", ISR: "🇮🇱", KWT: "🇰🇼", MKD: "🇲🇰", MYS: "🇲🇾",
  PER: "🇵🇪", PHL: "🇵🇭", POL: "🇵🇱", ROU: "🇷🇴", RUS: "🇷🇺", SAU: "🇸🇦",
  SRB: "🇷🇸", THA: "🇹🇭",
};

const EXTRA_CENTRAL_BANK_BY_ISO3: Record<string, string> = {
  ARG: "Banco Central de la República Argentina",
  CHL: "Banco Central de Chile",
  COL: "Banco de la República",
  CZE: "Czech National Bank",
  DNK: "Danmarks Nationalbank",
  HKG: "Hong Kong Monetary Authority",
  HUN: "Magyar Nemzeti Bank",
  ISL: "Central Bank of Iceland",
  ISR: "Bank of Israel",
  KWT: "Central Bank of Kuwait",
  MKD: "National Bank of the Republic of North Macedonia",
  MYS: "Bank Negara Malaysia",
  PER: "Banco Central de Reserva del Perú",
  PHL: "Bangko Sentral ng Pilipinas",
  POL: "Narodowy Bank Polski",
  ROU: "National Bank of Romania",
  RUS: "Bank of Russia",
  SAU: "Saudi Central Bank",
  SRB: "National Bank of Serbia",
  THA: "Bank of Thailand",
};

interface GoldPolicyRateRow {
  iso3: string;
  country: string;
  region: string;
  policy_rate_pct: number | null;
  change_bps: number | null;
  last_move_bps: number | null;
  stance: string | null;
  real_rate_pct: number | null;
  observation_date: string;
}

function goldCycle(stance: string | null): PolicyRate["cycle"] {
  return stance === "hiking" ? "HIKING" : stance === "cutting" ? "CUTTING" : "HOLD";
}

function goldBias(realRate: number | null): PolicyRate["bias"] {
  if (realRate == null) return "NEUTRAL";
  return realRate > 1.5 ? "HAWKISH" : realRate < 0 ? "DOVISH" : "NEUTRAL";
}

/** Build a full PolicyRate row for a Gold-only country (no RATE_DEFS entry).
 *  Fields Gold doesn't carry (meeting calendar, cycle-streak length, rate
 *  history) get honest minimal defaults rather than fabricated values. */
function policyRateFromGold(row: GoldPolicyRateRow): PolicyRate | null {
  if (row.policy_rate_pct == null) return null;
  const cycle = goldCycle(row.stance);
  return {
    country: row.country,
    flag: EXTRA_FLAG_BY_ISO3[row.iso3] ?? "🏳️",
    region: (row.region as Region) ?? "EMEA",
    centralBank: EXTRA_CENTRAL_BANK_BY_ISO3[row.iso3] ?? `${row.country} central bank`,
    rate: row.policy_rate_pct,
    priorRate: row.change_bps != null ? row.policy_rate_pct - row.change_bps / 100 : row.policy_rate_pct,
    lastMoveBps: row.change_bps ?? row.last_move_bps ?? 0,
    lastMeeting: "—",
    cycle,
    streak: 1,
    nextMeeting: "—",
    realRate: row.real_rate_pct ?? 0,
    bias: goldBias(row.real_rate_pct),
    history: [],
    fredId: undefined,
    source: "DB",
    asOf: row.observation_date,
  };
}

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
  const [goldRows, setGoldRows] = useState<GoldPolicyRateRow[]>([]);

  // Fetch Gold policy rate data — gold.global_policy_rates, populated via the
  // BIS WS_CBPOL connector (fred-bronze-to-gold-pipeline). Covers 38 central
  // banks vs. RATE_DEFS' 18-country SIM seed below.
  useEffect(() => {
    let alive = true;
    fetch("/api/econ/global-policy-rates")
      .then((r) => r.json())
      .then((data) => {
        if (alive && Array.isArray(data.rows)) setGoldRows(data.rows);
      })
      .catch(() => setGoldRows([]));
    return () => { alive = false; };
  }, []);

  // Gold rows keyed by country display name — matches Gold's `country` field
  // to RATE_DEFS's `country` field 1:1 for the 18 countries both cover.
  const goldByCountry = new Map(goldRows.map((r) => [r.country, r]));

  // Source order: live FRED/OECD snapshots → Gold DB (BIS) → deterministic SIM.
  const baseAll = getGlobalPolicyRates();
  const baseWithGold = baseAll.map((r) => {
    const gold = goldByCountry.get(r.country);
    if (!gold || gold.policy_rate_pct == null) return r;
    return {
      ...r,
      rate: gold.policy_rate_pct,
      priorRate: gold.change_bps != null ? gold.policy_rate_pct - gold.change_bps / 100 : r.priorRate,
      lastMoveBps: gold.change_bps ?? gold.last_move_bps ?? r.lastMoveBps,
      cycle: goldCycle(gold.stance),
      realRate: gold.real_rate_pct ?? r.realRate,
      bias: gold.real_rate_pct != null ? goldBias(gold.real_rate_pct) : r.bias,
      source: "DB" as const,
      asOf: gold.observation_date,
    };
  });

  const base = getGlobalSummary();
  // Live FRED for central banks with an OECD / ECB rate series.
  const { data: liveMap, source } = useLiveSeriesSet(baseWithGold.map((r) => r.fredId).filter(Boolean) as string[], "lin", 36);
  const merged = baseWithGold.map((r) => {
    const L = r.fredId ? liveMap[r.fredId] : undefined;
    return L && isRealEconSource(L.source) && L.observations.length ? { ...livePolicyRate(r, L.observations), source: L.source } : r;
  });

  // Append Gold-only countries (no RATE_DEFS entry) so the page reflects the
  // BIS connector's full 38-country reach, not just the 18-country SIM seed.
  const seedCountries = new Set(baseAll.map((r) => r.country));
  const extraFromGold = goldRows
    .filter((row) => !seedCountries.has(row.country))
    .map(policyRateFromGold)
    .filter((r): r is PolicyRate => r !== null);

  const all = [...merged, ...extraFromGold].sort((a, b) => b.rate - a.rate);
  const allSources = all.map((r) => r.source).filter((s) => s && s !== "LOADING");
  const realSources = allSources.filter((s) => s === "DB" || s === "FRED");
  const isRealMajority = realSources.length > allSources.length / 2;
  const pageSource: DataSource = source === "LOADING" && !allSources.length
    ? "LOADING"
    : isRealMajority
    ? (worstSource(realSources) as DataSource)
    : ("SIM" as DataSource);
  const realCovered = all.filter((r) => r.source === "DB" || r.source === "FRED");
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
      <PageHeader code="GPOL" title="Global Policy Rates" desc="Central-bank rates, cycles & streaks" right={<span className="flex items-center gap-2"><ChartLink refs={[{ source: "econ", id: "FEDFUNDS" }, { source: "econ", id: "DGS2" }]} range="5Y" /><SourceBadge source={pageSource} /><Tag tone="amber">{realCovered.length}/{all.length}</Tag><span className="text-2xs text-term-text-mute">real/tracked</span></span>} />

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
