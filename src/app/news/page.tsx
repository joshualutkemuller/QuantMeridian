
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Activity, Check, Copy, Download, RefreshCw, X } from "lucide-react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { fmtAbbr, fmtSigned, pnlClass } from "@/lib/format";
import { useNews } from "@/lib/useNews";
import { useSocial } from "@/lib/useSocial";
import {
  getMarketImpact,
  eventsFromHeadlines,
  signalsFromHeadlines,
  narrativesFromHeadlines,
  attentionFromHeadlines,
  summarizeHeadlines,
  ASSET_CLASSES,
  type AssetClass,
} from "@/data/news";

type View = "TAPE" | "NARR" | "SOCIAL" | "ATTN" | "EVENTS" | "SIGNALS" | "IMPACT";
const VIEWS: { key: View; label: string; code: string }[] = [
  { key: "TAPE", label: "Headline Tape", code: "NEWS-1" },
  { key: "NARR", label: "Narratives", code: "NEWS-2" },
  { key: "SOCIAL", label: "Social", code: "NEWS-3" },
  { key: "IMPACT", label: "Market Impact", code: "NEWS-4" },
  { key: "ATTN", label: "Attention", code: "NEWS-5" },
  { key: "EVENTS", label: "Events", code: "NEWS-6" },
  { key: "SIGNALS", label: "Signals", code: "NEWS-7" },
];

const AC_TONE: Record<AssetClass, "up" | "down" | "amber" | "neutral" | "blue" | "violet"> = {
  EQUITY: "blue", RATES: "amber", CREDIT: "violet", COMMODITY: "amber", FX: "neutral", CRYPTO: "violet", MACRO: "blue", "SEC-FIN": "up",
};

function sentClass(s: number): string {
  return s > 0.15 ? "text-term-up" : s < -0.15 ? "text-term-down" : "text-term-text-mute";
}
/** 0-100 → background tint for heatmap/score tiles. */
function scoreBg(score: number): string {
  const a = Math.max(0.06, Math.min(0.5, score / 200));
  return `rgba(255,140,0,${a.toFixed(3)})`;
}

