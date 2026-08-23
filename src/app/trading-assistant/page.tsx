import { useMemo, useState } from "react";
import clsx from "clsx";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { KpiStrip, PageHeader } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { TermSelect } from "@/components/ui/TermSelect";
import { LineChart } from "@/components/charts/LineChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { getPolyCategories, type PolyCategory, type PolyMarket } from "@/data/polymarket";
import {
  BOT_OPTIONS,
  MODE_OPTIONS,
  RISK_LIMITS,
  RISK_OPTIONS,
  buildSignal,
  buildSignals,
  canPlacePaperOrder,
  runRiskChecks,
  type AssistantMode,
  type BotCode,
  type PaperOrder,
  type PolyBotSignal,
  type RiskProfile,
} from "@/data/polybot";
import { usePaperLedger } from "@/lib/usePaperLedger";
import { usePolyBook } from "@/lib/usePolybot";
import { usePolyHistory, usePolymarkets } from "@/lib/usePolymarket";
import { fmtNum, fmtPct, fmtSignedPct, fmtUsdAbbr, pnlClass } from "@/lib/format";
import { useSimMode } from "@/lib/simMode";

type Universe = "ALL" | PolyCategory;

function confidenceTone(confidence: PolyBotSignal["confidence"]): "up" | "amber" | "neutral" {
  if (confidence === "HIGH") return "up";
  if (confidence === "MED") return "amber";
  return "neutral";
}

function riskTone(ok: boolean): "up" | "down" {
  return ok ? "up" : "down";
}

function bookTone(source: string): "up" | "amber" | "neutral" | "down" {
  if (source === "CLOB") return "up";
  if (source === "LOADING") return "amber";
  if (source === "ERR") return "down";
  return "neutral";
}

