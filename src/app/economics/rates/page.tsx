
import { useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ChartLink } from "@/components/charting/ChartLink";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { Donut } from "@/components/charts/Radial";
import {
  CURRENT_TARGET,
  getFomcMeetings,
  getImpliedPath,
  getDotPlot,
  getPolicyPathHistory,
  POLICY_PATH_HORIZONS,
  type FomcMeeting,
} from "@/data/econRates";
import { getPolicyTransmission, type PolicyTransmission } from "@/data/econEnhancements";
import { useFomc } from "@/lib/useEcon";
import { SourceBadge } from "@/components/econ/SourceBadge";
import { fmtNum, fmtSigned, fmtUsdAbbr, pnlClass } from "@/lib/format";

const CUT_COLOR = "#2ECC71";
const HOLD_COLOR = "#5E5E66";
const HIKE_COLOR = "#FF3B3B";

/** Colour a probability segment by its move (cut=green / hold=grey / hike=red). */
function moveColor(move: number, deep = false): string {
  if (move < 0) return deep ? "#19A35A" : CUT_COLOR;
  if (move > 0) return HIKE_COLOR;
  return HOLD_COLOR;
}

function moveLabel(move: number): string {
  if (move === 0) return "Hold";
  return `${move > 0 ? "+" : ""}${move}bp`;
}

function moveTone(text: string): "up" | "down" | "neutral" {
  if (text.includes("Cut")) return "up";
  if (text.includes("Hike")) return "down";
  return "neutral";
}

/** P(outcome) lookup for a given move within a meeting. */
function probOf(m: FomcMeeting, move: number): number {
  return m.outcomes.find((o) => o.move === move)?.prob ?? 0;
}

