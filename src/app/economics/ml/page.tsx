
import { useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ChartLink } from "@/components/charting/ChartLink";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { Gauge, ProgressBar } from "@/components/charts/Radial";
import { getMLModels, REGIME_STATES, type MLModel } from "@/data/econModels";
import { isRealEconSource, useLiveSeriesSet, type DataSource, type SeriesObs } from "@/lib/useEcon";
import { fmtNum, fmtPct } from "@/lib/format";

const STATUS_TONE: Record<MLModel["status"], "up" | "amber" | "blue"> = {
  LIVE: "up",
  TRAINING: "amber",
  STAGING: "blue",
};

function statusOf(models: MLModel[], id: string): MLModel | undefined {
  return models.find((m) => m.id === id);
}

function recessionProbFromSpread(pctPts: number): number {
  const bps = pctPts * 100;
  const z = -bps / 60;
  return Number((1 / (1 + Math.exp(-(z * 2 - 1.2))) * 100).toFixed(1));
}

function zHistory(values: number[]): number[] {
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length)) || 1;
  return values.map((v) => Number(((v - mean) / sd).toFixed(2)));
}

function latestMomPct(obs: { date: string; value: number }[]): number | null {
  if (obs.length < 2) return null;
  const cur = obs[obs.length - 1].value;
  const prev = obs[obs.length - 2].value;
  return prev ? Number(((cur / prev - 1) * 100).toFixed(2)) : null;
}

function overlayModel(model: MLModel, liveMap: Record<string, SeriesObs>): MLModel {
  if (model.id === "rec-prob") {
    const L = liveMap["T10Y2Y"];
    if (L && isRealEconSource(L.source) && L.observations.length) {
      const history = L.observations.map((o) => recessionProbFromSpread(o.value));
      return { ...model, output: history[history.length - 1], history, updated: L.observations[L.observations.length - 1].date };
    }
  }
  if (model.id === "infl-now") {
    const L = liveMap["PCEPILFE"];
    if (L && isRealEconSource(L.source) && L.observations.length) {
      const history = L.observations.slice(1).map((_, i) => latestMomPct(L.observations.slice(0, i + 2)) ?? 0);
      return { ...model, output: history[history.length - 1] ?? model.output, history, updated: L.observations[L.observations.length - 1].date };
    }
  }
  if (model.id === "rate-path") {
    const L = liveMap["FEDFUNDS"];
    if (L && isRealEconSource(L.source) && L.observations.length) {
      const last = L.observations[L.observations.length - 1];
      return { ...model, output: Number(Math.max(0, last.value - 0.75).toFixed(2)), history: L.observations.map((o) => o.value), updated: last.date };
    }
  }
  if (model.id === "fci") {
    const L = liveMap["NFCI"];
    if (L && isRealEconSource(L.source) && L.observations.length) {
      const history = L.observations.map((o) => Number(o.value.toFixed(2)));
      return { ...model, output: history[history.length - 1], history, updated: L.observations[L.observations.length - 1].date };
    }
  }
  if (model.id === "labor-mom") {
    const L = liveMap["ICSA"];
    if (L && isRealEconSource(L.source) && L.observations.length) {
      const history = zHistory(L.observations.map((o) => o.value));
      return { ...model, output: history[history.length - 1], history, updated: L.observations[L.observations.length - 1].date };
    }
  }
  return model;
}

