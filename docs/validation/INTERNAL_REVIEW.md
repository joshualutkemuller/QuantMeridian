# Internal Review — Market Terminal (Holistic)

Date: 2026-06-20
Reviewer: internal engineering pass
Scope: full codebase — `src/app` (32 pages, 12 API routes), `src/components` (27), `src/lib` (18), `src/data` (28)
Method: static read of infrastructure (data hooks, API routes, FRED layer, shell, charting), code-smell scans, build/type checks

---

## 0. Executive Summary

The terminal is in good shape architecturally. The core design — a **4-tier provenance-honest data layer** (DB → FILE → LIVE → SNAPSHOT), **deterministic seeded fallbacks** so nothing ever renders empty, and a **shared charting engine** under two thin studios — is consistent and well-executed. `tsc --noEmit` and `next build` both pass clean.

The pain points are **not** in the happy path; they're in the seams:

- **No error/loading boundaries** — a single thrown error drops the user to Next's default white page, breaking the terminal.
- **No test coverage at all** — including the "pure, unit-tested" indicator/transform functions, which are pure but untested.
- **Client-side everything** — 30/32 pages are `"use client"`; every data hook fetches independently with no dedupe/cache, so shared feeds (e.g. `useLiveIndicators`, used by 10 pages) are re-fetched per mount.
- **A few real functional bugs** — the command palette's security deep-link is dead; provenance badge vocabularies have drifted apart; a stray `test.json` is committed.
- **Mobile/responsive + accessibility** are largely unaddressed.

Findings below are ranked **P0 (correctness/broken) → P3 (polish)**, each with file references and a concrete fix.

---

## 1. Bugs & Correctness (P0–P1)

### 1.1 [P1] Command-palette security deep-link is dead
`src/components/shell/CommandPalette.tsx:37` routes a picked security to `/markets?sym=${s.ticker}`, but `src/app/markets/page.tsx` never reads a `sym` query param — `chartTicker` is hardcoded to `"AAPL"` (`markets/page.tsx:65`) and only the `CHART_CHIPS` buttons change it. Selecting "NVDA" from the palette lands on `/markets` showing AAPL.

**Fix:** In the markets page, read `useSearchParams()`, and if `sym` is present (and in the universe), seed `chartTicker`/selected tab from it. Low effort, restores a headline "Bloomberg command line" feature.

### 1.2 [P1] No error / not-found / loading boundaries
There are zero `error.tsx`, `global-error.tsx`, `not-found.tsx`, or `loading.tsx` files in `src/app`. Any runtime throw in a client page (e.g. a malformed API payload that slips past a guard) bubbles to Next's default error overlay/white screen — jarring in a black terminal and with no recovery path.

**Fix:** Add a root `src/app/error.tsx` (terminal-styled, with a "reset" button) and `src/app/not-found.tsx`. Optionally per-segment `loading.tsx` for the econ/market groups. ~1 hour, high UX payoff.

### 1.3 [P1] Stray committed junk file
`test.json` (contents: `hi`) sits in the repo root. Harmless but signals untidiness and could confuse tooling.

**Fix:** Delete `test.json`.

### 1.4 [P2] Provenance-badge vocabularies have drifted
The terminal's signature is its honest source badges, but three subsystems now use **overlapping-but-different** vocabularies:
- Econ (`lib/useEcon.ts:16`): `FRED | SIM | LOADING | ETL`
- Market (`lib/useMarket.ts:6`): `LIVE | DB | FILE | SNAPSHOT | LOADING`
- Charting (`api/chart/series/route.ts:29-33`, `ChartStudio.tsx:21`): `FRED | SNAPSHOT | ECON | SIM | ERR`

So the *same* underlying FRED-model fallback shows as `SIM` in econ but `ECON` in charting, and the charting layer invents `ERR` that no badge component formally knows. A user comparing the macro dashboard and the macro chart studio sees different words for the same data.

**Fix:** Define one `DataSource` union + one `SourceBadge` tone map in a single module (`lib/provenance.ts`), and have all three subsystems import it. Mechanical but improves the product's core trust signal.

### 1.5 [P2] Alt+1…0 shortcuts are index-fragile and only reach 10 of 30 modules
`AppShell.tsx:35-41` maps `Alt+<digit>` to `NAV[i]`. With 30 nav items, 20 are unreachable, and any reordering of `NAV` silently changes every shortcut. Also collides with browser/OS Alt-shortcuts on some platforms.

**Fix:** Either drop the numeric shortcuts in favor of the (excellent) command palette, or pin a stable `hotkey` field on the handful of `NavItem`s that deserve one rather than relying on array position.

---

## 2. Efficiency & Performance (P2)

