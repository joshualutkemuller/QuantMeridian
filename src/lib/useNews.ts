
import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import { getHeadlines, type Headline, type EventCluster } from "@/data/news";
import { useSimMode } from "@/lib/simMode";

interface NewsResponse {
  source: string;
  headlines: Headline[];
  clusters?: EventCluster[];
}

/**
 * Live news headlines with provenance, mirroring useEcon's pattern: render the
 * deterministic SIM set instantly, seed from cache on re-navigation, then
 * upgrade to the provider-chain response from /api/news. `source` is the live
 * provider name (e.g. "Alpha Vantage") or "SIM". `clusters` carries transformer
 * event clusters when the FinBERT stage (NEWS_NLP_URL) is wired (else empty →
 * the page falls back to keyword clustering).
 */
export function useNews(n = 60): { headlines: Headline[]; source: string; clusters: EventCluster[] } {
  const { simEnabled } = useSimMode();
  const url = `/api/news?n=${n}`;
  const cached = peekFresh<NewsResponse>(url);
  const [headlines, setHeadlines] = useState<Headline[]>(cached?.headlines ?? getHeadlines(n));
  const [source, setSource] = useState<string>(cached?.source ?? "SIM");
  const [clusters, setClusters] = useState<EventCluster[]>(cached?.clusters ?? []);

  useEffect(() => {
    let alive = true;
    const seed = peekFresh<NewsResponse>(url);
    if (seed?.headlines?.length) {
      setHeadlines(seed.headlines);
      setSource(seed.source);
      setClusters(seed.clusters ?? []);
    }
    fetchJson<NewsResponse>(url)
      .then((j) => {
        if (!alive || !j?.headlines?.length) return;
        setHeadlines(j.headlines);
        setSource(j.source ?? "SIM");
        setClusters(j.clusters ?? []);
      })
      .catch(() => {
        /* keep SIM fallback */
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (!simEnabled && source === "SIM") {
    return { headlines: [], source, clusters: [] };
  }
  return { headlines, source, clusters };
}
