
import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import type { ProviderStatus } from "@/data/dataOps";

export interface ProviderProbe {
  status: ProviderStatus;
  detail: string;
  live: boolean;
  configured?: boolean;
  readSuccessfully?: boolean;
  backend?: string;
  target?: string;
  explicitStatus?: string;
  diagnostics?: unknown;
}
interface HealthResponse {
  probedAt: string;
  providers: Record<string, ProviderProbe>;
}

/**
 * Live provider-health probe for DATAOPS. Renders nothing until the probe
 * returns (the page keeps its fixture baseline), then overlays the real status
 * from /api/dataops/health (env config + reachability of news_nlp / market
 * pipeline). Seeds from cache for instant re-navigation.
 */
export function useProviderHealth(): { health: Record<string, ProviderProbe> | null; probedAt: string | null } {
  const url = "/api/dataops/health";
  const cached = peekFresh<HealthResponse>(url);
  const [state, setState] = useState<{ health: Record<string, ProviderProbe> | null; probedAt: string | null }>(
    cached ? { health: cached.providers, probedAt: cached.probedAt } : { health: null, probedAt: null }
  );

  useEffect(() => {
    let alive = true;
    fetchJson<HealthResponse>(url)
      .then((j) => {
        if (alive && j?.providers) setState({ health: j.providers, probedAt: j.probedAt });
      })
      .catch(() => {
        /* keep fixture baseline */
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
