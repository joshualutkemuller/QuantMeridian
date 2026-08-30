
import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import { getSocialIntel, type SocialIntel } from "@/data/news";
import { useSimMode } from "@/lib/simMode";

export interface SocialProviderAttempt {
  provider: string;
  configured: boolean;
  ok: boolean;
  postCount: number;
  tickerCount: number;
  themeCount: number;
  latencyMs: number;
  error?: string;
}

type SocialResponse = SocialIntel & { source: string; diagnostics?: SocialProviderAttempt[] };

/**
 * Live social sentiment with provenance (NEWS-3 + SENT). Renders the SIM engine
 * instantly, seeds from cache, then upgrades to the Reddit/StockTwits aggregate
 * from /api/social. `source` is the live provider list (e.g. "Reddit + StockTwits")
 * or "SIM".
 */
export function useSocial(): { intel: SocialIntel; source: string; diagnostics: SocialProviderAttempt[] } {
  const { simEnabled } = useSimMode();
  const url = `/api/social${simEnabled ? "?sim=1" : ""}`;
  const cached = peekFresh<SocialResponse>(url);
  const [intel, setIntel] = useState<SocialIntel>(cached ?? getSocialIntel());
  const [source, setSource] = useState<string>(cached?.source ?? "SIM");
  const [diagnostics, setDiagnostics] = useState<SocialProviderAttempt[]>(cached?.diagnostics ?? []);

  useEffect(() => {
    let alive = true;
    const seed = peekFresh<SocialResponse>(url);
    if (seed) {
      setIntel(seed);
      setSource(seed.source);
      setDiagnostics(seed.diagnostics ?? []);
    }
    fetchJson<SocialResponse>(url)
      .then((j) => {
        if (!alive || !j?.platforms) return;
        const { source: s, diagnostics: d, ...rest } = j;
        setIntel(rest);
        setSource(s ?? "SIM");
        setDiagnostics(d ?? []);
      })
      .catch(() => {
        if (!alive) return;
        setSource(simEnabled ? "SIM" : "ERR");
        if (!simEnabled) {
          setIntel({ tickers: [], sectors: [], themes: [], totalPosts: 0, platforms: [] });
        }
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (!simEnabled && source === "SIM") {
    return { intel: { tickers: [], sectors: [], themes: [], totalPosts: 0, platforms: [] }, source: "ERR", diagnostics };
  }
  return { intel, source, diagnostics };
}
