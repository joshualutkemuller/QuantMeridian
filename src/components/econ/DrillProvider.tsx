
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { LineChart } from "@/components/charts/LineChart";
import { SourceBadge } from "./SourceBadge";
import { ChartLink } from "@/components/charting/ChartLink";
import { Modal } from "@/components/ui/Modal";
import type { DataSource } from "@/lib/useEcon";
import { useSimMode } from "@/lib/simMode";
import { fmtSigned, fmtNum, pnlClass } from "@/lib/format";

export interface DrillTarget {
  id: string;
  label: string;
  units?: string; // FRED units transform (pc1/pch/chg/lin)
  unitLabel?: string; // display suffix, e.g. "% YoY"
  decimals?: number;
  /** When true, fetch raw levels and derive MoM/YoY plus month-over-month deltas. */
  growthMetrics?: boolean;
}

interface DrillCtx {
  open: (t: DrillTarget) => void;
}
const Ctx = createContext<DrillCtx>({ open: () => {} });

/** Hook used by any econ card/row to launch the 24-month drill-down. */
export function useDrill(): DrillCtx {
  return useContext(Ctx);
}

interface Obs {
  date: string;
  value: number;
}

/**
 * Provides the drill-down modal to all econ pages. Clicking an indicator opens a
 * panel showing the rolling 24 months of observations (live from FRED when a key
 * is set, otherwise the simulation) as a chart + a month-over-month table.
 */
