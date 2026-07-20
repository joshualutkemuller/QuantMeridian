import { json } from "@/lib/server/http";
import { fredEnabled, fredSeries } from "@/lib/server/fred"; // MIGRATION FALLBACK — remove in Phase 6
import { getSeriesHistory, seriesById, resolveFred } from "@/data/econSeries"; // MIGRATION FALLBACK — remove in Phase 6
import { getMarketLensSeries } from "@/data/marketLens";
import { getSnapshotObservations, getSnapshotRawObservations } from "@/data/econSnapshot"; // MIGRATION FALLBACK — remove in Phase 6
import { goldEnabled, goldStore } from "@/lib/server/goldStore";
import { simFallbackEnabled, snapshotFallbackEnabled } from "@/lib/server/fallbacks";

interface GoldObsRow { series_id: string; date: string; observation_date?: string; value: number }
interface GoldEquityRow {
  ticker: string;
  date: string;
  observation_date?: string;
  close?: number | string | null;
  total_return_index?: number | string | null;
  price_return_index?: number | string | null;
}

function finiteNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/chart/series?source=econ&id=DGS10
 * GET /api/chart/series?source=market&id=SPY&assetClass=EQUITY
 *
 * Unified series resolver for the charting studios.
 *
 * Resolution order:
 *   econ/fred  → Gold DB (fred_feature_transforms) → FRED live → SNAPSHOT → SIM
 *   market/lens → Gold DB (equity_total_return_index) → Market Lens engine
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const source = (sp.get("source") ?? "econ").toLowerCase();
  const id = sp.get("id") ?? "";
  const assetClass = sp.get("assetClass") ?? undefined;
  const reqUnits = sp.get("units") ?? undefined;
  const allowSim = simFallbackEnabled(req);
  const allowSnapshot = snapshotFallbackEnabled(req);
  if (!id) return json({ error: "id required" }, { status: 400 });

  // Market / lens / book — daily price or macro level series from Gold equity tables.
  if (source === "market" || source === "lens" || source === "book") {
    if (goldEnabled()) {
      try {
        const store = goldStore();
        const rows = await store.history<GoldEquityRow>("equity_total_return_index", { ticker: id });
        if (rows.length) {
          const obs = rows
            .map((r) => {
              const value = reqUnits === "return_index"
                ? finiteNumber(r.total_return_index ?? r.price_return_index ?? r.close)
                : reqUnits === "price_return_index"
                  ? finiteNumber(r.price_return_index ?? r.total_return_index ?? r.close)
                  : finiteNumber(r.close ?? r.price_return_index ?? r.total_return_index);
              return { date: r.date ?? r.observation_date, value };
            })
            .filter((o): o is { date: string; value: number } => Boolean(o.date) && o.value !== null);
          return json({ source: "DB", id, label: id, observations: obs });
        }

        // FRED-sourced series in the lens (rates, macro) — try fred_feature_transforms
        const fredRows = await store.history<GoldObsRow>("fred_feature_transforms", { series_id: id });
        if (fredRows.length) {
          return json({ source: "DB", id, label: id, observations: fredRows.map((r) => ({ date: r.date ?? r.observation_date, value: r.value })) });
        }
      } catch (err) {
        console.warn("[chart/series] Gold DB read failed:", (err as Error).message);
      }
    }

    // Fall back to the Market Lens series engine (committed snapshots + FRED)
    try {
      const s = await getMarketLensSeries(id, assetClass);
      const badge =
        s.source === "fred" ? "FRED"
        : s.source === "econ-sim" ? "ECON"
        : s.source === "synthetic" ? "SIM"
        : "SNAPSHOT";
      if (!allowSim && (badge === "SIM" || badge === "ECON")) {
        return json({ source: "ERR", id, label: id, observations: [], error: "No Gold/real chart data available; enable SIM in the ribbon to use generated fallback data." });
      }
      if (!allowSnapshot && badge === "SNAPSHOT") {
        return json({ source: "ERR", id, label: id, observations: [], error: "No Gold/live chart data available; enable Snapshot Fallback in the ribbon to use committed fallback data." });
      }
      return json({
        source: badge,
        id,
        label: id,
        observations: s.dates.map((d, i) => ({ date: d, value: s.values[i] })),
      });
    } catch {
      return json({ source: "ERR", id, label: id, observations: [] });
    }
  }

  // Econ / FRED — mirror /api/econ/series unit semantics.
  const meta = seriesById(id);
  const resolved = resolveFred(id);
  const units = reqUnits ?? resolved.units;
  const freq = meta?.freq ?? "D";
  const n = freq === "D" ? 1800 : freq === "W" ? 520 : freq === "M" ? 360 : 120;

  // 1. Gold DB
  if (goldEnabled()) {
    try {
      const store = goldStore();
      const wantsTransformed = units !== "lin";
      const rows = await store.history<GoldObsRow>(
        wantsTransformed ? "fred_feature_transforms" : "fred_latest_observation",
        { series_id: id },
        n
      );
      if (rows.length) {
        return json({ source: "DB", id, label: meta?.label ?? id, units, observations: rows.map((r) => ({ date: r.date ?? r.observation_date, value: r.value })) });
      }
    } catch (err) {
      console.warn("[chart/series] Gold DB econ read failed:", (err as Error).message);
    }
  }

  // 2. FRED
  if (fredEnabled() && !resolved.simOnly) {
    try {
      const obs = await fredSeries(id, { limit: n, units, scale: resolved.scale }); // MIGRATION FALLBACK — remove in Phase 6
      if (obs.length) {
        return json({ source: "FRED", id, label: meta?.label ?? id, observations: obs });
      }
    } catch {
      /* fall through */
    }
  }

  // 3. Snapshot
  if (allowSnapshot) {
    const snap = units === "lin"
      ? getSnapshotRawObservations(id, n) ?? getSnapshotObservations(id, n) // MIGRATION FALLBACK — remove in Phase 6
      : getSnapshotObservations(id, n); // MIGRATION FALLBACK — remove in Phase 6
    if (snap) return json({ source: "SNAPSHOT", id, label: meta?.label ?? id, observations: snap });
  }

  // 4. SIM
  if (!allowSim) {
    return json({ source: "ERR", id, label: meta?.label ?? id, observations: [], error: "No DB/FRED/snapshot chart data available; enable SIM in the ribbon to use generated fallback data." });
  }
  return json({ source: "SIM", id, label: meta?.label ?? id, observations: getSeriesHistory(id, n) }); // MIGRATION FALLBACK — remove in Phase 6
}
