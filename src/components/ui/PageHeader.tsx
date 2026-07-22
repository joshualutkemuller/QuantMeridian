
import type { ReactNode } from "react";
import { useTick } from "@/lib/hooks";
import { Tag } from "./Panel";

/** Consistent module header: code, title, live badge, right-aligned actions. */
export function PageHeader({
  code,
  title,
  desc,
  right,
  asOf,
  showStreaming = true,
}: {
  code: string;
  title: string;
  desc?: string;
  right?: ReactNode;
  asOf?: string | null;
  showStreaming?: boolean;
}) {
  const tick = useTick(3000);
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-term-border bg-term-panel px-3 py-2">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="shrink-0 font-mono text-base font-bold tracking-tight text-term-amber">{code}</span>
        <h1 className="truncate text-sm font-semibold text-term-text">{title}</h1>
        {desc && <span className="hidden text-2xs text-term-text-mute md:inline">{desc}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        {asOf && (
          <span
            className="tnum rounded-sm border border-term-border bg-term-panel-2 px-1.5 py-px text-3xs font-semibold uppercase tracking-wide text-term-text-dim"
            title="As-of date of the latest underlying data point"
          >
            DATA AS OF {asOf}
          </span>
        )}
        {right}
        {showStreaming && (
          <Tag tone="up">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-term-up animate-blink align-middle" />
            STREAMING
          </Tag>
        )}
        <span className="tnum hidden text-3xs text-term-text-mute lg:inline" suppressHydrationWarning>
          TICK {String(tick).padStart(5, "0")}
        </span>
      </div>
    </div>
  );
}

/** A row of compact KPI stats used at the top of most modules. */
export function KpiStrip({ children }: { children: ReactNode }) {
  return (
    <div className="analytics-strip border-b border-term-border bg-term-panel">
      <div className="grid min-w-max auto-cols-[minmax(10rem,1fr)] grid-flow-col divide-x divide-term-border lg:grid-flow-row lg:grid-cols-6">
        {children}
      </div>
    </div>
  );
}
