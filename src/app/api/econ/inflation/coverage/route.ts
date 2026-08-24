import { json } from "@/lib/server/http";
import { buildCpiCoverageFromGold } from "@/lib/server/inflationCoverage";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

export async function GET() {
  if (!goldEnabled()) {
    return json({ source: "DB", ok: false, error: "MACRO_DB_URL not configured", coverage: null });
  }
  try {
    const coverage = await buildCpiCoverageFromGold(goldStore());
    return json({ source: "DB", ok: true, coverage });
  } catch (err) {
    return json({ source: "DB", ok: false, error: (err as Error).message, coverage: null });
  }
}
