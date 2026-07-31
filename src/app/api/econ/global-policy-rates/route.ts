import { json } from "@/lib/server/http";
import { goldStore } from "@/lib/server/goldStore";

export const runtime = "nodejs";

interface GoldPolicyRateRow {
  country: string;
  iso3: string;
  region: string;
  series_id: string;
  observation_date: string;
  policy_rate_pct: number | null;
  change_bps: number | null;
  last_move_bps: number | null;
  stance: string | null;
  real_rate_pct: number | null;
}

export async function GET() {
  const store = goldStore();
  if (!store) {
    return json({ rows: [], source: "ERR" });
  }

  const rows = await store.latest<GoldPolicyRateRow>("global_policy_rates");
  return json({
    rows: rows.map((r) => ({
      iso3: r.iso3,
      country: r.country,
      region: r.region,
      policy_rate_pct: r.policy_rate_pct,
      change_bps: r.change_bps,
      last_move_bps: r.last_move_bps,
      stance: r.stance,
      real_rate_pct: r.real_rate_pct,
      observation_date: r.observation_date,
    })),
    source: "DB",
  });
}
