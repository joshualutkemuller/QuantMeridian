
import { useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ChartLink } from "@/components/charting/ChartLink";
import { CorrelationMatrix, HeatGrid } from "@/components/charts/Matrix";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { SourceBadge } from "@/components/econ/SourceBadge";
import { TermToggle } from "@/components/ui/TermToggle";
import { TermSelect } from "@/components/ui/TermSelect";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { getStatStudyPacks, type StatStudyPack } from "@/data/econEnhancements";
import { STAT_LABELS, STAT_DEFAULT_LABELS } from "@/data/statsConfig";
import { useStatsData } from "@/lib/useStats";
import { buildStatsPayload, ols, histogram, moments, rollingCorr, acf, alignPair, type Obs } from "@/lib/stats";
import { isRealEconSource } from "@/lib/useEcon";
import { fmtNum, fmtPct, pnlClass } from "@/lib/format";

type Transform = "level" | "chg" | "yoy";

function transformObs(points: { date: string; value: number }[], mode: Transform): Obs[] {
  if (mode === "level") return points;
  if (mode === "chg") return points.slice(1).map((p, i) => ({ date: p.date, value: p.value - points[i].value }));
  return points.slice(12).map((p, i) => ({ date: p.date, value: p.value - points[i].value })); // 12m diff
}

const RANGES: [string, number][] = [["5Y", 60], ["10Y", 120], ["20Y", 240], ["Max", 320]];
const TRANSFORMS: [string, Transform][] = [["Levels", "level"], ["Δ 1m", "chg"], ["Δ 12m", "yoy"]];
const LAGS = [1, 2, 3, 4];
const WINDOWS = [6, 12, 24, 36];

const Btn = TermToggle;
const Sel = ({ value, onChange, labels }: { value: string; onChange: (s: string) => void; labels: string[] }) => (
  <TermSelect value={value} onChange={onChange} options={labels} />
);