export function DrillProvider({ children }: { children: ReactNode }) {
  const { simEnabled, snapshotFallbackEnabled } = useSimMode();
  const [target, setTarget] = useState<DrillTarget | null>(null);
  const [obs, setObs] = useState<Obs[]>([]);
  const [source, setSource] = useState<DataSource>("LOADING");

  const open = useCallback((t: DrillTarget) => {
    setTarget(t);
    setObs([]);
    setSource("LOADING");
  }, []);

  useEffect(() => {
    if (!target) return;
    let alive = true;
    const units = target.growthMetrics ? "lin" : target.units;
    const n = target.growthMetrics ? 37 : 24;
    const u = units ? `&units=${units}` : "";
    fetch(`/api/econ/series?id=${encodeURIComponent(target.id)}&n=${n}${u}${simEnabled ? "&sim=1" : ""}${snapshotFallbackEnabled ? "&snapshot=1" : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setObs(j.observations ?? []);
        setSource(j.source === "FRED" ? "FRED" : j.source === "SNAPSHOT" ? "SNAPSHOT" : j.source === "ETL" ? "ETL" : j.source === "DB" ? "DB" : j.source === "ERR" ? "ERR" : "SIM");
      })
      .catch(() => alive && setSource(simEnabled ? "SIM" : "ERR"));
    return () => {
      alive = false;
    };
  }, [target, simEnabled, snapshotFallbackEnabled]);

  const dp = target?.decimals ?? 2;
  const values = obs.map((o) => o.value);
  const latest = values[values.length - 1];
  const prior = values[values.length - 2];
  const first = values[0];
  const pctChange = (a: number | undefined, b: number | undefined): number | null =>
    a != null && b != null && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null;
  const metricRows = obs.map((o, i) => {
    const mom = pctChange(o.value, obs[i - 1]?.value);
    const yoy = pctChange(o.value, obs[i - 12]?.value);
    const prevMom = i > 0 ? pctChange(obs[i - 1]?.value, obs[i - 2]?.value) : null;
    const prevYoy = i > 0 ? pctChange(obs[i - 1]?.value, obs[i - 13]?.value) : null;
    return { ...o, mom, yoy, momDelta: mom != null && prevMom != null ? mom - prevMom : null, yoyDelta: yoy != null && prevYoy != null ? yoy - prevYoy : null };
  });
  const latestMetrics = metricRows[metricRows.length - 1];
  const visibleRows = target?.growthMetrics ? metricRows.slice(-24) : metricRows;
  const chartValues = visibleRows.map((o) => o.value);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <Modal open={!!target} onClose={() => setTarget(null)} label={target ? `${target.id} — ${target.label}` : "Indicator detail"} className="flex max-h-[86vh] w-[760px] max-w-[94vw] flex-col border border-term-amber/40 bg-term-panel shadow-glow">
        {target && (
          <>
            <header className="flex items-center justify-between border-b border-term-border bg-term-panel-2 px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-sm font-bold text-term-amber">{target.id}</span>
                <span className="text-sm font-semibold text-term-text">{target.label}</span>
                {target.unitLabel && <span className="text-2xs text-term-text-mute">{target.unitLabel}</span>}
              </div>
              <div className="flex items-center gap-2">
                <ChartLink refs={[{ source: "econ", id: target.id }]} range="5Y" transform={target.units === "pc1" ? "yoy" : target.units === "pch" ? "mom" : "none"} />
                <SourceBadge source={source} />
                <button onClick={() => setTarget(null)} className="text-term-text-mute hover:text-term-amber">
                  <X size={16} />
                </button>
              </div>
            </header>

            <div className="grid grid-cols-3 divide-x divide-term-border border-b border-term-border">
              <Cell label="Latest" value={latest != null ? fmtNum(latest, dp) : "—"} sub={obs[obs.length - 1]?.date} />
              {target.growthMetrics ? (
                <>
                  <Cell label="MoM / Δ" value={latestMetrics?.mom != null ? `${fmtSigned(latestMetrics.mom, 2)}%` : "—"} sub={latestMetrics?.momDelta != null ? `${fmtSigned(latestMetrics.momDelta, 2)} pp` : undefined} tone={latestMetrics?.mom ?? 0} />
                  <Cell label="YoY / Δ" value={latestMetrics?.yoy != null ? `${fmtSigned(latestMetrics.yoy, 2)}%` : "—"} sub={latestMetrics?.yoyDelta != null ? `${fmtSigned(latestMetrics.yoyDelta, 2)} pp` : undefined} tone={latestMetrics?.yoy ?? 0} />
                </>
              ) : (
                <>
                  <Cell label="Δ vs Prior" value={latest != null && prior != null ? fmtSigned(latest - prior, dp) : "—"} tone={latest != null && prior != null ? latest - prior : 0} />
                  <Cell label="Δ 24m" value={latest != null && first != null ? fmtSigned(latest - first, dp) : "—"} tone={latest != null && first != null ? latest - first : 0} />
                </>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <div className="border-b border-term-border p-2">
                <div className="mb-1 text-2xs uppercase tracking-wider text-term-text-mute">Rolling 24 months</div>
                {chartValues.length > 1 ? (
                  <LineChart height={170} series={[{ name: target.label, data: chartValues, color: "#FF8C00", area: true }]} labels={visibleRows.map((o) => o.date.slice(2, 7))} yFmt={(n) => fmtNum(n, dp)} />
                ) : (
                  <div className="py-8 text-center text-2xs text-term-text-mute">{source === "LOADING" ? "Loading…" : "No data"}</div>
                )}
              </div>
              <table className="w-full border-collapse tnum">
                <thead className="sticky top-0 bg-term-panel-2">
                  <tr>
                    <th className="border-b border-term-border px-3 py-1 text-left text-2xs uppercase text-term-text-mute">Date</th>
                    <th className="border-b border-term-border px-3 py-1 text-right text-2xs uppercase text-term-text-mute">Value{target.growthMetrics ? " (level)" : target.unitLabel ? ` (${target.unitLabel})` : ""}</th>
                    {target.growthMetrics ? (<>
                      <th className="border-b border-term-border px-3 py-1 text-right text-2xs uppercase text-term-text-mute">MoM %</th>
                      <th className="border-b border-term-border px-3 py-1 text-right text-2xs uppercase text-term-text-mute">ΔMoM</th>
                      <th className="border-b border-term-border px-3 py-1 text-right text-2xs uppercase text-term-text-mute">YoY %</th>
                      <th className="border-b border-term-border px-3 py-1 text-right text-2xs uppercase text-term-text-mute">ΔYoY</th>
                    </>) : (
                    <th className="border-b border-term-border px-3 py-1 text-right text-2xs uppercase text-term-text-mute">Δ m/m</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...visibleRows].reverse().map((o, i, arr) => {
                    const prev = arr[i + 1];
                    const d = prev ? o.value - prev.value : 0;
                    return (
                      <tr key={o.date} className="border-b border-term-border-soft hover:bg-term-panel-2">
                        <td className="px-3 py-1 text-left text-xs text-term-text-dim">{o.date}</td>
                        <td className="px-3 py-1 text-right text-xs text-term-text">{fmtNum(o.value, dp)}</td>
                        {target.growthMetrics ? (
                          <>
                            <MetricCell value={o.mom} suffix="%" />
                            <MetricCell value={o.momDelta} suffix=" pp" />
                            <MetricCell value={o.yoy} suffix="%" />
                            <MetricCell value={o.yoyDelta} suffix=" pp" />
                          </>
                        ) : (
                          <td className={`px-3 py-1 text-right text-xs ${prev ? pnlClass(d) : "text-term-text-mute"}`}>{prev ? fmtSigned(d, dp) : "—"}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <footer className="border-t border-term-border px-3 py-1.5 text-3xs text-term-text-mute">
              {source === "FRED" ? "Live observations from FRED · api.stlouisfed.org" : source === "SNAPSHOT" ? "Committed economic snapshot" : source === "ETL" ? "Committed macro ETL gold snapshot" : "Deterministic simulation — set FRED_API_KEY for live data"} · press ESC to close
            </footer>
          </>
        )}
      </Modal>
    </Ctx.Provider>
  );
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number }) {
  const toneClass = tone == null ? "text-term-text" : tone > 0 ? "text-term-up" : tone < 0 ? "text-term-down" : "text-term-text";
  return (
    <div className="px-3 py-2">
      <div className="text-2xs uppercase tracking-wider text-term-text-mute">{label}</div>
      <div className={`tnum text-base font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="text-3xs text-term-text-mute">{sub}</div>}
    </div>
  );
}


function MetricCell({ value, suffix }: { value: number | null; suffix: string }) {
  return (
    <td className={`px-3 py-1 text-right text-xs ${value == null ? "text-term-text-mute" : pnlClass(value)}`}>
      {value == null ? "—" : `${fmtSigned(value, 2)}${suffix}`}
    </td>
  );
}