export default function TradingAssistant() {
  const [bot, setBot] = useState<BotCode>("POLYBOT");
  const [mode, setMode] = useState<AssistantMode>("RESEARCH");
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("CONSERVATIVE");
  const [universe, setUniverse] = useState<Universe>("ALL");
  const [selected, setSelected] = useState<PolyMarket | null>(null);
  const { simEnabled, toggle: toggleSimMode } = useSimMode();

  const category = universe === "ALL" ? undefined : universe;
  const { data: markets, source } = usePolymarkets({ limit: 100, category });
  const categories = getPolyCategories();
  const universeOptions: { value: Universe; label: string }[] = [
    { value: "ALL", label: "All active" },
    ...categories.map((c) => ({ value: c.category, label: c.category })),
  ];
  const { snapshot: ledger, status: ledgerStatus, submitOrder, resetLedger } = usePaperLedger(markets);
  const paperOrders = ledger.orders;
  const positions = ledger.positions;

  const selectedMarket = useMemo(() => {
    if (selected) {
      const current = markets.find((m) => m.id === selected.id);
      if (current) return current;
    }
    return markets[0] ?? null;
  }, [markets, selected]);

  const { data: book, source: bookSource } = usePolyBook(selectedMarket);
  const riskChecks = useMemo(
    () => runRiskChecks({
      market: selectedMarket,
      book,
      orders: paperOrders,
      positions,
      riskProfile,
      orderSizeUsd: RISK_LIMITS[riskProfile].maxOrderUsd,
    }),
    [book, paperOrders, positions, riskProfile, selectedMarket]
  );
  const paperAllowed = mode === "PAPER" && ledgerStatus !== "LOADING" && canPlacePaperOrder(riskChecks);

  const signals = useMemo(
    () => buildSignals(markets, book ?? undefined, selectedMarket?.id),
    [book, markets, selectedMarket?.id]
  );
  const selectedSignal = selectedMarket ? buildSignal(selectedMarket, book ?? undefined) : null;
  const { data: history } = usePolyHistory(selectedMarket?.id ?? null, 90);

  const activeSignals = signals.filter((s) => s.signalScore >= 45).length;
  const avgEdge = signals.length ? signals.reduce((sum, s) => sum + s.expectedEdge, 0) / signals.length : 0;
  const avgDepth = signals.length ? signals.reduce((sum, s) => sum + s.depthScore, 0) / signals.length : 0;
  const paperExposure = ledger.exposureUsd;
  const paperPnl = ledger.pnlUsd;
  const ticketSize = RISK_LIMITS[riskProfile].maxOrderUsd;
  const bookLevels = book?.levels ?? [];

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
      render: (s) => <span className="text-term-text-dim">{(s.spread * 100).toFixed(1)}c</span>,
      sortVal: (s) => s.spread,
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

  async function addPaperOrder(side: PaperOrder["side"]) {
    if (!selectedMarket || mode !== "PAPER" || !canPlacePaperOrder(riskChecks)) return;
    const price = side === "BUY_YES"
      ? book?.bestAsk && book.bestAsk > 0 ? book.bestAsk : selectedMarket.yesPrice
      : selectedMarket.noPrice;
    await submitOrder({
      botCode: bot,
      marketId: selectedMarket.id,
      question: selectedMarket.question,
      market: selectedMarket,
      side,
      price,
      sizeUsd: ticketSize,
      riskProfile,
      book,
    });
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
            <Tag tone={simEnabled ? "amber" : "up"}>{simEnabled ? "SIM ENABLED" : "LIVE FIRST"}</Tag>
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
          <span className="term-label">DATA</span>
          <button
            type="button"
            onClick={toggleSimMode}
            className={clsx(
              "rounded-sm border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide",
              simEnabled
                ? "border-term-amber bg-term-amber/15 text-term-amber"
                : "border-term-up/40 bg-term-up/10 text-term-up hover:border-term-amber hover:text-term-amber"
            )}
            title="Toggle deterministic simulated data for easier local testing"
          >
            {simEnabled ? "SIM ON" : "LIVE DATA"}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <span className="term-label">UNIVERSE</span>
          <TermSelect value={universe} onChange={setUniverse} size="sm" options={universeOptions} />
        </div>
        <div className="flex items-center gap-1">
          <span className="term-label">RISK</span>
          <TermSelect value={riskProfile} onChange={setRiskProfile} options={RISK_OPTIONS} size="sm" />
        </div>
        <Tag tone={mode === "PAPER" ? "amber" : "neutral"}>{mode}</Tag>
        <Tag tone={paperAllowed ? "up" : "amber"}>{paperAllowed ? "PAPER READY" : "GATED"}</Tag>
        <Tag tone={ledgerStatus === "SERVER" ? "up" : ledgerStatus === "LOADING" ? "amber" : "neutral"}>{ledgerStatus === "SERVER" ? "SERVER LEDGER" : ledgerStatus}</Tag>
        <Tag tone="neutral">LIVE DISABLED</Tag>
      </div>

      <KpiStrip>
        <Stat label="Default Bot" value={bot === "POLYBOT" ? "Polymarket" : bot} tone="amber" />
        <Stat label="Markets Scanned" value={markets.length} sub={universe === "ALL" ? "all active" : universe} />
        <Stat label="Active Signals" value={activeSignals} sub="score >= 45" tone={activeSignals > 0 ? "up" : "neutral"} />
        <Stat label="Avg Edge" value={fmtSignedPct(avgEdge * 100, 1)} tone={avgEdge > 0 ? "up" : avgEdge < 0 ? "down" : "neutral"} />
        <Stat label="Paper Exposure" value={fmtUsdAbbr(paperExposure)} sub={`${paperOrders.length} orders / ${ledger.fills.length} fills`} tone={paperExposure > 0 ? "amber" : "neutral"} />
        <Stat label="Paper P&L" value={fmtUsdAbbr(paperPnl)} sub="marked to market" tone={paperPnl > 0 ? "up" : paperPnl < 0 ? "down" : "neutral"} />
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

            <Panel title="Order Book & Paper Ticket" code="BOOK" right={<Tag tone={bookTone(bookSource)}>{bookSource === "CLOB" ? "CLOB" : bookSource}</Tag>}>
              {selectedMarket ? (
                <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <div className="min-w-0">
                    <div className="mb-1 grid grid-cols-5 gap-1 text-3xs uppercase tracking-wide text-term-text-mute">
                      <span>Lvl</span><span className="text-right">Bid</span><span className="text-right">Bid Sz</span><span className="text-right">Ask</span><span className="text-right">Ask Sz</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {bookLevels.length === 0 ? (
                        <div className="rounded-sm border border-term-border bg-term-panel-2 px-2 py-3 text-center text-2xs text-term-text-mute">Book unavailable</div>
                      ) : bookLevels.map((row) => (
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
                          disabled={!paperAllowed}
                          onClick={() => addPaperOrder("BUY_YES")}
                          className="rounded-sm border border-term-up/40 bg-term-up/10 px-2 py-2 text-xs font-semibold text-term-up disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          Buy Yes {fmtUsdAbbr(ticketSize)}
                        </button>
                        <button
                          type="button"
                          disabled={!paperAllowed}
                          onClick={() => addPaperOrder("BUY_NO")}
                          className="rounded-sm border border-term-down/40 bg-term-down/10 px-2 py-2 text-xs font-semibold text-term-down disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          Buy No {fmtUsdAbbr(ticketSize)}
                        </button>
                      </div>
                      <div className="mt-2 text-2xs text-term-text-dim">
                        Paper orders are server-risk checked first; local fallback is used only if the paper API is unavailable.
                      </div>
                    </div>
                    <div className="rounded-sm border border-term-border bg-term-panel-2 p-2">
                      <div className="term-label">Risk Checks</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {riskChecks.map((check) => (
                          <Tag key={check.label} tone={riskTone(check.ok)}>{check.label}: {check.detail}</Tag>
                        ))}
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
          <Panel
            title="Paper Ledger"
            code="PAPER"
            right={
              <div className="flex items-center gap-1">
                <Tag tone={ledger.storage === "IN_MEMORY" ? "up" : "amber"}>{ledger.storage === "IN_MEMORY" ? "SERVER STATE" : "LOCAL FALLBACK"}</Tag>
                <button
                  type="button"
                  onClick={resetLedger}
                  className="rounded-sm border border-term-border bg-term-panel-3 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-term-text-mute hover:border-term-amber hover:text-term-amber"
                >
                  Reset
                </button>
              </div>
            }
            scroll
          >
            <div className="flex max-h-48 flex-col">
              {paperOrders.length === 0 ? (
                <div className="p-4 text-xs text-term-text-mute">No paper orders yet. Set mode to Paper and use the ticket above.</div>
              ) : (
                paperOrders.slice(0, 8).map((order) => (
                  <div key={order.id} className="grid grid-cols-[72px_64px_64px_56px_1fr] gap-2 border-b border-term-border-soft px-3 py-1.5 text-2xs">
                    <span className="tnum text-term-text-mute">{order.createdAt.slice(11, 19)}</span>
                    <span className={order.side === "BUY_YES" ? "text-term-up" : "text-term-down"}>{order.side}</span>
                    <span className="tnum text-term-text">{fmtUsdAbbr(order.sizeUsd)}</span>
                    <span className="tnum text-term-text-dim">{fmtPct(order.price * 100, 1)}</span>
                    <span className="truncate text-term-text-dim">{order.question}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
          <Panel title="Paper Positions" code="POS" right={<Tag tone={paperPnl >= 0 ? "up" : "down"}>{fmtUsdAbbr(paperPnl)}</Tag>} scroll>
            <div className="flex max-h-48 flex-col">
              {positions.length === 0 ? (
                <div className="p-4 text-xs text-term-text-mute">Positions appear after paper fills are recorded.</div>
              ) : (
                positions.slice(0, 6).map((position) => (
                  <div key={position.marketId} className="grid grid-cols-[72px_72px_72px_1fr] gap-2 border-b border-term-border-soft px-3 py-1.5 text-2xs">
                    <span className="tnum text-term-text">{fmtUsdAbbr(position.marketValue)}</span>
                    <span className="tnum text-term-text-dim">Cost {fmtUsdAbbr(position.costBasis)}</span>
                    <span className={clsx("tnum", pnlClass(position.pnl))}>{fmtUsdAbbr(position.pnl)}</span>
                    <span className="truncate text-term-text-dim">{position.question}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
          <Panel title="Run Log" code="LOG">
            <div className="flex flex-col gap-1 p-3 text-2xs text-term-text-dim">
              <div><span className="text-term-amber">INIT</span> Loaded Trading Assistant with Polymarket default.</div>
              <div><span className="text-term-amber">DATA</span> {simEnabled ? "SIM mode enabled for deterministic testing." : "Live-first mode; enable SIM if public API data is unavailable."}</div>
              <div><span className="text-term-amber">BOOK</span> Selected market book source: {bookSource}.</div>
              <div><span className="text-term-amber">LEDGER</span> {ledger.storage === "IN_MEMORY" ? "Using server in-memory paper ledger." : "Using browser fallback ledger."}</div>
              <div><span className="text-term-amber">SCAN</span> Ranked {markets.length} markets using edge, depth, spread, and urgency.</div>
              <div><span className="text-term-amber">RISK</span> {riskChecks.filter((check) => !check.ok).length} blocking checks.</div>
              {ledger.events.slice(0, 3).map((event) => (
                <div key={event.id}><span className="text-term-amber">{event.type}</span> {event.message}</div>
              ))}
              <div><span className="text-term-amber">SAFE</span> Research mode default; live orders disabled.</div>
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
