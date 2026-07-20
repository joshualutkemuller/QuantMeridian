
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { fmtNum, fmtSignedPct } from "@/lib/format";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { useSimMode } from "@/lib/simMode";

// ── Types ──────────────────────────────────────────────────────────────

interface ViewDef {
  view_id: string;
  display_name: string;
  category: string;
  description: string;
  default_series: string[];
  default_tiles: string[];
  configurable_fields: string[];
  default_forward_windows: string[];
}

interface PresetDef {
  preset_id: string;
  name: string;
  description: string;
  tags: string[];
}

interface CatalogEntry {
  series_id: string;
  ticker: string;
  display_name: string;
  asset_class: string;
  source: string;
}

interface TilePayload {
  tile_id: string;
  chart_type: string;
  title: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface AnalysisResult {
  view_id: string;
  tiles: TilePayload[];
  series_used: string[];
  warnings: string[];
  narrative: string;
  metadata: Record<string, unknown>;
  sample_size: number;
}

type Source = "LIVE" | "DB" | "FRED" | "SNAPSHOT" | "ECON" | "SIM" | "ERR" | "LOADING";

// ── Helpers ────────────────────────────────────────────────────────────

function pnlClass(v: number): string {
  if (v > 0) return "text-term-up";
  if (v < 0) return "text-term-down";
  return "text-term-flat";
}

const CATEGORIES = ["Event Studies", "Risk", "Returns", "Patterns", "Multi-Asset", "Rates", "Credit", "Inflation"] as const;

const CATEGORY_TONE: Record<string, "amber" | "up" | "down" | "neutral" | "blue" | "violet"> = {
  "Event Studies": "amber",
  "Risk": "down",
  "Returns": "up",
  "Patterns": "violet",
  "Multi-Asset": "blue",
  "Rates": "neutral",
  "Credit": "down",
  "Inflation": "amber",
};

const WINDOW_OPTIONS = ["1W", "1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y"];

// ── Data Fetching ──────────────────────────────────────────────────────

function useLensData<T>(action: string, id?: string) {
  const { snapshotFallbackEnabled } = useSimMode();
  const [data, setData] = useState<T | null>(null);
  const [source, setSource] = useState<Source>("LOADING");
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let alive = true;
    setSource("LOADING");
    const params = new URLSearchParams({ action });
    if (id) params.set("id", id);
    if (snapshotFallbackEnabled) params.set("snapshot", "1");
    fetch(`/api/market-lens?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        setData(json.data as T);
        setSource(["LIVE", "DB", "FRED", "SNAPSHOT", "ECON", "SIM", "ERR"].includes(json.source) ? json.source : "SNAPSHOT");
        setFallback(Boolean(json.fallback));
      })
      .catch(() => {
        if (!alive) return;
        setSource(snapshotFallbackEnabled ? "SNAPSHOT" : "ERR");
        setFallback(true); // request failed entirely — embedded data in use
      });
    return () => { alive = false; };
  }, [action, id, snapshotFallbackEnabled]);

  return { data, source, fallback };
}

// ── Sub-components ─────────────────────────────────────────────────────

function ViewSelector({
  views,
  selectedId,
  onSelect,
  categoryFilter,
  onCategoryChange,
}: {
  views: ViewDef[];
  selectedId: string;
  onSelect: (id: string) => void;
  categoryFilter: string;
  onCategoryChange: (cat: string) => void;
}) {
  const filtered = categoryFilter
    ? views.filter((v) => v.category === categoryFilter)
    : views;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1 px-2 py-1">
        <button
          onClick={() => onCategoryChange("")}
          className={clsx("term-btn text-3xs", !categoryFilter && "term-btn-active")}
        >
          ALL
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => onCategoryChange(cat)}
            className={clsx("term-btn text-3xs", categoryFilter === cat && "term-btn-active")}
          >
            {cat.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-1 p-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((v) => (
          <button
            key={v.view_id}
            onClick={() => onSelect(v.view_id)}
            className={clsx(
              "flex flex-col gap-0.5 rounded-sm border p-2 text-left transition-colors",
              selectedId === v.view_id
                ? "border-term-amber bg-term-amber/10"
                : "border-term-border bg-term-panel-2 hover:border-term-text-mute"
            )}
          >
            <div className="flex items-center gap-1.5">
              <Tag tone={CATEGORY_TONE[v.category] ?? "neutral"}>{v.category}</Tag>
              <span className="text-2xs font-semibold text-term-text">{v.display_name}</span>
            </div>
            <p className="text-3xs text-term-text-mute line-clamp-2">{v.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function SeriesSelector({
  catalog,
  selected,
  onToggle,
}: {
  catalog: CatalogEntry[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = search
    ? catalog.filter(
        (c) =>
          c.series_id.toUpperCase().includes(search.toUpperCase()) ||
          c.display_name.toUpperCase().includes(search.toUpperCase())
      )
    : catalog;

  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        placeholder="Search series…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-6 border border-term-border bg-term-panel-2 px-2 text-2xs text-term-text outline-none placeholder:text-term-text-mute"
      />
      <div className="max-h-40 overflow-auto">
        {filtered.map((c) => (
          <label
            key={c.series_id}
            className="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 text-2xs hover:bg-term-panel-3"
          >
            <input
              type="checkbox"
              checked={selected.has(c.series_id)}
              onChange={() => onToggle(c.series_id)}
              className="accent-term-amber"
            />
            <span className="w-14 font-semibold text-term-text">{c.series_id}</span>
            <span className="truncate text-term-text-mute">{c.display_name}</span>
            <Tag tone="neutral">{c.asset_class}</Tag>
          </label>
        ))}
      </div>
    </div>
  );
}

function WindowSelector({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (w: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {WINDOW_OPTIONS.map((w) => (
        <button
          key={w}
          onClick={() => onToggle(w)}
          className={clsx(
            "rounded-sm border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide transition-colors",
            selected.has(w)
              ? "border-term-amber bg-term-amber text-black"
              : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text"
          )}
        >
          {w}
        </button>
      ))}
    </div>
  );
}

function TileRenderer({ tile }: { tile: TilePayload }) {
  const { chart_type, title, payload } = tile;

  if (chart_type === "table") return <TableTile title={title} payload={payload} />;
  if (chart_type === "boxplot") return <BoxplotTile title={title} payload={payload} />;
  if (chart_type === "bar") return <BarTile title={title} payload={payload} />;
  if (chart_type === "heatmap") return <HeatmapTile title={title} payload={payload} />;
  if (chart_type === "line") return <LineTile title={title} payload={payload} />;
  if (chart_type === "gauge") return <GaugeTile title={title} payload={payload} />;
  if (chart_type === "text") return <TextTile title={title} payload={payload} />;

  return (
    <Panel title={title} code={chart_type.toUpperCase()}>
      <div className="p-3 text-2xs text-term-text-mute">
        Chart type <span className="text-term-amber">{chart_type}</span> — {Object.keys(payload).length} data keys
        <pre className="mt-2 max-h-40 overflow-auto rounded border border-term-border bg-term-panel-2 p-2 text-3xs">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>
    </Panel>
  );
}

function TableTile({ title, payload }: { title: string; payload: Record<string, unknown> }) {
  const events = (payload.events ?? payload.returns ?? []) as Record<string, unknown>[];
  const windows = (payload.windows ?? []) as string[];

  if (typeof events === "object" && !Array.isArray(events) && windows.length === 0) {
    const entries = Object.entries(events as Record<string, Record<string, unknown>>);
    return (
      <Panel title={title} code="TABLE">
        <div className="overflow-auto">
          <table className="w-full border-collapse text-2xs">
            <thead>
              <tr className="bg-term-panel-2">
                <th className="border border-term-border px-2 py-1 text-left text-term-text-mute">Series</th>
                {Object.keys(entries[0]?.[1] ?? {}).map((k) => (
                  <th key={k} className="border border-term-border px-2 py-1 text-right text-term-text-mute">{k}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tnum">
              {entries.map(([sid, vals]) => (
                <tr key={sid}>
                  <td className="border border-term-border px-2 py-1 font-semibold text-term-text">{sid}</td>
                  {Object.values(vals as Record<string, unknown>).map((v, i) => (
                    <td key={i} className={clsx("border border-term-border px-2 py-1 text-right", typeof v === "number" ? pnlClass(v) : "text-term-text-mute")}>
                      {typeof v === "number" ? fmtSignedPct(v, 2) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={title} code="TABLE">
      <div className="overflow-auto max-h-72">
        <table className="w-full border-collapse text-2xs">
          <thead>
            <tr className="bg-term-panel-2">
              {events.length > 0 && Object.keys(events[0]).map((k) => (
                <th key={k} className="border border-term-border px-2 py-1 text-left text-term-text-mute">{k}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tnum">
            {events.slice(0, 50).map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? "" : "bg-term-panel-2"}>
                {Object.values(row).map((v, j) => (
                  <td key={j} className="border border-term-border px-2 py-1 text-term-text-dim">
                    {typeof v === "number" ? fmtNum(v, 2) : String(v ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {events.length > 50 && (
          <div className="border-t border-term-border px-2 py-1 text-3xs text-term-text-mute">Showing 50 of {events.length} rows</div>
        )}
      </div>
    </Panel>
  );
}

function BoxplotTile({ title, payload }: { title: string; payload: Record<string, unknown> }) {
  const statistics = (payload.statistics ?? {}) as Record<string, Record<string, number | null>>;

  return (
    <Panel title={title} code="DIST">
      <div className="grid gap-px bg-term-border" style={{ gridTemplateColumns: `repeat(${Object.keys(statistics).length}, 1fr)` }}>
        {Object.entries(statistics).map(([label, stats]) => {
          const mean = stats.mean;
          const median = stats.median;
          const pctPos = stats.pct_positive;
          const count = stats.count;
          return (
            <div key={label} className="bg-term-panel p-2">
              <div className="mb-1 text-3xs font-semibold uppercase tracking-wider text-term-amber">{label}</div>
              <div className="space-y-0.5 text-2xs">
                <div className="flex justify-between">
                  <span className="text-term-text-mute">Median</span>
                  <span className={median !== null && median !== undefined ? pnlClass(median) : "text-term-text-mute"}>
                    {median !== null && median !== undefined ? fmtSignedPct(median * 100, 2) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-term-text-mute">Mean</span>
                  <span className={mean !== null && mean !== undefined ? pnlClass(mean) : "text-term-text-mute"}>
                    {mean !== null && mean !== undefined ? fmtSignedPct(mean * 100, 2) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-term-text-mute">% Positive</span>
                  <span className="text-term-text">{pctPos !== null && pctPos !== undefined ? `${(pctPos * 100).toFixed(0)}%` : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-term-text-mute">Count</span>
                  <span className="text-term-text-dim">{count ?? "—"}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function BarTile({ title, payload }: { title: string; payload: Record<string, unknown> }) {
  const data = (payload.returns ?? payload.may_oct ?? payload) as Record<string, unknown>;

  if (typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data).filter(([, v]) => typeof v === "object" && v !== null);
    if (entries.length === 0) {
      return (
        <Panel title={title} code="BAR">
          <div className="p-3 text-2xs text-term-text-mute">No data available</div>
        </Panel>
      );
    }

    return (
      <Panel title={title} code="BAR">
        <div className="space-y-1 p-2">
          {entries.map(([label, stats]) => {
            const s = stats as Record<string, number | null>;
            const mean = s.mean ?? s.pct_positive ?? 0;
            const maxAbs = 0.3;
            const width = Math.min(Math.abs(mean) / maxAbs, 1) * 100;
            const isPos = mean >= 0;
            return (
              <div key={label} className="grid grid-cols-[100px_1fr_60px] items-center gap-2 text-2xs">
                <span className="truncate font-semibold text-term-text-dim">{label}</span>
                <div className="relative h-4 bg-term-panel-3">
                  <div
                    className={clsx("absolute top-0 h-full", isPos ? "bg-term-up/60 left-1/2" : "bg-term-down/60 right-1/2")}
                    style={{ width: `${width / 2}%` }}
                  />
                </div>
                <span className={clsx("tnum text-right", pnlClass(mean))}>
                  {typeof mean === "number" ? fmtSignedPct(mean * 100, 1) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={title} code="BAR">
      <div className="p-3 text-2xs text-term-text-mute">
        <pre className="max-h-40 overflow-auto text-3xs">{JSON.stringify(payload, null, 2)}</pre>
      </div>
    </Panel>
  );
}

function HeatmapTile({ title, payload }: { title: string; payload: Record<string, unknown> }) {
  const months = (payload.months ?? payload.correlations ?? {}) as Record<string, Record<string, number | null>>;
  const entries = Object.entries(months);

  return (
    <Panel title={title} code="HEAT">
      <div className="grid grid-cols-3 gap-px bg-term-border p-0 sm:grid-cols-4 lg:grid-cols-6">
        {entries.map(([label, stats]) => {
          const mean = (stats as Record<string, number | null>).mean ?? (stats as Record<string, number | null>).latest ?? null;
          const bg = mean !== null
            ? mean >= 0
              ? `rgba(46,204,113,${Math.min(0.6, Math.abs(mean) * 8).toFixed(2)})`
              : `rgba(255,59,59,${Math.min(0.6, Math.abs(mean) * 8).toFixed(2)})`
            : "rgba(255,255,255,0.02)";
          return (
            <div key={label} className="bg-term-panel p-2 text-center" style={{ background: bg }}>
              <div className="text-3xs font-semibold uppercase tracking-wider text-term-text-dim">{label}</div>
              <div className={clsx("tnum text-sm font-semibold", mean !== null ? pnlClass(mean) : "text-term-text-mute")}>
                {mean !== null ? fmtSignedPct(mean * 100, 1) : "—"}
              </div>
              {(stats as Record<string, number | null>).pct_positive !== null && (stats as Record<string, number | null>).pct_positive !== undefined && (
                <div className="text-3xs text-term-text-mute">
                  {((stats as Record<string, number | null>).pct_positive! * 100).toFixed(0)}% pos
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function LineTile({ title, payload }: { title: string; payload: Record<string, unknown> }) {
  const values = (payload.values ?? payload.drawdowns ?? []) as (number | null)[];
  const maxVal = Math.max(...values.filter((v): v is number => v !== null).map(Math.abs), 1);

  return (
    <Panel title={title} code="LINE">
      <div className="flex h-28 items-end gap-px p-2">
        {values.slice(-120).map((v, i) => {
          const h = v !== null ? (Math.abs(v) / maxVal) * 100 : 0;
          const isNeg = v !== null && v < 0;
          return (
            <div
              key={i}
              className={clsx("flex-1 min-w-0", isNeg ? "bg-term-down/60" : "bg-term-up/40")}
              style={{ height: `${h}%` }}
              title={v !== null ? `${v.toFixed(2)}%` : "—"}
            />
          );
        })}
      </div>
      <div className="border-t border-term-border px-2 py-1 text-3xs text-term-text-mute">
        {values.length} data points · latest {values[values.length - 1] !== null ? fmtNum(values[values.length - 1] as number, 2) : "—"}
      </div>
    </Panel>
  );
}

function GaugeTile({ title, payload }: { title: string; payload: Record<string, unknown> }) {
  const stress = (payload.stress ?? {}) as Record<string, unknown>;
  const regime = (stress.regime ?? "UNKNOWN") as string;
  const composite = (stress.composite_percentile ?? null) as number | null;

  const regimeTone = regime === "STRESS" || regime === "ELEVATED" ? "down" : regime === "BENIGN" ? "up" : "amber";

  return (
    <Panel title={title} code="GAUGE">
      <div className="flex flex-col items-center gap-2 p-4">
        <Tag tone={regimeTone}>{regime}</Tag>
        {composite !== null && (
          <>
            <div className="relative h-3 w-full rounded bg-term-panel-3">
              <div
                className={clsx("absolute left-0 top-0 h-full rounded", composite > 0.75 ? "bg-term-down" : composite > 0.5 ? "bg-term-amber" : "bg-term-up")}
                style={{ width: `${composite * 100}%` }}
              />
            </div>
            <div className="text-2xs text-term-text-mute">
              {(composite * 100).toFixed(0)}th percentile
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function TextTile({ title, payload }: { title: string; payload: Record<string, unknown> }) {
  return (
    <Panel title={title} code="TEXT">
      <div className="p-3 text-xs text-term-text-dim whitespace-pre-wrap">
        {JSON.stringify(payload, null, 2)}
      </div>
    </Panel>
  );
}

function NarrativePanel({ narrative, warnings }: { narrative: string; warnings: string[] }) {
  return (
    <Panel title="Analysis Narrative" code="NARR" accent>
      <div className="space-y-2 p-3 text-xs text-term-text-dim">
        {narrative.split("\n").map((line, i) => {
          if (!line.trim()) return <div key={i} className="h-1" />;
          if (line.startsWith("•")) return <p key={i} className="pl-3 text-term-text-mute">{line}</p>;
          if (line.startsWith("⚠")) return <p key={i} className="pl-3 text-term-amber">{line}</p>;
          if (line.startsWith("Caveats:") || line.startsWith("Warnings:"))
            return <p key={i} className="font-semibold text-term-text uppercase text-3xs tracking-wider mt-2">{line}</p>;
          return <p key={i}>{line}</p>;
        })}
      </div>
      {warnings.length > 0 && (
        <div className="border-t border-term-border px-3 py-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1 text-2xs text-term-amber">
              <span>⚠</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function MarketLensStudioPage() {
  const { simEnabled, snapshotFallbackEnabled } = useSimMode();
  const { data: views, source: viewsSource, fallback: viewsFallback } = useLensData<ViewDef[]>("views");
  const { data: presets } = useLensData<PresetDef[]>("presets");
  const { data: catalogData } = useLensData<{ total: number; entries: CatalogEntry[] }>("catalog");

  // Memoized so their identity is stable across renders (these feed hook deps below).
  const catalog = useMemo(() => (Array.isArray(catalogData?.entries) ? catalogData!.entries : []), [catalogData]);
  const viewList = useMemo(() => (Array.isArray(views) ? views : []), [views]);
  const presetList = useMemo(() => (Array.isArray(presets) ? presets : []), [presets]);

  // Configuration state
  const [selectedViewId, setSelectedViewId] = useState("ath_forward_returns");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedSeries, setSelectedSeries] = useState<Set<string>>(new Set(["SPY"]));
  const [selectedWindows, setSelectedWindows] = useState<Set<string>>(new Set(["1W", "1M", "3M", "6M", "1Y"]));
  const [enabledTiles, setEnabledTiles] = useState<Set<string>>(new Set());

  // Analysis state
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisSource, setAnalysisSource] = useState<Source>("LOADING");
  const [running, setRunning] = useState(false);

  const selectedView = useMemo(
    () => viewList.find((v) => v.view_id === selectedViewId) ?? null,
    [viewList, selectedViewId]
  );

  // Update defaults when view changes
  useEffect(() => {
    if (!selectedView) return;
    setSelectedSeries(new Set(selectedView.default_series));
    setSelectedWindows(new Set(selectedView.default_forward_windows));
    setEnabledTiles(new Set(selectedView.default_tiles));
    setResult(null);
  }, [selectedView]);

  const toggleSeries = useCallback((id: string) => {
    setSelectedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleWindow = useCallback((w: string) => {
    setSelectedWindows((prev) => {
      const next = new Set(prev);
      if (next.has(w)) next.delete(w);
      else next.add(w);
      return next;
    });
  }, []);

  const toggleTile = useCallback((t: string) => {
    setEnabledTiles((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = presetList.find((p) => p.preset_id === presetId);
      if (!preset) return;
      // Presets map to views — select the view
      const viewMap: Record<string, string> = {
        bilello_classic: "asset_class_returns",
        ath_spy: "ath_forward_returns",
        vix_panic: "vix_spike_study",
        credit_stress: "credit_spread_stress",
        sell_in_may: "monthly_seasonality",
      };
      const viewId = viewMap[presetId];
      if (viewId) setSelectedViewId(viewId);
    },
    [presetList]
  );

  const runAnalysis = useCallback(async () => {
    if (!selectedView) return;
    setRunning(true);
    setResult(null);

    const body = {
      view_id: selectedViewId,
      series: Array.from(selectedSeries).map((sid) => {
        const cat = catalog.find((c) => c.series_id === sid);
        return {
          series_id: sid,
          ticker: cat?.ticker ?? sid,
          source: cat?.source ?? "yahoo",
          display_name: cat?.display_name ?? sid,
          asset_class: cat?.asset_class ?? "EQUITY",
        };
      }),
      forward_windows: Array.from(selectedWindows),
      selected_tiles: Array.from(enabledTiles),
      allow_snapshot_fallback: snapshotFallbackEnabled,
      allow_sim_fallback: simEnabled,
    };

    try {
      const res = await fetch("/api/market-lens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      setResult(json.data as AnalysisResult);
      setAnalysisSource(["LIVE", "DB", "FRED", "SNAPSHOT", "ECON", "SIM", "ERR"].includes(json.source) ? json.source : "ERR");
    } catch {
      setAnalysisSource("ERR");
    } finally {
      setRunning(false);
    }
  }, [selectedViewId, selectedSeries, selectedWindows, enabledTiles, selectedView, catalog, snapshotFallbackEnabled, simEnabled]);

  const visibleTiles = useMemo(
    () => (result?.tiles ?? []).filter((t) => enabledTiles.size === 0 || enabledTiles.has(t.tile_id)),
    [result, enabledTiles]
  );

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="LENS"
        title="Market Lens Studio"
        desc="Configurable analytics workspace — Bilello-style analysis"
        right={
          <span className="flex items-center gap-2">
            <ProvenanceBadge source={analysisSource} />
          </span>
        }
      />

      <KpiStrip>
        <Stat label="Views" value={viewList.length} sub="pre-canned analytics" tone="amber" />
        <Stat label="Active View" value={selectedView?.display_name ?? "—"} sub={selectedView?.category ?? ""} />
        <Stat label="Series" value={selectedSeries.size} sub={`of ${catalog.length} available`} tone="neutral" />
        <Stat label="Windows" value={selectedWindows.size} sub={Array.from(selectedWindows).join(", ")} />
        <Stat
          label="Sample Size"
          value={result?.sample_size ?? "—"}
          sub={result ? "observations" : "run analysis"}
          tone={result?.sample_size && result.sample_size >= 30 ? "up" : result?.sample_size ? "amber" : "neutral"}
        />
        <Stat label="Tiles" value={visibleTiles.length} sub={`of ${result?.tiles.length ?? 0} available`} />
      </KpiStrip>

      {/* Preset quick-access bar */}
      <div className="flex items-center gap-2 border-b border-term-border bg-term-panel px-3 py-1">
        <span className="text-3xs font-semibold uppercase tracking-wider text-term-text-mute">PRESETS</span>
        {presetList.map((p) => (
          <button key={p.preset_id} onClick={() => applyPreset(p.preset_id)} className="term-btn text-3xs" title={p.description}>
            {p.name}
          </button>
        ))}
      </div>

      {/* Data-source notice — clarifies when the embedded view library / local
          engine is in use vs. the live Python backend. */}
      {viewsSource !== "LOADING" && (
        <div
          className={clsx(
            "flex items-center gap-2 border-b px-3 py-1 text-2xs",
            viewsFallback
              ? "border-term-down/40 bg-term-down/10 text-term-down"
              : "border-term-border bg-term-panel text-term-text-mute"
          )}
        >
          <span>{viewsFallback ? "⚠" : "ℹ"}</span>
          <span>
            {viewsFallback
              ? "Live Market Lens backend unavailable — showing the built-in view library. Analytics run on the local engine with Gold DB first; snapshots and SIM require the ribbon toggles."
              : "Built-in view library — analytics run on the local engine with Gold DB first. Snapshot and SIM fallbacks are off unless enabled in the top ribbon."}
          </span>
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-12">
        {/* Left: Configuration panel */}
        <div className="flex flex-col gap-2 xl:col-span-3">
          <Panel title="View Selection" code="VIEW" accent>
            <ViewSelector
              views={viewList}
              selectedId={selectedViewId}
              onSelect={setSelectedViewId}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
            />
          </Panel>

          <Panel title="Series Configuration" code="SERIES">
            <div className="p-2">
              <SeriesSelector catalog={catalog} selected={selectedSeries} onToggle={toggleSeries} />
            </div>
          </Panel>

          <Panel title="Forward Windows" code="WINDOWS">
            <div className="p-2">
              <WindowSelector selected={selectedWindows} onToggle={toggleWindow} />
            </div>
          </Panel>

          {selectedView && (
            <Panel title="Tile Configuration" code="TILES">
              <div className="p-2">
                <div className="space-y-0.5">
                  {selectedView.default_tiles.map((t) => (
                    <label key={t} className="flex cursor-pointer items-center gap-1.5 text-2xs hover:bg-term-panel-3 px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={enabledTiles.has(t)}
                        onChange={() => toggleTile(t)}
                        className="accent-term-amber"
                      />
                      <span className="text-term-text">{t.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          <button
            onClick={runAnalysis}
            disabled={running || selectedSeries.size === 0}
            className={clsx(
              "w-full rounded-sm border py-2 text-xs font-semibold uppercase tracking-wider transition-colors",
              running
                ? "border-term-border bg-term-panel-3 text-term-text-mute cursor-wait"
                : "border-term-amber bg-term-amber text-black hover:bg-term-amber/80"
            )}
          >
            {running ? "RUNNING ANALYSIS…" : "RUN ANALYSIS"}
          </button>
        </div>

        {/* Right: Results */}
        <div className="flex flex-col gap-2 xl:col-span-9">
          {!result && !running && (
            <Panel title="Getting Started" code="HELP" accent>
              <div className="space-y-3 p-4 text-xs text-term-text-dim">
                <p>
                  <span className="text-term-amber font-semibold">Market Lens Studio</span> is a configurable analytics workspace
                  inspired by <span className="text-term-text">Charlie Bilello</span>-style market analysis.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded border border-term-border p-2">
                    <div className="text-3xs font-semibold uppercase tracking-wider text-term-amber mb-1">1. Select a View</div>
                    <p className="text-2xs text-term-text-mute">Choose from {viewList.length} pre-canned analytics views across event studies, risk, patterns, and more.</p>
                  </div>
                  <div className="rounded border border-term-border p-2">
                    <div className="text-3xs font-semibold uppercase tracking-wider text-term-amber mb-1">2. Configure</div>
                    <p className="text-2xs text-term-text-mute">Select series, forward windows, and which tiles to display.</p>
                  </div>
                  <div className="rounded border border-term-border p-2">
                    <div className="text-3xs font-semibold uppercase tracking-wider text-term-amber mb-1">3. Run</div>
                    <p className="text-2xs text-term-text-mute">Hit Run Analysis. The engine computes forward returns, baselines, and generates a narrative.</p>
                  </div>
                  <div className="rounded border border-term-border p-2">
                    <div className="text-3xs font-semibold uppercase tracking-wider text-term-amber mb-1">4. Explore</div>
                    <p className="text-2xs text-term-text-mute">Toggle tiles on/off, change windows, swap series — all independently configurable.</p>
                  </div>
                </div>
                <p className="text-2xs text-term-text-mute">
                  Or start with a <span className="text-term-text">preset</span> above — like &quot;Bilello Classic&quot; or &quot;VIX Panic Events&quot;.
                </p>
              </div>
            </Panel>
          )}

          {running && (
            <Panel title="Running Analysis…" code="EXEC">
              <div className="flex items-center gap-3 p-6">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-term-amber border-t-transparent" />
                <span className="text-xs text-term-text-dim">
                  Executing <span className="text-term-amber">{selectedView?.display_name}</span> on {selectedSeries.size} series
                  across {selectedWindows.size} forward windows…
                </span>
              </div>
            </Panel>
          )}

          {result && (
            <>
              {/* Tiles grid */}
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {visibleTiles.map((tile) => (
                  <TileRenderer key={tile.tile_id} tile={tile} />
                ))}
              </div>

              {/* Narrative */}
              <NarrativePanel narrative={result.narrative} warnings={result.warnings} />

              {/* Metadata footer */}
              <div className="flex flex-wrap items-center gap-2 rounded-sm border border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
                <span>View: <span className="text-term-amber">{result.view_id}</span></span>
                <span>·</span>
                <span>Series: {result.series_used.join(", ")}</span>
                <span>·</span>
                <span>Sample: {result.sample_size}</span>
                <span>·</span>
                <span>Source: <Tag tone={analysisSource === "LIVE" || analysisSource === "DB" || analysisSource === "FRED" ? "up" : analysisSource === "ERR" ? "down" : analysisSource === "SIM" || analysisSource === "ECON" ? "amber" : "violet"}>{analysisSource}</Tag></span>
                {(() => {
                  const notes = result.metadata?.proxy_notes;
                  if (!Array.isArray(notes) || notes.length === 0) return null;
                  return (
                    <>
                      <span>·</span>
                      <span className="text-term-amber">Proxy: {(notes as string[]).join("; ")}</span>
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
        <span className="text-violet-300">Market Lens Studio</span> — configurable analytics framework.
        {" "}ETF proxies are labeled; all returns hypothetical. Past performance does not predict future results.
        {" "}Data: Yahoo Finance (unofficial, best-effort) · FRED.
      </div>
    </div>
  );
}
