
import { Fragment, useMemo, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { MarketDataControls } from "@/components/market/MarketDataControls";
import { getAssetQuilt, quiltColor, type QuiltYear } from "@/data/marketAnalytics";
import { useMarketView, type MarketSource } from "@/lib/useMarket";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import type { BilelloView, BilelloMonthlyReturn, BilelloDailyPrice, ReturnBasis } from "@/data/marketPipeline";
import { fmtNum, fmtSignedPct } from "@/lib/format";
import { StalenessBar } from "@/components/ui/StalenessBar";

function tone(v: number): "up" | "down" | "amber" | "neutral" {
  if (v > 10) return "up";
  if (v < 0) return "down";
  if (v < 4) return "neutral";
  return "amber";
}

export default function AssetQuiltPage() {
  const [basis, setBasis] = useState<ReturnBasis>("total");
  const [asof, setAsOf] = useState("");
  const { data: bilello, source, earliestAsOf } = useMarketView<BilelloView>("bilello", basis, asof);
  const quilt = useMemo(() => quiltFromBilello(bilello, asof) ?? getAssetQuilt(), [bilello, asof]);
  const effectiveAsOf = asof || bilello?.asof || null;
  const latest = quilt[quilt.length - 1];
  const bestLatest = latest.cells[0];
  const worstLatest = latest.cells[latest.cells.length - 1];
  const leaders = quilt.reduce<Record<string, number>>((acc, y) => {
    acc[y.cells[0].asset] = (acc[y.cells[0].asset] ?? 0) + 1;
    return acc;
  }, {});
  const leader = Object.entries(leaders).sort((a, b) => b[1] - a[1])[0];
  const dispersion = latest.cells[0].returnPct - latest.cells[latest.cells.length - 1].returnPct;
  const proxyRows = useMemo(() => {
    const seen = new Map<string, NonNullable<QuiltYear["cells"][number]>>();
    for (const year of quilt) {
      for (const cell of year.cells) {
        const key = cell.proxyTicker ?? cell.asset;
        if (!seen.has(key)) seen.set(key, cell);
      }
    }
    return [...seen.values()].sort((a, b) => (a.proxyTicker ?? a.asset).localeCompare(b.proxyTicker ?? b.asset));
  }, [quilt]);

  const maxRank = Math.max(...quilt.map((y) => y.cells.length));

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="QUILT"
        title="Asset Quilt"
        desc="Annual ETF/index proxy return rank quilt"
        asOf={effectiveAsOf}
        right={<span className="flex items-center gap-2"><MarketDataControls basis={basis} onBasisChange={setBasis} asof={asof} onAsOfChange={setAsOf} latestAsOf={bilello?.asof} earliestAsOf={earliestAsOf} /><PipelineTag source={source} asOf={bilello?.asof} /></span>}
      />

      <StalenessBar asOf={effectiveAsOf} />

      <KpiStrip>
        <Stat label="Latest Leader" value={bestLatest.proxyTicker ?? bestLatest.asset} sub={`${fmtSignedPct(bestLatest.returnPct, 1)} · ${bestLatest.asOf ?? latest.asOf ?? "as of n/a"}`} tone={tone(bestLatest.returnPct)} />
        <Stat label="Latest Laggard" value={worstLatest.proxyTicker ?? worstLatest.asset} sub={`${fmtSignedPct(worstLatest.returnPct, 1)} · ${worstLatest.asOf ?? latest.asOf ?? "as of n/a"}`} tone={tone(worstLatest.returnPct)} />
        <Stat label="Dispersion" value={`${fmtNum(dispersion, 1)} pts`} sub={`${latest.year} high-low`} tone="amber" />
        <Stat label="Most #1 Finishes" value={leader?.[0] ?? "—"} sub={`${leader?.[1] ?? 0} years`} />
        <Stat label="Years" value={`${quilt[0].year}-${latest.year}`} sub={`${quilt.length} years${latest.year === new Date().getFullYear() ? " + current YTD" : ""}`} />
        <Stat label="Return As Of" value={effectiveAsOf ?? latest.asOf ?? "—"} sub={basis === "total" ? "adj close total return" : "raw close price return"} tone="neutral" />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-12">
        <Panel
          title="ETF / Index Proxy Return Quilt"
          code="RANK"
          className="xl:col-span-12"
          accent
          right={<span className="text-3xs text-term-text-mute">{source} · {basis === "total" ? "adjusted close total return" : "raw close price return"} · returns as of {effectiveAsOf ?? "latest"}</span>}
        >
          <div className="overflow-auto">
            <div className="grid min-w-[1080px]" style={{ gridTemplateColumns: `76px repeat(${quilt.length}, minmax(88px, 1fr))` }}>
              <div className="sticky left-0 z-20 border-b border-r border-term-border bg-term-panel-2 px-2 py-1 text-2xs font-semibold uppercase text-term-text-mute">Rank</div>
              {quilt.map((y) => (
                <div key={y.year} className="border-b border-r border-term-border bg-term-panel-2 px-2 py-1 text-center">
                  <div className="text-2xs font-semibold text-term-text-dim">{y.year === latest.year && y.year === new Date().getFullYear() ? `${y.year} YTD` : y.year}</div>
                  <div className="tnum mt-0.5 text-[9px] font-medium text-term-text-mute">{y.asOf ?? "as of n/a"}</div>
                </div>
              ))}

              {Array.from({ length: maxRank }, (_, rank) => (
                <Fragment key={`rank-row-${rank}`}>
                  <div key={`rank-${rank}`} className="sticky left-0 z-10 border-b border-r border-term-border bg-term-panel px-2 py-3 text-center text-xs font-semibold text-term-text-mute">
                    #{rank + 1}
                  </div>
                  {quilt.map((year) => {
                    const cell = year.cells[rank];
                    if (!cell) {
                      return <div key={`${year.year}-empty-${rank}`} className="min-h-[64px] border-b border-r border-black/40 bg-term-panel" />;
                    }
                    return (
                      <div key={`${year.year}-${cell.asset}`} className="min-h-[74px] border-b border-r border-black/40 p-1.5" style={{ background: quiltColor(cell.asset) }} title={`${cell.proxyTicker ?? cell.asset} · ${cell.displayName ?? cell.assetClass ?? ""} · return as of ${cell.asOf ?? year.asOf ?? "n/a"}`}>
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0 truncate text-2xs font-semibold uppercase leading-tight text-black/85">{cell.proxyTicker ?? cell.asset}</div>
                          {cell.assetClass && <div className="shrink-0 rounded-sm bg-black/15 px-1 text-[8px] font-bold leading-4 text-black/70">{cell.assetClass}</div>}
                        </div>
                        <div className="mt-0.5 truncate text-[9px] font-semibold leading-tight text-black/65" title={cell.displayName}>{cell.displayName ?? cell.asset}</div>
                        <div className="tnum mt-1 text-lg font-bold leading-none text-black">{fmtSignedPct(cell.returnPct, 1)}</div>
                        <div className="tnum mt-1 text-[9px] font-semibold leading-tight text-black/60">as of {cell.asOf ?? year.asOf ?? "n/a"}</div>
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="How to Read" code="NOTE" className="xl:col-span-4">
          <div className="space-y-2 p-3 text-xs text-term-text-dim">
            <p>Each column ranks the actual ETF/index proxy ticker from best annual return at the top to worst annual return at the bottom.</p>
            <p>The current year column is YTD, so it should not be compared as a full-year return.</p>
            <p>Default view ranks adjusted-close total returns. Switch to price return to rank raw-close performance. The data source badge and DATA AS OF date show the exact feed state.</p>
          </div>
        </Panel>

        <Panel title="Latest Ranking" code="YTD" className="xl:col-span-4">
          <div className="grid grid-cols-2 gap-px bg-term-border md:grid-cols-5">
            {latest.cells.map((c) => (
              <div key={c.asset} className="bg-term-panel p-2">
                <div className="flex items-center justify-between gap-2">
                  <Tag tone={tone(c.returnPct)}>#{c.rank}</Tag>
                  <span className="tnum text-xs font-semibold text-term-text">{fmtSignedPct(c.returnPct, 1)}</span>
                </div>
                <div className="mt-1 truncate text-xs font-semibold text-term-text" title={c.displayName}>{c.proxyTicker ?? c.asset}</div>
                <div className="truncate text-2xs text-term-text-dim" title={c.displayName}>{c.displayName ?? c.assetClass}</div>
                <div className="tnum mt-1 text-[10px] text-term-text-mute">as of {c.asOf ?? latest.asOf ?? "n/a"}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Proxy Universe" code="ETF" className="xl:col-span-4" right={<span className="text-3xs text-term-text-mute">{proxyRows.length} proxies</span>}>
          <div className="max-h-[260px] overflow-auto">
            <table className="w-full text-left text-2xs">
              <thead className="sticky top-0 bg-term-panel-2 text-term-text-mute">
                <tr>
                  <th className="px-2 py-1 font-semibold uppercase">Proxy</th>
                  <th className="px-2 py-1 font-semibold uppercase">Name</th>
                  <th className="px-2 py-1 font-semibold uppercase">Class</th>
                </tr>
              </thead>
              <tbody>
                {proxyRows.map((p) => (
                  <tr key={p.proxyTicker ?? p.asset} className="border-t border-term-border-soft">
                    <td className="px-2 py-1 font-semibold text-term-amber">{p.proxyTicker ?? p.asset}</td>
                    <td className="px-2 py-1 text-term-text-dim">{p.displayName ?? p.asset}</td>
                    <td className="px-2 py-1 text-term-text-mute">{p.assetClass ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function returnAsOfForYear(year: number, effectiveAsOf: string | null): string {
  if (!effectiveAsOf) return `${year}-12-31`;
  const asOfYear = Number(effectiveAsOf.slice(0, 4));
  if (!Number.isFinite(asOfYear) || year < asOfYear) return `${year}-12-31`;
  if (year === asOfYear) return effectiveAsOf;
  return `${year}-12-31`;
}

function returnFromDaily(daily: BilelloDailyPrice[], seriesId: string, yearStart: number, asof: string): number | null {
  const priorYearEnd = `${yearStart - 1}-12-31`;
  const seriesPrices = daily.filter((r) => r.series_id === seriesId);
  const basePrices = seriesPrices.filter((r) => r.date <= priorYearEnd);
  const base = basePrices.length ? basePrices[basePrices.length - 1].price : null;
  const endPrices = seriesPrices.filter((r) => r.date >= `${yearStart}-01-01` && r.date <= asof);
  const end = endPrices.length ? endPrices[endPrices.length - 1].price : null;
  if (base == null || end == null || base === 0) return null;
  return end / base - 1;
}

function compoundMonthly(monthly: BilelloMonthlyReturn[], seriesId: string, year: number, maxMonth: number): number | null {
  const rows = monthly.filter((r) => r.series_id === seriesId && r.year === year && r.month <= maxMonth);
  if (!rows.length) return null;
  return rows.reduce((acc, r) => acc * (1 + r.monthly_return), 1) - 1;
}

function quiltFromBilello(bilello: BilelloView | null | undefined, asof: string): QuiltYear[] | null {
  const annualRows = bilello?.asset_class_returns_by_year ?? [];
  if (!annualRows.length) return null;
  const daily = bilello?.asset_daily_prices ?? [];
  const monthly = bilello?.asset_monthly_returns ?? [];
  const hasDaily = daily.length > 0;
  const hasMonthly = monthly.length > 0;
  const effectiveAsOf = asof || bilello?.asof || null;

  const maxYear = asof ? parseInt(asof.slice(0, 4), 10) : 9999;
  const maxMonth = asof ? parseInt(asof.slice(5, 7), 10) : 12;
  const isPartialDate = asof !== "" && maxYear < 9999;
  const years = Array.from(new Set(annualRows.map((r) => r.year))).sort((a, b) => a - b).filter((y) => y <= maxYear);
  if (!years.length) return null;

  return years.map((year) => {
    const yearAsOf = returnAsOfForYear(year, effectiveAsOf);
    const isPartialYear = isPartialDate && year === maxYear;
    const needsGranular = isPartialYear && !(maxMonth === 12 && asof.endsWith("12-31"));
    const cells = annualRows
      .filter((r) => r.year === year && r.total_return !== null)
      .map((r) => {
        let ret: number | null = r.total_return;
        if (needsGranular) {
          if (hasDaily) {
            ret = returnFromDaily(daily, r.series_id ?? "", year, asof);
          } else if (hasMonthly) {
            ret = compoundMonthly(monthly, r.series_id ?? "", year, maxMonth);
          }
        }
        if (ret === null) return null;
        return {
          year,
          asset: r.series_id ?? prettyAssetClass(r.asset_class),
          proxyTicker: r.series_id,
          displayName: r.display_name,
          assetClass: r.asset_class,
          asOf: yearAsOf,
          returnPct: Number((ret * 100).toFixed(1)),
          rank: 0,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.returnPct - a.returnPct)
      .map((c, i) => ({ ...c, rank: i + 1 }));
    return { year, asOf: yearAsOf, cells };
  }).filter((y) => y.cells.length);
}

function prettyAssetClass(assetClass: string): string {
  const map: Record<string, string> = {
    EQUITY: "Equities",
    BOND: "Bonds",
    CREDIT: "Credit",
    COMMODITY: "Commodities",
    VOLATILITY: "Volatility",
    CURRENCY: "Currencies",
  };
  return map[assetClass] ?? assetClass;
}

function PipelineTag({ source, asOf }: { source: MarketSource; asOf?: string | null }) {
  return <ProvenanceBadge source={source} asOf={asOf} />;
}
