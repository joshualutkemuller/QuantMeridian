
import { useState, useMemo } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { SourceBadge } from "@/components/econ/SourceBadge";
import { getCalendarSensitivity, getReleaseMoveSummaries, type CalendarSensitivityTag, type ReleaseMoveSummary } from "@/data/econEnhancements";
import { useEconCalendar } from "@/lib/useEcon";
import { useTick, useMounted } from "@/lib/hooks";
import type { EconEvent, EventImportance, EventSeriesHistory, EventHistoryPoint } from "@/data/econRates";
import { fmtSigned } from "@/lib/format";

const IMPORTANCES: (EventImportance | "ALL")[] = ["ALL", "HIGH", "MEDIUM", "LOW"];

type TimeRange = "ALL" | "12M" | "3M" | "WEEK" | "UPCOMING";
const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "12M", label: "Past 12M" },
  { value: "3M", label: "Past 3M" },
  { value: "WEEK", label: "This Week" },
  { value: "UPCOMING", label: "Upcoming" },
];

type ViewMode = "stream" | "table";

function importanceTone(imp: EventImportance): "down" | "blue" | "neutral" {
  if (imp === "HIGH") return "down";
  if (imp === "MEDIUM") return "blue";
  return "neutral";
}

function importanceDot(imp: EventImportance): string {
  if (imp === "HIGH") return "#FF8C00";
  if (imp === "MEDIUM") return "#3B9DFF";
  return "#5E5E66";
}

function sensitivityTone(tag: CalendarSensitivityTag): "up" | "down" | "amber" | "blue" | "violet" {
  if (tag === "Rates P&L") return "amber";
  if (tag === "Haircut Risk") return "down";
  if (tag === "Borrow Demand") return "up";
  if (tag === "Funding Liquidity") return "blue";
  return "violet";
}

function toNum(s: string | null): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return isFinite(v) ? v : null;
}

function surprise(actual: string | null, consensus: string): { label: string; tone: "up" | "down" | "neutral" } | null {
  const a = toNum(actual);
  const c = toNum(consensus);
  if (a == null || c == null) return null;
  if (Math.abs(a - c) < 1e-9) return { label: "IN-LINE", tone: "neutral" };
  if (a > c) return { label: "BEAT", tone: "up" };
  return { label: "MISS", tone: "down" };
}

