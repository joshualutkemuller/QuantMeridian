
import { useMemo, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ChartLink } from "@/components/charting/ChartLink";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { Donut, ProgressBar } from "@/components/charts/Radial";
import {
  getRepoRates,
  getRateSensitivities,
  getReinvestmentLadder,
  getMacroLinkages,
  liveRepoRow,
  type RepoRow,
  type RateSensitivity,
  type ReinvestmentTier,
} from "@/data/econModels";
import {
  getSfeFactorLinks,
  getSfePnlBridge,
  getSfeScenarioLibrary,
  type SfeFactorLink,
  type SfePnlBridge,
  type SfeScenario,
} from "@/data/econEnhancements";
import { SourceBadge } from "@/components/econ/SourceBadge";
import { isRealEconSource, useLiveSeriesSet } from "@/lib/useEcon";
import { fmtNum, fmtSigned, fmtBps, fmtUsdAbbr, fmtPct, pnlClass } from "@/lib/format";

const DONUT_COLORS = ["#FF8C00", "#3B9DFF", "#2ECC71", "#A78BFA", "#22D3EE", "#EC4899"];

/** Spread vs SOFR bar color: tight to SOFR is neutral, rich (below) is green carry, firm (above) is amber. */
function spreadColor(bps: number): string {
  if (bps <= -15) return "#2ECC71";
  if (bps >= 15) return "#FF8C00";
  return "#3B9DFF";
}

const CREDIT_TONE_LABEL: Record<ReinvestmentTier["creditTone"], string> = {
  up: "HQ",
  amber: "SPREAD",
  down: "RISK",
};

const LIQUIDITY_TONE: Record<ReinvestmentTier["liquidity"], "up" | "amber" | "blue"> = {
  "T+0": "up",
  "T+1": "blue",
  "T+7": "amber",
};

const MAG_TONE: Record<"HIGH" | "MED" | "LOW", "amber" | "blue" | "neutral"> = {
  HIGH: "amber",
  MED: "blue",
  LOW: "neutral",
};

