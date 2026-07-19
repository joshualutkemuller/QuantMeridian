
import { useRef, useState, useImperativeHandle, forwardRef } from "react";
import clsx from "clsx";
import type { RecessionBand } from "@/lib/charting/recessions";
import type { CanvasSeries, OHLC, OscPane } from "@/lib/charting/canvasTypes";
import { FIB_LEVELS, type Drawing, type DrawMode } from "@/lib/charting/drawings";

export type { CanvasSeries } from "@/lib/charting/canvasTypes";

export interface ChartCanvasHandle {
  getSvgElement: () => SVGSVGElement | null;
}

interface ChartCanvasProps {
  axis: string[]; // ISO dates
  series: CanvasSeries[]; // main-pane line/area series
  candles?: OHLC[]; // if set, primary instrument drawn as candlesticks
  overlays?: CanvasSeries[]; // price-scale overlays (MAs, Bollinger)
  oscPanes?: OscPane[]; // oscillator sub-panes (RSI, MACD)
  height?: number; // main plot-area height
  yFmt?: (n: number) => string;
  recessions?: RecessionBand[];
  drawings?: Drawing[];
  drawMode?: DrawMode;
  onDrawingAdd?: (d: Drawing) => void;
  className?: string;
}

const W = 800, padL = 56, padR = 12;
const UP = "#2ECC71", DOWN = "#FF3B3B";

