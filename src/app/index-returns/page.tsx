
import { useMemo, useState } from "react";
import clsx from "clsx";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { MarketDataControls } from "@/components/market/MarketDataControls";
import { getIndexReturnMatrix, INDEXES as FALLBACK_INDEXES, type IndexYearSummary } from "@/data/marketAnalytics";
import { useMarketView, type MarketSource } from "@/lib/useMarket";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { PRICE_SNAPSHOTS, SNAPSHOTS, type IndexReturnsView, type ReturnBasis } from "@/data/marketPipeline";
import { fmtNum, fmtSignedPct } from "@/lib/format";

function returnClass(v: number | null): string {
  if (v === null) return "text-term-text-mute";
  if (v > 0) return "text-term-up";
  if (v < 0) return "text-term-down";
  return "text-term-flat";
}

function heat(v: number | null): string {
  if (v === null) return "rgba(255,255,255,0.02)";
  const a = Math.min(0.72, 0.1 + Math.abs(v) / 18);
  return v >= 0 ? `rgba(46,204,113,${a.toFixed(3)})` : `rgba(255,59,59,${a.toFixed(3)})`;
}

function ReturnCell({ value, strong }: { value: number | null; strong?: boolean }) {
  return (
    <td className={clsx("border border-term-border px-2 py-1 text-right text-2xs", strong && "font-semibold")} style={{ background: heat(value) }}>
      <span className={returnClass(value)}>{value === null ? "—" : fmtSignedPct(value, 2)}</span>
    </td>
  );
}

function AnnualDrawdownBars({ data }: { data: IndexYearSummary[] }) {
  const max = Math.max(...data.flatMap((d) => [Math.abs(d.annualReturn ?? 0), Math.abs(d.maxDrawdown ?? 0)]), 1);
  return (
    <div className="space-y-2 p-2">
      {data.map((d) => (
        <div key={d.year} className="grid grid-cols-[58px_1fr_64px_1fr_64px] items-center gap-2 text-2xs">
          <div className="font-mono text-term-text-dim">{d.isYtd ? `${d.year} YTD` : d.year}</div>
          <div className="h-3 bg-term-panel-3">
            <div className="h-full" style={{ width: `${(Math.abs(d.annualReturn ?? 0) / max) * 100}%`, background: (d.annualReturn ?? 0) >= 0 ? "#2ECC71" : "#FF3B3B" }} />
          </div>
          <div className={clsx("tnum text-right", returnClass(d.annualReturn))}>{d.annualReturn === null ? "—" : fmtSignedPct(d.annualReturn, 1)}</div>
          <div className="h-3 bg-term-panel-3">
            <div className="h-full bg-term-down" style={{ width: `${(Math.abs(d.maxDrawdown ?? 0) / max) * 100}%` }} />
          </div>
          <div className="tnum text-right text-term-down">{d.maxDrawdown === null ? "—" : fmtSignedPct(d.maxDrawdown, 1)}</div>
        </div>
      ))}
      <div className="grid grid-cols-[58px_1fr_64px_1fr_64px] items-center gap-2 border-t border-term-border pt-2 text-3xs uppercase tracking-wider text-term-text-mute">
        <span />
        <span>Annual / YTD Return</span>
        <span />
        <span>Max Drawdown</span>
        <span />
      </div>
    </div>
  );
}

function hasUsableMatrix(matrix: IndexReturnsView["matrices"][string] | undefined): matrix is IndexReturnsView["matrices"][string] {
  return Boolean(
    matrix?.rows?.length &&
    matrix.summaries?.some((s) => !s.isYtd) &&
    Number.isFinite(matrix.ytdYear)
  );
}

function snapshotForBasis(basis: ReturnBasis): IndexReturnsView {
  return (basis === "price" ? PRICE_SNAPSHOTS["index-returns"] : SNAPSHOTS["index-returns"]) as unknown as IndexReturnsView;
}

