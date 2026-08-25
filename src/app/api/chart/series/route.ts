import { json } from "@/lib/server/http";
import { seriesById, resolveFred } from "@/data/econSeries";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

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
 * GET /api/chart/series?source=market&id=SPY
 *
 * Unified series resolver for the charting studios.
 *
 * Resolution order:
 *   econ/fred  → Gold DB (fred_feature_transforms / fred_latest_observation)
 *   market/lens → Gold DB (equity_total_return_index / fred_feature_transforms)
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const source = (sp.get("source") ?? "econ").toLowerCase();
  const id = sp.get("id") ?? "";
  const reqUnits = sp.get("units") ?? undefined;
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
        return json({ source: "ERR", id, label: id, observations: [], error: (err as Error).message });
      }
    }

    return json({ source: "ERR", id, label: id, observations: [], error: goldEnabled() ? "No Gold DB market chart rows found." : "MACRO_DB_URL not configured." });
  }

  // Econ / FRED — mirror /api/econ/series unit semantics.
  const meta = seriesById(id);
  const resolved = resolveFred(id);
  const units = reqUnits ?? resolved.units;
  const freq = meta?.freq ?? "D";
  const n = freq === "D" ? 1800 : freq === "W" ? 520 : freq === "M" ? 360 : 120;

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
      return json({ source: "ERR", id, label: meta?.label ?? id, observations: [], error: (err as Error).message });
    }
  }

  return json({ source: "ERR", id, label: meta?.label ?? id, observations: [], error: goldEnabled() ? "No Gold DB econ chart rows found." : "MACRO_DB_URL not configured." });
}
