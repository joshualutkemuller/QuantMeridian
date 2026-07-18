
import { usePathname } from "@/lib/navigation";
import { NAV } from "@/lib/nav";
import { Search, PanelLeft, Command } from "lucide-react";
import { useSimMode } from "@/lib/simMode";

export function CommandBar({ onOpenPalette, onToggleSidebar }: { onOpenPalette: () => void; onToggleSidebar: () => void }) {
  const path = usePathname();
  const current = NAV.find((n) => n.href === path) ?? NAV[0];
  const { simEnabled, toggle: toggleSim } = useSimMode();
  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-term-border bg-term-panel px-2 sm:gap-3 sm:px-3">
      <button onClick={onToggleSidebar} className="shrink-0 text-term-text-mute hover:text-term-amber" title="Toggle sidebar">
        <PanelLeft size={16} />
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center bg-term-amber font-mono text-xs font-bold text-black">Q</div>
        <span className="font-mono text-sm font-bold tracking-tight text-term-amber">QIT</span>
        <span className="hidden text-3xs uppercase tracking-widest text-term-text-mute sm:inline">Quant Intelligence Platform</span>
      </div>

      <div className="mx-1 hidden h-4 w-px bg-term-border sm:block" />

      <div className="hidden items-center gap-1.5 text-xs sm:flex">
        <span className="font-mono font-semibold text-term-amber">{current.code}</span>
        <span className="text-term-text-mute">/</span>
        <span className="text-term-text-dim">{current.label}</span>
      </div>

      <button
        onClick={onOpenPalette}
        className="ml-auto hidden w-72 items-center gap-2 border border-term-border bg-term-panel-2 px-2 py-1 text-2xs text-term-text-mute hover:border-term-amber/60 sm:flex"
      >
        <Search size={13} />
        <span className="flex-1 text-left">Run command / find security…</span>
        <span className="flex items-center gap-0.5">
          <Command size={10} />
          <span className="term-kbd">K</span>
        </span>
      </button>

      {/* Mobile-only compact search button */}
      <button
        onClick={onOpenPalette}
        className="ml-auto shrink-0 text-term-text-mute hover:text-term-amber sm:hidden"
        title="Search"
      >
        <Search size={16} />
      </button>

      <button
        onClick={toggleSim}
        className={`flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide transition-colors ${
          simEnabled
            ? "border-term-amber/40 bg-term-amber/10 text-term-amber hover:bg-term-amber/20"
            : "border-term-border bg-term-panel-2 text-term-text-mute hover:border-term-text-mute"
        }`}
        title={simEnabled ? "SIM ON — simulated data fills gaps where live/DB data is unavailable. Click to turn off and see which modules go empty (audit mode)." : "SIM OFF — modules without real data show empty. Click to enable SIM fallback."}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${simEnabled ? "bg-term-amber animate-blink" : "bg-term-text-mute"}`} />
        SIM {simEnabled ? "ON" : "OFF"}
      </button>

      <div className="hidden items-center gap-3 text-3xs text-term-text-mute lg:flex">
        <span>DESK <span className="text-term-text-dim">SEC-FIN</span></span>
        <span>USER <span className="text-term-text-dim">jlutkemuller</span></span>
        <span className="flex items-center gap-1 text-term-up">RBAC <span>● PM</span></span>
      </div>
    </header>
  );
}
