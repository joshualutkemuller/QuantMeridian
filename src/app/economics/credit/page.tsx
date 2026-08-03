
import { useState, useMemo, useEffect } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ChartLink } from "@/components/charting/ChartLink";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { ProgressBar } from "@/components/charts/Radial";
import { useDrill } from "@/components/econ/DrillProvider";
import { SourceBadge } from "@/components/econ/SourceBadge";
import { isRealEconSource, useLiveSeriesSet, type DataSource } from "@/lib/useEcon";
import { Sparkline } from "@/components/charts/Sparkline";
import {
  getCreditCurve, getCreditSummary, getSpreadHistory, getSectorSpreads, getStressEpisodes, getCreditLinkages, liveRung,
  getSpreadDecomposition, getEtfDivergences, getCreditBetas, getHaircutPressure,
  type CreditRung, type SectorSpread, type CreditStress,
  type SpreadDecomp, type EtfDivergence, type CreditBeta, type HaircutPressure,
} from "@/data/creditSpreads";
import {
  getCounterpartyCreditOverlays,
  getCreditHaircutImpacts,
  getCreditSubstitutions,
  type CounterpartyCreditOverlay,
  type CreditHaircutImpact,
  type CreditSubstitution,
} from "@/data/econEnhancements";
import { fmtBps, fmtNum, fmtSigned, fmtInt, fmtPct, fmtUsdAbbr, pnlClass } from "@/lib/format";
import { DataLegend } from "@/components/ui/DataLegend";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";

const REGIME_TONE: Record<string, "up" | "down" | "amber" | "blue"> = { TIGHT: "up", NEUTRAL: "blue", WIDE: "amber", STRESS: "down" };

const MASTER_IDS = ["BAMLC0A0CM", "BAMLH0A0HYM2"];

