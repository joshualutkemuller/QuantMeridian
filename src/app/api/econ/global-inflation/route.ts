import { json } from "@/lib/server/http";
import { goldStore } from "@/lib/server/goldStore";

export const runtime = "nodejs";

interface GoldInflationRow {
  country: string;
  iso3: string;
  region: string;
  series_id: string;
  observation_date: string;
  cpi_yoy_pct: number | null;
  change_pp: number | null;
  trend: string | null;
  streak: number | null;
  target_pct: number | null;
  vs_target_pp: number | null;
}

export async function GET() {
  const store = goldStore();
  if (!store) {
    return json({ rows: [], source: "ERR" });
  }

  const rows = await store.latest<GoldInflationRow>("global_inflation");
  return json({
    rows: rows.map((r) => ({
      iso3: r.iso3,
      country: r.country,
      region: r.region,
      cpi_yoy_pct: r.cpi_yoy_pct,
      change_pp: r.change_pp,
      trend: r.trend,
      streak: r.streak,
      target_pct: r.target_pct,
      vs_target_pp: r.vs_target_pp,
      observation_date: r.observation_date,
    })),
    source: "DB",
  });
}
