# QIT Terminal Future Feature Roadmap

This roadmap is a product and engineering backlog for the QIT Terminal, with the first focus on user-interface polish and bug-risk reduction before adding larger platform capabilities. It is based on the current Next.js terminal shell, navigation model, module inventory, data-source posture, and observed test/lint output.

## Roadmap principles

1. **Stabilize the terminal before widening it.** The application already contains a broad module surface across markets, securities finance, optimization, economics, intelligence, and alerts. Near-term work should reduce visual inconsistency, discoverability gaps, and runtime risk.
2. **Keep the Bloomberg-style density, but add user control.** Dense layouts are part of the product identity; future UI work should add configurable density, saved workspaces, and accessibility affordances without turning the terminal into a generic dashboard.
3. **Make live-vs-simulated state impossible to miss.** The product deliberately mixes live FRED, ETL, partial-live, and simulated/local-model modules. UI and data plumbing should make source status, freshness, and fallbacks visible at every decision point.
4. **Prefer reusable primitives over one-off page fixes.** Bugs and UI inconsistencies should be addressed in shared shell, grid, chart, panel, badge, and data-fetching components wherever possible.

## Phase 1 — UI polish and interaction quality

### 1.1 Navigation, command, and workspace ergonomics

- Add a **workspace layout system** that lets users save named terminal layouts by role, for example `Sec Lending PM`, `Treasury`, `Macro`, `Risk`, and `DataOps`.
- Expand the command palette from simple module/security routing into a **true command surface**:
  - support commands such as `OPEN SLAB`, `PIN CURV`, `COMPARE NVDA AAPL`, `ALERT GME FEE > 500`, and `EXPORT PANEL`;
  - show command history and most-used modules;
  - add fuzzy matching and aliases for desks, tickers, and analytics.
- Add **route-aware breadcrumbs** and page-level quick actions so users can understand where they are inside deep areas like Economics, Securities Lending, and Chart Studios.
- Improve the collapsed sidebar with icon tooltips, active group indicators, and optional pinned favorites.
- Add keyboard shortcut documentation directly in the terminal, including command palette, sidebar collapse, module jumps, table sorting, and chart interactions.

### 1.2 Visual hierarchy and terminal density

- Introduce a global **display density setting**: compact, standard, and presentation. Compact should preserve current desk density; presentation should increase chart and label legibility for demos.
- Standardize page headers, KPI strips, panel headers, panel right-actions, tags, source badges, and empty states across all modules.
- Add a consistent **data freshness rail** or header strip with source status, latest observation time, fallback state, and cache age.
- Refine color semantics:
  - amber for command/action;
  - green/red for P&L and directional change;
  - blue for reference/live data;
  - purple or cyan for AI/model outputs;
  - grey for unavailable or stale data.
- Add a high-contrast accessibility mode that preserves the terminal look but improves border contrast, focus rings, and chart legibility.

### 1.3 Tables and data-grid upgrades

- Add reusable grid capabilities that will benefit nearly every module:
  - column resizing;
  - column pinning;
  - keyboard row navigation;
  - row virtualization for large books;
  - CSV export;
  - quick filters;
  - multi-column sort;
  - visible sort/filter chips.
- Add explicit empty, loading, stale, and error states to tables.
- Add row-level provenance popovers that explain whether a value is live, simulated, computed, cached, or sourced from ETL.
- Add numeric precision controls by domain: rates in bps, funding in bps, exposure in abbreviated USD, CPI in percentages, and optimization outputs in absolute plus incremental impact.

### 1.4 Charting and analytical surface improvements

- Add crosshair tooltips, synchronized hover, zoom/pan, and benchmark overlays to the shared chart components.
- Add a chart annotation layer for events such as FOMC meetings, CPI releases, stress periods, specials events, and optimization run timestamps.
- Add **chart-to-table drilldown** so clicking a line, heat-map cell, Sankey edge, or treemap tile opens the underlying observations.
- Add export support for PNG/SVG and CSV from every chart panel.
- Add reusable legends with series toggles, color-safe palettes, and source/status badges.

### 1.5 Responsive and multi-monitor behavior