export default function MLApplications() {
  const { data: liveMap, source } = useLiveSeriesSet(["T10Y2Y", "PCEPILFE", "FEDFUNDS", "NFCI", "ICSA"], "lin", 48);
  const models = getMLModels().map((m) => overlayModel(m, liveMap));
  const modelSource: DataSource = isRealEconSource(source) ? source : "SIM";
  const rec = statusOf(models, "rec-prob");
  const infl = statusOf(models, "infl-now");
  const rate = statusOf(models, "rate-path");
  const regime = statusOf(models, "regime");

  const recProb = rec?.output ?? 0;
  const liveCount = models.filter((m) => m.status === "LIVE").length;
  const bestAuc = Math.max(...models.map((m) => m.auc));
  const regimeIdx = regime ? Math.max(0, Math.min(REGIME_STATES.length - 1, Math.round(regime.output))) : 0;
  const regimeLabel = REGIME_STATES[regimeIdx];

  const [selId, setSelId] = useState("rec-prob");
  const sel = statusOf(models, selId) ?? models[0];
  const selFeatures = [...sel.features].sort((a, b) => b.importance - a.importance);
  const isRecSelected = sel.id === "rec-prob";

  const selectCls =
    "tnum border border-term-border bg-term-panel-2 px-1.5 py-0.5 text-2xs text-term-text focus:border-term-amber focus:outline-none";

  const registryCols: Column<MLModel>[] = [
    {
      key: "name",
      header: "Model",
      render: (m) => <span className="font-semibold text-term-text">{m.name}</span>,
      sortVal: (m) => m.name,
    },
    {
      key: "task",
      header: "Task",
      render: (m) => <Tag tone="violet">{m.task}</Tag>,
      sortVal: (m) => m.task,
    },
    {
      key: "algo",
      header: "Algo",
      render: (m) => <span className="font-mono text-2xs text-term-text-mute">{m.algo}</span>,
    },
    {
      key: "target",
      header: "Target",
      render: (m) => <span className="text-term-text-dim">{m.target}</span>,
    },
    {
      key: "output",
      header: "Output",
      align: "right",
      render: (m) => (
        <span className="text-term-amber">
          {fmtNum(m.output, 2)} {m.outputUnit}
        </span>
      ),
      sortVal: (m) => m.output,
    },
    {
      key: "conf",
      header: "Conf%",
      align: "right",
      render: (m) => <span className="text-term-text">{fmtNum(m.confidence, 0)}</span>,
      sortVal: (m) => m.confidence,
    },
    {
      key: "auc",
      header: "AUC",
      align: "right",
      render: (m) => (
        <span className="text-term-text-dim">{m.auc > 0 ? fmtNum(m.auc, 2) : "—"}</span>
      ),
      sortVal: (m) => m.auc,
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (m) => <Tag tone={STATUS_TONE[m.status]}>{m.status}</Tag>,
      sortVal: (m) => m.status,
    },
    {
      key: "updated",
      header: "Updated",
      align: "right",
      render: (m) => <span className="text-term-text-mute">{m.updated}</span>,
      sortVal: (m) => m.updated,
    },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="EML"
        title="ML Applications"
        desc="Recession, nowcast & rate-path models"
        right={<span className="flex items-center gap-2"><ChartLink refs={[{ source: "econ", id: "UNRATE" }, { source: "econ", id: "T10Y2Y" }]} range="5Y" /><ProvenanceBadge source={modelSource} /><Tag tone="up">{liveCount} LIVE</Tag></span>}
      />

      <KpiStrip>
        <Stat
          label="Recession Prob 12M"
          value={fmtPct(recProb, 1)}
          sub="yield-curve probit"
          tone={recProb > 40 ? (recProb > 60 ? "down" : "amber") : "neutral"}
        />
        <Stat
          label="Inflation Nowcast"
          value={`${fmtNum(infl?.output ?? 0, 2)} ${infl?.outputUnit ?? ""}`}
          sub="Core PCE"
          tone="amber"
        />
        <Stat
          label="Rate-Path 12M"
          value={fmtPct(rate?.output ?? 0, 2)}
          sub="EFFR forecast"
        />
        <Stat label="Models Live" value={liveCount} sub={`${models.length} registered`} tone="up" />
        <Stat label="Best AUC" value={fmtNum(bestAuc, 2)} sub="classifiers" tone="amber" />
        <Stat label="Regime" value={regimeLabel} sub={`state ${regimeIdx}`} />
      </KpiStrip>

      {/* Model cards */}
      <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 xl:grid-cols-4">
        {models.map((m) => (
          <Panel
            key={m.id}
            title={m.name}
            code={m.id.toUpperCase()}
            right={<Tag tone={STATUS_TONE[m.status]}>{m.status}</Tag>}
            accent={m.id === "rec-prob"}
          >
            <div className="flex flex-col gap-2 p-2">
              <div className="flex items-center gap-1.5">
                <Tag tone="violet">{m.task}</Tag>
                {m.auc > 0 && <Tag tone="blue">AUC {fmtNum(m.auc, 2)}</Tag>}
              </div>
              <div className="font-mono text-3xs leading-relaxed text-term-text-mute">{m.algo}</div>
              <Stat
                label={m.target}
                value={
                  <span>
                    {fmtNum(m.output, 2)}
                    <span className="ml-1 text-xs text-term-text-mute">{m.outputUnit}</span>
                  </span>
                }
                tone="amber"
                className="px-0"
              />
              <div>
                <div className="mb-0.5 flex items-center justify-between text-3xs text-term-text-mute">
                  <span>Confidence</span>
                  <span className="tnum">{fmtNum(m.confidence, 0)}%</span>
                </div>
                <ProgressBar
                  value={m.confidence}
                  color={m.confidence >= 75 ? "#2ECC71" : m.confidence >= 60 ? "#FF8C00" : "#FF3B3B"}
                  height={5}
                />
              </div>
              <div className="flex items-center justify-between text-3xs text-term-text-mute">
                <span>{m.features.length} features</span>
                <span className="tnum">upd {m.updated}</span>
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 px-2 pb-2 xl:grid-cols-3">
        {/* Feature importance */}
        <Panel
          title="Feature Importance"
          code="FEAT"
          right={
            <select className={selectCls} value={selId} onChange={(e) => setSelId(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          }
        >
          <div className="p-2">
            <BarChart
              horizontal
              data={selFeatures.map((f) => ({ label: f.name, value: f.importance }))}
              fmt={(n) => fmtNum(n, 2)}
            />
            <p className="mt-2 text-3xs leading-relaxed text-term-text-mute">
              Normalized importances for {sel.name} ({sel.algo}). Sorted descending.
            </p>
          </div>
        </Panel>

        {/* Output history */}
        <Panel
          title="Model Output History"
          code="HIST"
          right={<Tag tone="amber">{sel.target}</Tag>}
        >
          <div className="p-2">
            <LineChart
              height={220}
              series={[
                {
                  name: sel.target,
                  data: sel.history,
                  color: "#FF8C00",
                  area: true,
                },
              ]}
              yFmt={(n) => (isRecSelected ? `${n.toFixed(0)}%` : fmtNum(n, 2))}
            />
            {isRecSelected && (
              <div className="mt-1 flex items-center gap-2 text-3xs text-term-text-mute">
                <span className="inline-block h-1.5 w-3 bg-term-amber" />
                Recession probability (0–100%). Recession-signal threshold ≈ 40%.
              </div>
            )}
            <p className="mt-1 text-3xs leading-relaxed text-term-text-mute">
              {sel.history.length}-period predicted path for {sel.target}.
            </p>
          </div>
        </Panel>

        {/* Recession spotlight */}
        <Panel
          title="Recession Model Spotlight"
          code="REC"
          accent
          right={<Tag tone="up">{rec?.status ?? "—"}</Tag>}
        >
          <div className="flex flex-col items-center p-2">
            <Gauge value={recProb} max={100} size={150} label="NBER 12M" warn={40} danger={60} />
            <div className="mt-1 grid w-full grid-cols-3 gap-px bg-term-border">
              <Stat label="Prob 12M" value={fmtPct(recProb, 1)} tone={recProb > 40 ? "amber" : "neutral"} className="bg-term-panel" />
              <Stat label="AUC" value={fmtNum(rec?.auc ?? 0, 2)} className="bg-term-panel" />
              <Stat label="Conf" value={`${fmtNum(rec?.confidence ?? 0, 0)}%`} className="bg-term-panel" />
            </div>
            <p className="mt-2 text-2xs leading-relaxed text-term-text-dim">
              Yield-curve probit implies a {fmtPct(recProb, 1)} probability of an NBER recession
              within 12 months (AUC {fmtNum(rec?.auc ?? 0, 2)}). Reading{" "}
              {recProb > 40 ? "above" : "below"} the ~40% signal threshold —{" "}
              {recProb > 40 ? "elevated risk." : "subdued risk."}
            </p>
          </div>
        </Panel>
      </div>

      {/* Model registry */}
      <div className="px-2 pb-2">
        <Panel title="Model Registry" code="REG">
          <DataGrid
            columns={registryCols}
            rows={models}
            rowKey={(m) => m.id}
            initialSort={{ key: "status", dir: "asc" }}
            maxHeight="260px"
          />
        </Panel>
      </div>
    </div>
  );
}
