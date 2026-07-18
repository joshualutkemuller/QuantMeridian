
import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import { getSocialIntel, type SocialIntel } from "@/data/news";
import { useSimMode } from "@/lib/simMode";

type SocialResponse = SocialIntel & { source: string };

/**
 * Live social sentiment with provenance (NEWS-3 + SENT). Renders the SIM engine
 * instantly, seeds from cache, then upgrades to the Reddit/StockTwits aggregate
 * from /api/social. `source` is the live provider list (e.g. "Reddit + StockTwits")
 * or "SIM".
 */
export function useSocial(): { intel: SocialIntel; source: string } {
  const { simEnabled } = useSimMode();
  const url = "/api/social";
  const cached = peekFresh<SocialResponse>(url);
  const [intel, setIntel] = useState<SocialIntel>(cached ?? getSocialIntel());
  const [source, setSource] = useState<string>(cached?.source ?? "SIM");

  useEffect(() => {
    let alive = true;
    const seed = peekFresh<SocialResponse>(url);
    if (seed) {
      setIntel(seed);
      setSource(seed.source);
    }
    fetchJson<SocialResponse>(url)
      .then((j) => {
        if (!alive || !j?.platforms) return;
        const { source: s, ...rest } = j;
        setIntel(rest);
        setSource(s ?? "SIM");
      })
      .catch(() => {
        /* keep SIM fallback */
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (!simEnabled && source === "SIM") {
    return { intel: { tickers: [], sectors: [], themes: [], totalPosts: 0, platforms: [] }, source };
  }
  return { intel, source };
}
