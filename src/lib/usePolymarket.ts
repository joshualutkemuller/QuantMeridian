import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import {
  getPolymarkets,
  getPolyEvents,
  getPolyPriceHistory,
  type PolyMarket,
  type PolyEvent,
  type PolyPricePoint,
} from "@/data/polymarket";
import { useSimMode } from "@/lib/simMode";

export type PolySource = "POLY" | "SNAPSHOT" | "SIM" | "LOADING" | "ERR";

function mapSource(raw?: string): PolySource {
  if (raw === "POLY" || raw === "LIVE") return "POLY";
  if (raw === "SNAPSHOT") return "SNAPSHOT";
  if (raw === "ERR") return "ERR";
  return "SIM";
}

export function usePolymarkets(opts?: { limit?: number; category?: string }): {
  data: PolyMarket[];
  source: PolySource;
} {
  const { simEnabled } = useSimMode();
  const limit = opts?.limit ?? 100;
  const category = opts?.category;
  const sim = getPolymarkets().slice(0, limit);
  const filtered = category ? sim.filter((m) => m.category === category) : sim;

  const url = `/api/polymarket/markets?limit=${limit}${category ? `&category=${category}` : ""}${simEnabled ? "&sim=1" : ""}`;
  const cached = peekFresh<any>(url);
  const [data, setData] = useState<PolyMarket[]>(cached?.data ?? filtered);
  const [source, setSource] = useState<PolySource>(cached ? mapSource(cached.source) : "SIM");

  useEffect(() => {
    let alive = true;
    const seed = peekFresh<any>(url);
    if (seed) {
      setData(seed.data ?? filtered);
      setSource(mapSource(seed.source));
    } else {
      setSource("LOADING");
    }

    fetchJson<any>(url)
      .then((json) => {
        if (!alive) return;
        setData(json.data ?? filtered);
        setSource(mapSource(json.source));
      })
      .catch(() => {
        if (!alive) return;
        setData(simEnabled ? filtered : []);
        setSource(simEnabled ? "SIM" : "ERR");
      });

    return () => { alive = false; };
  }, [limit, category, simEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!simEnabled && source === "SIM") {
    return { data: [], source: "ERR" };
  }
  return { data, source };
}

export function usePolyEvents(): {
  data: PolyEvent[];
  source: PolySource;
} {
  const { simEnabled } = useSimMode();
  const sim = getPolyEvents();
  const url = `/api/polymarket/events${simEnabled ? "?sim=1" : ""}`;
  const cached = peekFresh<any>(url);
  const [data, setData] = useState<PolyEvent[]>(cached?.data ?? sim);
  const [source, setSource] = useState<PolySource>(cached ? mapSource(cached.source) : "SIM");

  useEffect(() => {
    let alive = true;
    const seed = peekFresh<any>(url);
    if (seed) {
      setData(seed.data ?? sim);
      setSource(mapSource(seed.source));
    } else {
      setSource("LOADING");
    }

    fetchJson<any>(url)
      .then((json) => {
        if (!alive) return;
        setData(json.data ?? sim);
        setSource(mapSource(json.source));
      })
      .catch(() => {
        if (!alive) return;
        setData(simEnabled ? sim : []);
        setSource(simEnabled ? "SIM" : "ERR");
      });

    return () => { alive = false; };
  }, [simEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!simEnabled && source === "SIM") {
    return { data: [], source: "ERR" };
  }
  return { data, source };
}

export function usePolyHistory(marketId: string | null, days = 90): {
  data: PolyPricePoint[];
  source: PolySource;
} {
  const { simEnabled } = useSimMode();
  const sim = marketId ? getPolyPriceHistory(marketId, days) : [];
  const [data, setData] = useState<PolyPricePoint[]>(sim);
  const [source, setSource] = useState<PolySource>("SIM");

  useEffect(() => {
    if (!marketId) {
      setData([]);
      setSource("ERR");
      return;
    }

    let alive = true;
    const url = `/api/polymarket/history?id=${marketId}&days=${days}${simEnabled ? "&sim=1" : ""}`;
    const seed = peekFresh<any>(url);
    if (seed) {
      setData(seed.data ?? sim);
      setSource(mapSource(seed.source));
    } else {
      setData(simEnabled ? getPolyPriceHistory(marketId, days) : []);
      setSource("LOADING");
    }

    fetchJson<any>(url)
      .then((json) => {
        if (!alive) return;
        setData(json.data ?? []);
        setSource(mapSource(json.source));
      })
      .catch(() => {
        if (!alive) return;
        setData(simEnabled ? getPolyPriceHistory(marketId, days) : []);
        setSource(simEnabled ? "SIM" : "ERR");
      });

    return () => { alive = false; };
  }, [marketId, days, simEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!simEnabled && source === "SIM") {
    return { data: [], source: "ERR" };
  }
  return { data, source };
}
