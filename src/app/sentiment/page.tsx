
import { useMemo, useState } from "react";
import clsx from "clsx";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart } from "@/components/charts/LineChart";
import { isRealEconSource, useLiveSeriesSet } from "@/lib/useEcon";
import { useSocial } from "@/lib/useSocial";
import { fmtSigned, pnlClass } from "@/lib/format";
import { aaiiSnapshotGeneratedAt, hasAaiiSnapshot } from "@/data/sentimentAaiiSnapshot";
import {
  getSentimentIndex,
  getSentimentSummary,
  getAaiiHistory,
  getAaiiSnapshot,
  getNaaimHistory,
  getBehavior,
  getContrarianSignals,
  getAnalogStudy,
  getSurveySocialDivergence,
  getTickerSentiment,
  type SentRegime,
  type SentSource,
  type SentLiveInputs,
  type Crowding,
} from "@/data/sentiment";

type View = "DASH" | "AAII" | "SOCIAL" | "POSITION" | "SIGNALS" | "DIVERGE" | "TICKER";
const VIEWS: { key: View; label: string }[] = [
  { key: "DASH", label: "Fear / Greed" },
  { key: "AAII", label: "AAII Survey" },
  { key: "SOCIAL", label: "Social Mood" },
  { key: "POSITION", label: "Positioning" },
  { key: "SIGNALS", label: "Contrarian" },
  { key: "DIVERGE", label: "Divergence" },
  { key: "TICKER", label: "By Ticker" },
];

const DIR_TONE = { BULLISH: "up", BEARISH: "down", NEUTRAL: "neutral" } as const;
const CROWD_TONE: Record<Crowding, "up" | "down" | "amber" | "neutral" | "blue" | "violet"> = {
  "Squeeze Risk": "down", "Crowded Long": "amber", "Crowded Short": "blue", Balanced: "neutral",
};

function regimeColor(score: number): string {
  return score < 20 ? "#FF3B3B" : score < 40 ? "#FF6B3B" : score < 60 ? "#FF8C00" : score < 80 ? "#7FCA5B" : "#2ECC71";
}
const regimeTone = (r: SentRegime): "up" | "down" | "amber" | "neutral" =>
  r === "Extreme Fear" || r === "Fear" ? "down" : r === "Neutral" ? "amber" : "up";

const SOURCE_TONE: Record<SentSource, "up" | "down" | "amber" | "neutral" | "blue" | "violet"> = {
  SURVEY: "violet", SOCIAL: "blue", FRED: "up", MARKET: "amber",
};

// ── Fear / Greed semicircle gauge ────────────────────────────────────────────
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arc(cx: number, cy: number, r: number, d0: number, d1: number): string {
  const [x0, y0] = polar(cx, cy, r, d0);
  const [x1, y1] = polar(cx, cy, r, d1);
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
}
function FearGreedGauge({ score }: { score: number }) {
  const cx = 130, cy = 122, r = 96;
  const segs = [
    { a: 180, b: 216, c: "#FF3B3B" },
    { a: 216, b: 252, c: "#FF6B3B" },
    { a: 252, b: 288, c: "#FF8C00" },
    { a: 288, b: 324, c: "#7FCA5B" },
    { a: 324, b: 360, c: "#2ECC71" },
  ];
  const deg = 180 + (score / 100) * 180;
  const [nx, ny] = polar(cx, cy, r - 14, deg);
  return (
    <svg viewBox="0 0 260 150" className="w-full" style={{ maxWidth: 320 }}>
      {segs.map((s) => (
        <path key={s.a} d={arc(cx, cy, r, s.a, s.b)} fill="none" stroke={s.c} strokeWidth={16} strokeLinecap="butt" />
      ))}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#E6E6E6" strokeWidth={3} />
      <circle cx={cx} cy={cy} r={5} fill="#E6E6E6" />
      <text x={cx} y={cy - 34} textAnchor="middle" fontSize={34} fontWeight={700} fill={regimeColor(score)} fontFamily="var(--font-mono)">{score}</text>
      <text x={padTextL(cx, r)} y={cy + 14} fontSize={8} fill="#5E5E66" fontFamily="var(--font-mono)">Fear</text>
      <text x={padTextR(cx, r)} y={cy + 14} textAnchor="end" fontSize={8} fill="#5E5E66" fontFamily="var(--font-mono)">Greed</text>
    </svg>
  );
}
const padTextL = (cx: number, r: number) => cx - r;
const padTextR = (cx: number, r: number) => cx + r;

