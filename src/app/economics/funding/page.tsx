
import { useMemo, useState } from "react";
import clsx from "clsx";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { ChartLink } from "@/components/charting/ChartLink";
import { isRealEconSource, useLiveSeriesSet, type DataSource , useMacroInputs } from "@/lib/useEcon";
import { fmtSigned, pnlClass } from "@/lib/format";
import { DataLegend } from "@/components/ui/DataLegend";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import {
  FUNDING_SERIES,
  FUNDING_FRED_IDS,
  buildFallback, buildFallbackWithAnchors,
  fraOisSeries,
  computeSpreads,
  computeGauge,
  computeSummary,
  computeDeskSignals,
  type FundingDef,
  type FundingGroup,
  type DeskSignalTone,
  type SeriesMap,
} from "@/data/funding";

const GROUPS: FundingGroup[] = ["Overnight", "Balances", "Bills", "FX Basis"];

function fmtVal(def: FundingDef, v: number | null): string {
  if (v == null) return "—";
  if (def.unit === "%") return `${v.toFixed(def.decimals)}%`;
  if (def.unit === "bps") return `${v.toFixed(0)}bps`;
  if (def.unit === "$B") return `$${v.toFixed(0)}B`;
  return `$${v.toFixed(2)}T`;
}

/** Change vs prior obs — bps for rates, native delta for balances/basis. */
function chgStr(def: FundingDef, cur: number | null, prev: number | null): { text: string; n: number } {
  if (cur == null || prev == null) return { text: "—", n: 0 };
  if (def.unit === "%") {
    const bps = (cur - prev) * 100;
    return { text: `${bps >= 0 ? "+" : ""}${bps.toFixed(1)}bps`, n: bps };
  }
  const d = cur - prev;
  return { text: fmtSigned(d, def.decimals), n: d };
}

const REGIME_TONE = { Calm: "up", Watch: "amber", Stressed: "down" } as const;
const DESK_TONE: Record<DeskSignalTone, "up" | "amber" | "down"> = { Calm: "up", Watch: "amber", Stress: "down" };

