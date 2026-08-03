import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import { useSimMode } from "@/lib/simMode";

export type GoldSource = "DB" | "LOADING" | "ERR";

/**
 * Resilient Gold DB view hook. Mirrors useMarketView/useEconResource pattern but
 * for aggregated routes that fetch pre-computed analytics from Gold.
 *
 * Returns a loading state initially, then upgrades to data when the route resolves.
 * No snapshot/SIM fallback — Gold routes are DB-only. Returns empty data structure
 * with source="LOADING" until the route responds, or source="ERR" on failure.
 */
export function useGoldView<T>(
  route: string,
  emptyValue: T
): { data: T; source: GoldSource } {
  const { simEnabled } = useSimMode();
  const url = simEnabled ? `/api/econ/${route}?sim=1` : `/api/econ/${route}`;
  const [data, setData] = useState<T>(emptyValue);
  const [source, setSource] = useState<GoldSource>("LOADING");

  useEffect(() => {
    let alive = true;

    const apply = (json: any) => {
      // Routes return { source: "DB", ok: true, ...data } or { source: "DB", ok: false, error: "..." }
      if (json?.source === "DB" && json?.ok === false) {
        setData(emptyValue);
        setSource("ERR");
        return;
      }
      if (json?.source === "DB" && json?.ok === true) {
        // Extract all keys except source and ok
        const { source: _, ok: __, ...payload } = json;
        setData(payload as T);
        setSource("DB");
      } else {
        setData(emptyValue);
        setSource("ERR");
      }
    };

    // Check for cached response
    const seed = peekFresh<any>(url);
    if (seed) apply(seed);

    fetchJson<any>(url)
      .then((json) => {
        if (!alive) return;
        apply(json);
      })
      .catch(() => {
        if (!alive) return;
        setData(emptyValue);
        setSource("ERR");
      });

    return () => {
      alive = false;
    };
  }, [url, route, simEnabled]);

  return { data, source };
}
