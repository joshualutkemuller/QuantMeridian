
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@/lib/navigation";
import { CommandBar } from "./CommandBar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { Ticker } from "./Ticker";
import { CommandPalette } from "./CommandPalette";
import { GoldDbTestRibbon } from "./GoldDbTestRibbon";
import { NAV } from "@/lib/nav";

/** Top-level chrome: ticker, command bar, sidebar, content, status bar + global hotkeys. */
export function AppShell({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const router = useRouter();

  // The command-bar toggle collapses the rail on md+, opens the drawer on mobile.
  const toggleSidebar = () => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      setCollapsed((c) => !c);
    } else {
      setMobileNavOpen((o) => !o);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K → command line
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      // "/" focuses command line when not typing
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      // Alt+1..9/0 jump to modules (Bloomberg function-key feel)
      if (e.altKey && /^[0-9]$/.test(e.key)) {
        const i = e.key === "0" ? 9 : Number(e.key) - 1;
        if (NAV[i]) {
          e.preventDefault();
          router.push(NAV[i].href);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-term-bg">
      <Ticker />
      <CommandBar onOpenPalette={() => setPaletteOpen(true)} onToggleSidebar={toggleSidebar} />
      <GoldDbTestRibbon />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        <main className="min-w-0 flex-1 overflow-auto bg-term-bg">{children}</main>
      </div>
      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