export default function SentimentModule() {
  const [view, setView] = useState<View>("DASH");
  const { intel: social, source: socialSource } = useSocial();
  const socialLive = socialSource !== "SIM";

  // VIX (the index's volatility component) is live-capable via FRED VIXCLS —
  // fetched through the existing /api/econ/batch path and turned into a
  // greed score (low vol percentile = complacency = greed).
  const { data: sentFred } = useLiveSeriesSet(["VIXCLS", "BAMLH0A0HYM2", "DGS10", "DGS2"], "lin", 252);
  const live = useMemo<SentLiveInputs>(() => {
    const next: SentLiveInputs = { social: { intel: social, source: socialSource } };
    const v = sentFred["VIXCLS"];
    if (v && isRealEconSource(v.source) && v.observations.length > 20) {
      const vals = v.observations.map((o) => o.value);
      const latest = vals[vals.length - 1];
      const pctile = vals.filter((x) => x <= latest).length / vals.length;
      const score = Math.round(Math.max(0, Math.min(100, (1 - pctile) * 100)));
      next.vix = { score, detail: `VIX ${latest.toFixed(1)} · ${Math.round(pctile * 100)}th pctile` };
    }
    const hy = sentFred["BAMLH0A0HYM2"];
    if (hy && isRealEconSource(hy.source) && hy.observations.length > 20) {
      const vals = hy.observations.map((o) => o.value);
      const latest = vals[vals.length - 1];
      const pctile = vals.filter((x) => x <= latest).length / vals.length;
      const score = Math.round(Math.max(0, Math.min(100, (1 - pctile) * 100)));
      next.junkBondDemand = { score, detail: `HY OAS ${(latest * 100).toFixed(0)}bps · ${Math.round(pctile * 100)}th pctile` };
    }
    const t10 = sentFred["DGS10"];
    const t2 = sentFred["DGS2"];
    if (isRealEconSource(t10?.source) && isRealEconSource(t2?.source) && t10.observations.length > 20 && t2.observations.length > 20) {
      const spread10 = t10.observations[t10.observations.length - 1].value;
      const spread2 = t2.observations[t2.observations.length - 1].value;
      const curve = spread10 - spread2;
      const score = Math.round(Math.max(0, Math.min(100, ((curve + 1) / 3) * 100)));
      next.safeHaven = { score, detail: `2s10s ${(curve * 100).toFixed(0)}bps` };
    }
    return next;
  }, [sentFred, social, socialSource]);
  const vixLive = !!live.vix;

  const idx = useMemo(() => getSentimentIndex(live), [live]);
  const summary = useMemo(() => getSentimentSummary(live), [live]);
  const signals = useMemo(() => getContrarianSignals(live), [live]);
  const aaii = useMemo(() => getAaiiHistory(), []);
  const aaiiSnap = useMemo(() => getAaiiSnapshot(), []);
  const naaim = useMemo(() => getNaaimHistory(), []);
  const behav = useMemo(() => getBehavior(), []);
  const analog = useMemo(() => getAnalogStudy(), []);
  const diverge = useMemo(() => getSurveySocialDivergence(), []);
  const tickers = useMemo(() => getTickerSentiment(16, social), [social]);
  const btn = "rounded-sm border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide transition-colors";
  const recent = aaii.slice(-10).reverse();
  const aaiiSource = hasAaiiSnapshot() ? "SNAPSHOT" : "SIM";
  const pageSource = vixLive ? "FRED" : socialLive ? "LIVE" : aaiiSource === "SNAPSHOT" ? "SNAPSHOT" : "SIM";

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="SENT"
        title="Investor Sentiment & Behavior"
        desc="Survey + social fear/greed & positioning"
        right={
          <span className="flex items-center gap-2">
            <ProvenanceBadge source={pageSource} />
            <Tag tone={socialLive ? "up" : "amber"}>{socialLive ? socialSource : "SOCIAL SIM"}</Tag>
          </span>
        }
      />

      <KpiStrip>
        <Stat label="Sentiment Index" value={`${summary.index}`} sub={summary.regime} tone={regimeTone(summary.regime)} />
        <Stat label="1w Δ" value={fmtSigned(summary.delta1w, 0)} sub="index points" tone={summary.delta1w >= 0 ? "up" : "down"} />
        <Stat label="AAII Bull−Bear" value={`${fmtSigned(summary.aaiiSpread, 1)}`} sub={summary.aaiiZone} tone={summary.aaiiZone === "Euphoria" ? "down" : summary.aaiiZone === "Capitulation" ? "up" : "neutral"} />
        <Stat label="NAAIM Exposure" value={`${summary.naaim}%`} sub="manager equity" tone="amber" />
        <Stat label="Social Net" value={`${fmtSigned(summary.socialNet, 2)}`} sub="X · Reddit · ST" tone={summary.socialNet >= 0 ? "up" : "down"} />
        <Stat label="Most Discussed" value={summary.topTicker} sub="social volume" />
      </KpiStrip>

      <div className="flex flex-wrap items-center gap-1 border-b border-term-border bg-term-panel px-3 py-1.5">
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)} className={clsx(btn, view === v.key ? "border-term-amber bg-term-amber text-black" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>{v.label}</button>
        ))}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-2">
        {/* ── SENT-1 Fear/Greed Dashboard ── */}
        {view === "DASH" && (
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-12 lg:col-span-5">
              <Panel title="Fear / Greed Index" code="SENT-1" accent right={<Tag tone={regimeTone(idx.regime)}>{idx.regime}</Tag>}>
                <div className="flex flex-col items-center p-3">
                  <FearGreedGauge score={idx.score} />
                  <div className="mt-1 flex items-center gap-2 text-2xs">
                    <span className="text-term-text-mute">1-week</span>
                    <span className={clsx("tnum font-semibold", pnlClass(idx.delta1w))}>{fmtSigned(idx.delta1w, 0)} pts</span>
                  </div>
                  <p className="mt-3 text-center text-2xs leading-relaxed text-term-text-dim">{idx.readThrough}</p>
                </div>
              </Panel>
            </div>
            <div className="col-span-12 lg:col-span-7">
              <Panel title="Index Components" code="MIX" accent right={<span className="text-3xs text-term-text-mute">weighted · 100 = greed</span>}>
                <div className="divide-y divide-term-border-soft">
                  {idx.components.map((c) => (
                    <div key={c.label} className="flex items-center gap-2 px-3 py-1.5 text-2xs">
                      <span className="w-36 shrink-0 font-semibold text-term-text">{c.label}</span>
                      <span className="w-14 shrink-0"><Tag tone={SOURCE_TONE[c.source]}>{c.source}</Tag></span>
                      <span className="hidden w-24 shrink-0 truncate text-3xs text-term-text-mute md:inline">{c.detail}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-sm bg-term-panel-3">
                        <span className="block h-full rounded-sm" style={{ width: `${c.score}%`, background: regimeColor(c.score) }} />
                      </span>
                      <span className="tnum w-7 shrink-0 text-right font-bold" style={{ color: regimeColor(c.score) }}>{c.score}</span>
                      <span className="tnum w-9 shrink-0 text-right text-3xs text-term-text-mute">{(c.weight * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">
                  Social upgrades through /api/social ({socialSource}); AAII reads the committed snapshot before SIM. NAAIM remains deterministic until a connector is wired. Market inputs (put/call, breadth, haven) upgrade via the market layer.
                </div>
              </Panel>
            </div>
          </div>
        )}

        {/* ── SENT-2 AAII Survey Monitor ── */}
        {view === "AAII" && (
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-12 lg:col-span-4">
              <Panel
                title="AAII Survey — This Week"
                code="SENT-2"
                accent
                right={
                  <span className="flex items-center gap-2">
                    <Tag tone={aaiiSnap.zone === "Euphoria" ? "down" : aaiiSnap.zone === "Capitulation" ? "up" : "amber"}>{aaiiSnap.zone}</Tag>
                    <ProvenanceBadge source={aaiiSource} asOf={aaiiSnapshotGeneratedAt} />
                  </span>
                }
              >
                <div className="flex flex-col gap-2 p-3">
                  {([["Bullish", aaiiSnap.latest.bullish, "#2ECC71"], ["Neutral", aaiiSnap.latest.neutral, "#8A8A92"], ["Bearish", aaiiSnap.latest.bearish, "#FF3B3B"]] as const).map(([label, val, color]) => (
                    <div key={label} className="flex items-center gap-2 text-2xs">
                      <span className="w-16 shrink-0 text-term-text-mute">{label}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-sm bg-term-panel-3"><span className="block h-full rounded-sm" style={{ width: `${val}%`, background: color }} /></span>
                      <span className="tnum w-12 text-right font-semibold text-term-text">{val}%</span>
                    </div>
                  ))}
                  <div className="mt-1 grid grid-cols-2 gap-2 border-t border-term-border pt-2 text-2xs">
                    <div><div className="text-3xs text-term-text-mute">Bull−Bear spread</div><div className={clsx("tnum text-lg font-bold", pnlClass(aaiiSnap.latest.spread))}>{fmtSigned(aaiiSnap.latest.spread, 1)}</div></div>
                    <div><div className="text-3xs text-term-text-mute">Spread percentile</div><div className="tnum text-lg font-bold text-term-text">{aaiiSnap.spreadPctile}%</div></div>
                  </div>
                  <p className="text-3xs leading-relaxed text-term-text-dim">{aaiiSnap.note}</p>
                </div>
              </Panel>
              <div className="mt-2">
                <Panel title="NAAIM Manager Exposure" code="NAAIM" right={<span className="tnum text-2xs font-semibold text-term-amber">{naaim[naaim.length - 1].exposure}%</span>}>
                  <div className="p-3">
                    <Sparkline data={naaim.map((w) => w.exposure)} width={300} height={40} />
                    <p className="mt-2 text-3xs text-term-text-mute">Active managers&apos; mean equity exposure — the &quot;smart money&quot; positioning read vs the retail survey above.</p>
                  </div>
                </Panel>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-8">
              <Panel title="Bull−Bear Spread — 2yr History" code="TREND" accent>
                <div className="p-2">
                  <LineChart
                    height={220}
                    series={[{ name: "Bull−Bear", data: aaii.map((w) => w.spread), color: "#3B9DFF", area: true }]}
                    yFmt={(n) => `${n.toFixed(0)}`}
                  />
                </div>
                <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">Extremes above/below the historical band have historically acted as contrarian markers.</div>
              </Panel>
              <div className="mt-2">
                <Panel title="Recent Weeks" code="LOG">
                  <table className="w-full border-collapse tnum">
                    <thead className="bg-term-panel-2"><tr>{["Week", "Bull", "Neutral", "Bear", "Spread"].map((c, i) => <th key={c} className={clsx("border-b border-term-border px-3 py-1 text-3xs font-semibold uppercase tracking-wider text-term-text-mute", i === 0 ? "text-left" : "text-right")}>{c}</th>)}</tr></thead>
                    <tbody>
                      {recent.map((w) => (
                        <tr key={w.date} className="border-b border-term-border-soft hover:bg-term-panel-2">
                          <td className="px-3 py-1 text-left text-2xs text-term-text-dim">{w.date}</td>
                          <td className="px-3 py-1 text-right text-2xs text-term-up">{w.bullish}%</td>
                          <td className="px-3 py-1 text-right text-2xs text-term-text-mute">{w.neutral}%</td>
                          <td className="px-3 py-1 text-right text-2xs text-term-down">{w.bearish}%</td>
                          <td className={clsx("px-3 py-1 text-right text-2xs font-semibold", pnlClass(w.spread))}>{fmtSigned(w.spread, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              </div>
            </div>
          </div>
        )}

        {/* ── SENT-3 Social Mood ── */}
        {view === "SOCIAL" && (
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-12">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {social.platforms.map((p) => (
                  <Panel key={p.name} title={p.name} code="PLAT">
                    <div className="flex items-center justify-between p-3">
                      <div><div className="text-3xs text-term-text-mute">Posts (24h)</div><div className="tnum text-lg font-bold text-term-text">{(p.posts / 1000).toFixed(0)}k</div></div>
                      <div className="text-right"><div className="text-3xs text-term-text-mute">Net sentiment</div><div className={clsx("tnum text-lg font-bold", pnlClass(p.sentiment))}>{fmtSigned(p.sentiment, 2)}</div></div>
                    </div>
                  </Panel>
                ))}
              </div>
            </div>
            <div className="col-span-12 lg:col-span-6">
              <Panel title="Most-Discussed Tickers" code="SENT-3" accent right={<span className="text-3xs text-term-text-mute">{socialSource} · {(social.totalPosts / 1000).toFixed(0)}k posts</span>}>
                <table className="w-full border-collapse tnum">
                  <thead className="bg-term-panel-2"><tr>{["Ticker", "Mentions", "Velocity", "Sentiment"].map((c, i) => <th key={c} className={clsx("border-b border-term-border px-3 py-1 text-3xs font-semibold uppercase tracking-wider text-term-text-mute", i === 0 ? "text-left" : "text-right")}>{c}</th>)}</tr></thead>
                  <tbody>
                    {social.tickers.map((t) => (
                      <tr key={t.label} className="border-b border-term-border-soft hover:bg-term-panel-2">
                        <td className="px-3 py-1 text-left text-2xs font-semibold text-term-amber">{t.label}</td>
                        <td className="px-3 py-1 text-right text-2xs text-term-text">{t.mentions.toLocaleString()}</td>
                        <td className={clsx("px-3 py-1 text-right text-2xs", pnlClass(t.velocity))}>{fmtSigned(t.velocity, 0)}%</td>
                        <td className="px-3 py-1 text-right"><span className="inline-flex items-center justify-end gap-1.5"><span className="h-1.5 w-12 overflow-hidden rounded-sm bg-term-panel-3"><span className="block h-full rounded-sm" style={{ width: `${((t.sentiment + 1) / 2) * 100}%`, background: t.sentiment >= 0 ? "#2ECC71" : "#FF3B3B" }} /></span><span className={clsx("tnum w-9 text-right text-3xs", pnlClass(t.sentiment))}>{fmtSigned(t.sentiment, 2)}</span></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
            <div className="col-span-12 lg:col-span-6">
              <div className="flex flex-col gap-2">
                {([["Sectors", social.sectors], ["Themes", social.themes]] as const).map(([title, rows]) => (
                  <Panel key={title} title={`Trending ${title}`} code={title === "Sectors" ? "SECT" : "THEME"}>
                    <div className="divide-y divide-term-border-soft">
                      {rows.map((r) => (
                        <div key={r.label} className="flex items-center gap-2 px-3 py-1.5 text-2xs">
                          <span className="min-w-0 flex-1 truncate text-term-text">{r.label}</span>
                          <span className="tnum w-16 shrink-0 text-right text-3xs text-term-text-mute">{r.mentions.toLocaleString()}</span>
                          <span className={clsx("tnum w-12 shrink-0 text-right text-3xs", pnlClass(r.velocity))}>{fmtSigned(r.velocity, 0)}%</span>
                          <span className={clsx("tnum w-10 shrink-0 text-right text-3xs font-semibold", pnlClass(r.sentiment))}>{fmtSigned(r.sentiment, 2)}</span>
                        </div>
                      ))}
                    </div>
                  </Panel>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* ── SENT-4 Behavior & Positioning ── */}
        {view === "POSITION" && (
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-12 lg:col-span-8">
              <Panel title="Retail vs Institutional Positioning" code="SENT-4" accent right={<Tag tone={behav.tone}>gap {fmtSigned(behav.gapNow, 0)} · {behav.gapZ}σ</Tag>}>
                <div className="p-2">
                  <LineChart
                    height={220}
                    labels={["Retail (AAII)", "Managers (NAAIM)"]}
                    series={[
                      { name: "Retail", data: behav.series.map((p) => p.retail), color: "#3B9DFF" },
                      { name: "Managers", data: behav.series.map((p) => p.inst), color: "#A78BFA" },
                    ]}
                    yFmt={(n) => `${n.toFixed(0)}`}
                  />
                </div>
                <div className="border-t border-term-border px-3 py-2 text-2xs leading-relaxed text-term-text-dim">{behav.signal}</div>
              </Panel>
            </div>
            <div className="col-span-12 lg:col-span-4">
              <Panel title="Positioning Now" code="POS">
                <div className="grid grid-cols-2 divide-x divide-term-border border-b border-term-border">
                  <div className="px-3 py-2"><div className="text-3xs text-term-text-mute">Retail mood</div><div className="tnum text-lg font-bold text-term-text">{behav.retailNow}</div></div>
                  <div className="px-3 py-2"><div className="text-3xs text-term-text-mute">Manager exposure</div><div className="tnum text-lg font-bold text-term-text">{behav.instNow}%</div></div>
                </div>
                <div className="px-3 py-2 text-2xs">
                  <span className="text-term-text-mute">Put/Call now </span>
                  <span className="tnum font-semibold text-term-text">{behav.putCallNow}</span>
                  <span className="inline-flex ml-2 align-middle"><Sparkline data={behav.series.map((p) => p.putCall)} width={120} height={16} /></span>
                </div>
              </Panel>
              <div className="mt-2">
                <Panel title="Weekly Fund Flows" code="FLOWS" right={<span className="text-3xs text-term-text-mute">$B net</span>}>
                  <div className="divide-y divide-term-border-soft">
                    {behav.flows.map((f) => (
                      <div key={f.label} className="flex items-center gap-2 px-3 py-1.5 text-2xs">
                        <span className="w-28 shrink-0 text-term-text">{f.label}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-sm bg-term-panel-3">
                          <span className="block h-full rounded-sm" style={{ width: `${Math.min(100, Math.abs(f.value) * 4)}%`, background: f.value >= 0 ? "#2ECC71" : "#FF3B3B" }} />
                        </span>
                        <span className={clsx("tnum w-14 shrink-0 text-right font-semibold", pnlClass(f.value))}>{fmtSigned(f.value, 1)}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </div>
          </div>
        )}

        {/* ── SENT-5 Contrarian Signals & Analogs ── */}
        {view === "SIGNALS" && (
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-12 lg:col-span-7">
              <Panel title="Contrarian Signals" code="SENT-5" accent right={<span className="text-3xs text-term-text-mute">{signals.length} active</span>}>
                <div className="divide-y divide-term-border-soft">
                  {signals.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2 text-2xs">
                      <span className="w-16 shrink-0"><Tag tone={DIR_TONE[s.direction]}>{s.direction}</Tag></span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-term-text">{s.trigger}</div>
                        <div className="text-3xs leading-relaxed text-term-text-mute">{s.rationale}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="tnum text-sm font-bold text-term-text">{s.confidence}</div>
                        <div className="text-3xs text-term-text-mute">conf</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
            <div className="col-span-12 lg:col-span-5">
              <Panel title="Historical Analog" code="ANALOG" accent right={<span className="text-3xs text-term-text-mute">forward returns</span>}>
                <div className="px-3 py-2 text-2xs text-term-text-dim">{analog.condition}</div>
                <table className="w-full border-collapse tnum">
                  <thead className="bg-term-panel-2"><tr>{["Horizon", "Avg Ret", "Hit Rate", "n"].map((c, i) => <th key={c} className={clsx("border-b border-term-border px-3 py-1 text-3xs font-semibold uppercase tracking-wider text-term-text-mute", i === 0 ? "text-left" : "text-right")}>{c}</th>)}</tr></thead>
                  <tbody>
                    {analog.forward.map((f) => (
                      <tr key={f.horizon} className="border-b border-term-border-soft">
                        <td className="px-3 py-1.5 text-left text-2xs text-term-text">{f.horizon}</td>
                        <td className={clsx("px-3 py-1.5 text-right text-2xs font-semibold", pnlClass(f.avgReturn))}>{fmtSigned(f.avgReturn, 1)}%</td>
                        <td className="px-3 py-1.5 text-right text-2xs text-term-text-dim">{f.hitRate}%</td>
                        <td className="px-3 py-1.5 text-right text-3xs text-term-text-mute">{f.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-term-border px-3 py-2 text-3xs leading-relaxed text-term-text-mute">{analog.note}</div>
              </Panel>
            </div>
          </div>
        )}

        {/* ── SENT-6 Survey vs Social Divergence ── */}
        {view === "DIVERGE" && (
          <Panel title="Survey vs Social Divergence" code="SENT-6" accent right={<Tag tone={diverge.tone}>{diverge.status} · gap {fmtSigned(diverge.gapNow, 0)}</Tag>}>
            <div className="p-2">
              <LineChart
                height={240}
                labels={["Survey (AAII)", "Social mood"]}
                series={[
                  { name: "Survey", data: diverge.series.map((p) => p.survey), color: "#A78BFA" },
                  { name: "Social", data: diverge.series.map((p) => p.social), color: "#3B9DFF" },
                ]}
                yFmt={(n) => `${n.toFixed(0)}`}
              />
            </div>
            <div className="border-t border-term-border px-3 py-2 text-2xs leading-relaxed text-term-text-dim">{diverge.note}</div>
            <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">When real-time social mood decouples from the weekly survey, one cohort typically converges to the other — an early-warning of a chase or a capitulation.</div>
          </Panel>
        )}
        {/* ── SENT-7 Ticker Sentiment Drill (× SQZ) ── */}
        {view === "TICKER" && (
          <Panel title="Ticker Sentiment × Borrow (SQZ cross-link)" code="SENT-7" accent right={<span className="text-3xs text-term-text-mute">crowding = social mood × short interest</span>}>
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full border-collapse tnum">
                <thead className="sticky top-0 bg-term-panel-2">
                  <tr>
                    {["Ticker", "Sector", "Social", "Mentions", "Vel", "SI %", "Util", "Fee", "P/C", "Heat", "Crowding"].map((c, i) => (
                      <th key={c} className={clsx("border-b border-term-border px-2 py-1 text-3xs font-semibold uppercase tracking-wider text-term-text-mute", i === 0 || i === 1 || i === 10 ? "text-left" : "text-right")}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickers.map((t) => (
                    <tr key={t.ticker} className="border-b border-term-border-soft hover:bg-term-panel-2" title={t.note}>
                      <td className="px-2 py-1 text-left text-2xs font-semibold text-term-amber">{t.ticker}</td>
                      <td className="px-2 py-1 text-left text-3xs text-term-text-mute">{t.sector}</td>
                      <td className={clsx("px-2 py-1 text-right text-2xs font-semibold", pnlClass(t.socialSentiment))}>{fmtSigned(t.socialSentiment, 2)}</td>
                      <td className="px-2 py-1 text-right text-2xs text-term-text-dim">{t.mentions.toLocaleString()}</td>
                      <td className={clsx("px-2 py-1 text-right text-3xs", pnlClass(t.velocity))}>{fmtSigned(t.velocity, 0)}%</td>
                      <td className="px-2 py-1 text-right text-2xs text-term-text">{t.shortInterestPct}</td>
                      <td className="px-2 py-1 text-right text-2xs text-term-text-dim">{t.utilization}%</td>
                      <td className="px-2 py-1 text-right text-2xs text-term-text-dim">{t.feeBps}</td>
                      <td className="px-2 py-1 text-right text-3xs text-term-text-mute">{t.putCall}</td>
                      <td className="px-2 py-1 text-right text-2xs text-term-text">{t.heat}</td>
                      <td className="px-2 py-1 text-left"><Tag tone={CROWD_TONE[t.crowding]}>{t.crowding}</Tag></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-term-border px-3 py-1.5 text-3xs text-term-text-mute">
              Combines SENT social mood with SQZ borrow microstructure — a crowded long that is also heavily shorted (<span className="text-term-down">Squeeze Risk</span>) is loaded on both sides.
            </div>
          </Panel>
        )}
      </div>

      <div className="border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
        <span className="text-term-amber">SENT</span> — investor sentiment & behavior: AAII survey + NAAIM positioning + X/Reddit/StockTwits mood, distilled into an explainable fear/greed index.
        {vixLive ? " VIX component live via FRED." : ""}
        {socialLive ? ` Social component live via ${socialSource}.` : " Social component is using SIM fallback."}
        {hasAaiiSnapshot() ? " AAII survey uses the committed AAII snapshot." : " AAII survey is using deterministic fallback until the AAII snapshot refresh succeeds."}
        {" "}NAAIM remains deterministic until a connector is wired.
      </div>
    </div>
  );
}