### 2.1 [P2] No client-side request dedupe or cache
Every hook (`useEcon`, `useMarket`, `useStats`) is a bespoke `useEffect(fetch)` (see `lib/useEcon.ts:28`). There's no SWR/React-Query layer, so:
- `useLiveIndicators` is called from **10 pages**; navigating between them re-fetches the full indicator set each time, even though it changes daily.
- Two components on the same page needing the same series fire two requests.
- No stale-while-revalidate: every navigation shows the SIM fallback, then flips to live — a visible flash.

**Fix:** Adopt a tiny cache. Either add `swr` (one dep, drop-in: `useSWR(url, fetcher)` with `dedupingInterval`), or a 20-line in-memory `Map<url, {promise, ts}>` shared cache that the existing hooks call. Big perceived-latency win for cross-module navigation.

### 2.2 [P2] Charting resolver refetches all series on any change
`lib/charting/resolver.ts:42` keys its effect on `JSON.stringify(refs)`, so adding/removing one series re-fetches *every* series in the chart. With up to 6 series this is wasteful and adds latency to a core interaction.

**Fix:** Cache resolved series by `source:id:assetClass` (the per-series fetch is already independent in the `Promise.all`), so only new refs hit the network. Pairs naturally with 2.1.

### 2.3 [P3] FRED in-memory cache is mostly inert on serverless
`lib/server/fred.ts:16` keeps a module-level `Map` cache. On Vercel each cold invocation gets a fresh module, so this rarely hits; the real caching is `next: { revalidate }` (line 36). Not a bug — but the in-memory layer gives a false sense of protection against rate limits during burst traffic across instances.

**Fix:** Document that the durable cache is the Next Data Cache; keep the Map only as a within-invocation memo. No urgent action.

### 2.4 [P3] Large client bundles from full client-rendering
30/32 pages are `"use client"`. Pages like `market-lens/page.tsx` (895 lines) and `markets/page.tsx` (454) ship their full logic to the browser. For an internal tool this is acceptable, but the heaviest pages would benefit from moving pure data-shaping into server components / route handlers and keeping only the interactive shell on the client.

---

## 3. Maintainability (P2–P3)

### 3.1 [P2] Zero automated tests
No `*.test.ts(x)` anywhere. The charting plan explicitly promises "pure, unit-tested functions," and the pure layer (`lib/charting/transforms.ts`, `indicators.ts`, `studies.ts`, and the return/drawdown/CAGR math in `api/market/[view]/route.ts`) is *ideal* for unit testing — deterministic, no I/O. A regression in `vsLag` (YoY) or `maxDrawdown` would ship silently.

**Fix:** Add `vitest` and cover the pure functions first: transforms, indicators, studies, and the market return-math helpers (`ret`, `ytd`, `mtd`, `cagr`, `maxDrawdown`). High value-per-test because the inputs/outputs are tiny and exact.

### 3.2 [P2] Lint disabled at build time
`next.config.mjs:6` sets `eslint: { ignoreDuringBuilds: true }`. Lint never gates a build or (likely) CI, so dead code and unused vars accumulate. (`tsc` is correctly enforced via `typescript: { ignoreBuildErrors: false }`.)

**Fix:** Run `next lint` in CI as a separate required step even if left off the build, so the signal exists without slowing builds.

### 3.3 [P3] Monolithic files
`data/marketLens.ts` (1204 lines) and `app/market-lens/page.tsx` (895) are large enough to be friction. The engine mixes series generation, 17 view computations, and the public contract in one file.

**Fix:** Split `marketLens.ts` into `marketLens/series.ts` (generation + provenance), `marketLens/views/*.ts` (per-view tile builders), `marketLens/index.ts` (contract + `runMarketLens`). Non-urgent; do it the next time that file is touched.

### 3.4 [P3] `any` usage concentrated in the market route
25 `any` occurrences, most in `api/market/[view]/route.ts` (the DB/file/snapshot shaping). The DB payloads are genuinely dynamic, but the computed-view outputs have stable shapes that could be typed.

**Fix:** Introduce interfaces for `MarketSnapshotView`, `BilelloView`, `IndexReturnsView` and type the `computedView`/`filterSnapshotByAsOf` outputs. Improves safety on the as-of filtering logic, which is the most intricate code in the route.

---

## 4. Accessibility & Responsive (P2–P3)

### 4.1 [P2] Modals lack focus management and ARIA roles
`CommandPalette.tsx`, the Save-Template dialog in `ChartStudio.tsx`, and the `DrillProvider` modal are plain divs. No `role="dialog"`, `aria-modal`, focus trap, or focus restoration on close. Keyboard users can tab out of the modal into the page behind it.

**Fix:** A small shared `<Modal>` primitive with focus trap + `role="dialog"` + restore-focus, reused by all three. Consolidates three ad-hoc overlays too.

