import clsx from "clsx";
import { useProviderHealth } from "@/lib/useProviderHealth";

/** Temporary deployment diagnostics for confirming Render can see the Gold DB. */
export function GoldDbTestRibbon() {
  const { health, probedAt } = useProviderHealth();
  const macro = health?.MACRO_DB;

  const state = !macro
    ? "PROBING"
    : macro.configured && macro.readSuccessfully
    ? "OK"
    : "CHECK";
  const tone =
    state === "OK"
      ? "border-term-up/40 bg-term-up/10 text-term-up"
      : state === "CHECK"
      ? "border-term-down/50 bg-term-down/10 text-term-down"
      : "border-term-amber/40 bg-term-amber/10 text-term-amber";
  const dot =
    state === "OK"
      ? "bg-term-up animate-blink"
      : state === "CHECK"
      ? "bg-term-down"
      : "bg-term-amber animate-pulse";

  const message = macro?.explicitStatus ?? "Probing /api/dataops/health for MACRO_DB_URL and Gold DB read status";
  const detail = macro?.detail ?? "Waiting for health response";
  const target = macro?.target ? ` · ${macro.target}` : "";
  const backend = macro?.backend ? ` · backend=${macro.backend}` : "";
  const stamp = probedAt ? ` · probe ${probedAt.slice(11, 19)}` : "";

  return (
    <div className={clsx("flex shrink-0 items-center gap-2 border-b px-3 py-1 text-3xs font-semibold uppercase tracking-wide", tone)}>
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <span className="shrink-0">Gold DB Test</span>
      <span className="text-term-text-mute">/</span>
      <span className="truncate" title={`${detail}${target}${backend}${stamp}`}>
        {state}: {message}
        {backend}
        {stamp}
      </span>
    </div>
  );
}
