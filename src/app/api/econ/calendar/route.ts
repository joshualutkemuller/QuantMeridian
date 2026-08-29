import { EVENT_SERIES, type EconEvent } from "@/data/econRates";
import { goldEnabled, goldParam, goldTable, goldStore } from "@/lib/server/goldStore";
import { json } from "@/lib/server/http";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface GoldReleaseCalendarRow {
  release_id: number;
  release_name: string;
  release_date: string;
  importance: EconEvent["importance"] | string | null;
  econ_category: string | null;
  representative_series_id: string | null;
  is_future: number | boolean | null;
  fetched_at: string | null;
}

const EVENT_BY_SERIES = new Map(EVENT_SERIES.filter((event) => event.fredId).map((event) => [event.fredId, event]));

function daysFromToday(dateOnly: string, todayMs: number): number {
  return Math.round((new Date(`${dateOnly}T00:00:00Z`).getTime() - todayMs) / 86400000);
}

function periodLabel(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateOnly;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function titleCaseCategory(category: string | null): string {
  if (!category) return "Release";
  return category
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function importance(value: string | null): EconEvent["importance"] {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW") return value;
  return "MEDIUM";
}

function eventName(row: GoldReleaseCalendarRow): string {
  const representative = row.representative_series_id ? EVENT_BY_SERIES.get(row.representative_series_id) : null;
  return representative?.name ?? row.release_name;
}

function eventTime(row: GoldReleaseCalendarRow): string {
  const representative = row.representative_series_id ? EVENT_BY_SERIES.get(row.representative_series_id) : null;
  return representative?.time ?? "-";
}

function toEvent(row: GoldReleaseCalendarRow, index: number, todayMs: number): EconEvent {
  const daysOut = daysFromToday(row.release_date, todayMs);
  return {
    id: `GRC-${row.release_id}-${row.release_date}-${index}`,
    date: row.release_date,
    time: eventTime(row),
    daysOut,
    name: eventName(row),
    category: titleCaseCategory(row.econ_category),
    importance: importance(row.importance),
    period: periodLabel(row.release_date),
    prior: "",
    consensus: "",
    actual: daysOut < 0 ? "released" : null,
    ticker: row.representative_series_id ?? `REL-${row.release_id}`,
    source: "DB",
  };
}

/**
 * GET /api/econ/calendar
 *
 * Gold DB only. Reads the curated forward economic-release schedule from
 * gold.release_calendar, produced by the FRED/Eco pipeline from FRED
 * releases/dates plus config/release_calendar.yml metadata.
 */
export async function GET() {
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  if (!goldEnabled()) {
    return json({ source: "ERR", events: [], error: "MACRO_DB_URL not configured." });
  }

  try {
    const start = new Date(todayMs - 30 * 86400000).toISOString().slice(0, 10);
    const end = new Date(todayMs + 120 * 86400000).toISOString().slice(0, 10);
    const table = goldTable("release_calendar");
    const rows = await goldStore().raw<GoldReleaseCalendarRow>(
      `SELECT release_id, release_name, release_date, importance, econ_category, representative_series_id, is_future, fetched_at
       FROM ${table}
       WHERE release_date >= ${goldParam(1)} AND release_date <= ${goldParam(2)}
       ORDER BY release_date ASC, release_id ASC`,
      [start, end]
    );
    const events = rows.map((row, index) => toEvent(row, index, todayMs));
    return json({
      source: events.length ? "DB" : "ERR",
      events,
      fetchedAt: rows[0]?.fetched_at ?? null,
      error: events.length ? undefined : "No Gold DB release calendar rows found.",
    });
  } catch (err) {
    console.warn("[calendar] Gold DB read failed:", (err as Error).message);
    return json({ source: "ERR", events: [], error: (err as Error).message });
  }
}