function pathWithGaps(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

function extent(arrs: (number | null)[][]): [number, number] {
  const flat = arrs.flat().filter((v): v is number => v != null && Number.isFinite(v));
  if (!flat.length) return [0, 1];
  const lo = Math.min(...flat), hi = Math.max(...flat);
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}

export const ChartCanvas = forwardRef<ChartCanvasHandle, ChartCanvasProps>(function ChartCanvas({ axis, series, candles, overlays = [], oscPanes = [], height = 300, yFmt, recessions, drawings = [], drawMode = "none", onDrawingAdd, className }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drawStart, setDrawStart] = useState<{ idx: number; val: number } | null>(null);

  useImperativeHandle(ref, () => ({ getSvgElement: () => svgRef.current }));

  const n = axis.length;
  const mainTop = 10;
  const mainBot = mainTop + height;

  // stack oscillator panes below the main pane
  let cursor = mainBot;
  const oscLayout = oscPanes.map((p) => {
    const h = p.height ?? 80;
    const top = cursor + 6 + 14; // gap + label row
    const bot = top + h;
    cursor = bot;
    return { top, bot };
  });
  const totalH = cursor + 18; // x-axis labels

  const candleVals: (number | null)[][] = candles ? [candles.map((c) => c.h), candles.map((c) => c.l)] : [];
  const [min, max] = extent([...series.map((s) => s.values), ...overlays.map((s) => s.values), ...candleVals]);
  const range = max - min || 1;
  const hasData = n > 0 && (series.some((s) => s.values.some((v) => v != null)) || (candles?.some((c) => c.c != null) ?? false));

  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const yMain = (v: number) => mainTop + (1 - (v - min) / range) * (mainBot - mainTop);
  const yIn = (v: number, top: number, bot: number, dmin: number, dmax: number) => top + (1 - (v - dmin) / (dmax - dmin || 1)) * (bot - top);

  const fmt = yFmt ?? ((v: number) => v.toFixed(2));
  const gridVals = Array.from({ length: 5 }, (_, i) => min + (range * i) / 4);

  // recession bands
  const tAxis = axis.map((d) => Date.parse(`${d}T00:00:00Z`));
  const dateToX = (iso: string): number => {
    const t = Date.parse(`${iso}T00:00:00Z`);
    if (!tAxis.length) return padL;
    if (t <= tAxis[0]) return x(0);
    if (t >= tAxis[n - 1]) return x(n - 1);
    for (let i = 1; i < n; i++) if (t <= tAxis[i]) return x(i - 1 + (t - tAxis[i - 1]) / (tAxis[i] - tAxis[i - 1] || 1));
    return x(n - 1);
  };
  const recBands = hasData && recessions ? recessions.filter((r) => Date.parse(`${r.end}T00:00:00Z`) >= tAxis[0] && Date.parse(`${r.start}T00:00:00Z`) <= tAxis[n - 1]) : [];

  const cw = Math.min(9, Math.max(1, ((W - padL - padR) / Math.max(1, n)) * 0.6));
  const xLabelEvery = Math.max(1, Math.ceil(n / 7));

  const posFromEvent = (e: React.MouseEvent): { idx: number; val: number } | null => {
    const el = wrapRef.current;
    if (!el || n < 2) return null;
    const rect = el.getBoundingClientRect();
    const plotFrac = ((e.clientX - rect.left) / rect.width * W - padL) / (W - padL - padR);
    const idx = Math.round(Math.min(1, Math.max(0, plotFrac)) * (n - 1));
    const yFrac = ((e.clientY - rect.top) / rect.height * totalH - mainTop) / (mainBot - mainTop);
    const val = max - yFrac * range;
    return { idx, val };
  };

  const onMove = (e: React.MouseEvent) => {
    const pos = posFromEvent(e);
    if (pos) setHover(pos.idx);
  };

  const onClick = (e: React.MouseEvent) => {
    if (drawMode === "none" || !onDrawingAdd || !hasData) return;
    const pos = posFromEvent(e);
    if (!pos) return;
    if (drawMode === "hline") {
      onDrawingAdd({ type: "hline", id: Math.random().toString(36).slice(2, 8), value: pos.val, color: "#F5C518" });
      return;
    }
    if (!drawStart) {
      setDrawStart(pos);
      return;
    }
    if (drawMode === "trendline") {
      onDrawingAdd({ type: "trendline", id: Math.random().toString(36).slice(2, 8), x1: drawStart.idx, y1: drawStart.val, x2: pos.idx, y2: pos.val, color: "#3B9DFF" });
    } else if (drawMode === "fib") {
      onDrawingAdd({ type: "fib", id: Math.random().toString(36).slice(2, 8), high: Math.max(drawStart.val, pos.val), low: Math.min(drawStart.val, pos.val), x1: drawStart.idx, x2: pos.idx, color: "#A78BFA" });
    }
    setDrawStart(null);
  };

  return (
    <div ref={wrapRef} className={clsx("relative", drawMode !== "none" && "cursor-crosshair", className)} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${totalH}`} preserveAspectRatio="none" style={{ width: "100%", height: totalH }}>
        {/* recession shading across all panes */}
        {recBands.map((r, i) => {
          const x0 = dateToX(r.start), x1 = dateToX(r.end);
          return <rect key={`rec-${i}`} x={x0} y={mainTop} width={Math.max(1, x1 - x0)} height={cursor - mainTop} fill="#3B9DFF" opacity={0.1} />;
        })}

        {/* main grid + y labels */}
        {gridVals.map((v, i) => (
          <g key={`g${i}`}>
            <line x1={padL} x2={W - padR} y1={yMain(v)} y2={yMain(v)} stroke="#1F1F23" strokeWidth={1} />
            <text x={padL - 6} y={yMain(v) + 3} textAnchor="end" fontSize={9} fill="#5E5E66" fontFamily="var(--font-mono)">{fmt(v)}</text>
          </g>
        ))}

        {/* candles */}
        {hasData && candles && candles.map((c, i) => {
          if (c.o == null || c.h == null || c.l == null || c.c == null) return null;
          const up = c.c >= c.o;
          const col = up ? UP : DOWN;
          const bodyTop = yMain(Math.max(c.o, c.c)), bodyBot = yMain(Math.min(c.o, c.c));
          return (
            <g key={`c${i}`}>
              <line x1={x(i)} x2={x(i)} y1={yMain(c.h)} y2={yMain(c.l)} stroke={col} strokeWidth={0.8} />
              <rect x={x(i) - cw / 2} y={bodyTop} width={cw} height={Math.max(0.6, bodyBot - bodyTop)} fill={col} />
            </g>
          );
        })}

        {/* main line/area series */}
        {hasData && series.map((s, si) => {
          const d = pathWithGaps(s.values, x, yMain);
          return (
            <g key={`s${si}`}>
              {s.area && d && <path d={`${d} L${x(n - 1).toFixed(1)},${yMain(min).toFixed(1)} L${x(0).toFixed(1)},${yMain(min).toFixed(1)} Z`} fill={s.color} fillOpacity={0.12} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.ghost ? 1 : 1.4} strokeLinejoin="round" strokeDasharray={s.ghost ? "2 4" : s.dashed ? "4 3" : undefined} opacity={s.ghost ? 0.28 : 1} />
              {n === 1 && s.values[0] != null && Number.isFinite(s.values[0]) && (
                <circle cx={x(0)} cy={yMain(s.values[0])} r={2.8} fill={s.color} opacity={s.ghost ? 0.28 : 1} />
              )}
            </g>
          );
        })}

        {/* price-scale overlays (MAs, Bollinger) */}
        {hasData && overlays.map((s, si) => (
          <path key={`o${si}`} d={pathWithGaps(s.values, x, yMain)} fill="none" stroke={s.color} strokeWidth={1.1} strokeDasharray={s.dashed ? "3 2" : undefined} strokeLinejoin="round" opacity={0.9} />
        ))}

        {/* oscillator sub-panes */}
        {hasData && oscPanes.map((p, pi) => {
          const { top, bot } = oscLayout[pi];
          const [dmin, dmax] = p.domain ?? extent([...p.lines.map((l) => l.values), ...(p.bars ? [p.bars.values] : [])]);
          const yo = (v: number) => yIn(v, top, bot, dmin, dmax);
          return (
            <g key={`p${p.id}`}>
              <text x={padL} y={top - 4} fontSize={9} fill="#8A8A92" fontFamily="var(--font-mono)">{p.label}</text>
              <line x1={padL} x2={W - padR} y1={top} y2={top} stroke="#1F1F23" />
              <line x1={padL} x2={W - padR} y1={bot} y2={bot} stroke="#1F1F23" />
              <text x={padL - 6} y={top + 3} textAnchor="end" fontSize={8} fill="#5E5E66" fontFamily="var(--font-mono)">{(p.fmt ?? ((v) => v.toFixed(1)))(dmax)}</text>
              <text x={padL - 6} y={bot} textAnchor="end" fontSize={8} fill="#5E5E66" fontFamily="var(--font-mono)">{(p.fmt ?? ((v) => v.toFixed(1)))(dmin)}</text>
              {p.refLines?.map((r, ri) => (
                <line key={`r${ri}`} x1={padL} x2={W - padR} y1={yo(r.v)} y2={yo(r.v)} stroke="#3A3A40" strokeDasharray="2 3" />
              ))}
              {p.bars && p.bars.values.map((v, i) => {
                if (v == null) return null;
                const y0 = yo(0), y1 = yo(v);
                return <rect key={`b${i}`} x={x(i) - cw / 2} y={Math.min(y0, y1)} width={cw} height={Math.max(0.6, Math.abs(y1 - y0))} fill={v >= 0 ? p.bars!.pos : p.bars!.neg} opacity={0.55} />;
              })}
              {p.lines.map((l, li) => (
                <path key={`l${li}`} d={pathWithGaps(l.values, x, yo)} fill="none" stroke={l.color} strokeWidth={1.1} strokeLinejoin="round" />
              ))}
            </g>
          );
        })}

        {/* drawings */}
        {hasData && drawings.map((d) => {
          if (d.type === "hline") {
            const cy = yMain(d.value);
            return (
              <g key={d.id}>
                <line x1={padL} x2={W - padR} y1={cy} y2={cy} stroke={d.color} strokeWidth={1} strokeDasharray="6 3" />
                <text x={W - padR + 2} y={cy + 3} fontSize={8} fill={d.color} fontFamily="var(--font-mono)">{d.label ?? fmt(d.value)}</text>
              </g>
            );
          }
          if (d.type === "trendline") {
            return <line key={d.id} x1={x(d.x1)} y1={yMain(d.y1)} x2={x(d.x2)} y2={yMain(d.y2)} stroke={d.color} strokeWidth={1.2} />;
          }
          if (d.type === "fib") {
            return (
              <g key={d.id}>
                {FIB_LEVELS.map((lvl) => {
                  const val = d.low + (d.high - d.low) * (1 - lvl);
                  const cy = yMain(val);
                  return (
                    <g key={lvl}>
                      <line x1={padL} x2={W - padR} y1={cy} y2={cy} stroke={d.color} strokeWidth={0.8} strokeDasharray="4 3" opacity={0.7} />
                      <text x={W - padR + 2} y={cy + 3} fontSize={7} fill={d.color} fontFamily="var(--font-mono)" opacity={0.8}>{(lvl * 100).toFixed(1)}%</text>
                    </g>
                  );
                })}
                <rect x={Math.min(x(d.x1), x(d.x2))} y={yMain(d.high)} width={Math.abs(x(d.x2) - x(d.x1))} height={yMain(d.low) - yMain(d.high)} fill={d.color} opacity={0.04} />
              </g>
            );
          }
          return null;
        })}

        {/* draw-in-progress indicator */}
        {drawStart && hover != null && drawMode === "trendline" && (
          <line x1={x(drawStart.idx)} y1={yMain(drawStart.val)} x2={x(hover)} y2={yMain(series[0]?.values[hover] ?? drawStart.val)} stroke="#3B9DFF" strokeWidth={1} strokeDasharray="3 2" opacity={0.6} />
        )}

        {/* x labels */}
        {axis.map((d, i) => (i % xLabelEvery === 0 ? (
          <text key={`x${i}`} x={x(i)} y={totalH - 4} textAnchor="middle" fontSize={9} fill="#5E5E66" fontFamily="var(--font-mono)">{d.slice(0, 7)}</text>
        ) : null))}

        {/* crosshair */}
        {hover != null && hasData && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={mainTop} y2={cursor} stroke="#5E5E66" strokeWidth={1} strokeDasharray="3 2" />
            {!candles && series.map((s, si) => { const v = s.values[hover]; return v == null || s.ghost ? null : <circle key={si} cx={x(hover)} cy={yMain(v)} r={2.4} fill={s.color} />; })}
          </g>
        )}
      </svg>

      {/* tooltip */}
      {hover != null && hasData && (
        <div className="pointer-events-none absolute top-2 z-10 min-w-32 -translate-x-1/2 rounded-sm border border-term-border bg-term-panel/95 px-2 py-1 text-2xs shadow-lg" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="mb-0.5 text-3xs text-term-text-mute">{axis[hover]}</div>
          {candles && candles[hover]?.c != null && (
            <div className="tnum text-term-text">O {fmt(candles[hover].o as number)} · H {fmt(candles[hover].h as number)} · L {fmt(candles[hover].l as number)} · C {fmt(candles[hover].c as number)}</div>
          )}
          {series.filter((s) => !s.ghost).map((s, si) => (
            <div key={si} className="flex items-center justify-between gap-3 tnum">
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} /><span className="text-term-text-dim">{s.label}</span></span>
              <span className="text-term-text">{s.values[hover] == null ? "—" : fmt(s.values[hover] as number)}</span>
            </div>
          ))}
          {overlays.map((s, si) => (
            <div key={`ov${si}`} className="flex items-center justify-between gap-3 tnum">
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} /><span className="text-term-text-dim">{s.label}</span></span>
              <span className="text-term-text">{s.values[hover] == null ? "—" : fmt(s.values[hover] as number)}</span>
            </div>
          ))}
          {oscPanes.flatMap((p) => p.lines).map((l, li) => (
            <div key={`os${li}`} className="flex items-center justify-between gap-3 tnum">
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: l.color }} /><span className="text-term-text-dim">{l.label}</span></span>
              <span className="text-term-text">{l.values[hover] == null ? "—" : (l.values[hover] as number).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {!hasData && <div className="absolute inset-0 flex items-center justify-center text-2xs text-term-text-mute">No data for this selection</div>}
    </div>
  );
});