export default function StatisticalAnalysis() {
  const { series, source, loading, lookbackMonths, setLookbackMonths, startDate, endDate } = useStatsData();
  const [transform, setTransform] = useState<Transform>("level");
  const [lag, setLag] = useState(2);
  const [win, setWin] = useState(12);
  // Default to a representative ~10-series subset so the correlation matrix stays
  // readable; everything else in STAT_SERIES starts excluded but is togglable.
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(STAT_LABELS.filter((l) => !STAT_DEFAULT_LABELS.includes(l)))
  );
  const [xL, setXL] = useState("2s10s");
  const [yL, setYL] = useState("HY OAS");
  const [distL, setDistL] = useState("10Y");
  const [rAL, setRAL] = useState("10Y");
  const [rBL, setRBL] = useState("EFFR");
  const [acfL, setAcfL] = useState("CPI");
  const studyPacks = getStatStudyPacks();
  const [activeStudyId, setActiveStudyId] = useState(studyPacks[0]?.id ?? "");

  // transform + filter → active analysis set
  const tSeries = series.map((s) => ({ label: s.label, obs: transformObs(s.points, transform) }));
  const active = tSeries.filter((s) => !excluded.has(s.label));
  const labels = active.map((s) => s.label);
  const p = buildStatsPayload(active, isRealEconSource(source) ? source : "SIM", lag);

  const byLabel = (l: string) => active.find((s) => s.label === l) ?? active[0] ?? { label: "", obs: [] };
  const rx = (l: string) => (labels.includes(l) ? l : labels[0] ?? "");

  // off-diagonal correlations
  const pairs: { a: string; b: string; r: number }[] = [];
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) pairs.push({ a: labels[i], b: labels[j], r: p.corr[i][j] });
  const byCorr = [...pairs].sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const sPos = [...pairs].sort((x, y) => y.r - x.r)[0];
  const sNeg = [...pairs].sort((x, y) => x.r - y.r)[0];
  const stationaryCount = p.stationarity.filter((s) => s.stationary).length;

  // regression / distribution / rolling / acf (client-side, pairwise complete)
  const al = alignPair(byLabel(rx(xL)).obs, byLabel(rx(yL)).obs);
  const reg = ols(al.x, al.y);
  const scatter = al.x.map((x, i) => ({ x, y: al.y[i] }));
  const dv = byLabel(rx(distL)).obs.map((o) => o.value);
  const hist = histogram(dv, 13);
  const mo = moments(dv);
  const latestZ = dv.length ? (dv[dv.length - 1] - mo.mean) / (mo.sd || 1) : 0;
  const al2 = alignPair(byLabel(rx(rAL)).obs, byLabel(rx(rBL)).obs);
  const roll = rollingCorr(al2.x, al2.y, win);
  const ac = acf(byLabel(rx(acfL)).obs.map((o) => o.value), 12);
  const activeStudy = studyPacks.find((s) => s.id === activeStudyId) ?? studyPacks[0];

  function applyStudy(pack: StatStudyPack) {
    const allLabels = tSeries.map((s) => s.label);
    setActiveStudyId(pack.id);
    setTransform(pack.transform);
    setLag(pack.lag);
    setWin(pack.rollingWindow);
    setXL(allLabels.includes(pack.driver) ? pack.driver : allLabels[0] ?? "");
    setYL(allLabels.includes(pack.target) ? pack.target : allLabels[1] ?? allLabels[0] ?? "");
    setRAL(allLabels.includes(pack.driver) ? pack.driver : allLabels[0] ?? "");
    setRBL(allLabels.includes(pack.target) ? pack.target : allLabels[1] ?? allLabels[0] ?? "");
    setDistL(pack.series.find((l) => allLabels.includes(l)) ?? allLabels[0] ?? "");
    setAcfL(pack.series.find((l) => allLabels.includes(l)) ?? allLabels[0] ?? "");
    setExcluded(new Set(allLabels.filter((l) => !pack.series.includes(l))));
  }

  const statCols: Column<(typeof p.descstats)[number]>[] = [
    { key: "label", header: "Series", render: (r) => <span className="text-term-text">{r.label}</span> },
    { key: "n", header: "n", align: "right", render: (r) => <span className="text-term-text-mute">{r.n}</span>, sortVal: (r) => r.n },
    { key: "mean", header: "Mean", align: "right", render: (r) => <span className="text-term-text-dim">{fmtNum(r.mean, 2)}</span>, sortVal: (r) => r.mean },
    { key: "sd", header: "SD", align: "right", render: (r) => <span className="text-term-text-dim">{fmtNum(r.sd, 2)}</span>, sortVal: (r) => r.sd },
    { key: "skew", header: "Skew", align: "right", render: (r) => <span className={pnlClass(r.skew)}>{fmtNum(r.skew, 2)}</span>, sortVal: (r) => r.skew },
    { key: "kurt", header: "Kurt", align: "right", render: (r) => <span className="text-term-text">{fmtNum(r.kurtosis, 2)}</span>, sortVal: (r) => r.kurtosis },
    { key: "acf1", header: "AR(1)", align: "right", render: (r) => <span className="text-term-amber">{fmtNum(r.acf1, 2)}</span>, sortVal: (r) => r.acf1 },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="STAT" title="Statistical Analysis" desc="Correlation · Granger · regression · stationarity · distributions" right={<span className="flex items-center gap-2"><ChartLink refs={[{ source: "econ", id: "DGS10" }, { source: "econ", id: "CPIAUCSL" }]} range="5Y" /><SourceBadge source={source} /></span>} />

      {/* SETTINGS BAR */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-term-border bg-term-panel-2 px-3 py-1.5 text-2xs">
        <div className="flex items-center gap-1"><span className="term-label">Range</span>{RANGES.map(([l, m]) => <Btn key={l} on={lookbackMonths === m} onClick={() => setLookbackMonths(m)}>{l}</Btn>)}</div>
        <div className="flex items-center gap-1"><span className="term-label">Transform</span>{TRANSFORMS.map(([l, t]) => <Btn key={t} on={transform === t} onClick={() => setTransform(t)}>{l}</Btn>)}</div>
        <div className="flex items-center gap-1"><span className="term-label">Granger lag</span>{LAGS.map((l) => <Btn key={l} on={lag === l} onClick={() => setLag(l)}>{l}</Btn>)}</div>
        <div className="flex items-center gap-1"><span className="term-label">Roll win</span>{WINDOWS.map((w) => <Btn key={w} on={win === w} onClick={() => setWin(w)}>{w}m</Btn>)}</div>
        <div className="flex items-center gap-1">
          <span className="term-label">Series</span>
          {tSeries.map((s) => <Btn key={s.label} on={!excluded.has(s.label)} onClick={() => setExcluded((e) => { const n = new Set(e); n.has(s.label) ? n.delete(s.label) : n.add(s.label); return n; })}>{s.label}</Btn>)}
        </div>
        <div className="ml-auto flex items-center gap-2 text-3xs text-term-text-mute">
          <span>{startDate.slice(0, 7)} → {endDate.slice(0, 7)}</span>
          <span className="text-term-text-dim">{p.minN}–{p.maxN} obs</span>
          {loading ? <span className="text-term-amber">● loading…</span> : <span className="text-term-up">● cached</span>}
        </div>
      </div>

      <KpiStrip>
        <Stat label="Series × Obs" value={`${labels.length}×${p.maxN}`} sub={`${(lookbackMonths / 12).toFixed(0)}y window`} tone="amber" />
        <Stat label="Strongest +Corr" value={sPos ? fmtNum(sPos.r, 2) : "—"} sub={sPos ? `${sPos.a}/${sPos.b}` : ""} tone="up" />
        <Stat label="Strongest −Corr" value={sNeg ? fmtNum(sNeg.r, 2) : "—"} sub={sNeg ? `${sNeg.a}/${sNeg.b}` : ""} tone="down" />
        <Stat label="Granger Links" value={p.links.length} sub={`F-test · lag ${lag}`} />
        <Stat label="Stationary" value={`${stationaryCount}/${labels.length}`} sub="ADF 5%" />
        <Stat label="Regression R²" value={fmtNum(reg.r2, 2)} sub={`${rx(xL)}→${rx(yL)}`} tone="amber" />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Panel title="Desk Study Packs" code="PACK" accent right={<Tag tone="amber">{activeStudy?.name ?? "Study"}</Tag>}>
            <div className="grid grid-cols-1 gap-px bg-term-border">
              {studyPacks.map((pack) => (
                <button
                  key={pack.id}
                  onClick={() => applyStudy(pack)}
                  className={`bg-term-panel px-2 py-1.5 text-left transition-colors hover:bg-term-panel-2 ${activeStudyId === pack.id ? "outline outline-1 outline-term-amber" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-2xs font-semibold text-term-text">{pack.name}</span>
                    <Tag tone={pack.confidence >= 80 ? "up" : pack.confidence >= 70 ? "amber" : "neutral"}>{fmtPct(pack.confidence, 0)}</Tag>
                  </div>
                  <div className="mt-0.5 text-3xs text-term-text-mute">{pack.question}</div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-3xs">
                    <span className="text-term-blue">{pack.driver}</span>
                    <span className="text-term-text-mute">to</span>
                    <span className="text-term-amber">{pack.target}</span>
                    <span className="ml-auto text-term-text-dim">{pack.deskUse}</span>
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Correlation Matrix" code="CORR">
            <div className="p-2">
              <CorrelationMatrix labels={labels} values={p.corr} height={240} />
              <div className="mt-1 text-3xs text-term-text-mute">Pearson on {transform === "level" ? "levels" : transform === "chg" ? "monthly changes" : "12m changes"}. Top: {byCorr.slice(0, 3).map((c) => `${c.a}/${c.b} ${fmtNum(c.r, 2)}`).join(" · ")}</div>
            </div>
          </Panel>
          <Panel title="Granger Causality — F(row → col)" code="GRNG" accent>
            <div className="p-2">
              <HeatGrid rows={labels} cols={labels} values={p.grangerF} fmt={(v) => (v ? v.toFixed(1) : "·")} height={210} />
              <div className="mt-1 text-3xs text-term-text-mute">F-test, lag {lag}, differenced. Higher F ⇒ row better predicts column.</div>
            </div>
          </Panel>
          <Panel title="Significant Causal Links" code="CAUSE">
            <div className="max-h-[160px] divide-y divide-term-border-soft overflow-auto">
              {p.links.length === 0 && <div className="px-2 py-3 text-center text-2xs text-term-text-mute">None significant at 5%</div>}
              {p.links.map((l, i) => (
                <div key={i} className="flex items-center justify-between px-2 py-1 text-2xs">
                  <span><span className="text-term-blue">{l.from}</span> <span className="text-term-text-mute">→</span> <span className="text-term-amber">{l.to}</span></span>
                  <span className="tnum text-term-text-dim">F {fmtNum(l.fStat, 1)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-2">
          <Panel title="OLS Regression" code="REG" right={<div className="flex items-center gap-1 text-3xs text-term-text-mute"><span>Y</span><Sel value={rx(yL)} onChange={setYL} labels={labels} /><span>~X</span><Sel value={rx(xL)} onChange={setXL} labels={labels} /></div>}>
            <div className="p-2">
              <ScatterPlot points={scatter} fit={{ slope: reg.slope, intercept: reg.intercept }} xLabel={rx(xL)} yLabel={rx(yL)} height={205} />
              <div className="mt-1 grid grid-cols-4 divide-x divide-term-border border-t border-term-border">
                <Stat label="β" value={fmtNum(reg.slope, 3)} className="px-2 py-1" />
                <Stat label="R²" value={fmtNum(reg.r2, 3)} className="px-2 py-1" tone="amber" />
                <Stat label="t-stat" value={fmtNum(reg.tStat, 2)} sub={Math.abs(reg.tStat) > 2 ? "sig" : "ns"} className="px-2 py-1" tone={Math.abs(reg.tStat) > 2 ? "up" : "neutral"} />
                <Stat label="n" value={reg.n} className="px-2 py-1" />
              </div>
            </div>
          </Panel>
          <Panel title="Distribution" code="DIST" right={<Sel value={rx(distL)} onChange={setDistL} labels={labels} />}>
            <div className="p-2">
              <BarChart data={hist.map((b) => ({ label: b.center.toFixed(1), value: b.count, color: "#3B9DFF" }))} height={145} />
              <div className="mt-1 grid grid-cols-4 divide-x divide-term-border border-t border-term-border">
                <Stat label="Mean" value={fmtNum(mo.mean, 2)} className="px-2 py-1" />
                <Stat label="SD" value={fmtNum(mo.sd, 2)} className="px-2 py-1" />
                <Stat label="Skew/Kurt" value={`${fmtNum(mo.skew, 1)}/${fmtNum(mo.kurtosis, 1)}`} className="px-2 py-1" />
                <Stat label="Latest Z" value={fmtNum(latestZ, 2)} className="px-2 py-1" tone={Math.abs(latestZ) > 2 ? "down" : "neutral"} />
              </div>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-2">
          <Panel title={`Rolling Correlation (${win}m)`} code="ROLL" right={<div className="flex items-center gap-1"><Sel value={rx(rAL)} onChange={setRAL} labels={labels} /><span className="text-3xs text-term-text-mute">×</span><Sel value={rx(rBL)} onChange={setRBL} labels={labels} /></div>}>
            <div className="p-2">
              <LineChart height={135} series={[{ name: "rho", data: roll, color: "#A78BFA", area: true }]} yFmt={(v) => v.toFixed(2)} />
              <div className="mt-1 text-3xs text-term-text-mute">{win}-month rolling Pearson — surfaces regime shifts in co-movement.</div>
            </div>
          </Panel>
          <Panel title="Autocorrelation (ACF)" code="ACF" right={<Sel value={rx(acfL)} onChange={setAcfL} labels={labels} />}>
            <div className="p-2">
              <BarChart data={ac.map((v, i) => ({ label: `${i + 1}`, value: v, color: Math.abs(v) > 0.3 ? "#FF8C00" : "#3B9DFF" }))} height={120} />
              <div className="mt-1 text-3xs text-term-text-mute">ACF by lag (months); slow decay ⇒ persistent / non-stationary.</div>
            </div>
          </Panel>
          <Panel title="Stationarity (ADF)" code="ADF">
            <div className="max-h-[130px] divide-y divide-term-border-soft overflow-auto">
              {p.stationarity.map((s) => (
                <div key={s.label} className="flex items-center justify-between px-2 py-1 text-2xs">
                  <span className="text-term-text">{s.label}</span>
                  <span className="flex items-center gap-2"><span className="tnum text-term-text-dim">{fmtNum(s.stat, 2)}</span><Tag tone={s.stationary ? "up" : "amber"}>{s.stationary ? "STATIONARY" : "UNIT ROOT"}</Tag></span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Descriptive Statistics" code="DESC">
            <DataGrid columns={statCols} rows={p.descstats} rowKey={(r) => r.label} initialSort={{ key: "sd", dir: "desc" }} maxHeight="170px" />
          </Panel>
        </div>
      </div>
    </div>
  );
}
