import { useMemo } from "react";
import type { CommandCenterMetric } from "@/lib/commandCenter";
import { useCommandCenter } from "@/lib/useCommandCenter";
import { fmtNum, fmtSigned, fmtSignedPct } from "@/lib/format";

function valueText(metric: CommandCenterMetric): string {
  if (metric.unit === "%") return `${fmtNum(metric.value, metric.decimals)}%`;
  if (metric.unit.includes("%")) return `${fmtNum(metric.value, metric.decimals)} ${metric.unit}`;
  if (metric.unit === "bps") return `${fmtNum(metric.value, metric.decimals)}bp`;
  if (metric.unit === "$T") return `$${fmtNum(metric.value, metric.decimals)}T`;
  if (metric.unit === "k") return `${fmtNum(metric.value, metric.decimals)}k`;
  if (metric.unit === "$/oz" || metric.unit === "$/bbl") return `$${fmtNum(metric.value, metric.decimals)}`;
  return fmtNum(metric.value, metric.decimals);
}

function changeText(metric: CommandCenterMetric): string {
  if (metric.changeMode === "pct") return metric.changePct == null ? "-" : fmtSignedPct(metric.changePct, 2);
  if (metric.changeMode === "bps") return metric.change == null ? "-" : `${fmtSigned(metric.change, 0)}bp`;
  if (metric.changeMode === "points") return metric.change == null ? "-" : `${fmtSigned(metric.change, metric.decimals)}pt`;
  return metric.change == null ? "-" : fmtSigned(metric.change, metric.decimals);
}

/** Scrolling top macro tape. Gold/FRED DB only; no market API, snapshot, or SIM fallback. */
export function Ticker() {
  const { data, source } = useCommandCenter();
  const metrics = useMemo(() => {
    const wanted = ["SP500", "NASDAQCOM", "DJIA", "VIXCLS", "DGS10", "T10Y2Y", "SOFR", "PCEPILFE", "UNRATE"];
    const byId = new Map([
      ...data.highLevelMarkets,
      ...data.volatility,
      ...data.domesticRates,
      ...data.domesticHealth,
    ].map((metric) => [metric.id, metric]));
    return wanted.map((id) => byId.get(id)).filter((metric): metric is CommandCenterMetric => metric != null);
  }, [data.domesticHealth, data.domesticRates, data.highLevelMarkets, data.volatility]);

  if (!metrics.length) {
    return (
      <div className="relative h-6 overflow-hidden border-b border-term-border bg-term-panel">
        <div className="flex h-full items-center px-3 text-2xs">
          <span className="font-semibold text-term-amber">GOLD MACRO TAPE</span>
          <span className="ml-3 text-term-text-mute">{source === "LOADING" ? "Loading FRED/Eco Gold DB metrics" : data.error ?? "No Gold DB metrics available"}</span>
        </div>
      </div>
    );
  }

  const items = [...metrics, ...metrics];
  return (
    <div className="relative h-6 overflow-hidden border-b border-term-border bg-term-panel">
      <div className="ticker-track flex h-full items-center whitespace-nowrap">
        {items.map((metric, index) => {
          const up = (metric.changeMode === "pct" ? metric.changePct : metric.change) ?? 0;
          return (
            <span key={`${metric.id}-${index}`} className="tnum mx-3 inline-flex items-center gap-1.5 text-2xs" title={`${metric.label} · ${metric.id} · as of ${metric.asOf}`}>
              <span className="font-semibold text-term-text-dim">{metric.short}</span>
              <span className="text-term-text">{valueText(metric)}</span>
              <span className={up >= 0 ? "text-term-up" : "text-term-down"}>
                {up >= 0 ? "▲" : "▼"} {changeText(metric)}
              </span>
              <span className="font-mono text-3xs text-term-text-mute">as of {metric.asOf}</span>
            </span>
          );
        })}
        <span className="mx-4 inline-flex items-center gap-1.5 text-3xs text-term-text-mute">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-term-up" />
          {source}{data.asOf ? ` latest ${data.asOf}` : ""}
        </span>
      </div>
      <style>{`
        .ticker-track { animation: ticker 60s linear infinite; }
        @keyframes ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .ticker-track:hover { animation-play-state: paused; }
      `}</style>
    </div>
  );
}
