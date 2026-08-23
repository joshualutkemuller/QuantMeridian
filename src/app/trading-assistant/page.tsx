import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { KpiStrip, PageHeader } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { TermSelect } from "@/components/ui/TermSelect";
import { LineChart } from "@/components/charts/LineChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { getPolyCategories, type PolyCategory, type PolyMarket } from "@/data/polymarket";
import { usePolyHistory, usePolymarkets } from "@/lib/usePolymarket";
import { fmtNum, fmtPct, fmtSignedPct, fmtUsdAbbr, pnlClass } from "@/lib/format";

type BotCode = "POLYBOT";
type AssistantMode = "RESEARCH" | "PAPER" | "LIVE";
type RiskProfile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "CUSTOM";
type Universe = "ALL" | PolyCategory;

interface PolyBotSignal {
  market: PolyMarket;
  modelProbability: number;
  executablePrice: number;
  expectedEdge: number;
  depthScore: number;
  urgencyScore: number;
  signalScore: number;
  confidence: "LOW" | "MED" | "HIGH";
  warning: string;
}

interface PaperOrder {
  id: string;
  createdAt: string;
  marketId: string;
  question: string;
  side: "BUY_YES" | "BUY_NO";
  price: number;
  sizeUsd: number;
  mode: "PAPER";
}

const BOT_OPTIONS: { value: BotCode; label: string }[] = [
  { value: "POLYBOT", label: "Polymarket" },
];

const RISK_OPTIONS: { value: RiskProfile; label: string }[] = [
  { value: "CONSERVATIVE", label: "Conservative" },
  { value: "BALANCED", label: "Balanced" },
  { value: "AGGRESSIVE", label: "Aggressive" },
  { value: "CUSTOM", label: "Custom" },
];

const MODE_OPTIONS: { value: AssistantMode; label: string; disabled?: boolean }[] = [
  { value: "RESEARCH", label: "Research" },
  { value: "PAPER", label: "Paper" },
  { value: "LIVE", label: "Live", disabled: true },
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function daysToClose(endDate: string): number {
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const now = Date.now();
  return Math.max(0, Math.round((end - now) / 86_400_000));
}

function buildSignal(market: PolyMarket): PolyBotSignal {
  const executablePrice = clamp(market.yesPrice + market.spread / 2, 0.01, 0.99);
  const momentum = clamp(market.chg24h, -0.1, 0.1);
  const liquidityBoost = clamp(Math.log10(Math.max(market.liquidity, 1)) / 10, 0, 0.75);
  const volumeBoost = clamp(Math.log10(Math.max(market.volume24h, 1)) / 10, 0, 0.75);
  const modelProbability = clamp(market.yesPrice + momentum * 0.35 + (liquidityBoost - 0.45) * 0.04, 0.02, 0.98);
  const spreadPenalty = market.spread * 0.6;
  const expectedEdge = modelProbability - executablePrice - spreadPenalty;
  const depthScore = Math.round(clamp((liquidityBoost * 0.65 + volumeBoost * 0.35) * 100, 0, 100));
  const urgencyScore = Math.round(clamp((1 - daysToClose(market.endDate) / 180) * 100, 0, 100));
  const signalScore = Math.round(clamp((expectedEdge * 350) + depthScore * 0.45 + urgencyScore * 0.2 - market.spread * 120, 0, 100));
  const confidence = signalScore >= 70 && depthScore >= 55 ? "HIGH" : signalScore >= 45 ? "MED" : "LOW";
  const warning = market.spread >= 0.035 ? "Wide spread" : depthScore < 40 ? "Thin depth" : daysToClose(market.endDate) <= 7 ? "Near close" : "Risk checks clean";

  return {
    market,
    modelProbability,
    executablePrice,
    expectedEdge,
    depthScore,
    urgencyScore,
    signalScore,
    confidence,
    warning,
  };
}

function buildBook(market: PolyMarket) {
  const midpoint = market.yesPrice;
  const halfSpread = Math.max(0.005, market.spread / 2);
  const baseDepth = Math.max(25, market.liquidity / 50_000);

  return Array.from({ length: 5 }, (_, i) => {
    const step = i * 0.01;
    return {
      level: i + 1,
      bid: clamp(midpoint - halfSpread - step, 0.01, 0.99),
      bidSize: Math.round(baseDepth * (5 - i) * 8),
      ask: clamp(midpoint + halfSpread + step, 0.01, 0.99),
      askSize: Math.round(baseDepth * (5 - i) * 7),
    };
  });
}

function confidenceTone(confidence: PolyBotSignal["confidence"]): "up" | "amber" | "neutral" {
  if (confidence === "HIGH") return "up";
  if (confidence === "MED") return "amber";
  return "neutral";
}

function loadPaperOrders(): PaperOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("qit.polybot.paperOrders");
    return raw ? JSON.parse(raw) as PaperOrder[] : [];
  } catch {
    return [];
  }
}

