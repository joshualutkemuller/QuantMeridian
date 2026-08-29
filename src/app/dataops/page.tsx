
import { useMemo, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { BarChart } from "@/components/charts/BarChart";
import { ProgressBar } from "@/components/charts/Radial";
import {
  getDataOpsSummary,
  getDataQualityIssues,
  getLineageRuns,
  getModuleCoverage,
  getModuleDataItems,
  getProviderHealth,
  getProviderRuns,
  getSeriesRunResults,
  type DataQualityIssue,
  type LineageRun,
  type ModuleCoverage,
  type ModuleDataItem,
  type ModuleDataStatus,
  type ProviderHealth,
  type ProviderName,
  type ProviderRun,
  type ProviderStatus,
  type SeriesRunResult,
} from "@/data/dataOps";
import { useProviderHealth } from "@/lib/useProviderHealth";
import { useLiveRuns } from "@/lib/useLiveRuns";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";

const STATUS_TONE: Record<ProviderStatus, "up" | "blue" | "amber" | "down" | "neutral"> = {
  LIVE: "up",
  CACHED: "blue",
  SIM: "amber",
  STALE: "neutral",
  ERROR: "down",
  FALLBACK_AVAILABLE: "neutral",
};

const ISSUE_TONE: Record<DataQualityIssue["severity"], "down" | "amber" | "neutral"> = {
  HIGH: "down",
  MED: "amber",
  LOW: "neutral",
};

const RUN_TONE: Record<LineageRun["status"] | ProviderRun["status"], "up" | "amber" | "down"> = {
  OK: "up",
  PARTIAL: "amber",
  FAILED: "down",
};

const SERIES_TONE: Record<SeriesRunResult["status"], "up" | "amber" | "down" | "neutral"> = {
  SUCCESS: "up",
  FAILED: "down",
  STALE: "amber",
  FALLBACK: "neutral",
};

const MODULE_ITEM_TONE: Record<ModuleDataStatus, "up" | "blue" | "amber" | "down"> = {
  LIVE: "up",
  CACHED: "blue",
  SIM: "amber",
  STALE: "down",
};

function providerTone(provider: ProviderName): "up" | "blue" | "amber" | "neutral" {
  if (provider === "FRED") return "up";
  if (provider === "YAHOO") return "blue";
  if (provider === "NEWS") return "amber";
  if (provider === "SYNTHETIC") return "neutral";
  return "amber";
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(name: string, rows: ModuleDataItem[]) {
  const headers: (keyof ModuleDataItem)[] = ["module", "functionName", "itemId", "itemName", "status", "provider", "dataset", "lastRunId", "asOf", "freshnessMin", "rows", "note"];
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Replace fixture rows whose provider/source has live manifest data; keep the rest. */
function mergeByProvider<T extends { provider?: ProviderName; source?: ProviderName }>(base: T[], liveRows: T[]): T[] {
  const liveProviders = new Set(liveRows.map((r) => r.provider ?? r.source));
  return [...liveRows, ...base.filter((r) => !liveProviders.has(r.provider ?? r.source))];
}

type ProviderRow = ProviderHealth & { verified: boolean };

export default function DataOpsPage() {
  const baseProviders = getProviderHealth();
  const probe = useProviderHealth();
  // Status is driven by the real /api/dataops/health probe. Until the probe
  // confirms a provider it is shown UNVERIFIED — the seeded fixture status is
  // never presented as a live claim (no more hardcoded "FRED LIVE").
  const providers = useMemo<ProviderRow[]>(
    () =>
      baseProviders.map((p) => {
        const h = probe.health?.[p.provider];
        if (!h) return { ...p, verified: false };
        return {
          ...p,
          status: h.status,
          freshnessMin: h.live ? 0 : p.freshnessMin,
          lastRun: probe.probedAt ? `probed ${probe.probedAt.slice(11, 19)}` : p.lastRun,
          upgradePath: h.detail || p.upgradePath,
          verified: true,
        };
      }),
    [baseProviders, probe]
  );
  const providersLive = providers.filter((p) => p.verified && p.status === "LIVE").length;

  // Live ingestion runs/series/lineage from the market pipeline manifest (else fixtures).
  const live = useLiveRuns();
  const runs = useMemo(() => (live ? mergeByProvider(getProviderRuns(), live.runs) : getProviderRuns()), [live]);
  const seriesResults = useMemo(() => (live ? [...getSeriesRunResults(), ...live.series] : getSeriesRunResults()), [live]);
  const lineage = useMemo(() => (live ? mergeByProvider(getLineageRuns(), live.lineage) : getLineageRuns()), [live]);
  const modules = getModuleCoverage();
  const moduleItems = getModuleDataItems();
  const issues = getDataQualityIssues();
  const summary = getDataOpsSummary();

  const [selectedProvider, setSelectedProvider] = useState<ProviderName>(providers[0].provider);
  const [selectedRunId, setSelectedRunId] = useState<string>(runs.find((r) => r.provider === providers[0].provider)?.runId ?? runs[0].runId);
  const [selectedModule, setSelectedModule] = useState<string>(modules[0].module);
  const [selectedIssueId, setSelectedIssueId] = useState<string>(issues[0].id);
  const [selectedLineageId, setSelectedLineageId] = useState<string>(lineage[0].runId);

  const selectedProviderRuns = useMemo(() => runs.filter((r) => r.provider === selectedProvider), [runs, selectedProvider]);
  const selectedRun = runs.find((r) => r.runId === selectedRunId) ?? selectedProviderRuns[0] ?? runs[0];
  const selectedRunSeries = useMemo(() => seriesResults.filter((s) => s.runId === selectedRun.runId), [seriesResults, selectedRun.runId]);
  const selectedModuleCoverage = modules.find((m) => m.module === selectedModule) ?? modules[0];
  const selectedModuleItems = useMemo(() => moduleItems.filter((i) => i.module === selectedModuleCoverage.module), [moduleItems, selectedModuleCoverage.module]);
  const selectedIssue = issues.find((i) => i.id === selectedIssueId) ?? issues[0];
  const selectedLineage = lineage.find((l) => l.runId === selectedLineageId) ?? lineage[0];

  const providerCols: Column<ProviderRow>[] = [
    { key: "provider", header: "Provider", render: (r) => <span className="font-semibold text-term-text">{r.provider}</span>, sortVal: (r) => r.provider },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (r) =>
        r.verified ? (
          <Tag tone={STATUS_TONE[r.status]}>{r.status}</Tag>
        ) : (
          <Tag tone="neutral"><span title="Not confirmed — /api/dataops/health probe unavailable or not yet returned">UNVERIFIED</span></Tag>
        ),
      sortVal: (r) => (r.verified ? r.status : "ZZZ"),
    },
    { key: "coverage", header: "Coverage", width: "130px", render: (r) => <ProgressBar value={r.coveragePct} color={r.coveragePct < 65 ? "#FF3B3B" : r.coveragePct < 80 ? "#FF8C00" : "#2ECC71"} showPct />, sortVal: (r) => r.coveragePct },
    { key: "fresh", header: "Fresh", align: "right", render: (r) => <span className="text-term-text-dim">{r.freshnessMin === 0 ? "now" : `${fmtInt(r.freshnessMin)}m`}</span>, sortVal: (r) => r.freshnessMin },
    { key: "series", header: "Series", align: "right", render: (r) => <span className="text-term-text">{fmtInt(r.seriesCount)}</span>, sortVal: (r) => r.seriesCount },
    { key: "failed", header: "Failed", align: "right", render: (r) => <span className={r.failedSeries ? "text-term-down" : "text-term-up"}>{fmtInt(r.failedSeries)}</span>, sortVal: (r) => r.failedSeries },
    { key: "last", header: "Last Run", render: (r) => <span className="text-term-text-mute">{r.lastRun}</span>, sortVal: (r) => r.lastRun },
    { key: "upgrade", header: "Upgrade Path", render: (r) => <span className="text-term-text-dim">{r.upgradePath}</span>, sortVal: (r) => r.upgradePath },
  ];

  const runCols: Column<ProviderRun>[] = [
    { key: "run", header: "Run", render: (r) => <span className="font-mono text-term-text">{r.runId}</span>, sortVal: (r) => r.runId },
    { key: "pipe", header: "Pipeline", render: (r) => <span className="text-term-text-dim">{r.pipeline}</span>, sortVal: (r) => r.pipeline },
    { key: "status", header: "Status", align: "center", render: (r) => <Tag tone={RUN_TONE[r.status]}>{r.status}</Tag>, sortVal: (r) => r.status },
    { key: "ok", header: "OK", align: "right", render: (r) => <span className="text-term-up">{fmtInt(r.successSeries)}</span>, sortVal: (r) => r.successSeries },
    { key: "fail", header: "Fail", align: "right", render: (r) => <span className={r.failedSeries ? "text-term-down" : "text-term-text-mute"}>{fmtInt(r.failedSeries)}</span>, sortVal: (r) => r.failedSeries },
    { key: "rows", header: "Rows", align: "right", render: (r) => <span className="text-term-text">{fmtInt(r.rowsIngested)}</span>, sortVal: (r) => r.rowsIngested },
    { key: "started", header: "Started", render: (r) => <span className="text-term-text-mute">{r.started}</span>, sortVal: (r) => r.started },
    { key: "duration", header: "Dur", align: "right", render: (r) => <span className="text-term-text-dim">{fmtInt(r.durationMs)}ms</span>, sortVal: (r) => r.durationMs },
  ];

  const seriesCols: Column<SeriesRunResult>[] = [
    { key: "series", header: "Series", render: (r) => <span className="font-mono text-term-text">{r.seriesId}</span>, sortVal: (r) => r.seriesId },
    { key: "dataset", header: "Dataset", render: (r) => <span className="text-term-text-dim">{r.dataset}</span>, sortVal: (r) => r.dataset },
    { key: "name", header: "Name", render: (r) => <span className="text-term-text">{r.displayName}</span>, sortVal: (r) => r.displayName },
    { key: "status", header: "Status", align: "center", render: (r) => <Tag tone={SERIES_TONE[r.status]}>{r.status}</Tag>, sortVal: (r) => r.status },
    { key: "rows", header: "Rows", align: "right", render: (r) => <span className="text-term-text">{fmtInt(r.rows)}</span>, sortVal: (r) => r.rows },
    { key: "latency", header: "Latency", align: "right", render: (r) => <span className="text-term-text-dim">{fmtInt(r.latencyMs)}ms</span>, sortVal: (r) => r.latencyMs },
    { key: "message", header: "Message", render: (r) => <span className={r.status === "FAILED" ? "text-term-down" : r.status === "STALE" ? "text-term-amber" : "text-term-text-dim"}>{r.message}</span>, sortVal: (r) => r.message },
  ];

  const moduleCols: Column<ModuleCoverage>[] = [
    { key: "module", header: "Module", align: "center", render: (r) => <Tag tone="blue">{r.module}</Tag>, sortVal: (r) => r.module },
    { key: "function", header: "Function", render: (r) => <span className="text-term-text">{r.functionName}</span>, sortVal: (r) => r.functionName },
    { key: "live", header: "Live", align: "right", render: (r) => <span className="text-term-up">{fmtPct(r.livePct, 0)}</span>, sortVal: (r) => r.livePct },
    { key: "cached", header: "Cached", align: "right", render: (r) => <span className="text-term-blue">{fmtPct(r.cachedPct, 0)}</span>, sortVal: (r) => r.cachedPct },
    { key: "sim", header: "Sim", align: "right", render: (r) => <span className="text-term-amber">{fmtPct(r.simPct, 0)}</span>, sortVal: (r) => r.simPct },
    { key: "stale", header: "Stale", align: "right", render: (r) => <span className={r.stalePct ? "text-term-down" : "text-term-text-mute"}>{fmtPct(r.stalePct, 0)}</span>, sortVal: (r) => r.stalePct },
    { key: "readiness", header: "Readiness", width: "130px", render: (r) => <ProgressBar value={r.readiness} color={r.readiness < 55 ? "#FF3B3B" : r.readiness < 75 ? "#FF8C00" : "#2ECC71"} showPct />, sortVal: (r) => r.readiness },
    { key: "blocker", header: "Blocker", render: (r) => <span className="text-term-text-dim">{r.blocker}</span>, sortVal: (r) => r.blocker },
  ];

  const moduleItemCols: Column<ModuleDataItem>[] = [
    { key: "item", header: "Item", render: (r) => <span className="font-mono text-term-text">{r.itemId}</span>, sortVal: (r) => r.itemId },
    { key: "name", header: "Name", render: (r) => <span className="text-term-text">{r.itemName}</span>, sortVal: (r) => r.itemName },
    { key: "status", header: "Status", align: "center", render: (r) => <Tag tone={MODULE_ITEM_TONE[r.status]}>{r.status}</Tag>, sortVal: (r) => r.status },
    { key: "provider", header: "Provider", align: "center", render: (r) => <Tag tone={providerTone(r.provider)}>{r.provider}</Tag>, sortVal: (r) => r.provider },
    { key: "dataset", header: "Dataset", render: (r) => <span className="text-term-text-dim">{r.dataset}</span>, sortVal: (r) => r.dataset },
    { key: "run", header: "Run", render: (r) => <span className="font-mono text-term-text-mute">{r.lastRunId}</span>, sortVal: (r) => r.lastRunId },
    { key: "fresh", header: "Fresh", align: "right", render: (r) => <span className={r.status === "STALE" ? "text-term-down" : "text-term-text-dim"}>{r.asOf === "deterministic" ? "sim" : `${fmtInt(r.freshnessMin)}m`}</span>, sortVal: (r) => r.freshnessMin },
    { key: "rows", header: "Rows", align: "right", render: (r) => <span className="text-term-text">{fmtInt(r.rows)}</span>, sortVal: (r) => r.rows },
    { key: "note", header: "Note", render: (r) => <span className="text-term-text-dim">{r.note}</span>, sortVal: (r) => r.note },
  ];

  const issueCols: Column<DataQualityIssue>[] = [
    { key: "id", header: "ID", render: (r) => <span className="font-mono text-term-text-mute">{r.id}</span>, sortVal: (r) => r.id },
    { key: "severity", header: "Severity", align: "center", render: (r) => <Tag tone={ISSUE_TONE[r.severity]}>{r.severity}</Tag>, sortVal: (r) => (r.severity === "HIGH" ? 3 : r.severity === "MED" ? 2 : 1) },
    { key: "provider", header: "Provider", align: "center", render: (r) => <Tag tone={providerTone(r.provider)}>{r.provider}</Tag>, sortVal: (r) => r.provider },
    { key: "dataset", header: "Dataset", render: (r) => <span className="text-term-text">{r.dataset}</span>, sortVal: (r) => r.dataset },
    { key: "check", header: "Check", render: (r) => <span className="text-term-amber">{r.check}</span>, sortVal: (r) => r.check },
    { key: "detail", header: "Detail", render: (r) => <span className="text-term-text-dim">{r.detail}</span>, sortVal: (r) => r.detail },
    { key: "rows", header: "Rows", align: "right", render: (r) => <span className="text-term-text">{fmtInt(r.rowsImpacted)}</span>, sortVal: (r) => r.rowsImpacted },
  ];

  const lineageCols: Column<LineageRun>[] = [
    { key: "run", header: "Run", render: (r) => <span className="font-mono text-term-text">{r.runId}</span>, sortVal: (r) => r.runId },
    { key: "source", header: "Source", align: "center", render: (r) => <Tag tone={providerTone(r.source)}>{r.source}</Tag>, sortVal: (r) => r.source },
    { key: "dataset", header: "Dataset", render: (r) => <span className="text-term-text-dim">{r.dataset}</span>, sortVal: (r) => r.dataset },
    { key: "rows", header: "Rows", align: "right", render: (r) => <span className="text-term-text">{fmtInt(r.rows)}</span>, sortVal: (r) => r.rows },
    { key: "quality", header: "DQ", align: "right", render: (r) => <span className={r.qualityScore >= 90 ? "text-term-up" : r.qualityScore >= 70 ? "text-term-amber" : "text-term-down"}>{fmtNum(r.qualityScore, 0)}</span>, sortVal: (r) => r.qualityScore },
    { key: "started", header: "Started", render: (r) => <span className="text-term-text-mute">{r.started}</span>, sortVal: (r) => r.started },
    { key: "status", header: "Status", align: "center", render: (r) => <Tag tone={RUN_TONE[r.status]}>{r.status}</Tag>, sortVal: (r) => r.status },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="DATAOPS" title="Data Health & Lineage" desc="Provider runs, series outcomes, quality exceptions and production readiness" right={<span className="flex items-center gap-2"><ProvenanceBadge source={probe.health ? "LIVE" : "SIM"} /><Tag tone="blue">DRILLDOWN</Tag></span>} />

      <KpiStrip>
        <Stat label="Live Providers" value={`${providersLive}/${providers.length}`} sub={probe.health ? "live-probed" : "active feeds"} tone="up" />
        <Stat label="Avg Coverage" value={fmtPct(summary.averageCoverage, 0)} sub="provider coverage" tone="amber" />
        <Stat label="Failed Series" value={fmtInt(summary.staleSeries)} sub="stale or failed" tone={summary.staleSeries ? "down" : "up"} />
        <Stat label="Quality Issues" value={fmtInt(summary.qualityIssues)} sub="high or medium" tone={summary.qualityIssues ? "down" : "up"} />
        <Stat label="Ready Modules" value={`${summary.productionReadyModules}/${modules.length}`} sub="readiness >= 75" />
        <Stat label="Lineage Runs" value={fmtInt(lineage.length)} sub="full local history" tone="neutral" />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-12">
        <Panel title="Provider Health" code="PROV" className="xl:col-span-12" right={<span className="flex items-center gap-2"><Tag tone={probe.health ? "blue" : "neutral"}>{probe.health && probe.probedAt ? `LIVE PROBE ${probe.probedAt.slice(11, 19)}` : "PROBING…"}</Tag><button className="term-btn" onClick={() => downloadJson("dataops_providers", providers)}>Download</button></span>}>
          <div className="px-3 py-1 text-3xs text-term-text-mute">
            <span className="font-semibold">Status</span> is verified live by <span className="font-mono">/api/dataops/health</span> (FRED makes a real call); <span className="font-semibold">UNVERIFIED</span> = probe hasn't confirmed it. Coverage / Fresh / Series / Failed are illustrative targets, not live metrics.
          </div>
          <DataGrid columns={providerCols} rows={providers} rowKey={(r) => r.provider} selectedKey={selectedProvider} onRowClick={(r) => {
            setSelectedProvider(r.provider);
            setSelectedRunId(runs.find((run) => run.provider === r.provider)?.runId ?? selectedRunId);
          }} maxHeight="245px" initialSort={{ key: "coverage", dir: "desc" }} zebra />
        </Panel>

        <Panel title={`${selectedProvider} Runs`} code="RUN" className="xl:col-span-7" right={<span className="flex items-center gap-2"><Tag tone={live ? "blue" : "neutral"}>{live ? "LIVE MANIFEST" : "FIXTURES"}</Tag><button className="term-btn" onClick={() => downloadJson(`dataops_${selectedProvider.toLowerCase()}_runs`, selectedProviderRuns)}>Download</button></span>}>
          <DataGrid columns={runCols} rows={selectedProviderRuns} rowKey={(r) => r.runId} selectedKey={selectedRun.runId} onRowClick={(r) => setSelectedRunId(r.runId)} maxHeight="330px" initialSort={{ key: "started", dir: "desc" }} zebra />
        </Panel>

        <Panel title={`Run Detail ${selectedRun.runId}`} code="DETAIL" className="xl:col-span-5" right={<Tag tone={RUN_TONE[selectedRun.status]}>{selectedRun.status}</Tag>}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 p-3 text-xs">
            <Stat label="Requested" value={fmtInt(selectedRun.requestedSeries)} sub="series" />
            <Stat label="Succeeded" value={fmtInt(selectedRun.successSeries)} sub={`${fmtPct((selectedRun.successSeries / selectedRun.requestedSeries) * 100, 0)} pass`} tone="up" />
            <Stat label="Failed" value={fmtInt(selectedRun.failedSeries)} sub="series" tone={selectedRun.failedSeries ? "down" : "up"} />
            <Stat label="Rejected" value={fmtInt(selectedRun.rowsRejected)} sub="rows" tone={selectedRun.rowsRejected ? "amber" : "up"} />
          </div>
          <div className="border-t border-term-border p-3 text-xs">
            <div className="term-label mb-1">Artifact</div>
            <div className="break-all font-mono text-term-text-dim">{selectedRun.artifact}</div>
            <button className="term-btn mt-3" onClick={() => downloadJson(`dataops_${selectedRun.runId}_series`, selectedRunSeries)}>Download Series Results</button>
          </div>
        </Panel>

        <Panel title={`${selectedRun.runId} Series Outcomes`} code="SERIES" className="xl:col-span-12" accent right={<Tag tone={selectedRun.failedSeries ? "down" : "up"}>{fmtInt(selectedRun.failedSeries)} failed</Tag>}>
          <DataGrid columns={seriesCols} rows={selectedRunSeries} rowKey={(r) => `${r.runId}-${r.seriesId}`} maxHeight="360px" initialSort={{ key: "status", dir: "asc" }} zebra />
        </Panel>

        <Panel title="Readiness Score - All Functions" code="READY" className="xl:col-span-4">
          <div className="p-2">
            <BarChart horizontal data={modules.map((m) => ({ label: m.module, value: m.readiness, color: m.readiness >= 75 ? "#2ECC71" : m.readiness >= 55 ? "#FF8C00" : "#FF3B3B" }))} fmt={(n) => fmtNum(n, 0)} />
          </div>
        </Panel>

        <Panel title="Module Data Mix" code="MIX" className="xl:col-span-8">
          <DataGrid columns={moduleCols} rows={modules} rowKey={(r) => r.module} selectedKey={selectedModuleCoverage.module} onRowClick={(r) => setSelectedModule(r.module)} maxHeight="415px" initialSort={{ key: "readiness", dir: "desc" }} zebra />
        </Panel>

        <Panel
          title={`${selectedModuleCoverage.module} Item Data Mix`}
          code="ITEMS"
          className="xl:col-span-12"
          right={<button className="term-btn" onClick={() => downloadCsv(`dataops_${selectedModuleCoverage.module.toLowerCase()}_data_mix`, selectedModuleItems)}>Download CSV</button>}
        >
          <div className="grid grid-cols-4 border-b border-term-border bg-term-panel-2/40">
            <Stat label="Live Items" value={fmtInt(selectedModuleItems.filter((i) => i.status === "LIVE").length)} sub={selectedModuleCoverage.functionName} tone="up" />
            <Stat label="Cached Items" value={fmtInt(selectedModuleItems.filter((i) => i.status === "CACHED").length)} sub="snapshot/cache" />
            <Stat label="Sim Items" value={fmtInt(selectedModuleItems.filter((i) => i.status === "SIM").length)} sub="fallback" tone="amber" />
            <Stat label="Stale Items" value={fmtInt(selectedModuleItems.filter((i) => i.status === "STALE").length)} sub="outside SLA" tone={selectedModuleItems.some((i) => i.status === "STALE") ? "down" : "up"} />
          </div>
          <DataGrid columns={moduleItemCols} rows={selectedModuleItems} rowKey={(r) => r.itemId} maxHeight="330px" initialSort={{ key: "status", dir: "asc" }} zebra />
        </Panel>

        <Panel title="Data Quality Exceptions" code="DQ" className="xl:col-span-8" accent right={<button className="term-btn" onClick={() => downloadJson("dataops_quality_exceptions", issues)}>Download</button>}>
          <DataGrid columns={issueCols} rows={issues} rowKey={(r) => r.id} selectedKey={selectedIssue.id} onRowClick={(r) => setSelectedIssueId(r.id)} maxHeight="285px" initialSort={{ key: "severity", dir: "desc" }} zebra />
        </Panel>

        <Panel title={`Exception Detail ${selectedIssue.id}`} code="DQD" className="xl:col-span-4" right={<Tag tone={ISSUE_TONE[selectedIssue.severity]}>{selectedIssue.severity}</Tag>}>
          <div className="space-y-3 p-3 text-xs">
            <div>
              <div className="term-label">Owner / Window</div>
              <div className="text-term-text">{selectedIssue.owner}</div>
              <div className="text-term-text-mute">{selectedIssue.firstSeen} → {selectedIssue.lastSeen}</div>
            </div>
            <div>
              <div className="term-label">Remediation</div>
              <div className="text-term-text-dim">{selectedIssue.remediation}</div>
            </div>
            <div>
              <div className="term-label">Affected Series</div>
              <div className="mt-1 flex flex-wrap gap-1">{selectedIssue.affectedSeries.map((s) => <Tag key={s} tone="neutral">{s}</Tag>)}</div>
            </div>
            <div>
              <div className="term-label">Sample Rows</div>
              <div className="mt-1 space-y-1 font-mono text-2xs text-term-text-dim">{selectedIssue.sampleRows.map((r) => <div key={r}>{r}</div>)}</div>
            </div>
          </div>
        </Panel>

        <Panel title="All Data Lineage Runs" code="LINEAGE" className="xl:col-span-8" right={<span className="flex items-center gap-2"><Tag tone={live ? "blue" : "neutral"}>{live ? "LIVE MANIFEST" : "FIXTURES"}</Tag><button className="term-btn" onClick={() => downloadJson("dataops_lineage_runs", lineage)}>Download</button></span>}>
          <DataGrid columns={lineageCols} rows={lineage} rowKey={(r) => r.runId} selectedKey={selectedLineage.runId} onRowClick={(r) => setSelectedLineageId(r.runId)} maxHeight="390px" initialSort={{ key: "started", dir: "desc" }} zebra />
        </Panel>

        <Panel title={`Lineage Detail ${selectedLineage.runId}`} code="TRACE" className="xl:col-span-4" right={<Tag tone={RUN_TONE[selectedLineage.status]}>{selectedLineage.status}</Tag>}>
          <div className="space-y-3 p-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Rows" value={fmtInt(selectedLineage.rows)} />
              <Stat label="Quality" value={fmtNum(selectedLineage.qualityScore, 0)} tone={selectedLineage.qualityScore >= 90 ? "up" : selectedLineage.qualityScore >= 70 ? "amber" : "down"} />
              <Stat label="Duration" value={`${fmtInt(selectedLineage.durationMs)}ms`} />
              <Stat label="Downstream" value={fmtInt(selectedLineage.downstream.length)} />
            </div>
            <div>
              <div className="term-label">Upstream Run</div>
              <div className="font-mono text-term-text-dim">{selectedLineage.upstreamRunId}</div>
            </div>
            <div>
              <div className="term-label">Downstream Modules</div>
              <div className="mt-1 flex flex-wrap gap-1">{selectedLineage.downstream.map((m) => <Tag key={m} tone="blue">{m}</Tag>)}</div>
            </div>
            <div>
              <div className="term-label">Artifact</div>
              <div className="break-all font-mono text-term-text-dim">{selectedLineage.artifact}</div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
