// Exception to DB-only policy — economic release *dates* are not a Gold series.
// Decision (§12): pipeline adds gold.release_calendar (FRED /releases/dates ingested);
// until that table exists this route remains on the live FRED + Finnhub path.
import { json } from "@/lib/server/http";
import { fredEnabled, fredSeries, fredReleaseDates, type FredObservation } from "@/lib/server/fred"; // Exception to DB-only policy
import { finnhubEnabled, finnhubEconCalendar, type FinnhubEconEvent } from "@/lib/server/finnhubCalendar";
import { EVENT_SERIES, type EconEvent } from "@/data/econRates";

const BATCH_SIZE = 25;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ── FRED helpers ───────────────────────────────────────────────────── */

async function batchFred(
  defs: typeof EVENT_SERIES,
  startDate: string,
): Promise<(PromiseSettledResult<FredObservation[]>)[]> {
  const results: (PromiseSettledResult<FredObservation[]>)[] = [];
  for (let i = 0; i < defs.length; i += BATCH_SIZE) {
    const batch = defs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((def) =>
        fredSeries(def.fredId!, { // MIGRATION FALLBACK — remove in Phase 6
          start: startDate,
          limit: def.freq === "weekly" ? 60 : def.freq === "quarterly" ? 8 : 15,
          units: def.fredUnits,
          scale: def.fredScale,
          revalidateSec: 3600,
        })
      )
    );
    results.push(...batchResults);
  }
  return results;
}

function fredPeriodLabel(def: { freq: string }, obsDate: Date): string {
  const month = obsDate.getUTCMonth();
  const year = obsDate.getUTCFullYear();
  if (def.freq === "quarterly") {
    const q = Math.floor(month / 3) + 1;
    return `Q${q} ${year}`;
  }
  if (def.freq === "weekly") {
    const weekStart = obsDate.toISOString().slice(0, 10);
    return `Wk ${weekStart}`;
  }
  return `${MONTHS[month]} ${year}`;
}

function buildFredEvents(
  seriesWithFred: typeof EVENT_SERIES,
  fredResults: (PromiseSettledResult<FredObservation[]>)[],
  todayMs: number,
): { events: EconEvent[]; fulfilled: number; rejected: number } {
  const events: EconEvent[] = [];
  let idCounter = 0;
  let fulfilled = 0;
  let rejected = 0;

  for (let si = 0; si < seriesWithFred.length; si++) {
    const def = seriesWithFred[si];
    const result = fredResults[si];
    if (result.status === "rejected") {
      rejected++;
      continue;
    }
    fulfilled++;
    const obs = result.value.filter((o): o is FredObservation & { value: number } => o.value != null);
    if (!obs.length) continue;

    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const obsDate = new Date(o.date + "T00:00:00Z");
      const daysOut = Math.round((obsDate.getTime() - todayMs) / 86400000);
      if (daysOut < -365 || daysOut > 30) continue;

      const prior = i > 0 ? obs[i - 1].value : o.value;
      const actual = o.value;
      const released = daysOut < 0;

      events.push({
        id: `FR-${def.fredId}-${idCounter++}`,
        date: o.date,
        time: def.time,
        daysOut,
        name: def.name,
        category: def.category,
        importance: def.importance,
        period: fredPeriodLabel(def, obsDate),
        prior: def.fmt(prior),
        consensus: def.fmt(prior),
        actual: released ? def.fmt(actual) : null,
        ticker: def.fredId,
        source: "FRED",
      });
    }
  }

  return { events, fulfilled, rejected };
}

/* ── Finnhub helpers ────────────────────────────────────────────────── */

const FINNHUB_IMPACT_MAP: Record<string, EconEvent["importance"]> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

function fmtFinnhubVal(v: number | null, unit: string): string {
  if (v == null) return "";
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(2);
}

function finnhubCategory(event: string): string {
  const e = event.toLowerCase();
  if (e.includes("cpi") || e.includes("ppi") || e.includes("inflation") || e.includes("pce")) return "Inflation";
  if (e.includes("gdp") || e.includes("growth")) return "Growth";
  if (e.includes("employment") || e.includes("payroll") || e.includes("jobless") || e.includes("labor") || e.includes("unemployment")) return "Labor";
  if (e.includes("rate") || e.includes("fomc") || e.includes("fed") || e.includes("boe") || e.includes("ecb") || e.includes("boj")) return "Policy";
  if (e.includes("housing") || e.includes("home") || e.includes("mortgage") || e.includes("construction")) return "Housing";
  if (e.includes("retail") || e.includes("consumer") || e.includes("confidence") || e.includes("sentiment") || e.includes("spending")) return "Consumer";
  if (e.includes("pmi") || e.includes("ism") || e.includes("manufacturing") || e.includes("production") || e.includes("orders")) return "Activity";
  if (e.includes("trade") || e.includes("export") || e.includes("import") || e.includes("balance")) return "Trade";
  if (e.includes("money") || e.includes("credit") || e.includes("lending") || e.includes("m2")) return "Money";
  return "Release";
}

