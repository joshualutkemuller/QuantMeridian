import { useState, useMemo } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { CorrelationMatrix } from "@/components/charts/Matrix";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { fmtNum, fmtSignedPct, pnlClass } from "@/lib/format";
import { useMarketView } from "@/lib/useMarket";
import {
  type CrossCorrelationResult,
  type GrangerResult,
  type LaggedOlsResult,
  type CusumResult,
  type PeltResult,
  type EdaCoverage,
  type EdaView,
} from "@/data/marketPipeline";

function sigStars(p: number): string {
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  if (p < 0.05) return "*";
  return "";
}

function pvalTone(p: number): "up" | "amber" | "neutral" {
  if (p < 0.01) return "up";
  if (p < 0.05) return "amber";
  return "neutral";
}

/** Reason a panel is blank: an explicit coverage note, else a generic no-data line. */
function panelNote(coverage: EdaCoverage | undefined, key: keyof EdaCoverage): string {
  const c = coverage?.[key];
  return typeof c === "string" ? c : "No data from the configured source.";
}

function PanelEmpty({ note }: { note: string }) {
  return <div className="p-3 text-2xs text-term-text-mute">{note}</div>;
}

export default function EdaPage() {
  const { data, source } = useMarketView<EdaView>("eda");
  const [ccfIdx, setCcfIdx] = useState(0);

  const strongestLead = useMemo(() => {
    if (!data.cross_correlation.length) return null;
    return data.cross_correlation.reduce((best, p) =>
      Math.abs(p.best_corr) > Math.abs(best.best_corr) ? p : best,
    );
  }, [data]);

  const bestGranger = useMemo(() => {
    if (!data.granger_causality.length) return null;
    return data.granger_causality.reduce((best, g) => (g.p_value < best.p_value ? g : best));
  }, [data]);

  const recentChangepoints = useMemo(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);
    return data.cusum.reduce((count, c) => {
      return count + c.changepoints.filter((d) => new Date(d) >= cutoff).length;
    }, 0);
  }, [data]);

  const avgAbsCorr = useMemo(() => {
    const vals = data.cross_correlation.map((p) => Math.abs(p.best_corr));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [data]);

  const grangerSorted = useMemo(
    () => [...data.granger_causality].sort((a, b) => a.p_value - b.p_value),
    [data],
  );

  const olsSorted = useMemo(
    () => [...data.lagged_ols].sort((a, b) => b.best_r2 - a.best_r2),
    [data],
  );

  // The pair set is source-dependent (the snapshot and Gold curate different
  // lists), so a stored index can outlive the array it points into.
  const safeCcfIdx = Math.min(ccfIdx, Math.max(0, data.cross_correlation.length - 1));
  const selectedCcf = data.cross_correlation[safeCcfIdx];
  const heatmap = data.pearson_heatmap;

  // Every hook above runs unconditionally, so bailing out here keeps hook order
  // stable across the loading → data transition.
  const isEmpty =
    !data.cross_correlation.length &&
    !data.granger_causality.length &&
    !data.lagged_ols.length &&
    !data.cusum.length &&
    !data.pelt.length &&
    !heatmap.labels.length;

  if (isEmpty) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          code="EDA"
          title="Exploratory Data Analysis"
          desc="Cross-correlation, Granger causality & structural breaks"
          right={<ProvenanceBadge source={source} />}
        />
        <div className="p-3 text-2xs text-term-text-mute">
          {source === "LOADING"
            ? "Loading EDA analytics…"
            : "No EDA analytics available. Configure MACRO_DB_URL (gold.series_lead_lag · series_correlation · series_structural_breaks), or enable Snapshot Fallback in the ribbon."}
        </div>
      </div>
    );
  }

  const grangerCols: Column<GrangerResult>[] = [
    {
      key: "pair",
      header: "Leader → Follower",
      render: (r) => `${r.leader_name} → ${r.follower_name}`,
      sortVal: (r) => r.leader_name,
    },
    {
      key: "lag",
      header: "Best Lag",
      align: "right",
      render: (r) => `${r.best_lag}mo`,
      sortVal: (r) => r.best_lag,
    },
    {
      key: "fstat",
      header: "F-Stat",
      align: "right",
      render: (r) => fmtNum(r.f_stat, 1),
      sortVal: (r) => r.f_stat,
    },
    {
      key: "pval",
      header: "p-value",
      align: "right",
      render: (r) => <Tag tone={pvalTone(r.p_value)}>{r.p_value.toFixed(4)}</Tag>,
      sortVal: (r) => r.p_value,
    },
    {
      key: "sig",
      header: "Sig",
      align: "center",
      render: (r) => <span className="text-term-amber">{sigStars(r.p_value)}</span>,
      sortVal: (r) => -sigStars(r.p_value).length,
    },
  ];

  const olsCols: Column<LaggedOlsResult>[] = [
    {
      key: "pair",
      header: "Leader → Follower",
      render: (r) => `${r.leader_name} → ${r.follower_name}`,
      sortVal: (r) => r.leader_name,
    },
    {
      key: "lag",
      header: "Best Lag",
      align: "right",
      render: (r) => `${r.best_lag}mo`,
      sortVal: (r) => r.best_lag,
    },
    {
      key: "r2",
      header: "R²",
      align: "right",
      render: (r) => fmtSignedPct(r.best_r2 * 100, 1),
      sortVal: (r) => r.best_r2,
    },
    {
      key: "beta",
      header: "Beta",
      align: "right",
      render: (r) => <span className={pnlClass(r.best_beta)}>{fmtNum(r.best_beta, 2)}</span>,
      sortVal: (r) => r.best_beta,
    },
    {
      key: "pval",
      header: "p-value",
      align: "right",
      render: (r) => <Tag tone={pvalTone(r.best_pvalue)}>{r.best_pvalue.toFixed(4)}</Tag>,
      sortVal: (r) => r.best_pvalue,
    },
  ];

  const cusumCols: Column<CusumResult>[] = [
    {
      key: "series",
      header: "Series",
      render: (r) => r.display_name,
      sortVal: (r) => r.display_name,
    },
    {
      key: "count",
      header: "Count",
      align: "right",
      render: (r) => r.changepoints.length,
      sortVal: (r) => r.changepoints.length,
    },
    {
      key: "dates",
      header: "Changepoints",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.changepoints.map((d) => (
            <Tag key={d} tone="amber">{d}</Tag>
          ))}
        </div>
      ),
    },
  ];

  const peltCols: Column<PeltResult>[] = [
    {
      key: "series",
      header: "Series",
      render: (r) => r.display_name,
      sortVal: (r) => r.display_name,
    },
    {
      key: "segs",
      header: "Segments",
      align: "right",
      render: (r) => r.segments.length,
      sortVal: (r) => r.segments.length,
    },
    {
      key: "latestReturn",
      header: "Latest μ Return",
      align: "right",
      render: (r) => {
        const s = r.segments[r.segments.length - 1];
        if (!s) return "—";
        return <span className={pnlClass(s.mean_return)}>{fmtSignedPct(s.mean_return * 100, 2)}</span>;
      },
      sortVal: (r) => r.segments[r.segments.length - 1]?.mean_return ?? 0,
    },
    {
      key: "latestVol",
      header: "Latest Vol",
      align: "right",
      render: (r) => {
        const s = r.segments[r.segments.length - 1];
        return s ? fmtSignedPct(s.volatility * 100, 2) : "—";
      },
      sortVal: (r) => r.segments[r.segments.length - 1]?.volatility ?? 0,
    },
    {
      key: "breaks",
      header: "Breakpoints",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.changepoints.map((d) => (
            <Tag key={d} tone="neutral">{d}</Tag>
          ))}
        </div>
      ),
    },
  ];

  const ccfPoints = selectedCcf?.ccf ?? [];
  const ccfMax = Math.max(...ccfPoints.map((p) => Math.abs(p.corr)), 0.01);
  const barW = 32;
  const barGap = 4;
  const chartW = ccfPoints.length * (barW + barGap) + 60;
  const chartH = 200;
  const axisY = chartH / 2;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        code="EDA"
        title="Exploratory Data Analysis"
        desc="Cross-correlation, Granger causality & structural breaks"
        asOf={data.asof}
        right={<ProvenanceBadge source={source} asOf={data.asof} />}
      />

      <KpiStrip>
        <Stat
          label="Strongest Lead"
          value={strongestLead ? `${strongestLead.leader_name} → ${strongestLead.follower_name}` : "—"}
          sub={strongestLead ? `${fmtNum(strongestLead.best_corr, 2)} at lag ${strongestLead.best_lag}` : undefined}
          tone={strongestLead ? (strongestLead.best_corr < 0 ? "down" : "up") : "neutral"}
        />
        <Stat
          label="Best Granger"
          value={bestGranger ? `${bestGranger.leader_name} → ${bestGranger.follower_name}` : "—"}
          sub={bestGranger ? `p=${bestGranger.p_value.toFixed(4)}` : undefined}
          tone={bestGranger ? "up" : "neutral"}
        />
        <Stat
          label="Active Changepoints"
          value={recentChangepoints}
          sub="last 6 months (CUSUM)"
          tone={recentChangepoints > 3 ? "amber" : "neutral"}
        />
        <Stat
          label="Avg |Cross-Corr|"
          value={avgAbsCorr === null ? "—" : fmtNum(avgAbsCorr, 2)}
          tone="neutral"
        />
        <Stat
          label="Pairs Analyzed"
          value={data.cross_correlation.length}
          tone="neutral"
        />
      </KpiStrip>

      <div className="analytics-grid flex-1 grid auto-rows-[minmax(20rem,auto)] grid-cols-12 gap-px bg-term-border">
        <Panel title="Granger Causality Tests" code="GRNR" className="col-span-12 xl:col-span-6">
          {grangerSorted.length ? (
            <DataGrid
              columns={grangerCols}
              rows={grangerSorted}
              rowKey={(r) => `${r.leader}-${r.follower}`}
              initialSort={{ key: "pval", dir: "asc" }}
            />
          ) : (
            <PanelEmpty note={panelNote(data.coverage, "granger_causality")} />
          )}
        </Panel>

        <Panel title="Lagged OLS Regression" code="OLS" className="col-span-12 xl:col-span-6">
          {olsSorted.length ? (
            <DataGrid
              columns={olsCols}
              rows={olsSorted}
              rowKey={(r) => `${r.leader}-${r.follower}`}
              initialSort={{ key: "r2", dir: "desc" }}
            />
          ) : (
            <PanelEmpty note={panelNote(data.coverage, "lagged_ols")} />
          )}
        </Panel>

        <Panel
          title="Cross-Correlation Function"
          code="CCF"
          subtitle={selectedCcf ? `${selectedCcf.leader_name} → ${selectedCcf.follower_name}` : undefined}
          className="col-span-12 xl:col-span-8"
        >
          {!selectedCcf ? (
            <PanelEmpty note={panelNote(data.coverage, "cross_correlation")} />
          ) : (
          <div className="flex flex-col gap-2 p-2">
            <div className="flex flex-wrap gap-1">
              {data.cross_correlation.map((p, i) => (
                <button
                  key={`${p.leader}-${p.follower}`}
                  onClick={() => setCcfIdx(i)}
                  className={`rounded-sm border px-1.5 py-px text-3xs font-semibold uppercase tracking-wide transition-colors ${
                    i === safeCcfIdx
                      ? "border-term-amber/60 bg-term-amber/15 text-term-amber"
                      : "border-term-border bg-term-panel-2 text-term-text-dim hover:text-term-text"
                  }`}
                >
                  {p.leader_name} → {p.follower_name}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${chartW} ${chartH + 30}`} className="w-full" style={{ minWidth: 480, maxHeight: 240 }}>
                <line x1={50} y1={axisY} x2={chartW - 10} y2={axisY} stroke="#3A3A4A" strokeWidth={1} />
                {selectedCcf.ccf.map((pt, i) => {
                  const x = 55 + i * (barW + barGap);
                  const barH = (Math.abs(pt.corr) / ccfMax) * (axisY - 10);
                  const y = pt.corr >= 0 ? axisY - barH : axisY;
                  const isBest = pt.lag === selectedCcf.best_lag;
                  const fill = isBest
                    ? "#FF8C00"
                    : pt.corr >= 0
                      ? "rgba(46,204,113,0.6)"
                      : "rgba(255,59,59,0.6)";
                  return (
                    <g key={pt.lag}>
                      <rect x={x} y={y} width={barW} height={barH} fill={fill} />
                      <text
                        x={x + barW / 2}
                        y={chartH + 14}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#9A9AA3"
                        fontFamily="var(--font-mono)"
                      >
                        {pt.lag}
                      </text>
                      <text
                        x={x + barW / 2}
                        y={pt.corr >= 0 ? y - 3 : y + barH + 11}
                        textAnchor="middle"
                        fontSize={8}
                        fill={isBest ? "#FF8C00" : "#9A9AA3"}
                        fontFamily="var(--font-mono)"
                      >
                        {pt.corr.toFixed(2)}
                      </text>
                    </g>
                  );
                })}
                <text x={chartW / 2} y={chartH + 28} textAnchor="middle" fontSize={10} fill="#6A6A7A" fontFamily="var(--font-mono)">
                  Lag (months)
                </text>
                <text x={14} y={axisY + 4} textAnchor="middle" fontSize={9} fill="#6A6A7A" fontFamily="var(--font-mono)" transform={`rotate(-90,14,${axisY})`}>
                  Corr
                </text>
              </svg>
            </div>
          </div>
          )}
        </Panel>

        <Panel title="Pearson Correlation Heatmap" code="CORR" className="col-span-12 xl:col-span-4" scroll>
          {heatmap.labels.length ? (
            <div className="p-2">
              <CorrelationMatrix labels={heatmap.labels} values={heatmap.matrix} height={420} />
            </div>
          ) : (
            <PanelEmpty note={panelNote(data.coverage, "pearson_heatmap")} />
          )}
        </Panel>

        <Panel title="CUSUM Changepoints" code="CUSUM" className="col-span-12 xl:col-span-6">
          {data.cusum.length ? (
            <DataGrid
              columns={cusumCols}
              rows={data.cusum}
              rowKey={(r) => r.series_id}
            />
          ) : (
            <PanelEmpty note={panelNote(data.coverage, "cusum")} />
          )}
        </Panel>

        <Panel title="PELT Regime Segments" code="PELT" className="col-span-12 xl:col-span-6">
          {data.pelt.length ? (
            <DataGrid
              columns={peltCols}
              rows={data.pelt}
              rowKey={(r) => r.series_id}
            />
          ) : (
            <PanelEmpty note={panelNote(data.coverage, "pelt")} />
          )}
        </Panel>
      </div>
    </div>
  );
}