function deriveSeriesHistory(events: EconEvent[]): EventSeriesHistory[] {
  const released = events.filter((e) => e.actual != null);
  const byName = new Map<string, EconEvent[]>();
  for (const e of released) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }

  const result: EventSeriesHistory[] = [];
  for (const [name, evts] of byName) {
    const points: EventHistoryPoint[] = [];
    for (const e of evts) {
      const a = toNum(e.actual);
      const c = toNum(e.consensus);
      const p = toNum(e.prior);
      if (a == null || c == null) continue;
      points.push({ date: e.date, period: e.period, actual: a, consensus: c, prior: p ?? a, surprise: a - c });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    if (points.length >= 2) {
      result.push({ name, category: evts[0].category, importance: evts[0].importance, unit: "", points });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function filterByTimeRange(events: EconEvent[], range: TimeRange): EconEvent[] {
  switch (range) {
    case "12M": return events.filter((e) => e.daysOut >= -365 && e.daysOut <= 30);
    case "3M": return events.filter((e) => e.daysOut >= -90 && e.daysOut <= 30);
    case "WEEK": return events.filter((e) => e.daysOut >= -7 && e.daysOut <= 7);
    case "UPCOMING": return events.filter((e) => e.daysOut >= 0);
    default: return events;
  }
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function SeriesTrendView({ series, onBack }: { series: EventSeriesHistory; onBack: () => void }) {
  const pts = series.points;
  const labels = pts.map((p) => p.period);
  const actuals = pts.map((p) => p.actual);
  const consensi = pts.map((p) => p.consensus);

  const beats = pts.filter((p) => p.surprise > 0).length;
  const misses = pts.filter((p) => p.surprise < 0).length;
  const avgSurprise = pts.reduce((s, p) => s + p.surprise, 0) / pts.length;
  const maxSurprise = Math.max(...pts.map((p) => Math.abs(p.surprise)));

  const surpriseBarData = pts.map((p) => ({
    label: p.period,
    value: p.surprise,
    color: p.surprise > 0 ? "#2ECC71" : p.surprise < 0 ? "#FF4444" : "#5E5E66",
  }));

  const trendCols: Column<(typeof pts)[0]>[] = [
    { key: "date", header: "Date", render: (r) => <span className="tnum text-term-text-dim">{r.date}</span>, sortVal: (r) => r.date },
    { key: "period", header: "Period", render: (r) => <span className="text-term-text">{r.period}</span>, sortVal: (r) => r.period },
    { key: "actual", header: "Actual", align: "right", render: (r) => <span className="tnum text-term-amber">{r.actual.toFixed(2)}</span>, sortVal: (r) => r.actual },
    { key: "consensus", header: "Cons.", align: "right", render: (r) => <span className="tnum text-term-text-dim">{r.consensus.toFixed(2)}</span>, sortVal: (r) => r.consensus },
    { key: "prior", header: "Prior", align: "right", render: (r) => <span className="tnum text-term-text-mute">{r.prior.toFixed(2)}</span>, sortVal: (r) => r.prior },
    {
      key: "surprise", header: "Surprise", align: "right",
      render: (r) => (
        <span className={`tnum ${r.surprise > 0 ? "text-term-up" : r.surprise < 0 ? "text-term-down" : "text-term-text-mute"}`}>
          {fmtSigned(r.surprise, 2)}
        </span>
      ),
      sortVal: (r) => r.surprise,
    },
    {
      key: "verdict", header: "", align: "center",
      render: (r) => {
        if (r.surprise > 0) return <Tag tone="up">BEAT</Tag>;
        if (r.surprise < 0) return <Tag tone="down">MISS</Tag>;
        return <Tag tone="neutral">IN-LINE</Tag>;
      },
      sortVal: (r) => r.surprise,
    },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border bg-term-panel px-3 py-1.5">
        <button className="term-btn" onClick={onBack}>← BACK</button>
        <span className="text-xs font-semibold text-term-amber">{series.name}</span>
        <Tag tone={series.importance === "HIGH" ? "down" : series.importance === "MEDIUM" ? "blue" : "neutral"}>{series.importance}</Tag>
        <Tag tone="neutral">{series.category}</Tag>
        {series.unit && <span className="text-3xs text-term-text-mute">{series.unit}</span>}
        <span className="ml-auto tnum text-3xs text-term-text-mute">{pts.length} prints</span>
      </div>

      <KpiStrip>
        <Stat label="Total Prints" value={pts.length} sub="historical" />
        <Stat label="Beats" value={beats} sub={`${((beats / pts.length) * 100).toFixed(0)}%`} tone="up" />
        <Stat label="Misses" value={misses} sub={`${((misses / pts.length) * 100).toFixed(0)}%`} tone="down" />
        <Stat label="Avg Surprise" value={avgSurprise.toFixed(3)} tone={avgSurprise > 0 ? "up" : avgSurprise < 0 ? "down" : undefined} />
        <Stat label="Max |Surprise|" value={maxSurprise.toFixed(3)} tone="amber" />
        <Stat label="Latest" value={pts[pts.length - 1]?.actual.toFixed(2) ?? "—"} sub={pts[pts.length - 1]?.period ?? ""} tone="amber" />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-2">
        <Panel title="Actual vs Consensus" code="TREND" accent>
          <div className="p-2">
            <LineChart
              height={220}
              series={[
                { name: "Actual", data: actuals, color: "#FF8C00", area: true },
                { name: "Consensus", data: consensi, color: "#3B9DFF", dashed: true },
              ]}
              labels={labels}
              yFmt={(n) => n.toFixed(2)}
            />
            <div className="mt-1 flex items-center justify-center gap-4 text-3xs text-term-text-mute">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 bg-[#FF8C00]" /> Actual</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 border border-[#3B9DFF] border-dashed" /> Consensus</span>
            </div>
          </div>
        </Panel>

        <Panel title="Surprise (Actual - Consensus)" code="SURP">
          <div className="p-2">
            <BarChart data={surpriseBarData} height={220} fmt={(n) => fmtSigned(n, 2)} />
          </div>
        </Panel>

        <Panel title="Historical Prints" code="HIST" className="xl:col-span-2">
          <DataGrid columns={trendCols} rows={pts} rowKey={(r) => r.date + r.period} maxHeight="340px" initialSort={{ key: "date", dir: "desc" }} zebra />
        </Panel>
      </div>
    </div>
  );
}

export default function EconomicCalendarPage() {
  const { data: events, source } = useEconCalendar();
  const moveSummaries = getReleaseMoveSummaries();
  const allSeriesHistory = useMemo(() => deriveSeriesHistory(events), [events]);
  const tick = useTick(2000);
  const mounted = useMounted();
  const todayStr = mounted ? new Date().toISOString().slice(0, 10) : null;
  const [impFilter, setImpFilter] = useState<EventImportance | "ALL">("ALL");
  const [catFilter, setCatFilter] = useState<string>("ALL");
  const [timeRange, setTimeRange] = useState<TimeRange>("ALL");
  const [trendSeries, setTrendSeries] = useState<string | null>(null);
  const [dateSort, setDateSort] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("stream");
  const [search, setSearch] = useState("");

  const activeTrend = trendSeries ? allSeriesHistory.find((s) => s.name === trendSeries) : null;

  if (activeTrend) {
    return <SeriesTrendView series={activeTrend} onBack={() => setTrendSeries(null)} />;
  }

  const categories = [...new Set(events.map((e) => e.category))].sort();

  const timeFiltered = filterByTimeRange(events, timeRange);
  const searchLower = search.toLowerCase();
  const searched = search
    ? timeFiltered.filter((e) =>
        e.name.toLowerCase().includes(searchLower) ||
        e.category.toLowerCase().includes(searchLower) ||
        (e.ticker?.toLowerCase().includes(searchLower) ?? false)
      )
    : timeFiltered;
  const sortDir = dateSort === "asc" ? 1 : -1;
  const sorted = [...searched].sort((a, b) => sortDir * (a.daysOut - b.daysOut) || a.time.localeCompare(b.time));

  const thisWeek = events.filter((e) => e.daysOut >= 0 && e.daysOut <= 7).length;
  const highCount = events.filter((e) => e.importance === "HIGH").length;
  const releasedCount = events.filter((e) => e.actual != null).length;
  const upcoming = sorted.filter((e) => e.daysOut >= 0 && e.actual == null);
  const upcomingCount = upcoming.length;
  const nextEvent = events.filter((e) => e.daysOut >= 0 && e.actual == null).sort((a, b) => a.daysOut - b.daysOut)[0] ?? null;
  const policyCount = events.filter((e) => e.category === "Policy").length;

  const filtered = sorted.filter(
    (e) => (impFilter === "ALL" || e.importance === impFilter) && (catFilter === "ALL" || e.category === catFilter)
  );

  const groups: { date: string; label: string; daysOut: number; rows: EconEvent[] }[] = [];
  for (const e of filtered) {
    let g = groups.find((x) => x.date === e.date);
    if (!g) {
      g = { date: e.date, label: formatDateLabel(e.date), daysOut: e.daysOut, rows: [] };
      groups.push(g);
    }
    g.rows.push(e);
  }

  const highImpactWeek = events.filter((e) => e.importance === "HIGH" && e.daysOut >= 0 && e.daysOut <= 7)
    .sort((a, b) => a.daysOut - b.daysOut);

  const catCounts = categories
    .map((c) => ({ label: c, value: events.filter((e) => e.category === c).length, color: "#FF8C00" }))
    .sort((a, b) => b.value - a.value);

  const tableCols: Column<EconEvent>[] = [
    {
      key: "date", header: "Date", width: "100px",
      render: (r) => {
        const isToday = r.daysOut === 0;
        return (
          <span className={`tnum ${isToday ? "font-semibold text-term-amber" : "text-term-text-dim"}`}>
            {r.date}
          </span>
        );
      },
      sortVal: (r) => r.date,
    },
    {
      key: "daysOut", header: "+/- Days", width: "72px", align: "right",
      render: (r) => (
        <span className={`tnum text-2xs ${r.daysOut === 0 ? "font-semibold text-term-amber" : r.daysOut < 0 ? "text-term-text-mute" : "text-term-text-dim"}`}>
          {r.daysOut < 0 ? `${r.daysOut}d` : r.daysOut === 0 ? "TODAY" : `+${r.daysOut}d`}
        </span>
      ),
      sortVal: (r) => r.daysOut,
    },
    { key: "time", header: "Time", width: "52px", render: (r) => <span className="tnum text-term-text-mute">{r.time}</span>, sortVal: (r) => r.time },
    {
      key: "name", header: "Event",
      render: (r) => (
        <button className="text-left text-xs font-semibold text-term-text hover:text-term-amber hover:underline" onClick={() => setTrendSeries(r.name)}>
          {r.name}
        </button>
      ),
      sortVal: (r) => r.name,
    },
    {
      key: "ticker", header: "Ticker", width: "88px",
      render: (r) => <span className="tnum text-2xs text-term-text-dim">{r.ticker ?? "—"}</span>,
      sortVal: (r) => r.ticker ?? "",
    },
    {
      key: "importance", header: "Imp.", width: "64px", align: "center",
      render: (r) => <Tag tone={importanceTone(r.importance)}>{r.importance}</Tag>,
      sortVal: (r) => r.importance === "HIGH" ? 0 : r.importance === "MEDIUM" ? 1 : 2,
    },
    { key: "category", header: "Cat.", width: "80px", render: (r) => <Tag tone="neutral">{r.category}</Tag>, sortVal: (r) => r.category },
    { key: "period", header: "Period", width: "84px", render: (r) => <span className="text-2xs text-term-text">{r.period}</span>, sortVal: (r) => r.period },
    {
      key: "prior", header: "Prior", width: "72px", align: "right",
      render: (r) => <span className="tnum text-term-text-dim">{r.prior}</span>,
      sortVal: (r) => toNum(r.prior) ?? 0,
    },
    {
      key: "consensus", header: "Cons.", width: "72px", align: "right",
      render: (r) => <span className="tnum text-term-text-dim">{r.consensus}</span>,
      sortVal: (r) => toNum(r.consensus) ?? 0,
    },
    {
      key: "actual", header: "Actual", width: "72px", align: "right",
      render: (r) => (
        <span className={`tnum ${r.actual != null ? "font-semibold text-term-amber" : "text-term-text-mute"}`}>
          {r.actual ?? "—"}
        </span>
      ),
      sortVal: (r) => toNum(r.actual) ?? -Infinity,
    },
    {
      key: "surprise", header: "Result", width: "72px", align: "center",
      render: (r) => {
        const sup = surprise(r.actual, r.consensus);
        if (!sup) return <span className="text-term-text-mute">—</span>;
        return <Tag tone={sup.tone}>{sup.label}</Tag>;
      },
      sortVal: (r) => {
        const a = toNum(r.actual);
        const c = toNum(r.consensus);
        if (a == null || c == null) return -Infinity;
        return a - c;
      },
    },
    {
      key: "source", header: "Src", width: "64px", align: "center",
      render: (r) => {
        const s = r.source ?? "—";
        const tone = s === "FRED" ? "up" : s === "FINNHUB" ? "blue" : "neutral";
        return <Tag tone={tone as "up" | "blue" | "neutral"}>{s}</Tag>;
      },
      sortVal: (r) => r.source ?? "",
    },
  ];

  const moveCols: Column<ReleaseMoveSummary>[] = [
    { key: "release", header: "Release", render: (r) => <span className="font-semibold text-term-text">{r.release}</span>, sortVal: (r) => r.release },
    { key: "factor", header: "Factor", render: (r) => <span className="text-term-amber">{r.factor}</span>, sortVal: (r) => r.factor },
    { key: "pre", header: "Pre", align: "right", render: (r) => <span className="text-term-text-dim">{fmtSigned(r.preMoveBps, 0)}</span>, sortVal: (r) => r.preMoveBps },
    { key: "post", header: "Post", align: "right", render: (r) => <span className={r.postMoveBps >= 0 ? "text-term-up" : "text-term-down"}>{fmtSigned(r.postMoveBps, 0)}</span>, sortVal: (r) => r.postMoveBps },
    { key: "impact", header: "Impact", align: "center", render: (r) => <Tag tone={sensitivityTone(r.deskImpact)}>{r.deskImpact}</Tag>, sortVal: (r) => r.deskImpact },
  ];

  const seriesCols: Column<EventSeriesHistory>[] = [
    {
      key: "name", header: "Series",
      render: (r) => (
        <button className="text-left text-term-amber underline decoration-term-amber/40 hover:decoration-term-amber" onClick={() => setTrendSeries(r.name)}>
          {r.name}
        </button>
      ),
      sortVal: (r) => r.name,
    },
    { key: "category", header: "Cat.", render: (r) => <Tag tone="neutral">{r.category}</Tag>, sortVal: (r) => r.category },
    { key: "importance", header: "Imp.", align: "center", render: (r) => <Tag tone={importanceTone(r.importance)}>{r.importance}</Tag>, sortVal: (r) => r.importance },
    { key: "prints", header: "Prints", align: "right", render: (r) => <span className="tnum text-term-text">{r.points.length}</span>, sortVal: (r) => r.points.length },
    {
      key: "beats", header: "Beat%", align: "right",
      render: (r) => {
        const b = r.points.filter((p) => p.surprise > 0).length;
        return <span className="tnum text-term-up">{((b / r.points.length) * 100).toFixed(0)}%</span>;
      },
      sortVal: (r) => r.points.filter((p) => p.surprise > 0).length / r.points.length,
    },
    {
      key: "avgSurp", header: "Avg Surp", align: "right",
      render: (r) => {
        const avg = r.points.reduce((s, p) => s + p.surprise, 0) / r.points.length;
        return <span className={`tnum ${avg > 0 ? "text-term-up" : avg < 0 ? "text-term-down" : "text-term-text-mute"}`}>{fmtSigned(avg, 3)}</span>;
      },
      sortVal: (r) => r.points.reduce((s, p) => s + p.surprise, 0) / r.points.length,
    },
    {
      key: "latest", header: "Latest", align: "right",
      render: (r) => {
        const last = r.points[r.points.length - 1];
        return <span className="tnum text-term-amber">{last?.actual.toFixed(2) ?? "—"}</span>;
      },
      sortVal: (r) => r.points[r.points.length - 1]?.actual ?? 0,
    },
  ];

  const streamToolbar = (
    <>
      <span className="text-3xs uppercase tracking-wider text-term-text-mute">Sort</span>
      <button
        className={`term-btn ${dateSort === "asc" ? "term-btn-active" : ""}`}
        onClick={() => setDateSort("asc")}
        title="Oldest first"
      >
        Date ↑
      </button>
      <button
        className={`term-btn ${dateSort === "desc" ? "term-btn-active" : ""}`}
        onClick={() => setDateSort("desc")}
        title="Newest first"
      >
        Date ↓
      </button>
      <span className="mx-1 text-term-border">|</span>
      <span className="text-3xs uppercase tracking-wider text-term-text-mute">View</span>
      <button
        className={`term-btn ${viewMode === "stream" ? "term-btn-active" : ""}`}
        onClick={() => setViewMode("stream")}
      >
        Stream
      </button>
      <button
        className={`term-btn ${viewMode === "table" ? "term-btn-active" : ""}`}
        onClick={() => setViewMode("table")}
      >
        Table
      </button>
      <div className="ml-auto flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events..."
          className="h-6 w-44 rounded-sm border border-term-border bg-term-panel px-2 text-2xs text-term-text placeholder:text-term-text-mute focus:border-term-amber focus:outline-none"
        />
        <span className="tnum text-3xs text-term-text-mute">{filtered.length} events</span>
      </div>
    </>
  );

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="CAL" title="Economic Calendar" desc="Scheduled releases & historical prints" asOf={todayStr} right={<SourceBadge source={source} />} />

      <KpiStrip>
        <Stat label="Events This Week" value={thisWeek} sub="next 7 days" tone="amber" />
        <Stat label="High Importance" value={highCount} sub="HIGH tier" tone="down" />
        <Stat label="Released" value={releasedCount} sub="actual reported" tone="up" />
        <Stat label="Upcoming" value={upcomingCount} sub="awaiting print" />
        <Stat label="Next Event" value={<span className="text-sm">{nextEvent ? nextEvent.name : "—"}</span>} sub={nextEvent ? `${nextEvent.date} ${nextEvent.time}` : "—"} tone="amber" />
        <Stat label="Policy Events" value={policyCount} sub="central banks" tone="amber" />
      </KpiStrip>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-term-border bg-term-panel px-3 py-1.5">
        <span className="mr-1 text-3xs uppercase tracking-wider text-term-text-mute">Range</span>
        {TIME_RANGES.map((tr) => (
          <button key={tr.value} className={`term-btn ${timeRange === tr.value ? "term-btn-active" : ""}`} onClick={() => setTimeRange(tr.value)}>
            {tr.label}
          </button>
        ))}
        <span className="mx-1 text-term-border">|</span>
        <span className="mr-1 text-3xs uppercase tracking-wider text-term-text-mute">Importance</span>
        {IMPORTANCES.map((i) => (
          <button key={i} className={`term-btn ${impFilter === i ? "term-btn-active" : ""}`} onClick={() => setImpFilter(i)}>
            {i === "ALL" ? "All" : i}
          </button>
        ))}
        <span className="mx-1 text-term-border">|</span>
        <span className="mr-1 text-3xs uppercase tracking-wider text-term-text-mute">Category</span>
        <button className={`term-btn ${catFilter === "ALL" ? "term-btn-active" : ""}`} onClick={() => setCatFilter("ALL")}>
          All
        </button>
        {categories.map((c) => (
          <button key={c} className={`term-btn ${catFilter === c ? "term-btn-active" : ""}`} onClick={() => setCatFilter(c)}>
            {c}
          </button>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        {/* Main calendar */}
        <div className="xl:col-span-2">
          <Panel title="Release Stream" code="ECO" accent toolbar={streamToolbar}>
            {viewMode === "table" ? (
              <DataGrid
                columns={tableCols}
                rows={filtered}
                rowKey={(r) => r.id}
                maxHeight="680px"
                initialSort={{ key: "date", dir: dateSort }}
                zebra
                onRowClick={(r) => setTrendSeries(r.name)}
              />
            ) : (
              <div className="divide-y divide-term-border" style={{ maxHeight: 680, overflowY: "auto" }}>
                {groups.map((g) => {
                  const isToday = g.daysOut === 0;
                  const isPast = g.daysOut < 0;
                  return (
                    <div key={g.date}>
                      <div className={`sticky top-0 z-[5] flex items-center justify-between px-3 py-1.5 ${isToday ? "bg-term-amber-soft" : "bg-term-panel-2"}`}>
                        <div className="flex items-center gap-2">
                          <span className={`text-2xs font-bold uppercase tracking-wide ${isToday ? "text-term-amber" : isPast ? "text-term-text-mute" : "text-term-text"}`}>
                            {g.label}
                          </span>
                          {isToday && <Tag tone="amber">TODAY</Tag>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="tnum text-3xs text-term-text-mute">
                            {g.daysOut < 0 ? `${Math.abs(g.daysOut)}d ago` : g.daysOut === 0 ? "today" : `in ${g.daysOut}d`}
                          </span>
                          <span className="rounded-sm bg-term-panel-3 px-1.5 py-px text-3xs font-semibold text-term-text-dim">
                            {g.rows.length} {g.rows.length === 1 ? "event" : "events"}
                          </span>
                        </div>
                      </div>
                      <div className="divide-y divide-term-border-soft">
                        {g.rows.map((e) => {
                          const released = e.actual != null;
                          const isNext = nextEvent != null && e.id === nextEvent.id;
                          const sup = surprise(e.actual, e.consensus);
                          const sensitivities = getCalendarSensitivity(e.name, e.category);
                          return (
                            <div
                              key={e.id}
                              className={`grid grid-cols-[56px_1fr_auto] items-start gap-2 px-3 py-2 transition-colors hover:bg-term-panel-2 ${released ? "opacity-75" : ""} ${isToday ? "bg-term-amber/5" : ""} ${isNext ? "border-l-2 border-l-term-amber" : ""}`}
                            >
                              {/* Time + importance dot */}
                              <div className="flex items-center gap-1.5 pt-0.5">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: importanceDot(e.importance) }} />
                                <span className="tnum text-2xs text-term-text-mute">{e.time}</span>
                              </div>

                              {/* Name + tags + values */}
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    className="text-xs font-semibold text-term-text hover:text-term-amber hover:underline"
                                    onClick={() => setTrendSeries(e.name)}
                                  >
                                    {e.name}
                                  </button>
                                  {isNext && (
                                    <span className="inline-flex items-center gap-1 rounded-sm border border-term-amber/40 bg-term-amber/10 px-1.5 py-px text-3xs font-bold text-term-amber">
                                      <span className={`h-1.5 w-1.5 rounded-full bg-term-amber ${tick % 2 === 0 ? "opacity-100" : "opacity-30"}`} />
                                      NEXT
                                    </span>
                                  )}
                                  {e.ticker && e.ticker !== "—" && (
                                    <span className="tnum text-3xs text-term-text-mute">{e.ticker}</span>
                                  )}
                                  <Tag tone={importanceTone(e.importance)}>{e.importance}</Tag>
                                  <Tag tone="neutral">{e.category}</Tag>
                                  <span className="text-2xs font-medium text-term-text-dim">{e.period}</span>
                                  {e.source && (
                                    <Tag tone={e.source === "FRED" ? "up" : e.source === "FINNHUB" ? "blue" : "neutral"}>{e.source}</Tag>
                                  )}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {sensitivities.map((tag) => (
                                    <Tag key={tag} tone={sensitivityTone(tag)}>{tag}</Tag>
                                  ))}
                                </div>
                              </div>

                              {/* Values column */}
                              <div className="flex shrink-0 items-start gap-4 text-2xs">
                                <div className="text-right">
                                  <div className="text-3xs uppercase text-term-text-mute">Prior</div>
                                  <div className="tnum text-term-text-dim">{e.prior || "—"}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-3xs uppercase text-term-text-mute">Cons.</div>
                                  <div className="tnum text-term-text-dim">{e.consensus || "—"}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-3xs uppercase text-term-text-mute">Actual</div>
                                  <div className={`tnum ${released ? "font-semibold text-term-amber" : "text-term-text-mute"}`}>
                                    {e.actual ?? "—"}
                                  </div>
                                </div>
                                {sup ? (
                                  <div className="flex items-end pt-2.5">
                                    <Tag tone={sup.tone}>{sup.label}</Tag>
                                  </div>
                                ) : (
                                  <div className="w-[52px]" />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {groups.length === 0 && (
                  <div className="px-3 py-8 text-center">
                    {events.length === 0 ? (
                      <div className="space-y-1">
                        <div className="text-xs text-term-text-mute">No Gold DB calendar rows available</div>
                        <div className="text-3xs text-term-text-mute">Refresh the FRED/Eco pipeline or check MACRO_DB_URL.</div>
                      </div>
                    ) : (
                      <div className="text-xs text-term-text-mute">No events match the current filters.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>

        {/* Side panel */}
        <div className="flex flex-col gap-2">
          <Panel title="This Week's High-Impact" code="HOT" accent right={<Tag tone="down">{highImpactWeek.length}</Tag>}>
            <div className="divide-y divide-term-border-soft">
              {highImpactWeek.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-2.5 py-2 hover:bg-term-panel-2">
                  <div className="min-w-0">
                    <button className="truncate text-2xs font-semibold text-term-text hover:text-term-amber" onClick={() => setTrendSeries(e.name)}>
                      {e.name}
                    </button>
                    <div className="mt-0.5 flex items-center gap-1">
                      <Tag tone="neutral">{e.category}</Tag>
                      <span className="text-3xs text-term-text-mute">{e.period}</span>
                    </div>
                  </div>
                  <div className="ml-2 shrink-0 text-right">
                    <div className="tnum text-2xs font-semibold text-term-amber">{e.date}</div>
                    <div className="tnum text-3xs text-term-text-mute">{e.time} · +{e.daysOut}d</div>
                  </div>
                </div>
              ))}
              {highImpactWeek.length === 0 && (
                <div className="px-3 py-4 text-center text-2xs text-term-text-mute">No high-impact events in the next 7 days.</div>
              )}
            </div>
          </Panel>

          <Panel title="Series History" code="SER" right={<Tag tone="amber">{allSeriesHistory.length} series</Tag>}>
            <DataGrid columns={seriesCols} rows={allSeriesHistory} rowKey={(r) => r.name} maxHeight="300px" initialSort={{ key: "name", dir: "asc" }} zebra />
          </Panel>

          <Panel title="Releases by Category" code="CAT">
            <div className="p-2">
              <BarChart horizontal data={catCounts} fmt={(n) => `${n.toFixed(0)}`} />
            </div>
          </Panel>

          <Panel title="Pre/Post Release Factor Moves" code="MOVE" accent>
            <DataGrid columns={moveCols} rows={moveSummaries} rowKey={(r) => `${r.release}-${r.factor}`} maxHeight="260px" initialSort={{ key: "post", dir: "desc" }} zebra />
          </Panel>
        </div>
      </div>
    </div>
  );
}