export default function CreditSpreadsPage() {
  const [goldData, setGoldData] = useState<any>(null);

  // Fetch Gold credit spread data
  useEffect(() => {
    let alive = true;
    fetch("/api/econ/credit")
      .then((r) => r.json())
      .then((data) => {
        if (alive && data.ok) {
          setGoldData(data);
        }
      })
      .catch(() => setGoldData(null));
    return () => { alive = false; };
  }, []);

  const baseCurve = getCreditCurve();
  const sum = getCreditSummary();

  // Take rating-curve OAS and IG/HY masters fully live (units default -> bps).
  const { data: liveMap, source } = useLiveSeriesSet([...baseCurve.map((r) => r.fredId), ...MASTER_IDS], undefined, 24);
  const pageSource: DataSource = goldData?.ok ? "DB" : source === "LOADING" ? "LOADING" : source === "ERR" ? "ERR" : source || "SIM";
  const curve = baseCurve.map((r) => {
    const L = liveMap[r.fredId];
    return L && isRealEconSource(L.source) && L.observations.length ? liveRung(r, L.observations) : r;
  });
  const masterOas = (id: string, fallback: number, prior = false) => {
    const L = liveMap[id];
    if (L && isRealEconSource(L.source) && L.observations.length) {
      const v = L.observations.map((o) => o.value);
      return Math.round(prior ? v[v.length - 2] ?? v[v.length - 1] : v[v.length - 1]);
    }
    return fallback;
  };
  const igOas = masterOas("BAMLC0A0CM", sum.igOas);
  const hyOas = masterOas("BAMLH0A0HYM2", sum.hyOas);
  const igChg1d = igOas - masterOas("BAMLC0A0CM", sum.igOas - sum.igChg1d, true);
  const hyChg1d = hyOas - masterOas("BAMLH0A0HYM2", sum.hyOas - sum.hyChg1d, true);

  const [gradeFilter, setGradeFilter] = useState("ALL");
  const [histRange, setHistRange] = useState("18");

  const hist = getSpreadHistory(18);
  const sectors = getSectorSpreads();
  const stress = getStressEpisodes();
  const links = getCreditLinkages();
  const haircutImpacts = getCreditHaircutImpacts();
  const counterpartyOverlays = getCounterpartyCreditOverlays();
  const substitutions = getCreditSubstitutions();
  const decomps = getSpreadDecomposition();
  const etfDivs = getEtfDivergences();
  const creditBetas = getCreditBetas();
  const haircutPressure = getHaircutPressure();
  const { open } = useDrill();

  const drill = (r: CreditRung) => open({ id: r.fredId, label: `${r.rating} OAS`, units: "lin", unitLabel: "bps", decimals: 0 });

  const curveCols: Column<CreditRung>[] = [
    { key: "rating", header: "Rating", render: (r) => <span className="font-semibold text-term-text">{r.rating}</span>, sortVal: (r) => r.oas },
    { key: "grade", header: "Grade", render: (r) => <Tag tone={r.grade === "IG" ? "blue" : "amber"}>{r.grade}</Tag> },
    { key: "oas", header: "OAS", align: "right", render: (r) => <span className="font-semibold text-term-amber">{fmtInt(r.oas)}</span>, sortVal: (r) => r.oas },
    { key: "chg1d", header: "Δ 1d", align: "right", render: (r) => <span className={pnlClass(-r.chg1d)}>{fmtSigned(r.chg1d, 0)}</span>, sortVal: (r) => r.chg1d },
    { key: "chg1m", header: "Δ 1m", align: "right", render: (r) => <span className={pnlClass(-r.chg1m)}>{fmtSigned(r.chg1m, 0)}</span>, sortVal: (r) => r.chg1m },
    { key: "yield", header: "Yield", align: "right", render: (r) => <span className="text-term-text">{fmtNum(r.yield, 2)}%</span>, sortVal: (r) => r.yield },
    { key: "pctile", header: "%ile (10y)", align: "right", width: "90px", render: (r) => <ProgressBar value={r.pctile} color={r.pctile > 50 ? "#FF3B3B" : "#2ECC71"} showPct />, sortVal: (r) => r.pctile },
    { key: "z", header: "Z", align: "right", render: (r) => <span className={pnlClass(-r.z)}>{fmtNum(r.z, 2)}</span>, sortVal: (r) => r.z },
    { key: "dur", header: "Sprd Dur", align: "right", render: (r) => <span className="text-term-text-dim">{fmtNum(r.dur, 1)}</span>, sortVal: (r) => r.dur },
  ];

  const sectorCols: Column<SectorSpread>[] = [
    { key: "sector", header: "Sector", render: (s) => <span className="text-term-text">{s.sector}</span>, sortVal: (s) => s.sector },
    { key: "grade", header: "Grade", render: (s) => <Tag tone={s.grade === "IG" ? "blue" : "amber"}>{s.grade}</Tag> },
    { key: "oas", header: "OAS", align: "right", render: (s) => <span className="text-term-amber">{fmtInt(s.oas)}</span>, sortVal: (s) => s.oas },
    { key: "chg1m", header: "Δ 1m", align: "right", render: (s) => <span className={pnlClass(-s.chg1m)}>{fmtSigned(s.chg1m, 0)}</span>, sortVal: (s) => s.chg1m },
  ];

  const stressCols: Column<CreditStress>[] = [
    { key: "name", header: "Episode", render: (s) => <span className="text-term-text">{s.name}</span> },
    { key: "peakIg", header: "Peak IG", align: "right", render: (s) => <span className="text-term-amber">{fmtInt(s.peakIg)}</span>, sortVal: (s) => s.peakIg },
    { key: "peakHy", header: "Peak HY", align: "right", render: (s) => <span className="text-term-down">{fmtInt(s.peakHy)}</span>, sortVal: (s) => s.peakHy },
    { key: "dd", header: "HY Drawdown", align: "right", render: (s) => <span className="text-term-down">{fmtNum(s.drawdownPct, 1)}%</span>, sortVal: (s) => s.drawdownPct },
    { key: "def", header: "Default Pk", align: "right", render: (s) => <span className="text-term-text">{fmtNum(s.defaultPeak, 1)}%</span>, sortVal: (s) => s.defaultPeak },
  ];

  const haircutCols: Column<CreditHaircutImpact>[] = [
    { key: "type", header: "Collateral", render: (r) => <span className="font-semibold text-term-text">{r.collateralType}</span>, sortVal: (r) => r.collateralType },
    { key: "base", header: "Base", align: "right", render: (r) => <span className="text-term-text-dim">{fmtPct(r.baseHaircut, 1)}</span>, sortVal: (r) => r.baseHaircut },
    { key: "stress", header: "Stress", align: "right", render: (r) => <span className="text-term-down">{fmtPct(r.stressedHaircut, 1)}</span>, sortVal: (r) => r.stressedHaircut },
    { key: "driver", header: "Driver", render: (r) => <span className="text-term-amber">{r.oasDriver}</span>, sortVal: (r) => r.oasDriver },
    { key: "drag", header: "Liq Drag", align: "right", render: (r) => <span className="text-term-text">{fmtSigned(r.liquidityDrag, 0)}</span>, sortVal: (r) => r.liquidityDrag },
    { key: "cost", header: "Opt Cost", align: "right", render: (r) => <span className="text-term-down">{fmtUsdAbbr(r.optimizationCost)}</span>, sortVal: (r) => r.optimizationCost },
  ];

  const overlayCols: Column<CounterpartyCreditOverlay>[] = [
    { key: "cp", header: "Counterparty", render: (r) => <span className="font-semibold text-term-text">{r.counterparty}</span>, sortVal: (r) => r.counterparty },
    { key: "rating", header: "Rating", align: "center", render: (r) => <span className="text-term-text-dim">{r.rating}</span>, sortVal: (r) => r.rating },
    { key: "score", header: "Stress", align: "right", render: (r) => <span className={r.stressScore > 70 ? "text-term-down" : r.stressScore > 60 ? "text-term-amber" : "text-term-text"}>{fmtNum(r.stressScore, 0)}</span>, sortVal: (r) => r.stressScore },
    { key: "uplift", header: "Margin+", align: "right", render: (r) => <span className="text-term-amber">{fmtPct(r.marginUplift, 1)}</span>, sortVal: (r) => r.marginUplift },
    { key: "www", header: "Wrong-Way", align: "center", render: (r) => <Tag tone={r.wrongWayFlag === "YES" ? "down" : "up"}>{r.wrongWayFlag}</Tag>, sortVal: (r) => r.wrongWayFlag },
    { key: "action", header: "Action", render: (r) => <span className="text-term-text-dim">{r.action}</span>, sortVal: (r) => r.action },
  ];

  const substitutionCols: Column<CreditSubstitution>[] = [
    { key: "from", header: "From", render: (r) => <span className="text-term-down">{r.fromAsset}</span>, sortVal: (r) => r.fromAsset },
    { key: "to", header: "To", render: (r) => <span className="text-term-up">{r.toAsset}</span>, sortVal: (r) => r.toAsset },
    { key: "notional", header: "Notional", align: "right", render: (r) => <span className="text-term-text">{fmtUsdAbbr(r.notional)}</span>, sortVal: (r) => r.notional },
    { key: "savings", header: "Haircut Save", align: "right", render: (r) => <span className="text-term-up">{fmtUsdAbbr(r.haircutSavings)}</span>, sortVal: (r) => r.haircutSavings },
    { key: "elig", header: "Elig+", align: "right", render: (r) => <span className="text-term-amber">{fmtSigned(r.eligibilityGain, 0)}%</span>, sortVal: (r) => r.eligibilityGain },
    { key: "why", header: "Rationale", render: (r) => <span className="text-term-text-dim">{r.rationale}</span>, sortVal: (r) => r.rationale },
  ];

  const DECOMP_TONE: Record<SpreadDecomp["signal"], "up" | "amber" | "down" | "neutral"> = { Tight: "up", Normal: "neutral", Wide: "amber", Stress: "down" };
  const DIV_TONE: Record<EtfDivergence["signal"], "up" | "amber" | "down" | "neutral"> = { Converging: "up", Neutral: "neutral", Diverging: "amber", Extreme: "down" };
  const BETA_TONE: Record<CreditBeta["regime"], "up" | "amber" | "down"> = { Low: "up", Normal: "amber", High: "down" };
  const HC_TONE: Record<HaircutPressure["signal"], "up" | "amber" | "down"> = { Stable: "up", Widening: "amber", Stress: "down" };

  const decompCols: Column<SpreadDecomp>[] = [
    { key: "pair", header: "Spread Pair", render: (r) => <span className="font-semibold text-term-text">{r.pair}</span>, sortVal: (r) => r.pair },
    { key: "val", header: "Value", align: "right", render: (r) => <span className="text-term-amber">{fmtBps(r.valueBps, 0)}</span>, sortVal: (r) => r.valueBps },
    { key: "z", header: "Z", align: "right", render: (r) => <span className={pnlClass(-r.zScore)}>{fmtNum(r.zScore, 2)}</span>, sortVal: (r) => r.zScore },
    { key: "pctile", header: "%ile", align: "right", width: "80px", render: (r) => <ProgressBar value={r.pctile} color={r.pctile > 60 ? "#FF3B3B" : r.pctile < 30 ? "#2ECC71" : "#FF8C00"} showPct />, sortVal: (r) => r.pctile },
    { key: "hist", header: "20d", align: "center", width: "80px", render: (r) => <Sparkline data={r.hist20d} width={72} height={20} stroke={r.signal === "Wide" || r.signal === "Stress" ? "#FF3B3B" : "#3B9DFF"} />, sortVal: (r) => r.valueBps },
    { key: "sig", header: "Signal", align: "center", render: (r) => <Tag tone={DECOMP_TONE[r.signal]}>{r.signal}</Tag>, sortVal: (r) => r.signal },
  ];

  const etfDivCols: Column<EtfDivergence>[] = [
    { key: "etf", header: "ETF", render: (r) => <span className="font-semibold text-term-text">{r.etf}</span>, sortVal: (r) => r.etf },
    { key: "px", header: "Price", align: "right", render: (r) => <span className="text-term-text">{fmtNum(r.etfPrice, 2)}</span>, sortVal: (r) => r.etfPrice },
    { key: "pxChg", header: "Px Δ", align: "right", render: (r) => <span className={pnlClass(r.etfChg1d)}>{fmtSigned(r.etfChg1d, 2)}</span>, sortVal: (r) => r.etfChg1d },
    { key: "oas", header: "OAS", align: "right", render: (r) => <span className="text-term-amber">{fmtInt(r.oasBps)}</span>, sortVal: (r) => r.oasBps },
    { key: "oasChg", header: "OAS Δ", align: "right", render: (r) => <span className={pnlClass(-r.oasChg1d)}>{fmtSigned(r.oasChg1d, 0)}</span>, sortVal: (r) => r.oasChg1d },
    { key: "div", header: "Div Score", align: "right", render: (r) => <span className={r.divergenceScore >= 5 ? "text-term-down" : "text-term-text"}>{fmtNum(r.divergenceScore, 1)}</span>, sortVal: (r) => r.divergenceScore },
    { key: "sig", header: "Signal", align: "center", render: (r) => <Tag tone={DIV_TONE[r.signal]}>{r.signal}</Tag>, sortVal: (r) => r.signal },
  ];

  const betaCols: Column<CreditBeta>[] = [
    { key: "pair", header: "Pair", render: (r) => <span className="font-semibold text-term-text">{r.pair}</span>, sortVal: (r) => r.pair },
    { key: "beta", header: "β", align: "right", render: (r) => <span className="text-term-amber">{fmtNum(r.beta, 2)}</span>, sortVal: (r) => r.beta },
    { key: "r2", header: "R²", align: "right", render: (r) => <span className="text-term-text">{fmtNum(r.r2, 2)}</span>, sortVal: (r) => r.r2 },
    { key: "regime", header: "Regime", align: "center", render: (r) => <Tag tone={BETA_TONE[r.regime]}>{r.regime}</Tag>, sortVal: (r) => r.regime },
    { key: "detail", header: "Detail", render: (r) => <span className="text-term-text-dim">{r.detail}</span>, sortVal: (r) => r.detail },
  ];

  const hcPressureCols: Column<HaircutPressure>[] = [
    { key: "asset", header: "Asset Class", render: (r) => <span className="font-semibold text-term-text">{r.assetClass}</span>, sortVal: (r) => r.assetClass },
    { key: "curr", header: "Current", align: "right", render: (r) => <span className="text-term-text">{fmtPct(r.currentHaircut / 100, 0)}</span>, sortVal: (r) => r.currentHaircut },
    { key: "stress", header: "Stress", align: "right", render: (r) => <span className="text-term-down">{fmtPct(r.stressHaircut / 100, 0)}</span>, sortVal: (r) => r.stressHaircut },
    { key: "delta", header: "Δ", align: "right", render: (r) => <span className={r.haircutDelta > 0 ? "text-term-down" : "text-term-text"}>{fmtSigned(r.haircutDelta, 0)}%</span>, sortVal: (r) => r.haircutDelta },
    { key: "margin", header: "Margin $", align: "right", render: (r) => <span className={pnlClass(r.marginImpact)}>{fmtNum(r.marginImpact, 1)}M</span>, sortVal: (r) => r.marginImpact },
    { key: "sig", header: "Signal", align: "center", render: (r) => <Tag tone={HC_TONE[r.signal]}>{r.signal}</Tag>, sortVal: (r) => r.signal },
  ];

  const filteredCurve = useMemo(() => gradeFilter === "ALL" ? curve : curve.filter((r) => r.grade === gradeFilter), [curve, gradeFilter]);
  const filteredSectors = useMemo(() => gradeFilter === "ALL" ? sectors : sectors.filter((s) => s.grade === gradeFilter), [sectors, gradeFilter]);
  const trimmedHist = useMemo(() => { const n = parseInt(histRange); return hist.slice(-n * 12); }, [hist, histRange]);

  const cv = (r: string) => curve.find((x) => x.rating === r) ?? baseCurve.find((x) => x.rating === r)!;
  const qualitySpread = cv("CCC").oas - cv("BB").oas;
  const bbbAaa = cv("BBB").oas - cv("AAA").oas;
  const igHySpread = hyOas - igOas;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="CRDT"
        title="Credit Spreads"
        desc="IG / HY OAS deep dive · curve · stress · sec-finance linkage"
        right={<div className="flex items-center gap-2"><ChartLink refs={[{ source: "econ", id: "BAMLH0A0HYM2" }, { source: "econ", id: "BAMLC0A0CM" }]} range="5Y" /><SourceBadge source={pageSource} /><Tag tone={REGIME_TONE[sum.regime]}>{sum.regime} REGIME</Tag></div>}
      />

      <KpiStrip>
        <Stat label="IG OAS" value={`${fmtInt(igOas)} bps`} sub={<span className={pnlClass(-igChg1d)}>{fmtSigned(igChg1d, 0)} 1d</span>} tone="amber" />
        <Stat label="HY OAS" value={`${fmtInt(hyOas)} bps`} sub={<span className={pnlClass(-hyChg1d)}>{fmtSigned(hyChg1d, 0)} 1d</span>} tone={hyOas > 500 ? "down" : "amber"} />
        <Stat label="HY − IG" value={`${fmtInt(igHySpread)} bps`} sub="credit risk premium" />
        <Stat label="Quality (CCC−BB)" value={`${fmtInt(qualitySpread)} bps`} sub="dispersion / distress" tone={qualitySpread > 450 ? "down" : "neutral"} />
        <Stat label="IG Yield" value={`${fmtNum(sum.igYield, 2)}%`} sub={`HY ${fmtNum(sum.hyYield, 2)}%`} />
        <Stat label="Distress Ratio" value={`${fmtNum(sum.distressRatio, 1)}%`} sub={`${fmtNum(sum.defaultRate, 1)}% TTM default`} tone={sum.distressRatio > 10 ? "down" : "neutral"} />
      </KpiStrip>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-3">
        <div className="flex flex-col gap-2 xl:col-span-2">
          <Panel title="Credit Curve — OAS by Rating" code="OAS" subtitle="Daily · bps" accent toolbar={<TermToggleGroup label="Grade" value={gradeFilter} onChange={setGradeFilter} options={[{ value: "ALL", label: "All" }, { value: "IG", label: "IG" }, { value: "HY", label: "HY" }]} size="sm" />} right={<span className="text-3xs text-term-text-mute">click a row → 24m history</span>}>
            <DataGrid columns={curveCols} rows={filteredCurve} rowKey={(r) => r.rating} onRowClick={drill} initialSort={{ key: "oas", dir: "asc" }} />
          </Panel>

          <Panel title={`Historical OAS — IG vs HY (${histRange}y)`} code="HIST" subtitle="Daily · bps" toolbar={<TermToggleGroup label="Range" value={histRange} onChange={setHistRange} options={[{ value: "5", label: "5Y" }, { value: "10", label: "10Y" }, { value: "18", label: "18Y" }]} size="sm" />}>
            <div className="p-2">
              <LineChart
                height={210}
                yFmt={(n) => fmtInt(n)}
                labels={trimmedHist.map((h) => h.date)}
                series={[
                  { name: "HY OAS", data: trimmedHist.map((h) => h.hy), color: "#FF3B3B", area: true },
                  { name: "IG OAS", data: trimmedHist.map((h) => h.ig), color: "#FF8C00" },
                ]}
              />
              <div className="mt-1 flex flex-wrap gap-2 px-1 text-3xs text-term-text-mute">
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 bg-term-down" /> HY OAS</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 bg-term-amber" /> IG OAS</span>
                <span className="ml-auto">Stress: {[...new Set(trimmedHist.map((h) => h.episode).filter(Boolean))].join(" · ")}</span>
              </div>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <Panel title="Sector Spreads" code="SEC">
              <DataGrid columns={sectorCols} rows={filteredSectors} rowKey={(s) => s.sector} initialSort={{ key: "oas", dir: "desc" }} maxHeight="260px" />
            </Panel>
            <Panel title="Historical Stress Episodes" code="STRS">
              <DataGrid columns={stressCols} rows={stress} rowKey={(s) => s.name} maxHeight="260px" />
            </Panel>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Panel title="Credit Curve Shape" code="SHAPE">
            <div className="p-2">
              <BarChart data={curve.map((r) => ({ label: r.rating, value: r.oas, color: r.grade === "IG" ? "#FF8C00" : "#FF3B3B" }))} height={160} fmt={(n) => fmtInt(n)} />
              <div className="mt-1 text-3xs text-term-text-mute">OAS rises with credit risk — the slope from BBB→BB is the IG/HY cliff.</div>
            </div>
          </Panel>

          <Panel title="Valuation vs History" code="PCTL">
            <div className="space-y-2 p-3">
              <div>
                <div className="mb-0.5 flex justify-between text-2xs"><span className="text-term-text-dim">IG percentile (10y)</span><span className="tnum text-term-text">{sum.igPctile}%</span></div>
                <ProgressBar value={sum.igPctile} color={sum.igPctile > 50 ? "#FF3B3B" : "#2ECC71"} height={8} />
              </div>
              <div>
                <div className="mb-0.5 flex justify-between text-2xs"><span className="text-term-text-dim">HY percentile (10y)</span><span className="tnum text-term-text">{sum.hyPctile}%</span></div>
                <ProgressBar value={sum.hyPctile} color={sum.hyPctile > 50 ? "#FF3B3B" : "#2ECC71"} height={8} />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Stat label="BBB − AAA" value={`${fmtInt(bbbAaa)} bps`} className="px-0 py-1" />
                <Stat label="Regime" value={sum.regime} tone={REGIME_TONE[sum.regime] === "down" ? "down" : "amber"} className="px-0 py-1" />
              </div>
              <div className="text-3xs text-term-text-mute">Low percentiles = spreads tight vs history (rich); compression signals complacency / low risk premium.</div>
            </div>
          </Panel>

          <Panel title="Sector OAS Ranking" code="RANK">
            <div className="p-2">
              <BarChart horizontal data={sectors.slice(0, 9).map((s) => ({ label: s.sector, value: s.oas, color: s.grade === "IG" ? "#FF8C00" : "#FF3B3B" }))} fmt={(n) => `${fmtInt(n)}`} />
            </div>
          </Panel>

          <Panel title="Credit → Securities-Finance" code="SFE">
            <div className="divide-y divide-term-border-soft">
              {links.map((l, i) => (
                <div key={i} className="flex items-start gap-2 px-2 py-1.5">
                  <span className={`mt-0.5 text-sm ${l.effect === "up" ? "text-term-up" : "text-term-down"}`}>{l.effect === "up" ? "▲" : "▼"}</span>
                  <div>
                    <div className="text-2xs font-semibold text-term-text">{l.driver}</div>
                    <div className="text-3xs text-term-text-mute">{l.impact}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Haircut Impact From Spread Widening" code="HCT" accent>
            <DataGrid columns={haircutCols} rows={haircutImpacts} rowKey={(r) => r.collateralType} maxHeight="230px" initialSort={{ key: "cost", dir: "desc" }} zebra />
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 px-2 xl:grid-cols-3">
        <Panel title="Spread Decomposition" code="SDEC" accent className="xl:col-span-2" right={<span className="text-3xs text-term-text-mute">cross-rating spread pairs · z-score vs 1y</span>}>
          <DataGrid columns={decompCols} rows={decomps} rowKey={(r) => r.pair} maxHeight="260px" initialSort={{ key: "val", dir: "desc" }} zebra />
        </Panel>
        <Panel title="Credit Beta to Equity" code="BETA" right={<Tag tone="amber">rolling 60d</Tag>}>
          <DataGrid columns={betaCols} rows={creditBetas} rowKey={(r) => r.pair} maxHeight="260px" initialSort={{ key: "r2", dir: "desc" }} zebra />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-2 px-2 xl:grid-cols-3">
        <Panel title="ETF Price vs OAS Divergence" code="EDIV" className="xl:col-span-2" right={<span className="text-3xs text-term-text-mute">HYG · JNK · LQD · BKLN · EMB</span>}>
          <DataGrid columns={etfDivCols} rows={etfDivs} rowKey={(r) => r.etf} maxHeight="260px" initialSort={{ key: "div", dir: "desc" }} zebra />
          <div className="px-3 pb-2">
            <div className="space-y-1">
              {etfDivs.filter((d) => d.signal === "Diverging" || d.signal === "Extreme").map((d) => (
                <div key={d.etf} className="flex items-center gap-2 text-3xs">
                  <Tag tone={DIV_TONE[d.signal]}>{d.etf}</Tag>
                  <span className="text-term-text-dim">{d.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Financing Haircut Pressure" code="HCPR" accent right={<Tag tone={HC_TONE[haircutPressure.some((h) => h.signal === "Stress") ? "Stress" : haircutPressure.some((h) => h.signal === "Widening") ? "Widening" : "Stable"]}>{haircutPressure.some((h) => h.signal === "Stress") ? "STRESS" : haircutPressure.some((h) => h.signal === "Widening") ? "WIDENING" : "STABLE"}</Tag>}>
          <DataGrid columns={hcPressureCols} rows={haircutPressure} rowKey={(r) => r.assetClass} maxHeight="260px" initialSort={{ key: "delta", dir: "desc" }} zebra />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-2 px-2 xl:grid-cols-2">
        <Panel title="Counterparty Credit Overlay" code="CPST">
          <DataGrid columns={overlayCols} rows={counterpartyOverlays} rowKey={(r) => r.counterparty} maxHeight="260px" initialSort={{ key: "score", dir: "desc" }} zebra />
        </Panel>
        <Panel title="Credit Collateral Substitutions" code="SUBS" accent>
          <DataGrid columns={substitutionCols} rows={substitutions} rowKey={(r) => `${r.fromAsset}-${r.toAsset}`} maxHeight="260px" initialSort={{ key: "savings", dir: "desc" }} zebra />
        </Panel>
      </div>

      <div className="px-2 pb-2">
        <DataLegend />
      </div>
    </div>
  );
}