function Bar({ pct, color = "#FF8C00" }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-term-panel-3">
      <div className="h-full rounded-sm" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

interface DiagnosticsPayload {
  news?: {
    source?: unknown;
    attempts?: unknown[];
    nlp?: NewsNlpPayload;
  };
  social?: {
    source?: unknown;
    attempts?: unknown[];
  };
}

interface NewsNlpPayload {
  configured?: unknown;
  ok?: unknown;
  model?: unknown;
  sentiment?: { ok?: unknown; model?: unknown; backend?: unknown; version?: unknown };
  clustering?: { ok?: unknown; model?: unknown; backend?: unknown; version?: unknown };
  ner?: { ok?: unknown; model?: unknown; backend?: unknown; version?: unknown };
  lexiconFallback?: { enabled?: unknown; model?: unknown; version?: unknown };
  device?: unknown;
  runtime?: unknown;
}

function asDiagnosticsPayload(value: unknown): DiagnosticsPayload {
  return value && typeof value === "object" ? value as DiagnosticsPayload : {};
}

function countOk(attempts: unknown[]): number {
  return attempts.filter((attempt) => Boolean((attempt as { ok?: unknown }).ok)).length;
}

function stringLabel(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nlpStatusLabel(health?: NewsNlpPayload): string {
  if (!health?.ok) return health?.configured ? "NLP ERR" : "NLP OFF";
  const sentiment = stringLabel(health.sentiment?.model);
  const clustering = stringLabel(health.clustering?.model);
  const ner = stringLabel(health.ner?.model);
  const model = stringLabel(health.model);
  if (sentiment && clustering && ner) return "NLP FULL";
  return model ?? sentiment ?? "NLP UP";
}

function componentLabel(label: string, component?: NewsNlpPayload["sentiment"]): string {
  if (!component) return `${label}: n/a`;
  const status = component.ok ? "ok" : "err";
  return `${label}: ${stringLabel(component.model) ?? stringLabel(component.backend) ?? "unknown"} ${status}`;
}

export default function NewsTerminal() {
  const [view, setView] = useState<View>("TAPE");
  const [acFilter, setAcFilter] = useState<AssetClass | "ALL">("ALL");
  const [impactEvent, setImpactEvent] = useState(0);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [drawerDiagnostics, setDrawerDiagnostics] = useState<unknown | null>(null);
  const [drawerDiagnosticsLoading, setDrawerDiagnosticsLoading] = useState(false);
  const [drawerDiagnosticsError, setDrawerDiagnosticsError] = useState<string | null>(null);
  const [drawerRefreshKey, setDrawerRefreshKey] = useState(0);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  const { headlines, source: newsSource, clusters, diagnostics, nlp } = useNews(60);
  const { intel: social, source: socialSource, diagnostics: socialDiagnostics } = useSocial();
  const narratives = useMemo(() => narrativesFromHeadlines(headlines), [headlines]);
  const attention = useMemo(() => attentionFromHeadlines(headlines), [headlines]);
  const summary = useMemo(() => summarizeHeadlines(headlines, narratives, attention), [headlines, narratives, attention]);
  const impact = useMemo(() => getMarketImpact(), []);
  // Prefer transformer clusters from the FinBERT stage; else keyword clustering.
  const events = useMemo(() => (clusters.length ? clusters : eventsFromHeadlines(headlines)), [clusters, headlines]);
  const signals = useMemo(() => signalsFromHeadlines(narratives, attention, social, headlines), [narratives, attention, social, headlines]);
  const clusterSourceLabel = nlp.clusterSource === "FINBERT" ? "FinBERT clusters" : nlp.clusterSource === "KEYWORD" ? "Keyword clusters" : "No clusters";
  const nlpTone = nlp.health?.ok ? "up" : nlp.health?.configured ? "down" : "neutral";
  const nlpHeaderLabel = nlpStatusLabel(nlp.health);

  const tape = acFilter === "ALL" ? headlines : headlines.filter((h) => h.assetClass === acFilter);
  const maxNarr = Math.max(...narratives.map((n) => n.mentions));
  const btn = "rounded-sm border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide transition-colors";
  const hookDiagnostics = useMemo(() => ({
    news: { source: newsSource, attempts: diagnostics, nlp, clusterSource: nlp.clusterSource },
    social: { source: socialSource, attempts: socialDiagnostics },
  }), [diagnostics, newsSource, nlp, socialDiagnostics, socialSource]);
  const rawDiagnostics = drawerDiagnostics ?? hookDiagnostics;
  const diagnosticsPayload = asDiagnosticsPayload(rawDiagnostics);
  const drawerNewsAttempts = Array.isArray(diagnosticsPayload.news?.attempts) ? diagnosticsPayload.news.attempts : diagnostics;
  const drawerSocialAttempts = Array.isArray(diagnosticsPayload.social?.attempts) ? diagnosticsPayload.social.attempts : socialDiagnostics;
  const drawerNewsSource = String(diagnosticsPayload.news?.source ?? newsSource);
  const drawerSocialSource = String(diagnosticsPayload.social?.source ?? socialSource);
  const drawerNlp = diagnosticsPayload.news?.nlp;
  const drawerNlpLabel = nlpStatusLabel(drawerNlp);
  const drawerNlpDetails = [
    componentLabel("sentiment", drawerNlp?.sentiment),
    componentLabel("cluster", drawerNlp?.clustering),
    componentLabel("NER", drawerNlp?.ner),
    `fallback: ${drawerNlp?.lexiconFallback?.enabled ? stringLabel(drawerNlp.lexiconFallback.model) ?? "on" : "off"}`,
    `runtime: ${stringLabel(drawerNlp?.device) ?? "n/a"}${stringLabel(drawerNlp?.runtime) ? ` · ${stringLabel(drawerNlp?.runtime)}` : ""}`,
  ];
  const diagnosticsJson = useMemo(() => JSON.stringify(rawDiagnostics, null, 2), [rawDiagnostics]);

  useEffect(() => {
    if (!diagnosticsOpen) return;
    const ctrl = new AbortController();
    setDrawerDiagnosticsLoading(true);
    setDrawerDiagnosticsError(null);
    Promise.all([
      fetch("/api/news/diagnostics?n=20", { signal: ctrl.signal }).then((r) => r.json()),
      fetch("/api/social/diagnostics", { signal: ctrl.signal }).then((r) => r.json()),
    ])
      .then(([news, social]) => {
        setDrawerDiagnostics({ news, social });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setDrawerDiagnosticsError(err instanceof Error ? err.message : String(err));
        setDrawerDiagnostics(hookDiagnostics);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setDrawerDiagnosticsLoading(false);
      });
    return () => ctrl.abort();
  }, [diagnosticsOpen, drawerRefreshKey, hookDiagnostics]);

  useEffect(() => {
    if (!diagnosticsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDiagnosticsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [diagnosticsOpen]);

  function downloadDiagnostics() {
    const blob = new Blob([diagnosticsJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `news_diagnostics_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyDiagnostics() {
    if (!navigator.clipboard?.writeText) {
      setDrawerDiagnosticsError("Clipboard API is unavailable in this browser context.");
      return;
    }
    void navigator.clipboard.writeText(diagnosticsJson).then(() => {
      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 1600);
    }).catch((err) => {
      setDrawerDiagnosticsError(err instanceof Error ? err.message : String(err));
    });
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="NEWS"
        title="Market News & Signal Intelligence"
        desc="Signal extraction · narratives · social · impact"
        right={<span className="flex items-center gap-1"><ProvenanceBadge source={newsSource} /><Tag tone={nlpTone}>{nlpHeaderLabel}</Tag><Tag tone={nlp.clusterSource === "FINBERT" ? "up" : nlp.clusterSource === "KEYWORD" ? "amber" : "neutral"}>{clusterSourceLabel}</Tag></span>}
      />

      <KpiStrip>
        <Stat label="Headlines 24h" value={summary.headlines24h} sub="ingested" tone="amber" />
        <Stat label="Avg Sentiment" value={summary.avgSentiment.toFixed(2)} sub={summary.avgSentiment >= 0 ? "net bullish" : "net bearish"} tone={summary.avgSentiment >= 0 ? "up" : "down"} />
        <Stat label="Risk Tone" value={summary.riskTone} sub="signal net" tone={summary.riskTone === "RISK-ON" ? "up" : summary.riskTone === "RISK-OFF" ? "down" : "neutral"} />
        <Stat label="Top Narrative" value={summary.topNarrative} sub="by velocity" />
        <Stat label="Active Signals" value={summary.activeSignals} sub="engine" tone="amber" />
        <Stat label="Attention Leader" value={summary.attentionLeader} sub="most-watched" />
      </KpiStrip>

      {/* View switcher */}
      <div className="flex flex-wrap items-center gap-1 border-b border-term-border bg-term-panel px-3 py-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={clsx(btn, view === v.key ? "border-term-amber bg-term-amber text-black" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}
            title={v.code}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1 border-b border-term-border bg-term-panel-2 px-3 py-1.5">
        <span className="term-label mr-1">Provider Chain</span>
        {diagnostics.length ? diagnostics.map((attempt) => (
          <Tag
            key={attempt.provider}
            tone={attempt.ok ? "up" : attempt.configured ? "down" : "neutral"}
            className="max-w-full"
          >
            <span
              className="max-w-[14rem] truncate"
              title={`${attempt.provider}: ${attempt.ok ? `${attempt.headlineCount} headlines in ${attempt.latencyMs}ms` : attempt.error ?? "no headlines"}`}
            >
              {attempt.provider} {attempt.ok ? `${attempt.headlineCount}/${attempt.latencyMs}ms` : attempt.configured ? "ERR" : "OFF"}
            </span>
          </Tag>
        )) : (
          <Tag tone="neutral">PROBING</Tag>
        )}
        <button
          className="term-btn ml-auto inline-flex items-center gap-1"
          onClick={() => setDiagnosticsOpen(true)}
          title="Inspect raw provider-attempt diagnostics"
        >
          <Activity className="h-3 w-3" />
          Diagnostics
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-2">
        {/* ── NEWS-1 Headline Tape ─────────────────────────────────────────── */}
        {view === "TAPE" && (
          <Panel title="Headline Tape" code="NEWS-1" accent right={<span className="text-3xs text-term-text-mute">{tape.length} headlines</span>}>
            <div className="flex flex-wrap gap-1 border-b border-term-border px-2 py-1.5">
              <button onClick={() => setAcFilter("ALL")} className={clsx(btn, acFilter === "ALL" ? "border-term-amber bg-term-amber/15 text-term-amber" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>All</button>
              {ASSET_CLASSES.map((ac) => (
                <button key={ac} onClick={() => setAcFilter(ac)} className={clsx(btn, acFilter === ac ? "border-term-amber bg-term-amber/15 text-term-amber" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>{ac}</button>
              ))}
            </div>
            <div className="max-h-[60vh] overflow-auto divide-y divide-term-border-soft">
              {tape.map((h) => (
                <div key={h.id} className="flex items-center gap-2 px-2 py-1.5 text-2xs hover:bg-term-panel-2">
                  <span className="tnum w-10 shrink-0 text-term-text-mute">{h.time}</span>
                  <span className="w-9 shrink-0">
                    <span className={clsx("tnum text-3xs font-bold", h.importance >= 75 ? "text-term-down" : h.importance >= 50 ? "text-term-amber" : "text-term-text-mute")}>{h.importance}</span>
                  </span>
                  <span className="w-16 shrink-0"><Tag tone={AC_TONE[h.assetClass]}>{h.assetClass}</Tag></span>
                  <span className="hidden w-20 shrink-0 truncate text-term-text-mute lg:inline">{h.source}</span>
                  <span className="min-w-0 flex-1 truncate text-term-text" title={h.headline}>{h.headline}</span>
                  {h.tickers.slice(0, 2).map((t, i) => <span key={i} className="hidden shrink-0 font-mono text-3xs text-term-blue md:inline">{t}</span>)}
                  <span className={clsx("w-14 shrink-0 text-right text-3xs font-semibold uppercase", sentClass(h.sentimentScore))}>{h.sentiment}</span>
                  <span className="w-8 shrink-0 text-right"><span className="tnum text-3xs text-term-text-dim" title="impact score">{h.impact}</span></span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ── NEWS-2 Narrative Monitor ─────────────────────────────────────── */}
        {view === "NARR" && (
          <Panel title="Narrative Monitor" code="NEWS-2" accent right={<span className="text-3xs text-term-text-mute">ranked by velocity</span>}>
            <div className="grid grid-cols-1 gap-px bg-term-border md:grid-cols-2">
              {narratives.map((n) => {
                const size = 14 + (n.mentions / maxNarr) * 34;
                return (
                  <div key={n.name} className="flex items-center gap-3 bg-term-panel px-3 py-2">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center">
                      <span className="flex items-center justify-center rounded-full text-3xs font-bold text-black" style={{ width: size, height: size, background: n.sentiment >= 0 ? "#2ECC71" : "#FF3B3B", opacity: 0.85 }}>{n.breadth}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate text-2xs font-semibold text-term-text">{n.name}</span>
                        <span className="tnum text-3xs text-term-text-mute">{fmtAbbr(n.mentions)} mentions</span>
                      </div>
                      <div className="mt-1"><Bar pct={n.velocity} color={n.sentiment >= 0 ? "#2ECC71" : "#FF3B3B"} /></div>
                      <div className="mt-1 flex items-center gap-3 text-3xs">
                        <span className="text-term-text-mute">vel <span className="tnum text-term-text-dim">{n.velocity}</span></span>
                        <span className={pnlClass(n.chg7d)}>7d {fmtSigned(n.chg7d, 0)}%</span>
                        <span className={pnlClass(n.chg30d)}>30d {fmtSigned(n.chg30d, 0)}%</span>
                        <span className={clsx("ml-auto tnum", sentClass(n.sentiment))}>sent {n.sentiment >= 0 ? "+" : ""}{n.sentiment.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">Bubble size = mention volume · number = asset-class breadth · bar = velocity (acceleration of mentions).</div>
          </Panel>
        )}

        {/* ── NEWS-3 Social Intelligence ───────────────────────────────────── */}
        {view === "SOCIAL" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-3xs text-term-text-mute">
              <span>Source</span>
              <ProvenanceBadge source={socialSource} />
              <span>· Reddit + StockTwits when configured, else simulated.</span>
            </div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
              {([["Trending Tickers", social.tickers], ["Sectors", social.sectors], ["Themes", social.themes]] as const).map(([title, rows]) => (
                <Panel key={title} title={title} code="SOCIAL">
                  <div className="divide-y divide-term-border-soft">
                    {rows.map((r) => (
                      <div key={r.label} className="flex items-center gap-2 px-2 py-1.5 text-2xs">
                        <span className="w-24 shrink-0 truncate font-semibold text-term-text">{r.label}</span>
                        <span className="tnum w-12 shrink-0 text-right text-term-text-dim">{fmtAbbr(r.mentions)}</span>
                        <span className={clsx("tnum w-12 shrink-0 text-right text-3xs", pnlClass(r.velocity))}>{fmtSigned(r.velocity, 0)}%</span>
                        <span className="flex-1"><Bar pct={Math.min(100, Math.abs(r.velocity))} color={r.sentiment >= 0 ? "#2ECC71" : "#FF3B3B"} /></span>
                      </div>
                    ))}
                  </div>
                </Panel>
              ))}
            </div>
            <Panel title="Platform Activity" code="SOCIAL" right={<span className="text-3xs text-term-text-mute">{fmtAbbr(social.totalPosts)} posts/24h</span>}>
              <div className="grid grid-cols-1 divide-y divide-term-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                {social.platforms.map((p) => (
                  <div key={p.name} className="px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-2xs font-semibold text-term-text">{p.name}</span>
                      <span className={clsx("tnum text-3xs", sentClass(p.sentiment))}>{p.sentiment >= 0 ? "+" : ""}{p.sentiment.toFixed(2)}</span>
                    </div>
                    <div className="tnum mt-0.5 text-base font-semibold text-term-amber">{fmtAbbr(p.posts)}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {/* ── NEWS-4 Market Impact ─────────────────────────────────────────── */}
        {view === "IMPACT" && (
          <Panel title="Market Impact Dashboard" code="NEWS-4" accent right={<span className="text-3xs text-term-text-mute">historical model · external event-study inputs</span>}>
            <div className="flex flex-wrap gap-1 border-b border-term-border px-2 py-1.5">
              {impact.map((e, i) => (
                <button key={e.event} onClick={() => setImpactEvent(i)} className={clsx(btn, impactEvent === i ? "border-term-amber bg-term-amber text-black" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>{e.event}</button>
              ))}
            </div>
            <div className="space-y-1 px-3 py-2 text-2xs text-term-text-dim">
              <div>
                When <span className="font-semibold text-term-amber">{impact[impactEvent].event}</span> occurred historically ({impact[impactEvent].occurrences} episodes), assets moved:
              </div>
              <div className="grid gap-1 rounded border border-term-border bg-term-panel-2 p-2 sm:grid-cols-[1.3fr_1fr_0.8fr]">
                <div><span className="text-term-text-mute">Gold-table inputs:</span> {impact[impactEvent].datasets.join(" + ")}</div>
                <div><span className="text-term-text-mute">Magnitude:</span> {impact[impactEvent].magnitude}</div>
                <div><span className="text-term-text-mute">Access:</span> {impact[impactEvent].access}</div>
              </div>
            </div>
            <table className="w-full border-collapse tnum">
              <thead className="bg-term-panel-2">
                <tr>
                  {["Asset", "+1D", "+1W", "+1M", "Hit", "N"].map((c, i) => (
                    <th key={c} className={clsx("border-b border-term-border px-3 py-1 text-3xs font-semibold uppercase tracking-wider text-term-text-mute", i === 0 ? "text-left" : "text-right")}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {impact[impactEvent].rows.map((r) => (
                  <tr key={r.asset} className="border-b border-term-border-soft hover:bg-term-panel-2">
                    <td className="px-3 py-1 text-left text-2xs font-semibold text-term-text">{r.asset}</td>
                    {[r.d1, r.w1, r.m1].map((v, i) => (
                      <td key={i} className={clsx("px-3 py-1 text-right text-2xs", pnlClass(v))}>{fmtSigned(v, 1)}%</td>
                    ))}
                    <td className="px-3 py-1 text-right text-2xs text-term-text-dim">{r.hitRate}%</td>
                    <td className="px-3 py-1 text-right text-2xs text-term-text-dim">{r.observations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">
              Served in the existing getMarketImpact() shape from an analytics_event_impact-style gold table: event dates + magnitude join the price warehouse to compute median +1D/+1W/+1M forward returns, hit-rate, and n per asset. Clearly labelled historical model; not a live forecast.
            </div>
          </Panel>
        )}

        {/* ── NEWS-5 Attention Heatmap ─────────────────────────────────────── */}
        {view === "ATTN" && (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {([["Tickers", attention.tickers], ["Sectors", attention.sectors], ["Countries", attention.countries], ["Commodities", attention.commodities]] as const).map(([title, rows]) => (
              <Panel key={title} title={`${title} — Attention`} code="NEWS-5">
                <div className="grid grid-cols-2 gap-px bg-term-border sm:grid-cols-3">
                  {rows.map((r) => (
                    <div key={r.label} className="flex flex-col gap-0.5 px-2.5 py-2" style={{ background: scoreBg(r.score) }}>
                      <div className="flex items-center justify-between">
                        <span className="truncate text-2xs font-semibold text-term-text">{r.label}</span>
                        <span className="tnum text-2xs font-bold text-term-text">{r.score}</span>
                      </div>
                      <div className="flex items-center justify-between text-3xs">
                        <span className={pnlClass(r.chg)}>{fmtSigned(r.chg, 0)}</span>
                        <span className={sentClass(r.sentiment)}>{r.sentiment >= 0 ? "▲" : "▼"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        )}

        {/* ── NEWS-6 Event Intelligence ────────────────────────────────────── */}
        {view === "EVENTS" && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {events.map((e) => (
              <Panel key={e.id} title={e.title} code="NEWS-6" right={<span className="flex items-center gap-1"><Tag tone={nlp.clusterSource === "FINBERT" ? "up" : "amber"}>{nlp.clusterSource === "FINBERT" ? "FINBERT" : "KEYWORD"}</Tag><Tag tone={AC_TONE[e.assetClass]}>{e.assetClass}</Tag></span>}>
                <div className="flex flex-col gap-2 p-3">
                  <div className="flex items-center gap-3 text-3xs">
                    <span className="text-term-text-mute">Related <span className="tnum font-semibold text-term-text">{e.relatedCount}</span></span>
                    <span className="text-term-text-mute">First seen <span className="tnum text-term-text-dim">{e.firstSeen}</span></span>
                    <span className={clsx("ml-auto tnum", sentClass(e.sentiment))}>sentiment {e.sentiment >= 0 ? "+" : ""}{e.sentiment.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-3xs text-term-text-mute">Importance</span>
                    <span className="flex-1"><Bar pct={e.importance} color={e.importance >= 75 ? "#FF3B3B" : "#FF8C00"} /></span>
                    <span className="tnum text-3xs font-bold text-term-text">{e.importance}</span>
                  </div>
                  <p className="text-2xs leading-relaxed text-term-text-dim">{e.summary}</p>
                  <div className="flex flex-wrap gap-1">
                    {e.sources.map((s) => <Tag key={s} tone="neutral">{s}</Tag>)}
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}

        {/* ── NEWS-7 Signal Engine ─────────────────────────────────────────── */}
        {view === "SIGNALS" && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {signals.map((s) => (
              <Panel
                key={s.id}
                title={s.text}
                code="NEWS-7"
                accent={s.confidence >= 80}
                right={<Tag tone={s.direction === "RISK-ON" ? "up" : s.direction === "RISK-OFF" ? "down" : "neutral"}>{s.direction}</Tag>}
              >
                <div className="flex flex-col gap-2 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-3xs uppercase tracking-wide text-term-text-mute">Confidence</span>
                    <span className="flex-1"><Bar pct={s.confidence} color={s.confidence >= 80 ? "#2ECC71" : "#FF8C00"} /></span>
                    <span className="tnum text-3xs font-bold text-term-text">{s.confidence}%</span>
                  </div>
                  <div className="text-3xs text-term-text-mute">Trigger: <span className="text-term-amber">{s.trigger}</span> · fired {s.firedAgo}m ago</div>
                  <ul className="flex flex-col gap-0.5">
                    {s.evidence.map((ev, i) => (
                      <li key={i} className="flex gap-1.5 text-3xs text-term-text-dim"><span className="text-term-amber">▸</span><span>{ev}</span></li>
                    ))}
                  </ul>
                  <div className="border-t border-term-border-soft pt-1.5">
                    <span className="text-3xs uppercase tracking-wide text-term-text-mute">Similar episodes</span>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {s.similarEpisodes.map((ep, i) => (
                        <span key={i} className="flex items-center gap-1 text-3xs">
                          <span className="text-term-text-dim">{ep.label}</span>
                          <span className={clsx("tnum", pnlClass(ep.spyFwd))}>SPY {fmtSigned(ep.spyFwd, 1)}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
        <span className="text-term-amber">NEWS</span> — source {newsSource}; clusters {clusterSourceLabel}; sentiment {nlp.sentiment ? "FinBERT" : "provider/heuristic"}; social {socialSource}.
      </div>

      {diagnosticsOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/55 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="NEWS diagnostics">
          <div className="flex h-full w-full max-w-2xl flex-col border border-term-border bg-term-panel shadow-2xl">
            <div className="term-panel-head">
              <div className="flex min-w-0 items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-term-amber" />
                <span className="truncate text-term-text-dim">Provider Diagnostics</span>
                <Tag tone={newsSource === "ERR" && socialSource === "ERR" ? "down" : "up"}>
                  {newsSource === "ERR" && socialSource === "ERR" ? "OFFLINE" : "ACTIVE"}
                </Tag>
                {drawerDiagnosticsLoading && <Tag tone="neutral">LOADING</Tag>}
                {drawerDiagnosticsError && <Tag tone="down">FETCH ERR</Tag>}
              </div>
              <div className="flex items-center gap-1">
                <button className="term-btn inline-flex items-center gap-1" onClick={() => setDrawerRefreshKey((key) => key + 1)} title="Refresh provider diagnostics">
                  <RefreshCw className={clsx("h-3 w-3", drawerDiagnosticsLoading && "animate-spin")} />
                  Refresh
                </button>
                <button className="term-btn inline-flex items-center gap-1" onClick={copyDiagnostics} title="Copy diagnostics JSON">
                  {diagnosticsCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {diagnosticsCopied ? "Copied" : "Copy"}
                </button>
                <button className="term-btn inline-flex items-center gap-1" onClick={downloadDiagnostics} title="Download diagnostics JSON">
                  <Download className="h-3 w-3" />
                  JSON
                </button>
                <button className="term-btn inline-flex items-center gap-1" onClick={() => setDiagnosticsOpen(false)} title="Close diagnostics">
                  <X className="h-3 w-3" />
                  Close
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-px border-b border-term-border bg-term-border text-2xs sm:grid-cols-2">
              <div className="bg-term-panel-2 p-2">
                <div className="term-label">NEWS</div>
                <div className="mt-1 truncate text-term-text" title={drawerNewsSource}>{drawerNewsSource}</div>
                <div className="text-term-text-mute">{countOk(drawerNewsAttempts)}/{drawerNewsAttempts.length} providers ok</div>
              </div>
              <div className="bg-term-panel-2 p-2">
                <div className="term-label">SOCIAL / NLP</div>
                <div className="mt-1 truncate text-term-text" title={`${drawerSocialSource} · ${drawerNlpLabel}`}>
                  {drawerSocialSource} · {drawerNlpLabel}
                </div>
                <div className="text-term-text-mute">{countOk(drawerSocialAttempts)}/{drawerSocialAttempts.length} social providers ok · {clusterSourceLabel}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-px border-b border-term-border bg-term-border text-3xs md:grid-cols-5">
              {drawerNlpDetails.map((detail) => (
                <div key={detail} className="truncate bg-term-panel p-2 text-term-text-mute" title={detail}>
                  {detail}
                </div>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {drawerDiagnosticsError && (
                <div className="mb-2 border border-term-down/40 bg-term-down/10 p-2 text-2xs text-term-down">
                  {drawerDiagnosticsError}
                </div>
              )}
              <pre className="whitespace-pre-wrap break-words rounded border border-term-border bg-term-panel-3 p-3 font-mono text-3xs leading-relaxed text-term-text-dim">
                {diagnosticsJson}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