export default function IndexReturnAnalyticsPage() {
  const [symbol, setSymbol] = useState("SPX");
  const [basis, setBasis] = useState<ReturnBasis>("total");
  const [asof, setAsOf] = useState("");
  const { data: liveData, source, earliestAsOf } = useMarketView<IndexReturnsView>("index-returns", basis, asof);
  const snapshotData = useMemo(() => snapshotForBasis(basis), [basis]);
  const indexes = liveData?.indices?.length ? liveData.indices : snapshotData.indices?.length ? snapshotData.indices : FALLBACK_INDEXES;
  const liveMatrix = liveData?.matrices?.[symbol];
  const snapshotMatrix = snapshotData.matrices?.[symbol];
  const matrixIsLive = hasUsableMatrix(liveMatrix);
  const matrixIsSnapshot = !matrixIsLive && hasUsableMatrix(snapshotMatrix);
  const matrix = useMemo(() => matrixIsLive ? liveMatrix : matrixIsSnapshot ? snapshotMatrix : getIndexReturnMatrix(symbol), [liveMatrix, matrixIsLive, matrixIsSnapshot, snapshotMatrix, symbol]);
  const matrixSource: MarketSource | "SIM" = matrixIsLive ? source : matrixIsSnapshot ? "SNAPSHOT" : "SIM";
  const matrixAsOf = matrixIsLive ? liveData?.asof : matrixIsSnapshot ? snapshotData.asof : undefined;
  const columns = [...matrix.years, matrix.ytdYear];
  const completedYears = matrix.summaries.filter((s) => !s.isYtd);
  const bestYear = [...completedYears].sort((a, b) => (b.annualReturn ?? -999) - (a.annualReturn ?? -999))[0] ?? null;
  const worstYear = [...completedYears].sort((a, b) => (a.annualReturn ?? 999) - (b.annualReturn ?? 999))[0] ?? null;
  const ytd = matrix.summaries.find((s) => s.isYtd);
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="IRET"
        title="Index Return Analytics"
        desc="Monthly return matrix, annual totals and intra-year drawdowns"
        asOf={asof || matrixAsOf || liveData?.asof || null}
        right={<span className="flex items-center gap-2"><MarketDataControls basis={basis} onBasisChange={setBasis} asof={asof} onAsOfChange={setAsOf} latestAsOf={liveData?.asof} earliestAsOf={earliestAsOf} /><PipelineTag source={matrixSource} asOf={matrixAsOf} /></span>}
      />

      <KpiStrip>
        <Stat label="Index" value={matrix.index.symbol} sub={matrix.index.name} tone="amber" />
        <Stat label="Underlying" value={matrix.index.proxy ?? matrix.index.symbol} sub={basis === "total" ? "adjusted close" : "raw close"} tone="neutral" />
        <Stat label="Current YTD" value={ytd?.annualReturn === null ? "—" : fmtSignedPct(ytd?.annualReturn ?? 0, 2)} sub={`${matrix.ytdYear} through Jun`} tone={(ytd?.annualReturn ?? 0) >= 0 ? "up" : "down"} />
        <Stat label="Best Full Year" value={bestYear ? `${bestYear.year}` : "—"} sub={bestYear ? fmtSignedPct(bestYear.annualReturn ?? 0, 2) : "need history"} tone="up" />
        <Stat label="Worst Full Year" value={worstYear ? `${worstYear.year}` : "—"} sub={worstYear ? fmtSignedPct(worstYear.annualReturn ?? 0, 2) : "need history"} tone="down" />
        <Stat label="Avg Annual*" value={fmtSignedPct(matrix.averageAnnualReturn, 2)} sub="excludes current YTD" />
      </KpiStrip>

      <div className="flex flex-wrap gap-1 border-b border-term-border bg-term-panel px-2 py-1">
        {indexes.map((idx) => (
          <button key={idx.symbol} onClick={() => setSymbol(idx.symbol)} className={`term-btn ${symbol === idx.symbol ? "term-btn-active" : ""}`} title={idx.name}>
            {idx.symbol}
          </button>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-12">
        <Panel
          title={`${matrix.index.name} Monthly Return Matrix`}
          code="MATRIX"
          className="xl:col-span-12"
          accent
          right={<span className="text-3xs text-term-text-mute">Proxy {matrix.index.proxy ?? matrix.index.symbol} · {basis === "total" ? "adjusted close" : "raw close"} · {asof || matrixAsOf || liveData?.asof || "latest"}</span>}
        >
          <div className="overflow-auto">
            <table className="w-full min-w-[1040px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-term-panel-2">
                  <th className="sticky left-0 z-20 border border-term-border bg-term-panel-2 px-2 py-1 text-left text-2xs uppercase text-term-text-mute">Month</th>
                  {columns.map((year) => (
                    <th key={year} className="border border-term-border px-2 py-1 text-right text-2xs uppercase text-term-text-mute">{year === matrix.ytdYear ? `${year} YTD` : year}</th>
                  ))}
                  <th className="border border-term-border px-2 py-1 text-right text-2xs uppercase text-term-text-mute">Month Avg</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {matrix.rows.map((row) => (
                  <tr key={row.month}>
                    <td className="sticky left-0 z-10 border border-term-border bg-term-panel px-2 py-1 text-xs font-semibold text-term-text-dim">{row.month}</td>
                    {columns.map((year) => <ReturnCell key={year} value={row.values[String(year)]} />)}
                    <ReturnCell value={row.monthAverage} strong />
                  </tr>
                ))}
                <tr>
                  <td className="sticky left-0 z-10 border border-term-border bg-term-panel-2 px-2 py-1 text-xs font-semibold text-term-amber">Annual / YTD</td>
                  {columns.map((year) => <ReturnCell key={year} value={matrix.annualReturns[String(year)]} strong />)}
                  <td className="border border-term-border bg-term-panel-2 px-2 py-1 text-right text-2xs text-term-text-mute">—</td>
                </tr>
                <tr>
                  <td className="sticky left-0 z-10 border border-term-border bg-term-panel-2 px-2 py-1 text-xs font-semibold text-term-amber">Avg Annual*</td>
                  {columns.map((year) => (
                    <td key={year} className="border border-term-border bg-term-panel-2 px-2 py-1 text-right text-2xs text-term-text-mute">{year === matrix.ytdYear ? "excluded" : "—"}</td>
                  ))}
                  <ReturnCell value={matrix.averageAnnualReturn} strong />
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Annual Return vs Max Drawdown" code="DDOWN" className="xl:col-span-8">
          <AnnualDrawdownBars data={matrix.summaries} />
        </Panel>

        <Panel title="Footnotes" code="NOTE" className="xl:col-span-4">
          <div className="space-y-2 p-3 text-xs text-term-text-dim">
            <p>Monthly cells show each month&apos;s return for the selected index and year.</p>
            <p>The `Annual / YTD` row compounds monthly returns within each year. The current year column is YTD only.</p>
            <p>The `Month Avg` column averages each month across the ten completed full years only.</p>
            <p><span className="text-term-amber">Avg Annual*</span> is the arithmetic average of completed annual returns and explicitly excludes the current YTD return.</p>
            <p>The selected index is calculated from the visible proxy ticker. SPX uses SPY, NDX uses QQQ, RUT uses IWM, INDU uses DIA, EAFE uses EFA, and EM uses EEM.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function PipelineTag({ source, asOf }: { source: MarketSource | "SIM"; asOf?: string | null }) {
  return <ProvenanceBadge source={source} asOf={asOf} />;
}