export default function SecFinanceEconomics() {
  const baseRepo = getRepoRates();
  const sens = getRateSensitivities();
  const ladder = getReinvestmentLadder();
  const links = getMacroLinkages();
  const factorLinks = getSfeFactorLinks();
  const pnlBridge = getSfePnlBridge();
  const scenarioLibrary = getSfeScenarioLibrary();

  // Live FRED for the policy/repo rates that have real series, plus the backdrop.
  const liveIds = [...baseRepo.map((r) => r.fredId).filter(Boolean) as string[], "FEDFUNDS"];
  const { data: liveMap, source } = useLiveSeriesSet(liveIds, "lin", 60);
  const liveSofr = (() => {
    const L = liveMap["SOFR"];
    return L && isRealEconSource(L.source) && L.observations.length ? L.observations[L.observations.length - 1].value : baseRepo.find((r) => r.rate === "SOFR")!.level;
  })();
  const repo = baseRepo.map((r) => {
    const L = r.fredId ? liveMap[r.fredId] : undefined;
    return L && isRealEconSource(L.source) && L.observations.length ? liveRepoRow(r, L.observations, liveSofr) : r;
  });

  // ── Scenario control: number of 25bp Fed cuts (0 → −4) ────────────────
  const [cuts, setCuts] = useState(0);

  // ── KPI derivations ───────────────────────────────────────────────────
  const lvl = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of repo) m[r.rate] = r.level;
    return m;
  }, [repo]);

  const sofr = lvl["SOFR"] ?? 0;
  const effr = lvl["EFFR"] ?? 0;
  const gcSpecialsBps = useMemo(
    () => Number((((lvl["Tri-Party GC Repo"] ?? 0) - (lvl["Specials (avg)"] ?? 0)) * 100).toFixed(0)),
    [lvl]
  );

  const sensByMetric = useMemo(() => {
    const m: Record<string, RateSensitivity> = {};
    for (const s of sens) m[s.metric] = s;
    return m;
  }, [sens]);

  const cashYieldBase = sensByMetric["Cash collateral reinvestment yield"]?.base ?? 0;
  const slSpreadBase = sensByMetric["Securities-lending net spread"]?.base ?? 0;
  const fundingBase = sensByMetric["Funding cost of book"]?.base ?? 0;

  // ── Scenario projections ──────────────────────────────────────────────
  /** Project a metric to the chosen scenario. base + cuts*per25bpCut, clamped at 0. */
  const project = (s: RateSensitivity, n: number) => Math.max(0, s.base + n * s.per25bpCut);

  const scenarioRows = useMemo(
    () =>
      sens.map((s) => {
        const projected = project(s, cuts);
        const delta = projected - s.base;
        // "helps" the book when net spread / GC-specials widen, or funding/HQLA cost falls.
        const helps =
          s.metric === "Securities-lending net spread" || s.metric === "GC vs specials spread"
            ? delta > 0
            : delta < 0;
        return { s, projected, delta, helps };
      }),
    [sens, cuts]
  );

  // Net impact on lending revenue / NIM: SL net spread + GC-specials widening are revenue-positive;
  // cash reinvestment yield + prime NIM compression are revenue-negative.
  const netImpactBps = useMemo(() => {
    const d = (metric: string) => {
      const s = sensByMetric[metric];
      return s ? project(s, cuts) - s.base : 0;
    };
    return (
      d("Securities-lending net spread") +
      0.5 * d("GC vs specials spread") +
      d("Prime financing NIM") +
      0.15 * d("Cash collateral reinvestment yield")
    );
  }, [sensByMetric, cuts]);

  const scenarioBars = useMemo(
    () =>
      scenarioRows.map((r) => ({
        label: r.s.metric.length > 16 ? r.s.metric.slice(0, 16) + "…" : r.s.metric,
        value: Number(r.delta.toFixed(1)),
        color: r.helps ? "#2ECC71" : "#FF3B3B",
      })),
    [scenarioRows]
  );

  // ── Reinvestment ladder analytics ─────────────────────────────────────
  const totalAlloc = useMemo(() => ladder.reduce((a, t) => a + t.allocation, 0) || 1, [ladder]);
  const blendedYield = useMemo(
    () => ladder.reduce((a, t) => a + t.yield * t.allocation, 0) / totalAlloc,
    [ladder, totalAlloc]
  );
  const blendedWam = useMemo(
    () => ladder.reduce((a, t) => a + t.wam * t.allocation, 0) / totalAlloc,
    [ladder, totalAlloc]
  );
  const ladderDonut = useMemo(
    () => ladder.map((t, i) => ({ value: t.allocation, color: DONUT_COLORS[i % DONUT_COLORS.length], label: t.instrument })),
    [ladder]
  );

  // ── Funding backdrop series ───────────────────────────────────────────
  const fedFunds = useMemo(() => {
    const L = liveMap["FEDFUNDS"];
    return L && isRealEconSource(L.source) && L.observations.length ? L.observations.map((o) => o.value) : [];
  }, [liveMap]);
  const sofrHist = useMemo(() => {
    const L = liveMap["SOFR"];
    return L && isRealEconSource(L.source) && L.observations.length ? L.observations.map((o) => o.value) : [];
  }, [liveMap]);

  // ── Column defs ───────────────────────────────────────────────────────
  const repoCols: Column<RepoRow>[] = [
    { key: "rate", header: "Rate", sortVal: (r) => r.rate, render: (r) => <span className="font-semibold text-term-text">{r.rate}</span> },
    { key: "level", header: "Level", align: "right", sortVal: (r) => r.level, render: (r) => <span className="text-term-text">{fmtNum(r.level, 3)}%</span> },
    {
      key: "vsSofr",
      header: "vs SOFR",
      align: "right",
      sortVal: (r) => r.vsSofr,
      render: (r) => <span className={r.vsSofr < 0 ? "text-term-up" : r.vsSofr > 0 ? "text-term-amber" : "text-term-text-dim"}>{fmtSigned(r.vsSofr, 0)}</span>,
    },
    { key: "spark", header: "40d", align: "right", width: "90px", render: (r) => <div className="flex justify-end"><Sparkline data={r.spark} width={72} height={18} /></div> },
  ];

  const sensCols: Column<RateSensitivity>[] = [
    { key: "metric", header: "Metric", sortVal: (r) => r.metric, render: (r) => <span className="text-term-text">{r.metric}</span> },
    { key: "base", header: "Base", align: "right", sortVal: (r) => r.base, render: (r) => <span className="text-term-text">{fmtNum(r.base, 0)} {r.unit}</span> },
    {
      key: "per25",
      header: "Δ / 25bp Cut",
      align: "right",
      sortVal: (r) => r.per25bpCut,
      render: (r) => {
        const helps = r.metric === "Securities-lending net spread" || r.metric === "GC vs specials spread" ? r.per25bpCut > 0 : r.per25bpCut < 0;
        return <span className={helps ? "text-term-up" : "text-term-down"}>{fmtSigned(r.per25bpCut, 0)}</span>;
      },
    },
    {
      key: "shock",
      header: "Δ −100bp Shock",
      align: "right",
      sortVal: (r) => r.shock100,
      render: (r) => {
        const helps = r.metric === "Securities-lending net spread" || r.metric === "GC vs specials spread" ? r.shock100 > 0 : r.shock100 < 0;
        return <span className={helps ? "text-term-up" : "text-term-down"}>{fmtSigned(r.shock100, 0)}</span>;
      },
    },
    { key: "dir", header: "Dir", align: "center", sortVal: (r) => r.direction, render: (r) => <Tag tone={r.direction === "up" ? "up" : "down"}>{r.direction === "up" ? "▲" : "▼"}</Tag> },
  ];

  const ladderCols: Column<ReinvestmentTier>[] = [
    { key: "inst", header: "Instrument", sortVal: (r) => r.instrument, render: (r) => <span className="text-term-text">{r.instrument}</span> },
    { key: "yield", header: "Yield", align: "right", sortVal: (r) => r.yield, render: (r) => <span className="text-term-amber">{fmtNum(r.yield, 2)}%</span> },
    { key: "wam", header: "WAM", align: "right", sortVal: (r) => r.wam, render: (r) => <span className="text-term-text-dim">{fmtNum(r.wam, 0)}d</span> },
    {
      key: "alloc",
      header: "Allocation",
      align: "right",
      width: "130px",
      sortVal: (r) => r.allocation,
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <div className="w-16"><ProgressBar value={r.allocation} max={30} color="#FF8C00" height={5} /></div>
          <span className="tnum w-8 text-right text-2xs text-term-text-dim">{fmtNum(r.allocation, 0)}%</span>
        </div>
      ),
    },
    { key: "liq", header: "Liq.", align: "center", sortVal: (r) => r.liquidity, render: (r) => <Tag tone={LIQUIDITY_TONE[r.liquidity]}>{r.liquidity}</Tag> },
    { key: "credit", header: "Credit", align: "center", sortVal: (r) => r.creditTone, render: (r) => <Tag tone={r.creditTone}>{CREDIT_TONE_LABEL[r.creditTone]}</Tag> },
  ];

  const factorCols: Column<SfeFactorLink>[] = [
    { key: "metric", header: "Metric", render: (r) => <span className="font-semibold text-term-text">{r.metric}</span>, sortVal: (r) => r.metric },
    { key: "factor", header: "Macro Factor", render: (r) => <span className="text-term-amber">{r.factorLabel}</span>, sortVal: (r) => r.factorLabel },
    { key: "source", header: "Source", align: "center", render: (r) => <Tag tone={r.source === "FRED" ? "up" : r.source === "YAHOO" ? "blue" : "neutral"}>{r.source}</Tag>, sortVal: (r) => r.source },
    { key: "sens", header: "Beta", align: "right", render: (r) => <span className="text-term-text">{fmtBps(r.sensitivityBps, 0)}</span>, sortVal: (r) => r.sensitivityBps },
    { key: "conf", header: "Conf.", align: "right", render: (r) => <span className="text-term-text-dim">{fmtPct(r.confidence, 0)}</span>, sortVal: (r) => r.confidence },
    { key: "use", header: "Desk Use", render: (r) => <span className="text-term-text-dim">{r.deskUse}</span>, sortVal: (r) => r.deskUse },
  ];

  const pnlCols: Column<SfePnlBridge>[] = [
    { key: "driver", header: "Driver", render: (r) => <span className="font-semibold text-term-text">{r.driver}</span>, sortVal: (r) => r.driver },
    { key: "desk", header: "Desk", align: "center", render: (r) => <Tag tone="blue">{r.desk}</Tag>, sortVal: (r) => r.desk },
    { key: "factor", header: "Factor ID", render: (r) => <span className="font-mono text-2xs text-term-text-mute">{r.factorId}</span>, sortVal: (r) => r.factorId },
    { key: "base", header: "Base", align: "right", render: (r) => <span className="text-term-text-dim">{fmtBps(r.baseBps, 0)}</span>, sortVal: (r) => r.baseBps },
    { key: "shock", header: "Shock", align: "right", render: (r) => <span className={pnlClass(r.shockBps)}>{fmtSigned(r.shockBps, 0)}</span>, sortVal: (r) => r.shockBps },
    { key: "pnl", header: "P&L", align: "right", render: (r) => <span className={pnlClass(r.pnlImpact)}>{fmtUsdAbbr(r.pnlImpact)}</span>, sortVal: (r) => r.pnlImpact },
  ];

  const scenarioCols: Column<SfeScenario>[] = [
    { key: "scenario", header: "Scenario", render: (r) => <span className="font-semibold text-term-text">{r.scenario}</span>, sortVal: (r) => r.scenario },
    { key: "repo", header: "Repo", align: "right", render: (r) => <span className={pnlClass(-r.repoShockBps)}>{fmtSigned(r.repoShockBps, 0)}</span>, sortVal: (r) => r.repoShockBps },
    { key: "rebate", header: "Rebate", align: "right", render: (r) => <span className={pnlClass(-r.rebateShockBps)}>{fmtSigned(r.rebateShockBps, 0)}</span>, sortVal: (r) => r.rebateShockBps },
    { key: "reinvest", header: "Reinvest", align: "right", render: (r) => <span className={pnlClass(r.reinvestShockBps)}>{fmtSigned(r.reinvestShockBps, 0)}</span>, sortVal: (r) => r.reinvestShockBps },
    { key: "special", header: "Specials", align: "right", render: (r) => <span className={pnlClass(r.specialnessShockBps)}>{fmtSigned(r.specialnessShockBps, 0)}</span>, sortVal: (r) => r.specialnessShockBps },
    { key: "pnl", header: "P&L", align: "right", render: (r) => <span className={pnlClass(r.pnlImpact)}>{fmtUsdAbbr(r.pnlImpact)}</span>, sortVal: (r) => r.pnlImpact },
  ];

  const cutLabel = cuts === 0 ? "No cuts" : `${cuts * 25}bp of cuts`;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="SFE" title="Sec-Finance Economics" desc="How rates flow into repo, funding, collateral & lending" right={<span className="flex items-center gap-2"><ChartLink refs={[{ source: "econ", id: "FEDFUNDS" }, { source: "econ", id: "DGS10" }]} range="5Y" /><SourceBadge source={source} /></span>} />

      <KpiStrip>
        <Stat label="SOFR" value={`${fmtNum(sofr, 2)}%`} sub="secured O/N" tone="amber" />
        <Stat label="Eff. Fed Funds" value={`${fmtNum(effr, 2)}%`} sub={<span className={pnlClass(sofr - effr)}>{fmtSigned((sofr - effr) * 100, 0)}bps vs SOFR</span>} />
        <Stat label="GC–Specials" value={`${fmtNum(gcSpecialsBps, 0)}bps`} sub="specialness / borrow value" tone="up" />
        <Stat label="Cash Reinvest Yld" value={`${fmtNum(cashYieldBase, 0)}bps`} sub="collateral reinvestment" />
        <Stat label="SL Net Spread" value={`${fmtNum(slSpreadBase, 0)}bps`} sub="lending margin" tone="up" />
        <Stat label="Funding Cost" value={`${fmtNum(fundingBase, 0)}bps`} sub="book funding" tone="down" />
      </KpiStrip>

      <div className="flex flex-col gap-2 p-2">
        {/* Repo complex + spread bars */}
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
          <Panel title="Rates Landscape — Repo Complex" code="REPO" className="xl:col-span-2">
            <DataGrid columns={repoCols} rows={repo} rowKey={(r) => r.rate} dense initialSort={{ key: "level", dir: "desc" }} zebra />
            <div className="border-t border-term-border px-2 py-1.5 text-2xs text-term-text-mute">
              Specials trade <span className="text-term-up">below</span> GC — that negative spread is the &ldquo;specialness&rdquo;, i.e. the value of holding hard-to-borrow paper. Wider GC–specials ⇒ richer lending economics.
            </div>
          </Panel>

          <Panel title="Spread vs SOFR" code="SPRD">
            <div className="p-2">
              <BarChart
                horizontal
                data={repo.map((r) => ({ label: r.rate, value: r.vsSofr, color: spreadColor(r.vsSofr) }))}
                fmt={(n) => `${fmtSigned(n, 0)}`}
              />
              <div className="mt-1 flex gap-3 px-1 text-3xs text-term-text-mute">
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 bg-term-up" /> rich/below</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 bg-term-amber" /> firm/above</span>
              </div>
            </div>
          </Panel>
        </div>

        {/* Rate sensitivity — flagship scenario tool */}
        <Panel
          title="Rate Sensitivity — Greeks for the Book"
          code="GRKS"
          accent
          right={<Tag tone={netImpactBps >= 0 ? "up" : "down"}>{fmtSigned(netImpactBps, 1)}bps NIM</Tag>}
        >
          <div className="grid grid-cols-1 gap-2 p-2 xl:grid-cols-2">
            <DataGrid columns={sensCols} rows={sens} rowKey={(r) => r.metric} dense initialSort={{ key: "shock", dir: "asc" }} zebra />

            <div className="flex flex-col gap-2">
              {/* Scenario stepper */}
              <div className="flex flex-col gap-2 border border-term-border bg-term-panel-2 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="term-label">Fed Easing Scenario</span>
                  <span className="tnum text-2xs text-term-amber">{cutLabel}</span>
                </div>
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setCuts(n)}
                      className={`flex-1 px-2 py-1 text-2xs font-semibold tabular-nums transition-colors ${
                        cuts === n ? "bg-term-amber/15 text-term-amber" : "bg-term-panel-3 text-term-text-mute hover:text-term-text-dim"
                      }`}
                    >
                      {n === 0 ? "0" : `−${n * 25}`}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-term-border pt-2">
                  <div>
                    <div className="term-label">Net impact on lending rev / NIM</div>
                    <div className={`tnum text-xl font-semibold leading-none ${netImpactBps >= 0 ? "text-term-up" : "text-term-down"}`}>{fmtSigned(netImpactBps, 1)} bps</div>
                  </div>
                  <div className="max-w-[52%] text-right text-3xs text-term-text-mute">
                    {netImpactBps >= 0
                      ? "Wider lending spreads & GC–specials offset cash-yield drag — net constructive for agency lending."
                      : "Cash-reinvestment & NIM compression outweigh spread pickup — funding desk feels the cut."}
                  </div>
                </div>
              </div>

              {/* Scenario impact bars */}
              <Panel title={`Projected Δ at ${cutLabel}`} code="SCEN">
                <div className="p-2">
                  <BarChart horizontal data={scenarioBars} fmt={(n) => `${fmtSigned(n, 1)}`} />
                  <div className="mt-1 px-1 text-3xs text-term-text-mute">Green = helps the book · Red = hurts. Magnitudes in bps from base.</div>
                </div>
              </Panel>
            </div>
          </div>
        </Panel>

        <Panel title="Macro Factor Links And P&L Bridge" code="BETA" accent>
          <div className="grid grid-cols-1 gap-2 p-2 xl:grid-cols-2">
            <div>
              <div className="term-label mb-1">Metric to macro factor map</div>
              <DataGrid columns={factorCols} rows={factorLinks} rowKey={(r) => r.metric} dense maxHeight="230px" initialSort={{ key: "sens", dir: "desc" }} zebra />
            </div>
            <div>
              <div className="term-label mb-1">Rate and spread P&L bridge</div>
              <DataGrid columns={pnlCols} rows={pnlBridge} rowKey={(r) => r.driver} dense maxHeight="230px" initialSort={{ key: "pnl", dir: "desc" }} zebra />
            </div>
          </div>
        </Panel>

        <Panel title="Shared Scenario Library" code="LIB">
          <div className="grid grid-cols-1 gap-2 p-2 xl:grid-cols-[1.2fr_0.8fr]">
            <DataGrid columns={scenarioCols} rows={scenarioLibrary} rowKey={(r) => r.scenario} dense maxHeight="230px" initialSort={{ key: "pnl", dir: "desc" }} zebra />
            <BarChart horizontal data={scenarioLibrary.map((s) => ({ label: s.scenario, value: s.pnlImpact, color: s.pnlImpact >= 0 ? "#2ECC71" : "#FF3B3B" }))} fmt={(n) => fmtUsdAbbr(n)} />
          </div>
        </Panel>

        {/* Cash-collateral reinvestment */}
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
          <Panel title="Cash-Collateral Reinvestment Ladder" code="REIN" className="xl:col-span-2">
            <DataGrid columns={ladderCols} rows={ladder} rowKey={(r) => r.instrument} dense initialSort={{ key: "alloc", dir: "desc" }} zebra />
            <div className="border-t border-term-border px-2 py-1.5 text-2xs text-term-text-mute">
              The cash desk reinvests cash collateral across this ladder; reaching for yield (CP, time deposits) lifts blended yield but adds credit &amp; term-liquidity risk.
            </div>
          </Panel>

          <Panel title="Allocation & Blend" code="ALLOC">
            <div className="flex flex-col items-center gap-3 p-3">
              <Donut segments={ladderDonut} size={130} thickness={18} center={`${fmtNum(blendedYield, 2)}%`} centerSub="blended yld" />
              <div className="grid w-full grid-cols-2 gap-2">
                <Stat label="Blended Yield" value={`${fmtNum(blendedYield, 2)}%`} sub="alloc-weighted" tone="amber" />
                <Stat label="Blended WAM" value={`${fmtNum(blendedWam, 0)}d`} sub="weighted maturity" />
              </div>
              <div className="flex w-full flex-col gap-0.5">
                {ladder.map((t, i) => (
                  <div key={t.instrument} className="flex items-center gap-1.5 text-3xs">
                    <span className="h-2 w-2 rounded-sm" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="flex-1 truncate text-term-text-dim">{t.instrument}</span>
                    <span className="tnum text-term-text-mute">{fmtNum(t.allocation, 0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* Macro → business linkage */}
        <Panel title="Macro → Business Linkage" code="LINK">
          <div className="grid grid-cols-1 gap-px bg-term-border md:grid-cols-2 xl:grid-cols-3">
            {links.map((l) => (
              <div key={l.driver} className="flex flex-col gap-1 bg-term-panel p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-base font-bold leading-none ${l.effect === "up" ? "text-term-up" : "text-term-down"}`}>{l.effect === "up" ? "▲" : "▼"}</span>
                    <span className="text-2xs font-semibold text-term-text">{l.driver}</span>
                  </div>
                  <Tag tone={MAG_TONE[l.magnitude]}>{l.magnitude}</Tag>
                </div>
                <div className="text-2xs leading-snug text-term-text-dim">{l.impact}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Rate regime → lending P&L */}
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
          <Panel title="Funding Backdrop — Fed Funds vs SOFR" code="REGM" className="xl:col-span-2">
            <div className="p-2">
              <LineChart
                height={180}
                yFmt={(n) => `${n.toFixed(2)}%`}
                series={[
                  { name: "EFFR", data: fedFunds, color: "#3B9DFF" },
                  { name: "SOFR", data: sofrHist, color: "#FF8C00", area: true },
                ]}
              />
              <div className="mt-1 flex gap-4 px-1 text-2xs">
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 bg-term-blue" /> Effective Fed Funds</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 bg-term-amber" /> SOFR (secured)</span>
              </div>
            </div>
          </Panel>

          <Panel title="Rate Regime → Lending P&L" code="TAKE" accent>
            <div className="flex flex-col gap-2 p-2.5 text-2xs leading-snug text-term-text-dim">
              <div className="flex gap-2">
                <span className="mt-px text-term-amber">▪</span>
                <span>
                  A <span className="text-term-down">−100bp</span> shock lowers cash-reinvestment yield ~{Math.abs(sensByMetric["Cash collateral reinvestment yield"]?.shock100 ?? 96)}bps but widens GC–specials{" "}
                  <span className="text-term-up">+{sensByMetric["GC vs specials spread"]?.shock100 ?? 19}bps</span> — net modestly positive for agency lending spread.
                </span>
              </div>
              <div className="flex gap-2">
                <span className="mt-px text-term-amber">▪</span>
                <span>
                  SL net spread is rate-<span className="text-term-up">convex</span>: it gains {fmtBps(sensByMetric["Securities-lending net spread"]?.per25bpCut ?? 3)} per 25bp cut as funding costs fall faster than fee income.
                </span>
              </div>
              <div className="flex gap-2">
                <span className="mt-px text-term-amber">▪</span>
                <span>
                  Funding cost of book tracks SOFR ~1:1 ({fmtBps(sensByMetric["Funding cost of book"]?.shock100 ?? -100)} on −100bp) — the liability side reprices, protecting NIM into easing.
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-term-border pt-2">
                <span className="term-label">Current SOFR vs EFFR basis</span>
                <span className={`tnum text-sm font-semibold ${pnlClass(sofr - effr)}`}>{fmtSigned((sofr - effr) * 100, 0)} bps</span>
              </div>
              <div className="text-3xs text-term-text-mute">
                A persistent positive SOFR–EFFR basis signals firmer secured funding (QT / reserve scarcity), pressuring repo-funded book economics — see QT linkage above.
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