### 4.2 [P3] Icon-only buttons inconsistently labelled
Only `ChartStudio.tsx` shows meaningful `aria-label`/`role` density (4). Many icon buttons elsewhere rely on `title` alone (e.g. `CommandBar.tsx` sidebar toggle). `title` is not reliably announced by screen readers.

**Fix:** Add `aria-label` to icon-only buttons; cheap and broad.

### 4.3 [P3] No mobile/responsive story for the shell
`AppShell.tsx:48` is `h-screen overflow-hidden` with an always-present sidebar (collapsible to `w-12`, never hidden) and dense `DataGrid` tables. On a phone the sidebar permanently eats width and tables overflow. Fine if desktop-only is an explicit decision — but it should be stated.

**Fix:** If mobile matters, add a breakpoint that turns the sidebar into a drawer below `md`. Otherwise document "desktop-first, ≥1024px" in the README.

---

## 5. Functionality Improvements (opportunities)

### 5.1 AI Copilot is a keyword matcher, not AI
`app/copilot/page.tsx:64` (`answerFor`) is a deterministic keyword switch over local datasets. It's a solid demo, but the module is named "AI Copilot" and sits in the INTELLIGENCE group. With the Anthropic API and the existing structured datasets, this is the single highest-leverage upgrade: route free-text to Claude with the desk datasets as tool-callable context, keeping the deterministic answers as offline fallback (mirrors the data layer's own fallback philosophy).

### 5.2 Drill-in coverage is partial
Phase 4 added "Open in Chart Studio" from the macro dashboard, MKT candle, and the econ drill modal. The fixed econ pages (`INFL`, `CURV`, `CRDT`, `STAT`, etc.) and Market Lens views still lack the affordance the charting plan calls for (§4 of the charting plan: "every fixed econ page gets an Open in Chart Studio").

**Fix:** Drop the existing `ChartLink` component into each econ page header — the helper (`econChartHref`) already exists.

### 5.3 Saved templates/drawings are localStorage-only
Phase 4 persists templates and drawings to `localStorage` (`lib/charting/templates.ts`, `drawings.ts`). They don't survive a browser/device change and can't be shared except via URL. The charting plan anticipates an optional `/api/chart/templates` DB tier (§7).

**Fix:** Add the optional DB-backed templates route mirroring the `MARKET_DB_URL` pattern, with localStorage as the offline tier — consistent with the rest of the terminal.

### 5.4 Cron warmer doesn't touch the charting/lens endpoints
`api/cron/refresh/route.ts` warms econ + market views but not `/api/chart/series` or `/api/market-lens`. After a cold deploy the first chart-studio visit pays full FRED latency.

**Fix:** Add a few representative chart-series/lens URLs to the warm list (low cost; they share the FRED cache anyway).

---

## 6. What's working well (keep)

- **Provenance-honest fallbacks** everywhere — the DB→FILE→LIVE→SNAPSHOT ladder in `api/market/[view]/route.ts` is textbook, always returns 200, never blocks the UI.
- **Deterministic seeded data** (`lib/rng.ts`) keeps SSR/hydration stable and demos reproducible.
- **Optional native drivers** loaded via `optionalRequire` (`api/market/[view]/route.ts:58`) so the app runs with zero backend yet upgrades cleanly when `pg`/`duckdb` are present.
- **Clean type discipline** — `tsc` is enforced and passes; the charting engine's spec/transform/indicator separation is genuinely reusable.
- **Command palette** (`CommandPalette.tsx`) is fast and the right primary navigation model (which is why 1.1 and the Alt-key fragility are worth fixing).

---

## 7. Suggested priority order

| # | Item | Severity | Effort |
|---|------|----------|--------|
| 1 | Error/not-found boundaries (1.2) | P1 | S |
| 2 | Fix command-palette security link (1.1) | P1 | S |
| 3 | Delete `test.json` (1.3) | P1 | XS |
| 4 | Unify provenance badge vocabulary (1.4) | P2 | M |
| 5 | Client fetch dedupe/cache + SWR (2.1, 2.2) | P2 | M |
| 6 | Vitest on pure functions (3.1) | P2 | M |
| 7 | Shared accessible Modal primitive (4.1) | P2 | M |
| 8 | Lint in CI (3.2) | P2 | S |
| 9 | Copilot → Claude API (5.1) | P2 | L |
| 10 | Remaining drill-ins + DB templates (5.2, 5.3) | P3 | M |
| 11 | Mobile drawer / document desktop-only (4.3) | P3 | M |
| 12 | Split monoliths, type the market route (3.3, 3.4) | P3 | M |

*Items 1–3 are an afternoon and remove the sharpest user-facing edges. Items 4–8 are the structural backbone (trust, performance, safety) worth a focused sprint. Items 9–12 are roadmap-level.*