- Improve small-screen behavior for wide tables and dense grid pages by introducing mobile-aware panel stacking, horizontal table affordances, and compact chart legends.
- Add a **detached monitor mode** that opens selected modules in a clean secondary-window layout without the full sidebar.
- Add URL-serializable panel state so views can be shared and restored exactly, including selected tickers, filters, scenario, curve spread, and chart range.

## Phase 2 — Bug-risk reduction and reliability backlog

### 2.1 Known issues and quality signals to address first

- Fix the current lint warning around custom font loading in `src/app/layout.tsx` by moving to the Next.js font system or another supported pattern.
- Remove or document npm environment warnings such as the unknown `http-proxy` config warning observed during test and lint commands.
- Add tests for shell-level interactions: command palette open/close, command search, keyboard navigation, sidebar mobile drawer behavior, and module route jumps.
- Add tests for DataGrid sorting behavior, missing `sortVal` behavior, selected row state, and dense/non-dense rendering.
- Add smoke tests for high-value routes: Home, Live Markets, Market Snapshot, Securities Lending, Collateral, Treasury Curve Lab, Inflation Explorer, DataOps, Alerts, and AI Copilot.

### 2.2 Runtime and data resilience

- Add a standardized `DataState` contract for all modules: `loading`, `live`, `partial`, `simulated`, `stale`, `error`, and `unauthorized`.
- Centralize cache/fallback behavior so FRED, Yahoo/pipeline, ETL, Anthropic, and local deterministic data report consistent freshness metadata.
- Add module-level health checks visible in DataOps and a lightweight status indicator in the global status bar.
- Add circuit-breaker behavior for slow APIs and provider failures so one degraded source never blocks the terminal shell.
- Add request tracing IDs to API responses and surface them in error panels for support/debug workflows.

### 2.3 Accessibility and keyboard bugs

- Audit focus management for modals, command palette, sidebar drawer, chart controls, and table rows.
- Add visible focus rings across all interactive terminal controls.
- Ensure Escape, Enter, Arrow keys, and Tab behavior is consistent and does not conflict between global shell handlers and modal/table handlers.
- Add ARIA labels for icon-only controls, chart controls, panel action buttons, and status badges.
- Confirm the mobile sidebar traps or restores focus appropriately when opened and closed.

### 2.4 Performance bugs

- Profile the largest module pages for hydration cost, render cost, and chart/table re-render loops.
- Add memoization and virtualization where large static arrays or derived analytics are repeatedly recomputed client-side.
- Lazy-load heavy modules and chart studios where possible.
- Add bundle analysis to CI and set a budget for shell, shared charting, and each major route group.

## Phase 3 — Product feature expansion after UI and bugs

### 3.1 Securities lending and squeeze intelligence

- Add borrow-rate history, utilization history, lendable supply changes, recall pressure, and specials lifecycle tracking.
- Add issuer-level and sector-level aggregation for fee opportunity, concentration, and squeeze risk.
- Add scenario tools for recall shocks, fee compression, client demand changes, and collateral substitution impacts.
- Add automated narratives explaining the top changes in hard-to-borrow names and revenue drivers.

### 3.2 Prime finance and financing analytics

- Add client profitability waterfalls across financing spread, balance-sheet usage, margin, shorts, synthetic exposure, and liquidity cost.
- Add hedge-fund-client exposure drilldowns with concentration flags and stress overlays.
- Add balance-sheet optimization recommendations connected to collateral, sources/uses, and funding modules.
- Add daily exception queues for underpriced financing, margin disputes, client limit breaches, and data breaks.

### 3.3 Collateral, cash, reinvestment, and liquidity

- Add end-to-end collateral lifecycle tracking from margin call to settlement to reuse.
- Add eligibility rule authoring and what-if testing for client schedules, CCPs, bilateral agreements, and internal constraints.
- Add intraday liquidity timeline views for funding gaps, settlement waves, and contingency sources.
- Add policy-rate transmission scenarios linking FOMC path changes into reinvestment yield, funding cost, collateral haircuts, and optimization runs.

### 3.4 Optimization platform