function finnhubPeriodLabel(dateOnly: string): string {
  const d = new Date(dateOnly + "T00:00:00Z");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function buildFinnhubEvents(raw: FinnhubEconEvent[], todayMs: number): EconEvent[] {
  const events: EconEvent[] = [];

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!r.event || !r.time) continue;

    const dateOnly = r.time.slice(0, 10);
    const timeStr = r.time.length > 10 ? r.time.slice(11, 16) : "—";
    const eventDate = new Date(dateOnly + "T00:00:00Z");
    const daysOut = Math.round((eventDate.getTime() - todayMs) / 86400000);

    if (daysOut < -90 || daysOut > 90) continue;

    const released = r.actual != null;
    const country = r.country ? `${r.country} ` : "";

    events.push({
      id: `FH-${i}`,
      date: dateOnly,
      time: timeStr,
      daysOut,
      name: `${country}${r.event}`,
      category: finnhubCategory(r.event),
      importance: FINNHUB_IMPACT_MAP[r.impact] ?? "LOW",
      period: finnhubPeriodLabel(dateOnly),
      prior: fmtFinnhubVal(r.prev, r.unit),
      consensus: fmtFinnhubVal(r.estimate, r.unit),
      actual: released ? fmtFinnhubVal(r.actual, r.unit) : null,
      ticker: "—",
      source: "FINNHUB",
    });
  }

  return events;
}

/* ── Route ──────────────────────────────────────────────────────────── */

/**
 * GET /api/econ/calendar
 *
 * Real data only — no simulated fallback. Merges:
 *   1. FRED — 12-month history of real observations with series tickers
 *   2. Finnhub — upcoming events with real consensus estimates
 *   3. FRED release dates — supplementary forward schedule
 *
 * Returns empty events array if no live sources are configured.
 */
export async function GET() {
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const hasFred = fredEnabled();
  const hasFinnhub = finnhubEnabled();

  if (!hasFred && !hasFinnhub) {
    return json({ source: "NONE", events: [], detail: "Set FRED_API_KEY and/or FINNHUB_API_KEY for real calendar data" });
  }

  const sources: string[] = [];
  const allEvents: EconEvent[] = [];
  const seen = new Set<string>();

  const addEvents = (events: EconEvent[]) => {
    for (const e of events) {
      const key = `${e.date}|${e.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allEvents.push(e);
    }
  };

  // Layer 1: FRED historical observations
  if (hasFred) {
    try {
      const startDate = new Date(todayMs - 400 * 86400000).toISOString().slice(0, 10);
      const seriesWithFred = EVENT_SERIES.filter((d) => d.fredId);
      const fredResults = await batchFred(seriesWithFred, startDate);
      const { events, fulfilled, rejected } = buildFredEvents(seriesWithFred, fredResults, todayMs);

      if (rejected > 0) {
        console.warn(`[calendar] FRED: ${rejected}/${seriesWithFred.length} series failed`);
      }

      if (events.length > 0) {
        addEvents(events);
        sources.push(`FRED(${events.length})`);
        console.log(`[calendar] FRED: ${events.length} observations from ${fulfilled}/${seriesWithFred.length} series`);
      }

      // Supplementary FRED release dates (forward schedule)
      try {
        const releases = await fredReleaseDates(40);
        const releaseEvents: EconEvent[] = releases
          .filter((r) => !seen.has(`${r.date}|${r.release_name.toLowerCase()}`))
          .slice(0, 30)
          .map((r, i) => {
            const daysOut = Math.round((new Date(r.date).getTime() - todayMs) / 86400000);
            return {
              id: `FRD-${r.release_id}-${i}`,
              date: r.date,
              time: "—",
              daysOut,
              name: r.release_name,
              category: "Release",
              importance: "MEDIUM" as const,
              period: finnhubPeriodLabel(r.date),
              prior: "",
              consensus: "",
              actual: daysOut < 0 ? "released" : null,
              ticker: `REL-${r.release_id}`,
              source: "FRED",
            };
          });
        addEvents(releaseEvents);
      } catch {
        // release dates are supplementary
      }
    } catch (err) {
      console.warn(`[calendar] FRED layer failed:`, err instanceof Error ? err.message : err);
    }
  }

  // Layer 2: Finnhub upcoming + recent events with real consensus
  if (hasFinnhub) {
    try {
      const from = new Date(todayMs - 30 * 86400000).toISOString().slice(0, 10);
      const to = new Date(todayMs + 90 * 86400000).toISOString().slice(0, 10);
      const raw = await finnhubEconCalendar(from, to);
      const finnhubEvents = buildFinnhubEvents(raw, todayMs);

      if (finnhubEvents.length > 0) {
        const upgrades: EconEvent[] = [];
        const fresh: EconEvent[] = [];

        for (const fe of finnhubEvents) {
          const key = `${fe.date}|${fe.name.toLowerCase()}`;
          if (seen.has(key)) {
            if (fe.consensus && fe.consensus !== fe.prior) {
              const idx = allEvents.findIndex(
                (e) => e.date === fe.date && e.name.toLowerCase() === fe.name.toLowerCase()
              );
              if (idx >= 0) {
                allEvents[idx].consensus = fe.consensus;
                if (fe.actual && !allEvents[idx].actual) {
                  allEvents[idx].actual = fe.actual;
                }
                upgrades.push(fe);
              }
            }
          } else {
            fresh.push(fe);
          }
        }

        addEvents(fresh);
        sources.push(`Finnhub(${fresh.length}+${upgrades.length}upg)`);
        console.log(`[calendar] Finnhub: ${fresh.length} new events, ${upgrades.length} consensus upgrades`);
      }
    } catch (err) {
      console.warn(`[calendar] Finnhub layer failed:`, err instanceof Error ? err.message : err);
    }
  }

  allEvents.sort((a, b) => a.daysOut - b.daysOut);
  const sourceLabel = sources.length > 0 ? sources.join(" + ") : "NONE";
  console.log(`[calendar] ${sourceLabel} → ${allEvents.length} total events`);
  return json({ source: sourceLabel, events: allEvents });
}
