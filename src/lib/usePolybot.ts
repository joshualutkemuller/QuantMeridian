import { useEffect, useState } from "react";
import { fetchJson, peekFresh } from "@/lib/fetchCache";
import { useSimMode } from "@/lib/simMode";
import { type PolyMarket } from "@/data/polymarket";
import { buildSimBook, type PolyOrderBook } from "@/data/polybot";

export function usePolyBook(market: PolyMarket | null): {
  data: PolyOrderBook | null;
  source: PolyOrderBook["source"];
} {
  const { simEnabled } = useSimMode();
  const tokenId = market?.yesTokenId ?? "";
  const marketId = market?.id ?? "";
  const sim = market ? buildSimBook(market) : null;
  const url = market
    ? `/api/polymarket/book?marketId=${encodeURIComponent(marketId)}&tokenId=${encodeURIComponent(tokenId)}${simEnabled ? "&sim=1" : ""}`
    : "";
  const cached = url ? peekFresh<any>(url, 15_000) : undefined;
  const [data, setData] = useState<PolyOrderBook | null>(cached?.data ?? sim);
  const [source, setSource] = useState<PolyOrderBook["source"]>(cached?.data?.source ?? (sim ? "SIM" : "ERR"));

  useEffect(() => {
    if (!market || !url) {
      setData(null);
      setSource("ERR");
      return;
    }

    let alive = true;
    const seed = peekFresh<any>(url, 15_000);
    if (seed?.data) {
      setData(seed.data);
      setSource(seed.data.source ?? "SIM");
    } else {
      setData(simEnabled ? buildSimBook(market) : null);
      setSource("LOADING");
    }

    fetchJson<any>(url, { maxAgeMs: 15_000, dedupeMs: 5_000 })
      .then((json) => {
        if (!alive) return;
        const next = json.data ?? buildSimBook(market);
        setData(next);
        setSource(next.source ?? (json.source === "POLY" ? "CLOB" : json.source ?? "SIM"));
      })
      .catch(() => {
        if (!alive) return;
        setData(buildSimBook(market));
        setSource("SIM");
      });

    return () => { alive = false; };
  }, [market, marketId, simEnabled, tokenId, url]);

  return { data, source };
}
