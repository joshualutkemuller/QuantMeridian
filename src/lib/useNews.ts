
import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import { getHeadlines, type Headline, type EventCluster } from "@/data/news";
import { useSimMode } from "@/lib/simMode";

export interface NewsProviderAttempt {
  provider: string;
  configured: boolean;
  ok: boolean;
  headlineCount: number;
  latencyMs: number;
  error?: string;
}

export type NewsClusterSource = "FINBERT" | "KEYWORD" | "NONE";

export interface NewsNlpStatus {
  configured: boolean;
  ok: boolean;
  latencyMs: number;
  model?: string;
  error?: string;
}

export interface NewsNlpRuntime {
  sentiment: boolean;
  clusters: boolean;
  clusterSource: NewsClusterSource;
  health?: NewsNlpStatus;
}

interface NewsResponse {
  source: string;
  headlines: Headline[];
  clusters?: EventCluster[];
  clusterSource?: NewsClusterSource;
  nlp?: NewsNlpRuntime;
  diagnostics?: NewsProviderAttempt[];
}

/**
 * Live news headlines with provenance. Uses cached provider-chain responses on
 * re-navigation and fetches /api/news; generated headlines are only exposed
 * when the SIM ribbon is enabled. `source` is the live provider name
 * (e.g. "Alpha Vantage"), "ERR", or explicit "SIM". `clusters` carries
 * transformer event clusters when NEWS_NLP_URL is wired.
 */
const defaultNlpRuntime: NewsNlpRuntime = { sentiment: false, clusters: false, clusterSource: "KEYWORD" };

export function useNews(n = 60): { headlines: Headline[]; source: string; clusters: EventCluster[]; diagnostics: NewsProviderAttempt[]; nlp: NewsNlpRuntime } {
  const { simEnabled } = useSimMode();
  const url = `/api/news?n=${n}${simEnabled ? "&sim=1" : ""}`;
  const cached = peekFresh<NewsResponse>(url);
  const [headlines, setHeadlines] = useState<Headline[]>(cached?.headlines ?? getHeadlines(n));
  const [source, setSource] = useState<string>(cached?.source ?? "SIM");
  const [clusters, setClusters] = useState<EventCluster[]>(cached?.clusters ?? []);
  const [diagnostics, setDiagnostics] = useState<NewsProviderAttempt[]>(cached?.diagnostics ?? []);
  const [nlp, setNlp] = useState<NewsNlpRuntime>(cached?.nlp ?? { ...defaultNlpRuntime, clusterSource: cached?.clusterSource ?? "KEYWORD" });

  useEffect(() => {
    let alive = true;
    const seed = peekFresh<NewsResponse>(url);
    if (seed?.headlines?.length) {
      setHeadlines(seed.headlines);
      setSource(seed.source);
      setClusters(seed.clusters ?? []);
      setDiagnostics(seed.diagnostics ?? []);
      setNlp(seed.nlp ?? { ...defaultNlpRuntime, clusterSource: seed.clusterSource ?? (seed.clusters?.length ? "FINBERT" : "KEYWORD") });
    }
    fetchJson<NewsResponse>(url)
      .then((j) => {
        if (!alive) return;
        setDiagnostics(j?.diagnostics ?? []);
        if (!j?.headlines?.length) {
          setSource(j?.source ?? (simEnabled ? "SIM" : "ERR"));
          setNlp(j?.nlp ?? { ...defaultNlpRuntime, clusterSource: "NONE" });
          if (!simEnabled || j?.source === "ERR") {
            setHeadlines([]);
            setClusters([]);
          }
          return;
        }
        setHeadlines(j.headlines);
        setSource(j.source ?? "SIM");
        setClusters(j.clusters ?? []);
        setNlp(j.nlp ?? { ...defaultNlpRuntime, clusterSource: j.clusters?.length ? "FINBERT" : "KEYWORD" });
      })
      .catch(() => {
        if (!alive) return;
        setSource(simEnabled ? "SIM" : "ERR");
        setNlp({ ...defaultNlpRuntime, clusterSource: simEnabled ? "KEYWORD" : "NONE" });
        if (!simEnabled) {
          setHeadlines([]);
          setClusters([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (!simEnabled && source === "SIM") {
    return { headlines: [], source: "ERR", clusters: [], diagnostics, nlp: { ...nlp, clusterSource: "NONE" } };
  }
  return { headlines, source, clusters, diagnostics, nlp };
}