export default function FundingPulse() {
  const { data: macroInputs } = useMacroInputs();
  const fallback = useMemo<SeriesMap>(() => {
    if (!macroInputs) return {};
    const m = buildFallbackWithAnchors(macroInputs.benchmarks, 260);
    m["FRA_OIS"] = fraOisSeries(260);
    return m;
  }, [macroInputs]);

  const { data: live, source } = useLiveSeriesSet(FUNDING_FRED_IDS, "lin", 260);

  const map = useMemo<SeriesMap>(() => {
    const m: SeriesMap = { ...fallback };
    for (const id of FUNDING_FRED_IDS) {
      const L = live[id];
      if (L && isRealEconSource(L.source) && L.observations.length) m[id] = L.observations;
    }
    return m;
  }, [live, fallback]);

  const [groupFilter, setGroupFilter] = useState<string>("ALL");

  const anyReal = FUNDING_FRED_IDS.some((id) => isRealEconSource(live[id]?.source));
  const liveIds = useMemo(() => new Set(FUNDING_FRED_IDS.filter((id) => isRealEconSource(live[id]?.source))), [live]);
  const spreads = useMemo(() => computeSpreads(map), [map]);
  const gauge = useMemo(() => computeGauge(map), [map]);
  const summary = useMemo(() => computeSummary(map, gauge), [map, gauge]);
  const deskSignals = useMemo(() => computeDeskSignals(map, liveIds), [map, liveIds]);

  const seriesSource = (def: FundingDef): DataSource => (def.hasFred && isRealEconSource(live[def.id]?.source) ? live[def.id].source : "SIM");

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="FUND"
        title="Funding & Liquidity Pulse"
        desc="Repo, the corridor, balances & funding stress"
        right={<ProvenanceBadge source={anyReal ? (source === "FRED" ? "FRED" : "SNAPSHOT") : "SIM"} />}
      />

      <KpiStrip>
        <Stat label="SOFR" value={summary.sofr != null ? `${summary.sofr.toFixed(2)}%` : "—"} sub={summary.sofrChg != null ? `${fmtSigned(summary.sofrChg, 1)}bps` : ""} tone="amber" />
        <Stat label="SOFR − EFFR" value={summary.sofrEffrBps != null ? `${fmtSigned(summary.sofrEffrBps, 1)}bps` : "—"} sub="secured vs unsecured" tone={summary.sofrEffrBps != null && summary.sofrEffrBps > 5 ? "down" : "neutral"} />
        <Stat label="RRP Take-up" value={summary.rrp != null ? `$${summary.rrp.toFixed(0)}B` : "—"} sub="liquidity buffer" />
        <Stat label="Reserves" value={summary.reserves != null ? `$${summary.reserves.toFixed(2)}T` : "—"} sub="at the Fed" />
        <Stat label="Funding Stress" value={`${summary.stress}`} sub="0–100 composite" tone={REGIME_TONE[summary.regime]} />
        <Stat label="Regime" value={summary.regime} sub={`${gauge.quarterEndDays}d to q-end`} tone={REGIME_TONE[summary.regime]} />
      </KpiStrip>

      <div className="grid grid-cols-12 gap-2 p-2">
        {/* Stress gauge */}
        <div className="col-span-12 xl:col-span-5">
          <Panel title="Funding-Stress Gauge" code="STRESS" accent right={<Tag tone={REGIME_TONE[summary.regime]}>{summary.regime}</Tag>}>
            <div className="p-3">
              <div className="flex items-end justify-between">
                <span className="tnum text-3xl font-bold text-term-text">{gauge.score}</span>
                <span className="text-2xs text-term-text-mute">/ 100</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-sm bg-term-panel-3">
                <div className={clsx("h-full rounded-sm", gauge.score >= 65 ? "bg-term-down" : gauge.score >= 35 ? "bg-term-amber" : "bg-term-up")} style={{ width: `${gauge.score}%` }} />
              </div>
              <p className="mt-3 text-2xs leading-relaxed text-term-text-dim">{gauge.readThrough}</p>
              <div className="mt-3 flex flex-col gap-1.5">
                {gauge.components.map((c) => (
                  <div key={c.label} className="grid grid-cols-[110px_1fr_56px] items-center gap-2 text-3xs">
                    <span className="text-term-text-mute">{c.label}</span>
                    <div className="h-1.5 overflow-hidden rounded-sm bg-term-panel-3">
                      <div className={clsx("h-full rounded-sm", c.contribution >= 65 ? "bg-term-down" : c.contribution >= 35 ? "bg-term-amber" : "bg-term-up")} style={{ width: `${c.contribution}%` }} />
                    </div>
                    <span className="tnum text-right text-term-text-dim">{c.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* Funding spreads */}
        <div className="col-span-12 xl:col-span-7">
          <Panel title="Funding Spreads" code="SPRD" accent right={<span className="text-3xs text-term-text-mute">wide = stress (mostly)</span>}>
            <div className="divide-y divide-term-border-soft">
              {spreads.map((s) => {
                const wide = s.percentile != null && (s.stressHigh ? s.percentile >= 70 : s.percentile <= 30);
                return (
                  <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-2xs">
                    <span className="w-24 shrink-0 font-semibold text-term-text">{s.label}</span>
                    <span className="hidden min-w-0 flex-1 truncate text-3xs text-term-text-mute lg:inline">{s.desc}</span>
                    <span className="inline-flex w-16 justify-end"><Sparkline data={s.hist.slice(-40)} width={60} height={16} /></span>
                    <span className={clsx("tnum w-16 shrink-0 text-right font-semibold", wide ? "text-term-down" : "text-term-text")}>{s.valueBps != null ? `${fmtSigned(s.valueBps, 1)}` : "—"}</span>
                    <span className="tnum w-10 shrink-0 text-right text-3xs text-term-text-mute" title="percentile in own history">{s.percentile != null ? `${s.percentile}%` : "—"}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        <div className="col-span-12">
          <Panel
            title="Desk Action Map"
            code="ACTION"
            accent
            right={<span className="text-3xs text-term-text-mute">scores derive from funding spreads, balances, bill scarcity and q-end proximity</span>}
          >
            <div className="analytics-scroll">
              <div className="min-w-[980px] divide-y divide-term-border-soft">
                <div className="grid grid-cols-[5.5rem_7rem_4rem_8.5rem_1fr_1.25fr_1.4fr] gap-2 px-3 py-1.5 text-3xs uppercase tracking-wide text-term-text-mute">
                  <span>Desk</span>
                  <span>Signal</span>
                  <span className="text-right">Score</span>
                  <span>Source</span>
                  <span>Driver</span>
                  <span>Derivation</span>
                  <span>Action</span>
                </div>
                {deskSignals.map((s) => (
                  <div key={s.desk} className="grid grid-cols-[5.5rem_7rem_4rem_8.5rem_1fr_1.25fr_1.4fr] items-center gap-2 px-3 py-2 text-2xs">
                    <span className="font-semibold text-term-text">{s.desk}</span>
                    <span className="text-term-text-dim">{s.signal}</span>
                    <span className="tnum text-right font-semibold text-term-text">{s.score}</span>
                    <span>
                      <Tag tone={DESK_TONE[s.tone]}>{s.tone}</Tag>
                      <span className="ml-1 text-3xs text-term-text-mute">{s.source}</span>
                    </span>
                    <span className="truncate text-term-text-dim" title={s.driver}>{s.driver}</span>
                    <span className="truncate text-3xs text-term-text-mute" title={s.derivation}>{s.derivation}</span>
                    <span className="text-term-text">{s.action}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* Series groups */}
        <div className="col-span-12">
          <TermToggleGroup label="Group" value={groupFilter} onChange={setGroupFilter} options={[{ value: "ALL", label: "All" }, ...GROUPS.map((g) => ({ value: g, label: g }))]} size="sm" />
        </div>
        {GROUPS.filter((g) => groupFilter === "ALL" || g === groupFilter).map((g) => {
          const rows = FUNDING_SERIES.filter((s) => s.group === g);
          return (
            <div key={g} className="col-span-12 md:col-span-6">
              <Panel title={g === "FX Basis" ? "Cross-Currency Basis (3M)" : g === "Overnight" ? "Overnight Rates" : g === "Balances" ? "Liquidity Balances" : "T-Bills"} code={g === "Overnight" ? "O/N" : g === "Balances" ? "BAL" : g === "Bills" ? "BILL" : "XCCY"} subtitle={g === "FX Basis" ? "Daily · bps" : g === "Overnight" ? "Daily · %" : g === "Balances" ? "Weekly · $B/$T" : "Daily · %"}>
                <div className="divide-y divide-term-border-soft">
                  {rows.map((def) => {
                    const obs = map[def.id] ?? [];
                    const cur = obs.length ? obs[obs.length - 1].value : null;
                    const prev = obs.length > 1 ? obs[obs.length - 2].value : null;
                    const chg = chgStr(def, cur, prev);
                    return (
                      <div key={def.id} className="flex items-center gap-2 px-3 py-1.5 text-2xs">
                        <span className="w-16 shrink-0 font-semibold text-term-text" title={def.label}>{def.short}</span>
                        <span className="hidden min-w-0 flex-1 truncate text-3xs text-term-text-mute lg:inline">{def.label}</span>
                        <span className="inline-flex w-16 justify-end"><Sparkline data={obs.slice(-40).map((o) => o.value)} width={60} height={16} /></span>
                        <span className="tnum w-16 shrink-0 text-right font-semibold text-term-text">{fmtVal(def, cur)}</span>
                        <span className={clsx("tnum w-14 shrink-0 text-right text-3xs", pnlClass(chg.n))}>{chg.text}</span>
                        {def.hasFred ? <ChartLink refs={[{ source: "econ", id: def.id }]} range="2Y" /> : <span className="w-8 shrink-0 text-center"><ProvenanceBadge source="SIM" /></span>}
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">
                  {rows.some((r) => seriesSource(r) === "FRED") ? "Live FRED where available." : rows.some((r) => seriesSource(r) === "SNAPSHOT") ? "Committed snapshots where available." : "Deterministic — set FRED_API_KEY for live rates."}
                </div>
              </Panel>
            </div>
          );
        })}
      </div>

      <div className="border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
        <span className="text-term-amber">FUND</span> — the funding tape: corridor, repo, balances and the stress gauge swap traders, prime, agency lenders & treasury all watch.
        {" "}Rates/balances/bills live from FRED; cross-currency basis & FRA-OIS are research-grade (SIM) pending a BIS feed.
      </div>

      <div className="px-2 pb-2">
        <DataLegend />
      </div>
    </div>
  );
}