- Add solver explainability: objective terms, constraint binding status, dual/shadow prices, infeasible constraint diagnostics, and recommended manual overrides.
- Add before/after blotters and approval workflows for recommended trades or collateral movements.
- Add replayable optimization runs with frozen inputs, solver version, runtime, outputs, and sign-off metadata.
- Add sensitivity sweeps for haircut changes, funding spread changes, liquidity buffers, borrower demand, and balance-sheet charges.

### 3.5 Macro, markets, and economic intelligence

- Add a cross-module event calendar that links macro releases, market moves, financing impacts, and alert triggers.
- Add regime-aware playbooks that automatically highlight desk actions under growth, inflation, liquidity, policy, and credit regimes.
- Add market chart templates and macro chart templates tied to common workflows: curve steepener, inflation impulse, credit stress, dollar funding, risk-on/risk-off.
- Add correlation and lead/lag studies between macro factors and securities-finance outcomes such as fee revenue, specials, utilization, reinvestment spread, and funding gap.

### 3.6 AI Copilot and intelligence workflows

- Add source-cited answers with links back to panels, rows, chart points, and datasets.
- Add copilot actions that can create alerts, open modules, build charts, compare securities, and draft desk summaries.
- Add role-scoped prompt packs: trader, portfolio manager, treasury, collateral manager, risk, ops, and executive.
- Add guardrails that force the copilot to label simulated data, stale data, and computed/model-derived estimates.

### 3.7 Alerts, news, and workflow automation

- Add a rule builder for alerts across securities lending, financing, collateral, funding, macro, markets, and DataOps.
- Add severity routing, owner assignment, comments, acknowledgements, snooze, and audit trail.
- Add notification adapters for email, Slack/Teams, webhook, and ticketing systems.
- Add news/signal explainability that links article themes to affected securities, sectors, clients, desks, and portfolio metrics.

## Phase 4 — Platform, data, and enterprise readiness

### 4.1 Data integration roadmap

- Formalize provider adapters for FRED, Yahoo/prototype market data, licensed market data, internal books, collateral systems, risk systems, settlement systems, and optimizer outputs.
- Add a data contract registry with schema versioning, field-level lineage, units, transforms, and quality checks.
- Add daily data-quality scorecards and automated stale-data escalation.
- Add replayable historical snapshots for audit, backtesting, and demo reproducibility.

### 4.2 Security and controls

- Add authentication and authorization with role-based module access.
- Add row-level and client-level entitlements for sensitive borrower, hedge fund, and beneficial-owner data.
- Add audit logging for exports, AI prompts, scenario runs, optimization approvals, and alert acknowledgements.
- Add environment-aware secrets management and key-health diagnostics for external data and AI providers.

### 4.3 Engineering and deployment

- Add CI gates for lint, unit tests, route smoke tests, type checking, build, and bundle budget.
- Add Playwright visual regression tests for high-value modules and shell interactions.
- Add Storybook or a lightweight component gallery for terminal UI primitives.
- Add observability dashboards for API latency, error rate, data freshness, cache hits, and client-side render errors.

## Suggested first 10 tickets

1. Fix Next.js font-loading lint warning and document the chosen font-loading pattern.
2. Add `docs/UI_COMPONENT_GUIDELINES.md` covering colors, typography, badges, grid behavior, empty states, and source-state labels.
3. Add unit tests for `DataGrid` sorting, selected rows, and non-sortable columns.
4. Add command palette tests for search, keyboard navigation, Enter selection, and Escape close.
5. Add route smoke tests for the top 10 user-facing modules.
6. Add a global data-state badge component for live, ETL, simulated, stale, partial, and error states.
7. Add reusable empty/loading/error states for panels and tables.
8. Add chart crosshair tooltip support to the shared chart components.
9. Add saved command history and favorites in the command palette.
10. Add DataOps provider-health integration into the global status bar.

## Success metrics

- **UI consistency:** all modules use shared page headers, panels, source badges, and empty/error states.
- **Reliability:** lint, unit tests, route smoke tests, and production build pass in CI.
- **Discoverability:** command palette can find modules, tickers, saved views, common actions, and recent commands.
- **Trust:** every material number exposes source, freshness, and fallback status.
- **Speed:** top modules stay within agreed render and interaction budgets on standard analyst laptops.
- **Workflow value:** users can move from alert → source data → chart/table drilldown → scenario/optimization → action without leaving the terminal.
