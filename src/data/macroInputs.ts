/**
 * macroInputs — shared Gold DB macro context for Tier C synthetic-book modules.
 *
 * Tier C modules (COLL, REINV, CASH, LIQ, SFE, FCOST, SQZ, OPT, HOME, ALRT, etc.)
 * keep their position/inventory/P&L book deterministic-synthetic, but all macro/rate
 * inputs must come from Gold, not SIM. This helper fetches the handful of Gold facts
 * these modules need so they consume one DB-sourced context object instead of
 * importing SIM series.
 *
 * See GOLD_DB_MIGRATION_HANDOFF §7 (Tier C) for the full mapping.
 */
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

export interface MacroInputs {
  source: "DB" | "SIM";
  /** Latest treasury curve points: tenor → yield_pct */
  curve: Record<string, number>;
  /** Latest benchmark rates: rate_id → value */
  benchmarks: Record<string, number>;
  /** Funding stress gauge (0–100) and corridor spreads */
  funding: {
    stress_gauge: number | null;
    sofr_effr_spread_bps: number | null;
    ioer_effr_spread_bps: number | null;
  };
  /** Credit spread (HY OAS bps, IG OAS bps) */
  credit: {
    hy_oas_bps: number | null;
    ig_oas_bps: number | null;
  };
  /** Current macro regime */
  regime: {
    named_regime: string | null;
    confidence: number | null;
    growth_score: number | null;
    inflation_score: number | null;
    financial_conditions_score: number | null;
  };
  /** Macro indicator dashboard: series_id → latest_value */
  indicators: Record<string, number>;
  asOf: string | null;
}

const SIM_DEFAULTS: MacroInputs = {
  source: "SIM",
  curve: { "1M": 4.3, "3M": 4.25, "6M": 4.15, "1Y": 3.95, "2Y": 3.74, "5Y": 3.8, "10Y": 4.11, "30Y": 4.35 },
  benchmarks: { FEDFUNDS: 4.08, SOFR: 4.31, DGS2: 3.74, DGS10: 4.11 },
  funding: { stress_gauge: null, sofr_effr_spread_bps: null, ioer_effr_spread_bps: null },
  credit: { hy_oas_bps: 312, ig_oas_bps: 105 },
  regime: { named_regime: null, confidence: null, growth_score: null, inflation_score: null, financial_conditions_score: null },
  indicators: {},
  asOf: null,
};

/** Fetch macro inputs for Tier C modules. Never throws — returns SIM defaults on failure. */
export async function getMacroInputs(): Promise<MacroInputs> {
  if (!goldEnabled()) return SIM_DEFAULTS;

  try {
    const store = goldStore();
    const [curveRows, benchRows, fundingRows, stressRows, creditRows, regimeRows, indicatorRows] = await Promise.all([
      store.latest<{ tenor: string; yield_pct: number; as_of_date: string }>("treasury_curve"),
      store.latest<{ rate_id: string; value: number }>("benchmark_rate_board"),
      store.latest<{ metric: string; value: number; date: string }>("funding_tape_daily"),
      store.latest<{ stress_gauge: number; date: string }>("funding_stress_daily"),
      store.latest<{ instrument: string; oas_bps: number; date: string }>("credit_spread_daily"),
      store.latest<{ named_regime: string; confidence: number; growth_score: number; inflation_score: number; financial_conditions_score: number; date: string }>("macro_regime_daily"),
      store.latest<{ series_id: string; latest_value: number; as_of_date: string }>("macro_indicator_dashboard"),
    ]);

    // Curve: take most recent as_of_date
    const maxCurveDate = curveRows.reduce((m, r) => r.as_of_date > m ? r.as_of_date : m, "");
    const curve: Record<string, number> = {};
    for (const r of curveRows.filter((r) => r.as_of_date === maxCurveDate)) curve[r.tenor] = r.yield_pct;

    const benchmarks: Record<string, number> = {};
    for (const r of benchRows) benchmarks[r.rate_id] = r.value;

    const fundingMap: Record<string, number> = {};
    const maxFundingDate = fundingRows.reduce((m, r) => r.date > m ? r.date : m, "");
    for (const r of fundingRows.filter((r) => r.date === maxFundingDate)) fundingMap[r.metric] = r.value;

    const latestStress = stressRows.sort((a, b) => b.date.localeCompare(a.date))[0];

    const maxCreditDate = creditRows.reduce((m, r) => r.date > m ? r.date : m, "");
    const latestCredit = creditRows.filter((r) => r.date === maxCreditDate);
    const hyRow = latestCredit.find((r) => r.instrument?.includes("HY") || r.instrument?.includes("high_yield"));
    const igRow = latestCredit.find((r) => r.instrument?.includes("IG") || r.instrument?.includes("invest_grade"));

    const latestRegime = regimeRows.sort((a, b) => b.date?.localeCompare(a.date ?? "") ?? 0)[0];

    const indicators: Record<string, number> = {};
    for (const r of indicatorRows) indicators[r.series_id] = r.latest_value;

    const maxDate = [maxCurveDate, maxFundingDate, latestStress?.date ?? "", latestRegime?.date ?? ""]
      .filter(Boolean).sort().at(-1) ?? null;

    return {
      source: "DB",
      curve,
      benchmarks,
      funding: {
        stress_gauge: latestStress?.stress_gauge ?? null,
        sofr_effr_spread_bps: fundingMap["SOFR_EFFR_SPREAD"] ?? null,
        ioer_effr_spread_bps: fundingMap["IOER_EFFR_SPREAD"] ?? null,
      },
      credit: {
        hy_oas_bps: hyRow?.oas_bps ?? null,
        ig_oas_bps: igRow?.oas_bps ?? null,
      },
      regime: {
        named_regime: latestRegime?.named_regime ?? null,
        confidence: latestRegime?.confidence ?? null,
        growth_score: latestRegime?.growth_score ?? null,
        inflation_score: latestRegime?.inflation_score ?? null,
        financial_conditions_score: latestRegime?.financial_conditions_score ?? null,
      },
      indicators,
      asOf: maxDate,
    };
  } catch (err) {
    console.warn("[macroInputs] Gold DB read failed, using SIM defaults:", (err as Error).message);
    return SIM_DEFAULTS;
  }
}