function savePaperOrders(orders: PaperOrder[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("qit.polybot.paperOrders", JSON.stringify(orders.slice(0, 50)));
}

export default function TradingAssistant() {
  const [bot, setBot] = useState<BotCode>("POLYBOT");
  const [mode, setMode] = useState<AssistantMode>("RESEARCH");
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("CONSERVATIVE");
  const [universe, setUniverse] = useState<Universe>("ALL");
  const [selected, setSelected] = useState<PolyMarket | null>(null);
  const [paperOrders, setPaperOrders] = useState<PaperOrder[]>([]);

  const category = universe === "ALL" ? undefined : universe;
  const { data: markets, source } = usePolymarkets({ limit: 100, category });

  useEffect(() => {
    setPaperOrders(loadPaperOrders());
  }, []);

  useEffect(() => {
    savePaperOrders(paperOrders);
  }, [paperOrders]);

  const signals = useMemo(
    () => markets.map(buildSignal).sort((a, b) => b.signalScore - a.signalScore),
    [markets]
  );

  const selectedMarket = useMemo(() => {
    if (selected && markets.some((m) => m.id === selected.id)) return selected;
    return signals[0]?.market ?? markets[0] ?? null;
  }, [markets, selected, signals]);

  const selectedSignal = selectedMarket ? buildSignal(selectedMarket) : null;
  const { data: history } = usePolyHistory(selectedMarket?.id ?? null, 90);
  const book = selectedMarket ? buildBook(selectedMarket) : [];
  const categories = getPolyCategories();

  const activeSignals = signals.filter((s) => s.signalScore >= 45).length;
  const avgEdge = signals.length ? signals.reduce((sum, s) => sum + s.expectedEdge, 0) / signals.length : 0;
  const avgDepth = signals.length ? signals.reduce((sum, s) => sum + s.depthScore, 0) / signals.length : 0;
  const paperExposure = paperOrders.reduce((sum, o) => sum + o.sizeUsd, 0);

  const signalCols: Column<PolyBotSignal>[] = [
    {
      key: "market",
      header: "Market",
      width: "340px",
      render: (s) => <span className="text-term-text" title={s.market.question}>{s.market.question.length > 64 ? `${s.market.question.slice(0, 64)}...` : s.market.question}</span>,
      sortVal: (s) => s.market.question,
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      render: (s) => <span className={s.signalScore >= 70 ? "text-term-up" : s.signalScore >= 45 ? "text-term-amber" : "text-term-text-dim"}>{s.signalScore}</span>,
      sortVal: (s) => s.signalScore,
    },
    {
      key: "prob",
      header: "Mkt Prob",
      align: "right",
      render: (s) => <span className="text-term-text">{fmtPct(s.market.yesPrice * 100, 1)}</span>,
      sortVal: (s) => s.market.yesPrice,
    },
    {
      key: "model",
      header: "Bot Fair",
      align: "right",
      render: (s) => <span className="text-term-amber">{fmtPct(s.modelProbability * 100, 1)}</span>,
      sortVal: (s) => s.modelProbability,
    },
    {
      key: "edge",
      header: "Edge",
      align: "right",
      render: (s) => <span className={pnlClass(s.expectedEdge)}>{fmtSignedPct(s.expectedEdge * 100, 1)}</span>,
      sortVal: (s) => s.expectedEdge,
    },
    {
      key: "spread",
      header: "Spread",
      align: "right",
      render: (s) => <span className="text-term-text-dim">{(s.market.spread * 100).toFixed(1)}c</span>,
      sortVal: (s) => s.market.spread,
    },
    {
      key: "depth",
      header: "Depth",
      align: "right",
      render: (s) => <span className={s.depthScore >= 55 ? "text-term-up" : s.depthScore >= 35 ? "text-term-amber" : "text-term-down"}>{s.depthScore}</span>,
      sortVal: (s) => s.depthScore,
    },
    {
      key: "conf",
      header: "Conf",
      align: "center",
      render: (s) => <Tag tone={confidenceTone(s.confidence)}>{s.confidence}</Tag>,
      sortVal: (s) => s.confidence,
    },
    {
      key: "spark",
      header: "30d",
      width: "80px",
      align: "right",
      render: (s) => <Sparkline data={s.market.spark} width={70} height={18} />,
    },
  ];

  function addPaperOrder(side: PaperOrder["side"]) {
    if (!selectedMarket || mode !== "PAPER") return;
    const price = side === "BUY_YES" ? book[0]?.ask ?? selectedMarket.yesPrice : selectedMarket.noPrice;
    const order: PaperOrder = {
      id: `paper-${Date.now()}`,
      createdAt: new Date().toISOString(),
      marketId: selectedMarket.id,
      question: selectedMarket.question,
      side,
      price,
      sizeUsd: 5,
      mode: "PAPER",
    };
    setPaperOrders((prev) => [order, ...prev].slice(0, 50));
  }

  const prices = history.map((p) => p.price * 100);
  const labels = history.map((p) => p.date.slice(5));

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="TASSIST"
        title="Trading Assistant"
        desc="Bot selector, signals, paper trading, execution controls"
        right={
          <>
            <span className="term-label hidden md:inline">BOT</span>
            <TermSelect value={bot} onChange={setBot} options={BOT_OPTIONS} size="sm" />
            <ProvenanceBadge source={source} />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-term-border bg-term-panel-2 px-2 py-1">
        <div className="flex items-center gap-1">
          <span className="term-label">MODE</span>
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => !option.disabled && setMode(option.value)}
              className={clsx(
                "rounded-sm border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide",
                mode === option.value
                  ? "border-term-amber bg-term-amber/15 text-term-amber"
                  : "border-term-border bg-term-panel-3 text-term-text-mute hover:text-term-text",
                option.disabled && "cursor-not-allowed opacity-40 hover:text-term-text-mute"
              )}
              title={option.disabled ? "Live execution is disabled until credentials, limits, approval, and kill switch are configured" : undefined}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="term-label">UNIVERSE</span>
          <TermSelect
            value={universe}
            onChange={setUniverse}
            size="sm"
            options={[{ value: "ALL", label: "All active" }, ...categories.map((c) => ({ value: c.category, label: c.category }))]}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="term-label">RISK</span>
          <TermSelect value={riskProfile} onChange={setRiskProfile} options={RISK_OPTIONS} size="sm" />
        </div>
        <Tag tone={mode === "PAPER" ? "amber" : "neutral"}>{mode}</Tag>
        <Tag tone="up">SAFE DEFAULTS</Tag>
        <Tag tone="neutral">LIVE DISABLED</Tag>
      </div>

      <KpiStrip>
        <Stat label="Default Bot" value={bot === "POLYBOT" ? "Polymarket" : bot} tone="amber" />
        <Stat label="Markets Scanned" value={markets.length} sub={universe === "ALL" ? "all active" : universe} />
        <Stat label="Active Signals" value={activeSignals} sub="score >= 45" tone={activeSignals > 0 ? "up" : "neutral"} />
        <Stat label="Avg Edge" value={fmtSignedPct(avgEdge * 100, 1)} tone={avgEdge > 0 ? "up" : avgEdge < 0 ? "down" : "neutral"} />
        <Stat label="Avg Depth" value={fmtNum(avgDepth, 0)} sub="derived liquidity" tone={avgDepth >= 55 ? "up" : "amber"} />
        <Stat label="Paper Exposure" value={fmtUsdAbbr(paperExposure)} sub={`${paperOrders.length} orders`} tone={paperExposure > 0 ? "amber" : "neutral"} />
      </KpiStrip>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-2 p-2">
        <div className="col-span-12 min-h-0 xl:col-span-7">
          <Panel
            title="POLYBOT Signal Queue"
            code="SIG"
            accent
            right={<Tag tone="amber">EDGE SCANNER</Tag>}
            scroll
          >
            <DataGrid
              columns={signalCols}
              rows={signals}
              rowKey={(s) => s.market.id}
              onRowClick={(s) => setSelected(s.market)}
              selectedKey={selectedMarket?.id}
              initialSort={{ key: "score", dir: "desc" }}
              maxHeight="calc(100vh - 300px)"
            />
          </Panel>
        </div>

        <div className="col-span-12 min-h-0 xl:col-span-5">
          <div className="grid h-full grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-1">
            <Panel
              title="Selected Market"
              code="MKT"
              right={selectedSignal ? <Tag tone={confidenceTone(selectedSignal.confidence)}>{selectedSignal.confidence}</Tag> : null}
            >
              {selectedMarket && selectedSignal ? (
                <div className="flex flex-col gap-3 p-3">
                  <div>
                    <div className="text-sm font-semibold text-term-text">{selectedMarket.question}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Tag tone="neutral">{selectedMarket.category}</Tag>
                      <Tag tone={selectedMarket.chg24h >= 0 ? "up" : "down"}>24h {fmtSignedPct(selectedMarket.chg24h * 100, 1)}</Tag>
                      <Tag tone="neutral">Ends {selectedMarket.endDate}</Tag>
                      <Tag tone={selectedSignal.expectedEdge >= 0 ? "up" : "down"}>Edge {fmtSignedPct(selectedSignal.expectedEdge * 100, 1)}</Tag>
                    </div>
                  </div>
                  <LineChart
                    series={[{ name: "Yes", data: prices, color: "#2ECC71", area: true }]}
                    labels={labels}
                    height={170}
                    yFmt={(n) => `${n.toFixed(0)}%`}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Mkt Prob" value={fmtPct(selectedMarket.yesPrice * 100, 1)} tone="text-term-text" />
                    <Metric label="Bot Fair" value={fmtPct(selectedSignal.modelProbability * 100, 1)} tone="text-term-amber" />
                    <Metric label="Executable" value={fmtPct(selectedSignal.executablePrice * 100, 1)} tone="text-term-text" />
                    <Metric label="Signal Score" value={`${selectedSignal.signalScore}`} tone={selectedSignal.signalScore >= 70 ? "text-term-up" : "text-term-amber"} />
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-term-text-mute">No market selected</div>
              )}
            </Panel>

            <Panel title="Order Book & Paper Ticket" code="BOOK" right={<Tag tone="neutral">READ ONLY</Tag>}>
              {selectedMarket ? (
                <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <div className="min-w-0">
                    <div className="mb-1 grid grid-cols-5 gap-1 text-3xs uppercase tracking-wide text-term-text-mute">
                      <span>Lvl</span><span className="text-right">Bid</span><span className="text-right">Bid Sz</span><span className="text-right">Ask</span><span className="text-right">Ask Sz</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {book.map((row) => (
                        <div key={row.level} className="grid grid-cols-5 gap-1 rounded-sm border border-term-border bg-term-panel-2 px-2 py-1 text-2xs">
                          <span className="tnum text-term-text-mute">{row.level}</span>
                          <span className="tnum text-right text-term-up">{fmtPct(row.bid * 100, 1)}</span>
                          <span className="tnum text-right text-term-text-dim">{fmtNum(row.bidSize, 0)}</span>
                          <span className="tnum text-right text-term-down">{fmtPct(row.ask * 100, 1)}</span>
                          <span className="tnum text-right text-term-text-dim">{fmtNum(row.askSize, 0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="rounded-sm border border-term-border bg-term-panel-2 p-2">
                      <div className="term-label">Ticket</div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={mode !== "PAPER"}
                          onClick={() => addPaperOrder("BUY_YES")}
                          className="rounded-sm border border-term-up/40 bg-term-up/10 px-2 py-2 text-xs font-semibold text-term-up disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          Buy Yes $5
                        </button>
                        <button
                          type="button"
                          disabled={mode !== "PAPER"}
                          onClick={() => addPaperOrder("BUY_NO")}
                          className="rounded-sm border border-term-down/40 bg-term-down/10 px-2 py-2 text-xs font-semibold text-term-down disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          Buy No $5
                        </button>
                      </div>
                      <div className="mt-2 text-2xs text-term-text-dim">
                        Switch to Paper mode to record simulated orders. Live execution remains disabled.
                      </div>
                    </div>
                    <div className="rounded-sm border border-term-border bg-term-panel-2 p-2">
                      <div className="term-label">Risk Checks</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Tag tone="up">Max order $5</Tag>
                        <Tag tone="up">Max position $25</Tag>
                        <Tag tone="up">Kill switch armed</Tag>
                        <Tag tone={selectedSignal?.warning === "Risk checks clean" ? "up" : "amber"}>{selectedSignal?.warning ?? "Pending"}</Tag>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-term-text-mute">Select a market to inspect the book</div>
              )}
            </Panel>
          </div>
        </div>

        <div className="col-span-12 grid grid-cols-1 gap-2 xl:grid-cols-3">
          <Panel title="Paper Ledger" code="PAPER" right={<Tag tone="amber">LOCAL STORAGE</Tag>} scroll>
            <div className="flex max-h-48 flex-col">
              {paperOrders.length === 0 ? (
                <div className="p-4 text-xs text-term-text-mute">No paper orders yet. Set mode to Paper and use the ticket above.</div>
              ) : (
                paperOrders.slice(0, 8).map((order) => (
                  <div key={order.id} className="grid grid-cols-[72px_64px_64px_1fr] gap-2 border-b border-term-border-soft px-3 py-1.5 text-2xs">
                    <span className="tnum text-term-text-mute">{order.createdAt.slice(11, 19)}</span>
                    <span className={order.side === "BUY_YES" ? "text-term-up" : "text-term-down"}>{order.side}</span>
                    <span className="tnum text-term-text">{fmtUsdAbbr(order.sizeUsd)}</span>
                    <span className="truncate text-term-text-dim">{order.question}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
          <Panel title="Bot Controls" code="CTRL">
            <div className="grid grid-cols-2 gap-2 p-3 text-2xs">
              <Metric label="Risk Profile" value={riskProfile} tone="text-term-amber" />
              <Metric label="Execution" value="Disabled" tone="text-term-text-dim" />
              <Metric label="Venue" value="Polymarket" tone="text-term-text" />
              <Metric label="Persistence" value="Local paper ledger" tone="text-term-text" />
            </div>
          </Panel>
          <Panel title="Run Log" code="LOG">
            <div className="flex flex-col gap-1 p-3 text-2xs text-term-text-dim">
              <div><span className="text-term-amber">INIT</span> Loaded Trading Assistant with Polymarket default.</div>
              <div><span className="text-term-amber">SCAN</span> Ranked {markets.length} markets using edge, depth, spread, and urgency.</div>
              <div><span className="text-term-amber">SAFE</span> Research mode default; live orders disabled.</div>
              <div><span className="text-term-amber">PAPER</span> Ledger persists in browser local storage.</div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-sm border border-term-border bg-term-panel-2 p-2">
      <div className="term-label">{label}</div>
      <div className={clsx("tnum mt-1 truncate text-sm font-semibold", tone)} title={value}>{value}</div>
    </div>
  );
}