export default function RateProbabilitiesPage() {
  // FOMC probabilities from Gold DB (see src/lib/server/goldFomc.ts) or fall back to SIM.
  const { data: fomcData } = useFomc();
  const meetings = fomcData?.meetings?.length
    ? (fomcData.meetings as import("@/data/econRates").FomcMeeting[])
    : getFomcMeetings();
  const path = fomcData?.path?.length ? fomcData.path : getImpliedPath();
  const fedSource: "DB" | "SIM" = fomcData?.source === "DB" ? "DB" : "SIM";
  const fedSourceDetail = fomcData?.sourceDetail ?? null;
  const currentTarget = fomcData?.currentTarget ?? CURRENT_TARGET;
  const displayPath = path;
  const dot = getDotPlot();
  const pathHistory = getPolicyPathHistory();
  const transmissions = getPolicyTransmission();
  const [selPaths, setSelPaths] = useState<Set<string>>(new Set([pathHistory[0].asOf, "2026-05-17", "2025-12-17"]));
  const togglePath = (asOf: string) =>
    setSelPaths((s) => {
      const n = new Set(s);
      n.has(asOf) ? n.delete(asOf) : n.add(asOf);
      return n;
    });
  const shownPaths = pathHistory.filter((p) => selPaths.has(p.asOf));

  const first = meetings[0];
  const last = displayPath[displayPath.length - 1];
  const impliedRate12m = last.rate;
  const terminalRate = Math.min(...displayPath.map((p) => p.rate));
  const cutsPriced = Math.round((currentTarget.mid - impliedRate12m) / 0.25);

  const firstCutProb = first.outcomes.filter((o) => o.move < 0).reduce((a, o) => a + o.prob, 0);
  const firstHoldProb = probOf(first, 0);
  const firstHikeProb = first.outcomes.filter((o) => o.move > 0).reduce((a, o) => a + o.prob, 0);

  const targetStr = `${fmtNum(currentTarget.low, 2)}–${fmtNum(currentTarget.high, 2)}%`;

  // Dot-plot rate levels (rows) sorted high→low across all years.
  const rateLevels = [...new Set(dot.dots.map((d) => d.rate))].sort((a, b) => b - a);
  const maxCount = Math.max(...dot.dots.map((d) => d.count), 1);
  const dotAt = (year: string, rate: number) =>
    dot.dots.find((d) => d.year === year && d.rate === rate)?.count ?? 0;

  const gridCols: Column<FomcMeeting>[] = [
    { key: "label", header: "Meeting", render: (m) => <span className="font-semibold text-term-text">{m.label}</span>, sortVal: (m) => m.daysOut },
    { key: "days", header: "Days", align: "right", render: (m) => <span className="text-term-text-mute">{m.daysOut}d</span>, sortVal: (m) => m.daysOut },
    { key: "c50", header: "P(-50)", align: "right", render: (m) => <span className="text-term-up">{(probOf(m, -50) * 100).toFixed(0)}%</span>, sortVal: (m) => probOf(m, -50) },
    { key: "c25", header: "P(-25)", align: "right", render: (m) => <span className="text-term-up">{(probOf(m, -25) * 100).toFixed(0)}%</span>, sortVal: (m) => probOf(m, -25) },
    { key: "hold", header: "P(Hold)", align: "right", render: (m) => <span className="text-term-text-dim">{(probOf(m, 0) * 100).toFixed(0)}%</span>, sortVal: (m) => probOf(m, 0) },
    { key: "h25", header: "P(+25)", align: "right", render: (m) => <span className="text-term-down">{(probOf(m, 25) * 100).toFixed(0)}%</span>, sortVal: (m) => probOf(m, 25) },
    { key: "implied", header: "Implied Rate", align: "right", render: (m) => <span className="text-term-amber">{fmtNum(m.impliedRate, 2)}%</span>, sortVal: (m) => m.impliedRate },
    { key: "ml", header: "Most Likely", align: "right", render: (m) => <Tag tone={moveTone(m.mostLikely)}>{m.mostLikely}</Tag>, sortVal: (m) => m.mostLikely },
  ];

  const transmissionCols: Column<PolicyTransmission>[] = [
    { key: "module", header: "Module", align: "center", render: (r) => <Tag tone="blue">{r.module}</Tag>, sortVal: (r) => r.module },
    { key: "input", header: "Path Input", render: (r) => <span className="text-term-amber">{r.pathInput}</span>, sortVal: (r) => r.pathInput },
    { key: "impact", header: "Current Impact", render: (r) => <span className="text-term-text-dim">{r.currentImpact}</span>, sortVal: (r) => r.currentImpact },
    { key: "s25", header: "-25bp", align: "right", render: (r) => <span className={pnlClass(r.shock25bp)}>{fmtUsdAbbr(r.shock25bp)}</span>, sortVal: (r) => r.shock25bp },
    { key: "s100", header: "-100bp", align: "right", render: (r) => <span className={pnlClass(r.shock100bp)}>{fmtUsdAbbr(r.shock100bp)}</span>, sortVal: (r) => r.shock100bp },
    { key: "action", header: "Action", render: (r) => <span className="text-term-text-dim">{r.action}</span>, sortVal: (r) => r.action },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="FOMC" title="Rate Probabilities" desc="Fed path & hike/cut odds" asOf={fomcData?.asOf} right={<span className="flex items-center gap-2"><ChartLink refs={[{ source: "econ", id: "FEDFUNDS" }, { source: "econ", id: "DGS3MO" }]} range="5Y" /><SourceBadge source={fedSource} /></span>} />

      <KpiStrip>
        <Stat label="Current Target" value={targetStr} sub={`mid ${fmtNum(currentTarget.mid, 3)}%`} tone="amber" />
        <Stat label="Next Meeting" value={first.label} sub={`${first.daysOut} days out`} />
        <Stat label="Most-Likely Next Move" value={<Tag tone={moveTone(first.mostLikely)}>{first.mostLikely}</Tag>} sub={`${(Math.max(firstCutProb, firstHoldProb, firstHikeProb) * 100).toFixed(0)}% priced`} />
        <Stat label="Implied Rate 12M" value={`${fmtNum(impliedRate12m, 2)}%`} sub={`from ${fmtNum(currentTarget.mid, 2)}%`} tone={impliedRate12m < currentTarget.mid ? "up" : "down"} />
        <Stat label="Cuts Priced 12M" value={`${cutsPriced} cuts`} sub="25bp equivalents" tone="up" />
        <Stat label="Terminal Rate" value={`${fmtNum(terminalRate, 2)}%`} sub="path minimum" tone="amber" />
      </KpiStrip>

      <div className="px-3 pt-1.5 text-3xs text-term-text-mute">
        {fedSource === "DB"
          ? "FOMC probabilities from the Gold pipeline (fred-bronze-to-gold-pipeline). Outcomes computed from the Treasury short-rate zero-coupon curve, bootstrapped for incremental forward rates between meeting horizons."
          : "Fallback to deterministic SIM probabilities when Gold DB is unavailable."}
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        {/* Left + middle: FedWatch grid + path */}
        <div className="flex flex-col gap-2 xl:col-span-2">
          <Panel title="FOMC Meeting Probabilities" code="FEDWATCH" accent right={<Tag tone={fedSource === "DB" ? "neutral" : "amber"}>{fedSource === "DB" ? "GOLD · FEDWATCH" : "SIM · FEDWATCH"}</Tag>}>
            <div className="divide-y divide-term-border-soft">
              {meetings.map((m) => {
                const segs = [...m.outcomes].sort((a, b) => a.move - b.move);
                return (
                  <div key={m.date} className="px-2.5 py-2">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-term-text">{m.label}</span>
                        <span className="text-3xs text-term-text-mute">{m.daysOut}d · {m.date}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tnum text-2xs text-term-amber">{fmtNum(m.impliedRate, 2)}%</span>
                        <Tag tone={moveTone(m.mostLikely)}>{m.mostLikely}</Tag>
                      </div>
                    </div>
                    <div className="flex h-5 w-full overflow-hidden rounded-sm bg-term-panel-3">
                      {segs.map((o, i) =>
                        o.prob <= 0 ? null : (
                          <div
                            key={i}
                            className="flex items-center justify-center overflow-hidden border-r border-black/40 last:border-r-0"
                            style={{ width: `${o.prob * 100}%`, background: moveColor(o.move) }}
                            title={`${moveLabel(o.move)} · ${(o.prob * 100).toFixed(1)}%`}
                          >
                            {o.prob >= 0.08 && (
                              <span className="tnum px-1 text-3xs font-semibold text-black/80">
                                {(o.prob * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        )
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-3xs text-term-text-mute">
                      {segs.map((o, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: moveColor(o.move) }} />
                          {moveLabel(o.move)} <span className="tnum text-term-text-dim">{(o.prob * 100).toFixed(1)}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Meeting Probability Grid" code="TABLE">
            <DataGrid columns={gridCols} rows={meetings} rowKey={(m) => m.date} initialSort={{ key: "days", dir: "asc" }} />
          </Panel>

          <Panel
            title="Policy Path Evolution"
            code="PATH"
            right={<span className="tnum text-2xs text-term-text-dim">forward EFFR · {shownPaths.length} dates</span>}
          >
            <div className="p-2">
              {/* As-of date selector — toggle which historical prints to overlay */}
              <div className="mb-1.5 flex flex-wrap gap-1">
                {pathHistory.map((p) => {
                  const on = selPaths.has(p.asOf);
                  return (
                    <button
                      key={p.asOf}
                      onClick={() => togglePath(p.asOf)}
                      className={`flex items-center gap-1 border px-1.5 py-0.5 text-3xs transition-colors ${on ? "border-term-amber text-term-text" : "border-term-border text-term-text-mute hover:text-term-text-dim"}`}
                      title={`Path as priced on ${p.asOf}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? p.color : "#3a3a40" }} />
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <LineChart
                height={180}
                grid
                labels={POLICY_PATH_HORIZONS}
                yFmt={(n) => `${n.toFixed(2)}%`}
                series={shownPaths.map((p) => ({ name: p.label, data: p.path.map((x) => x.rate), color: p.color, area: false }))}
              />
              {/* Legend with the EXACT as-of date each path was generated */}
              <div className="mt-1.5 max-h-[92px] overflow-auto border-t border-term-border-soft">
                <table className="w-full tnum">
                  <thead>
                    <tr className="text-3xs uppercase text-term-text-mute">
                      <th className="px-1 py-0.5 text-left font-semibold">Path (as of)</th>
                      <th className="px-1 py-0.5 text-right font-semibold">Date</th>
                      <th className="px-1 py-0.5 text-right font-semibold">Terminal</th>
                      <th className="px-1 py-0.5 text-right font-semibold">Cuts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownPaths.map((p) => (
                      <tr key={p.asOf} className="border-b border-term-border-soft">
                        <td className="px-1 py-0.5 text-left text-2xs">
                          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: p.color }} />
                          <span className="text-term-text">{p.label}</span>
                        </td>
                        <td className="px-1 py-0.5 text-right text-2xs text-term-text-dim">{p.asOf}</td>
                        <td className="px-1 py-0.5 text-right text-2xs text-term-amber">{fmtNum(p.terminalRate, 2)}%</td>
                        <td className="px-1 py-0.5 text-right text-2xs text-term-up">{fmtSigned(-p.cutsImplied, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-1 px-1 text-3xs text-term-text-mute">
                Each line is the forward fed-funds path priced on its <span className="text-term-amber">as-of date</span> — the drift shows how cuts have been re-priced over time.
              </div>
            </div>
          </Panel>
        </div>

        {/* Right: donut + dot plot */}
        <div className="flex flex-col gap-2">
          <Panel title="Rate Cut Odds — Next Meeting" code={first.label.toUpperCase()}>
            <div className="flex flex-col items-center gap-2 p-3">
              <Donut
                size={140}
                thickness={18}
                center={`${(firstCutProb * 100).toFixed(0)}%`}
                centerSub="P(CUT)"
                segments={[
                  { value: firstCutProb, color: CUT_COLOR, label: "Cut" },
                  { value: firstHoldProb, color: HOLD_COLOR, label: "Hold" },
                  { value: firstHikeProb, color: HIKE_COLOR, label: "Hike" },
                ]}
              />
              <div className="grid w-full grid-cols-3 gap-px bg-term-border text-center">
                <div className="bg-term-panel py-1.5">
                  <div className="tnum text-sm font-semibold text-term-up">{(firstCutProb * 100).toFixed(0)}%</div>
                  <div className="text-3xs text-term-text-mute">CUT</div>
                </div>
                <div className="bg-term-panel py-1.5">
                  <div className="tnum text-sm font-semibold text-term-text-dim">{(firstHoldProb * 100).toFixed(0)}%</div>
                  <div className="text-3xs text-term-text-mute">HOLD</div>
                </div>
                <div className="bg-term-panel py-1.5">
                  <div className="tnum text-sm font-semibold text-term-down">{(firstHikeProb * 100).toFixed(0)}%</div>
                  <div className="text-3xs text-term-text-mute">HIKE</div>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="FOMC Dot Plot" code="SEP" scroll>
            <div className="p-2">
              <div className="mb-1.5 grid grid-cols-[64px_repeat(4,1fr)] gap-px text-center text-3xs text-term-text-mute">
                <span />
                {dot.years.map((y) => (
                  <span key={y} className="truncate" title={y}>{y}</span>
                ))}
              </div>
              <div className="grid grid-cols-[64px_repeat(4,1fr)] gap-px bg-term-border">
                {rateLevels.map((rate) => (
                  <div key={rate} className="contents">
                    <div className="flex items-center justify-end bg-term-panel px-1 py-0.5 tnum text-3xs text-term-text-dim">
                      {fmtNum(rate, 2)}%
                    </div>
                    {dot.years.map((y) => {
                      const count = dotAt(y, rate);
                      const isMedian = dot.median[y] === rate;
                      return (
                        <div
                          key={y}
                          className={`flex min-h-[18px] flex-wrap items-center justify-center gap-px bg-term-panel py-0.5 ${isMedian ? "ring-1 ring-inset ring-term-amber/60" : ""}`}
                          title={count ? `${y}: ${count} dots @ ${fmtNum(rate, 2)}%` : undefined}
                        >
                          {Array.from({ length: count }).map((_, i) => (
                            <span
                              key={i}
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: isMedian ? "#FF8C00" : "#3B9DFF", opacity: 0.55 + 0.45 * (count / maxCount) }}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex items-center justify-between px-1 text-3xs text-term-text-mute">
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "#3B9DFF" }} /> projection</span>
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-term-amber" /> median level</span>
              </div>
            </div>
          </Panel>

          <Panel title="Median Projection by Year" code="MEDIAN">
            <div className="p-2">
              <BarChart
                horizontal
                fmt={(n) => `${n.toFixed(2)}%`}
                data={dot.years.map((y) => ({ label: y, value: dot.median[y], color: "#FF8C00" }))}
              />
            </div>
          </Panel>

          <Panel title="Policy Path Transmission" code="XMIT" accent>
            <DataGrid columns={transmissionCols} rows={transmissions} rowKey={(r) => r.module} maxHeight="280px" initialSort={{ key: "s100", dir: "desc" }} zebra />
          </Panel>
        </div>
      </div>
    </div>
  );
}
