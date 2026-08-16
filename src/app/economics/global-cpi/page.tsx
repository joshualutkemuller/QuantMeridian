
import { useEffect, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { BarChart } from "@/components/charts/BarChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { useDrill } from "@/components/econ/DrillProvider";
import { SourceBadge } from "@/components/econ/SourceBadge";
import { isRealEconSource, useLiveSeriesSet, type DataSource } from "@/lib/useEcon";
import { worstSource } from "@/lib/provenance";
import { getGlobalCPI, getGlobalSummary, liveCountryCPI, type CountryInflation, type Region, type Trend } from "@/data/globalMacro";
import { fmtNum, fmtSigned, pnlClass } from "@/lib/format";

const REGIONS: Array<"ALL" | Region> = ["ALL", "AMER", "EMEA", "APAC"];
const REGION_TONE: Record<Region, "amber" | "blue" | "violet"> = { AMER: "amber", EMEA: "blue", APAC: "violet" };

/** Flag emoji for countries gold.global_inflation covers but the SIM seed
 *  (CPI_DEFS, 20 countries) does not. Gold now spans 38 countries (World Bank
 *  CPI, annual) — see fred-bronze-to-gold-pipeline docs/handoffs. */
const EXTRA_FLAG_BY_ISO3: Record<string, string> = {
  ARG: "🇦🇷", CHL: "🇨🇱", COL: "🇨🇴", EGY: "🇪🇬", HKG: "🇭🇰", ISR: "🇮🇱",
  MYS: "🇲🇾", NZL: "🇳🇿", NGA: "🇳🇬", NOR: "🇳🇴", PER: "🇵🇪", PHL: "🇵🇭",
  POL: "🇵🇱", RUS: "🇷🇺", SGP: "🇸🇬", SWE: "🇸🇪", THA: "🇹🇭", VNM: "🇻🇳",
};

interface GoldInflationRow {
  iso3: string;
  country: string;
  region: string;
  cpi_yoy_pct: number | null;
  change_pp: number | null;
  trend: string | null;
  streak: number | null;
  target_pct: number | null;
  vs_target_pp: number | null;
  observation_date: string;
}

function goldTrend(trend: string | null): Trend {
  return trend === "RISING" || trend === "FALLING" ? trend : "FLAT";
}

/** Build a full CountryInflation row for a Gold-only country (no CPI_DEFS
 *  entry). Gold's World Bank feed is annual, so MoM/history stay null/empty
 *  rather than fabricated — matches how the existing merge already treats
 *  World Bank rows for CPI_DEFS countries (see footer note on this page). */
function cpiFromGold(row: GoldInflationRow): CountryInflation | null {
  if (row.cpi_yoy_pct == null) return null;
  return {
    country: row.country,
    flag: EXTRA_FLAG_BY_ISO3[row.iso3] ?? "🏳️",
    region: (row.region as Region) ?? "EMEA",
    fredId: "",
    yoy: row.cpi_yoy_pct,
    priorYoy: row.change_pp != null ? row.cpi_yoy_pct - row.change_pp : row.cpi_yoy_pct,
    mom: null,
    momDelta: null,
    yoyDelta: row.change_pp,
    trend: goldTrend(row.trend),
    streak: row.streak ?? 1,
    target: row.target_pct ?? 2,
    vsTarget: row.vs_target_pp ?? row.cpi_yoy_pct - (row.target_pct ?? 2),
    history: [],
    source: "DB",
    asOf: row.observation_date,
  };
}

/** Color a YoY level: hot inflation (high) -> red, cool -> green/dim. */
function yoyClass(yoy: number): string {
  if (yoy >= 5) return "text-term-down";
  if (yoy >= 3) return "text-term-amber";
  if (yoy < 1) return "text-term-up";
  return "text-term-text";
}

/** Background tint scaling red with YoY level for the heat surface. */
function heatBg(yoy: number): string {
  const t = Math.max(0, Math.min(1, yoy / 6));
  const a = (0.08 + t * 0.62).toFixed(3);
  return `rgba(255,59,59,${a})`;
}

export default function GlobalInflation() {
  const { open } = useDrill();
  const [region, setRegion] = useState<"ALL" | Region>("ALL");
  const [goldRows, setGoldRows] = useState<GoldInflationRow[]>([]);
  const [goldRateRows, setGoldRateRows] = useState<{ policy_rate_pct: number | null; stance: string | null }[]>([]);

  // Fetch Gold inflation data — gold.global_inflation (World Bank CPI, annual,
  // 38 countries).
  useEffect(() => {
    let alive = true;
    fetch("/api/econ/global-inflation")
      .then((r) => r.json())
      .then((data) => {
        if (alive && Array.isArray(data.rows)) setGoldRows(data.rows);
      })
      .catch(() => setGoldRows([]));
    return () => { alive = false; };
  }, []);

  // Fetch Gold policy-rate data — drives the "Avg Policy Rate" KPI tile below,
  // which otherwise fell through to the frozen macro_data_etl snapshot (30
  // countries, last refreshed 2026-05-01) even after the rest of this page
  // moved to live Gold/FRED. Gold now covers 38 countries via the BIS
  // WS_CBPOL connector (see fred-bronze-to-gold-pipeline G11 handoff).
  useEffect(() => {
    let alive = true;
    fetch("/api/econ/global-policy-rates")
      .then((r) => r.json())
      .then((data) => {
        if (alive && Array.isArray(data.rows)) setGoldRateRows(data.rows);
      })
      .catch(() => setGoldRateRows([]));
    return () => { alive = false; };
  }, []);

  // Gold rows keyed by country display name — matches Gold's `country` field
  // to CPI_DEFS's `country` field 1:1 for the 20 countries both cover.
  const goldByCountry = new Map(goldRows.map((r) => [r.country, r]));

  // Source order: live FRED raw levels → Gold DB (World Bank CPI) → deterministic SIM.
  const baseAll = getGlobalCPI();
  const baseWithGold = baseAll.map((c) => {
    const gold = goldByCountry.get(c.country);
    if (!gold || gold.cpi_yoy_pct == null) return c;
    return {
      ...c,
      yoy: gold.cpi_yoy_pct,
      priorYoy: gold.change_pp != null ? gold.cpi_yoy_pct - gold.change_pp : c.priorYoy,
      yoyDelta: gold.change_pp ?? c.yoyDelta,
      trend: goldTrend(gold.trend),
      streak: gold.streak ?? c.streak,
      vsTarget: gold.vs_target_pp ?? c.vsTarget,
      target: gold.target_pct ?? c.target,
      source: "DB" as const,
      asOf: gold.observation_date,
    };
  });

  const { data: liveMap, source } = useLiveSeriesSet(baseWithGold.map((c) => c.fredId), "lin", 26);
  const merged = baseWithGold.map((c) => {
    const L = liveMap[c.fredId];
    return L && isRealEconSource(L.source) && L.observations.length
      ? { ...liveCountryCPI(c, L.observations), source: L.source }
      : c;
  });

  // Append Gold-only countries (no CPI_DEFS entry) so the page reflects Gold's
  // full 38-country reach, not just the 20-country SIM seed.
  const seedCountries = new Set(baseAll.map((c) => c.country));
  const extraFromGold = goldRows
    .filter((row) => !seedCountries.has(row.country))
    .map(cpiFromGold)
    .filter((c): c is CountryInflation => c !== null);

  const all = [...merged, ...extraFromGold];
  const allSources = all.map((c) => c.source).filter((s) => s && s !== "LOADING");
  const realSources = allSources.filter((s) => s === "DB" || s === "FRED");
  const isRealMajority = realSources.length > allSources.length / 2;
  const pageSource = source === "LOADING" && !allSources.length
    ? ("LOADING" as const)
    : isRealMajority
    ? worstSource(realSources)
    : ("SIM" as DataSource);
  const base = getGlobalSummary();
  const ys = all.map((c) => c.yoy).sort((a, b) => a - b);

  // Rate-KPI fields prefer live Gold policy-rate coverage (38 countries via
  // the BIS connector) over the ETL-derived fallback baked into `base`.
  const validRates = goldRateRows.filter((r) => r.policy_rate_pct != null);
  const summary = {
    ...base,
    avgCpi: Number((all.reduce((a, c) => a + c.yoy, 0) / all.length).toFixed(1)),
    medianCpi: ys[Math.floor(ys.length / 2)],
    aboveTarget: all.filter((c) => c.vsTarget > 0).length,
    risingCount: all.filter((c) => c.trend === "RISING").length,
    fallingCount: all.filter((c) => c.trend === "FALLING").length,
    ...(validRates.length
      ? {
          avgPolicyRate: Number((validRates.reduce((a, r) => a + (r.policy_rate_pct ?? 0), 0) / validRates.length).toFixed(2)),
          cuttingCount: validRates.filter((r) => r.stance === "cutting").length,
          hikingCount: validRates.filter((r) => r.stance === "hiking").length,
        }
      : {}),
  };
  const rows = region === "ALL" ? all : all.filter((c) => c.region === region);

  const drill = (row: CountryInflation) => {
    const hasRawLevels = isRealEconSource(row.source);
    open({
      id: row.fredId,
      label: `${row.country} CPI`,
      units: "lin",
      unitLabel: hasRawLevels ? "level · derived MoM/YoY" : row.source === "ETL" ? "YoY % · ETL annual" : "simulation",
      decimals: hasRawLevels ? 2 : 1,
      growthMetrics: hasRawLevels,
    });
  };

  const trendTag = (t: CountryInflation["trend"]) =>
    t === "RISING" ? (
      <Tag tone="down">▲ RISING</Tag>
    ) : t === "FALLING" ? (
      <Tag tone="up">▼ FALLING</Tag>
    ) : (
      <Tag tone="neutral">FLAT</Tag>
    );

  const cols: Column<CountryInflation>[] = [
    {
      key: "country",
      header: "Country",
      render: (c) => (
        <span className="flex items-center gap-1.5">
          <span>{c.flag}</span>
          <span className="font-semibold text-term-text">{c.country}</span>
        </span>
      ),
      sortVal: (c) => c.country,
    },
    { key: "region", header: "Reg", render: (c) => <Tag tone={REGION_TONE[c.region]}>{c.region}</Tag>, sortVal: (c) => c.region },
    {
      key: "yoy",
      header: "CPI YoY %",
      align: "right",
      render: (c) => <span className={yoyClass(c.yoy)}>{fmtNum(c.yoy, 1)}</span>,
      sortVal: (c) => c.yoy,
    },
    {
      key: "yoyDelta",
      header: "ΔYoY",
      align: "right",
      render: (c) => <span className={c.yoyDelta == null ? "text-term-text-mute" : pnlClass(c.yoyDelta)}>{c.yoyDelta == null ? "—" : `${fmtSigned(c.yoyDelta, 2)} pp`}</span>,
      sortVal: (c) => c.yoyDelta ?? -999,
    },
    {
      key: "mom",
      header: "MoM %",
      align: "right",
      render: (c) => <span className={c.mom == null ? "text-term-text-mute" : pnlClass(c.mom)}>{c.mom == null ? "—" : fmtSigned(c.mom, 2)}</span>,
      sortVal: (c) => c.mom ?? -999,
    },
    {
      key: "momDelta",
      header: "ΔMoM",
      align: "right",
      render: (c) => <span className={c.momDelta == null ? "text-term-text-mute" : pnlClass(c.momDelta)}>{c.momDelta == null ? "—" : `${fmtSigned(c.momDelta, 2)} pp`}</span>,
      sortVal: (c) => c.momDelta ?? -999,
    },
    {
      key: "vsTarget",
      header: "vs Tgt",
      align: "right",
      render: (c) => <span className={c.vsTarget > 0 ? "text-term-down" : "text-term-up"}>{fmtSigned(c.vsTarget, 1)}</span>,
      sortVal: (c) => c.vsTarget,
    },
    { key: "trend", header: "Trend", align: "center", render: (c) => trendTag(c.trend), sortVal: (c) => c.trend },
    {
      key: "streak",
      header: "Streak",
      align: "right",
      render: (c) => (
        <span className={c.trend === "RISING" ? "text-term-down" : c.trend === "FALLING" ? "text-term-up" : "text-term-text-mute"}>
          {c.trend === "RISING" ? "▲" : c.trend === "FALLING" ? "▼" : "·"} {c.streak}m
        </span>
      ),
      sortVal: (c) => c.streak,
    },
    {
      key: "hist",
      header: "24m Trend",
      align: "right",
      width: "84px",
      render: (c) => <Sparkline data={c.history} width={72} height={20} />,
    },
    {
      key: "source",
      header: "Src",
      align: "center",
      render: (c) => <Tag tone={c.source === "DB" || c.source === "FRED" ? "up" : c.source === "SNAPSHOT" ? "blue" : c.source === "ETL" ? "amber" : "neutral"}>{c.source}</Tag>,
      sortVal: (c) => c.source,
    },
  ];

  const realCovered = all.filter((c) => c.source === "DB" || c.source === "FRED");
  const falling = [...all].filter((c) => c.trend === "FALLING").sort((a, b) => b.streak - a.streak).slice(0, 6);
  const rising = [...all].filter((c) => c.trend === "RISING").sort((a, b) => b.streak - a.streak).slice(0, 6);

  const targetBars = [...all]
    .sort((a, b) => a.vsTarget - b.vsTarget)
    .map((c) => ({ label: `${c.flag} ${c.country}`, value: c.vsTarget, color: c.vsTarget > 0 ? "#FF3B3B" : "#2ECC71" }));

  const heat = [...all].sort((a, b) => b.yoy - a.yoy);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="GCPI"
        title="Global Inflation"
        desc="CPI YoY & MoM by country — trend & streaks"
        right={<div className="flex items-center gap-2"><SourceBadge source={pageSource} /><Tag tone="amber">{realCovered.length}/{all.length}</Tag><span className="text-2xs text-term-text-mute">real/tracked</span></div>}
      />

      <KpiStrip>
        <Stat label="Global Avg CPI" value={`${fmtNum(summary.avgCpi, 1)}%`} sub="YoY, tracked set" tone="amber" />
        <Stat label="Median CPI" value={`${fmtNum(summary.medianCpi, 1)}%`} sub="YoY" />
        <Stat label="Above Target" value={summary.aboveTarget} sub={`of ${all.length} countries`} tone={summary.aboveTarget > 0 ? "down" : "up"} />
        <Stat label="Rising" value={summary.risingCount} sub="re-accelerating" tone="down" />
        <Stat label="Falling" value={summary.fallingCount} sub="disinflating" tone="up" />
        <Stat label="Avg Policy Rate" value={`${fmtNum(summary.avgPolicyRate, 2)}%`} sub={`${summary.cuttingCount} cutting / ${summary.hikingCount} hiking`} />
      </KpiStrip>

      <div className="flex items-center gap-1.5 border-b border-term-border bg-term-panel px-3 py-1.5">
        <span className="mr-1 text-3xs uppercase tracking-wider text-term-text-mute">Region</span>
        {REGIONS.map((r) => (
          <button key={r} className={`term-btn ${region === r ? "term-btn-active" : ""}`} onClick={() => setRegion(r)}>
            {r}
          </button>
        ))}
        <span className="ml-auto tnum text-3xs text-term-text-mute">{rows.length} shown</span>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        {/* Main table spans 2 cols on xl */}
        <Panel title="Global CPI Monitor" code="GCPI" className="xl:col-span-2" accent>
          <DataGrid
            columns={cols}
            rows={rows}
            rowKey={(c) => c.country}
            dense
            maxHeight="420px"
            onRowClick={drill}
            initialSort={{ key: "yoy", dir: "desc" }}
          />
        </Panel>

        {/* Trend / streak focus */}
        <Panel title="Trend & Streak Leaders" code="STRK">
          <div className="grid grid-cols-1 gap-px bg-term-border">
            <StreakBlock title="Longest Disinflation" tone="up" rows={falling} />
            <StreakBlock title="Longest Re-Acceleration" tone="down" rows={rising} />
          </div>
        </Panel>

        {/* Above / below target */}
        <Panel title="CPI vs Target" code="TGT" className="xl:col-span-2">
          <div className="p-2">
            <BarChart data={targetBars} horizontal fmt={(n) => fmtSigned(n, 1)} />
            <div className="mt-1 flex gap-4 px-1 text-3xs text-term-text-mute">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-3 bg-term-up" /> Below target
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-3 bg-term-down" /> Above target
              </span>
            </div>
          </div>
        </Panel>

        {/* Heat map */}
        <Panel title="Global Inflation Heat" code="HEAT">
          <div className="grid grid-cols-2 gap-px bg-term-border p-px">
            {heat.map((c) => (
              <button
                key={c.country}
                onClick={() => drill(c)}
                style={{ background: heatBg(c.yoy) }}
                className="flex items-center justify-between px-2 py-1.5 text-left hover:outline hover:outline-1 hover:outline-term-amber/60"
              >
                <span className="flex items-center gap-1 truncate text-2xs text-term-text">
                  <span>{c.flag}</span>
                  <span className="truncate">{c.country}</span>
                </span>
                <span className="tnum text-2xs font-semibold text-term-text">{fmtNum(c.yoy, 1)}</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
        Source order: live FRED raw levels → Gold DB (fred-bronze-to-gold-pipeline) → deterministic SIM. MoM / ΔMoM are shown only when raw monthly index levels are available; Gold-sourced World Bank rows (annual updates) show YoY / ΔYoY without monthly interpolation. Click any country to drill into raw index-level history where available.
      </div>
    </div>
  );
}

function StreakBlock({ title, tone, rows }: { title: string; tone: "up" | "down"; rows: CountryInflation[] }) {
  return (
    <div className="bg-term-panel">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-2xs uppercase tracking-wider text-term-text-mute">{title}</span>
        <Tag tone={tone}>{rows.length}</Tag>
      </div>
      <div className="divide-y divide-term-border-soft">
        {rows.length === 0 && <div className="px-2 py-2 text-3xs text-term-text-mute">No countries in this trend.</div>}
        {rows.map((c) => (
          <div key={c.country} className="flex items-center justify-between px-2 py-1 text-2xs">
            <span className="flex items-center gap-1.5">
              <span>{c.flag}</span>
              <span className="text-term-text">{c.country}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className={`tnum ${tone === "up" ? "text-term-up" : "text-term-down"}`}>{c.streak}m</span>
              <span className={`tnum w-12 text-right ${yoyClass(c.yoy)}`}>{fmtNum(c.yoy, 1)}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
