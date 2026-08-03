# Production Architecture

The shipped demo runs 100% in the browser on deterministic mock generators so it can be
hosted statically and reviewed with zero setup. This document describes the **target
production architecture** the UI is designed against — i.e. what each mock would be wired
to in a real institutional deployment.

```
                         ┌────────────────────────────────────────────┐
                         │            QIT Terminal (Next.js)            │
                         │  Bloomberg-style UI · keyboard-driven · RBAC │
                         └───────────────┬───────────────┬─────────────┘
                          WebSocket /    │               │  REST (FastAPI)
                          SSE streams    │               │
                  ┌──────────────────────┴───┐   ┌───────┴───────────────────┐
                  │      Streaming Gateway     │   │       API Gateway         │
                  │   (WebSockets, Kafka bus)  │   │   FastAPI · Pydantic      │
                  └───────────┬────────────────┘   └───────┬───────────────────┘
                              │                            │
        ┌─────────────────────┼──────────────┬────────────┼───────────────────┐
        │                     │              │            │                   │
 ┌──────┴──────┐      ┌───────┴──────┐ ┌─────┴──────┐ ┌───┴─────────┐ ┌───────┴───────┐
 │ Market Data │      │  Analytics   │ │ Optimization│ │  Risk /     │ │  AI Copilot   │
 │ feed adapters│     │ Pandas/Polars│ │ OR-Tools /  │ │  Stress     │ │  LLM + RAG    │
 │ (exchanges, │      │   / NumPy    │ │ Gurobi /    │ │  engine     │ │  over datasets│
 │  prime, repo)│     │              │ │ Pyomo       │ │             │ │               │
 └─────────────┘      └──────────────┘ └─────────────┘ └─────────────┘ └───────────────┘
        │                     │              │            │                   │
        └─────────────────────┴──────────────┴────────────┴───────────────────┘
                                          │
                         ┌────────────────┴─────────────────┐
                         │  PostgreSQL (reference/book)      │
                         │  TimescaleDB (tick / time-series) │
                         └──────────────────────────────────┘
```

## Layers

| Concern | Technology | Maps to (in demo) |
|---------|-----------|-------------------|
| UI | Next.js, React, TypeScript, Tailwind | `src/app`, `src/components` |
| Real-time | WebSockets, Kafka | `useTick` / streaming-styled components & `data/*` generators |
| API | Python, FastAPI, Pydantic | `data/*` typed accessors |
| Analytics | Pandas, Polars, NumPy | `data/*` aggregations (revenue by X, summaries) |
| Optimization | OR-Tools, Gurobi, Pyomo | `data/optimization.ts`, `data/collateral.ts`, `data/cash.ts` |
| Time-series | TimescaleDB | intraday/candle/trend series |
| Reference & book | PostgreSQL | `data/universe.ts`, loan/margin/client books |
| Identity | SSO, Active Directory, RBAC | role badge in the command bar |

## Optimization model sketch

The Collateral / Cash / Sources & Uses optimizers are linear/mixed-integer programs of the
canonical form solved by Gurobi or OR-Tools:

```
minimize    Σ cost_ij · x_ij                      # funding / opportunity cost of allocation
subject to  Σ_j x_ij ≤ available_i                 # source capacity
            Σ_i x_ij ≥ requirement_j               # cover each use / margin call
            Σ x_ij ≤ concentration_limit           # issuer / counterparty concentration
            haircut & eligibility schedules        # collateral quality constraints
            regulatory ratios (LCR / NSFR / BS cap) # balance-sheet & liquidity constraints
            x_ij ≥ 0
```

Shadow prices (dual values) on the binding constraints — surfaced verbatim in the
**Optimization Center** and **Collateral** modules — quantify the marginal value of relaxing
each limit, which drives the recommended trades and what-if analysis.

## Data resolution — Gold DB migration

As of the Gold DB migration (`GOLD_DB_MIGRATION_HANDOFF`), the terminal resolves
economic/market series data through a prioritized chain:

```
MACRO_DB_URL (Gold DB)          ← Tier A/C production path
  │  fred-bronze-to-gold-pipeline SQLite (local) / Postgres / Databricks
  │  Tables: gold.macro_indicator_dashboard, treasury_curve, benchmark_rate_board,
  │          credit_spread_daily, funding_tape_daily, equity_total_return_index, …
  ↓ (fallback when MACRO_DB_URL not set)
FRED_API_KEY                    ← legacy live path
  ↓
econSnapshot.json               ← committed frozen snapshot
  ↓
Deterministic SIM               ← offline / zero-config baseline
```

**Tier B (kept live — deliberate exceptions):** NEWS provider chain, SENT social/survey,
Polymarket, AI Copilot LLM call. Each route carries a `// Exception to DB-only policy`
comment referencing §7 D1 of the handoff.

**Tier C (synthetic book, DB-backed macro inputs):** Internal securities-finance book
modules (SLAB, PB, COLL, CASH, REINV, LIQ, SXU, OPT, DESK, SFE, SQZ, HOME, FCOST,
UTIL, ALRT) keep position/P&L synthetic but pull all rate/curve/credit/regime inputs
from the Gold DB via `src/data/macroInputs.ts`.

**New routes added by the migration:**
- `GET /api/econ/credit` — `gold.credit_spread_daily` + `credit_spread_rolling`
- `GET /api/econ/funding` — `gold.funding_tape_daily` + `funding_stress_daily`
- `GET /api/econ/inflation` — `gold.inflation_explorer` + `inflation_contribution`
- `GET /api/econ/regime` — `gold.macro_regime_daily`
- `GET /api/econ/global` — `gold.global_inflation` + `global_policy_rates`
- `GET /api/ml` — ML Applications (recession probability, inflation forecast, factor scores)

**GoldStore** (`src/lib/server/goldStore.ts`): unified read interface supporting SQLite,
Postgres, and Databricks. Set `MACRO_DB_URL` to activate; set `MACRO_DB_BACKEND=databricks`
plus `DATABRICKS_HOST/HTTP_PATH/TOKEN` for the Delta/Unity Catalog path.
