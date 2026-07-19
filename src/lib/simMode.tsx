import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface SimModeState {
  simEnabled: boolean;
  snapshotFallbackEnabled: boolean;
  toggle: () => void;
  toggleSnapshotFallback: () => void;
}

const SimModeContext = createContext<SimModeState>({
  simEnabled: false,
  snapshotFallbackEnabled: false,
  toggle: () => {},
  toggleSnapshotFallback: () => {},
});

const STORAGE_KEY = "qit-sim-mode";
const SNAPSHOT_STORAGE_KEY = "qit-snapshot-fallback";

export function SimModeProvider({ children }: { children: ReactNode }) {
  const [simEnabled, setSimEnabled] = useState(false);
  const [snapshotFallbackEnabled, setSnapshotFallbackEnabled] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "1") setSimEnabled(true);

    const storedSnapshotFallback = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (storedSnapshotFallback === "1") setSnapshotFallbackEnabled(true);
  }, []);

  const toggle = useCallback(() => {
    setSimEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const toggleSnapshotFallback = useCallback(() => {
    setSnapshotFallbackEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(SNAPSHOT_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return (
    <SimModeContext.Provider value={{ simEnabled, snapshotFallbackEnabled, toggle, toggleSnapshotFallback }}>
      {children}
    </SimModeContext.Provider>
  );
}

export function useSimMode() {
  return useContext(SimModeContext);
}
