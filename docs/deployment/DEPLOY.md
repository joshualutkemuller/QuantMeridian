# Deploying QIT Terminal

This is a **Vite + React SPA** with Web-standard `/api/*` handlers. The SPA is static,
but `/api/*` needs a **runtime**. A static-only deploy (plain CDN, `vite preview`, or a
misconfigured host) serves the UI but no API — so every module shows committed
snapshots / simulation and the DataOps provider table shows **UNVERIFIED**.

There are two supported runtimes. **If Vercel is giving you trouble, use Option A — it is
verified end-to-end.**

---

## Option A — Node process host (Render / Railway / Fly.io / a VM) ✅ verified

`npm start` runs `src/server/index.ts`, a single Node process that serves the built SPA
(`dist/`) **and** `/api/*` from the same registry the dev server uses. No serverless
bundling, no per-platform quirks.

### Render (fastest)
1. Push the branch to GitHub (already done) and merge to `main`.
2. Render → **New → Web Service** → connect this repo, branch `main`.
3. Settings:
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
   - **Environment:** `Node` (Render auto-detects), Node 20+.
4. **Environment Variables:** add `FRED_API_KEY` (and optionally `ANTHROPIC_API_KEY`,
   `MARKET_PIPELINE_URL`).
5. Deploy. The service listens on `$PORT` automatically (the server reads `process.env.PORT`).

### Railway / Fly.io / any VM
Same two commands:
```bash
npm run build      # → dist/ (client) + dist-server/ (server)
npm start          # serves http://0.0.0.0:$PORT  (PORT defaults to 3000)
```
Set `FRED_API_KEY` in the platform's env. For the daily cache warm-up, point any
scheduler (OS cron, GitHub Actions, the platform's cron) at `GET /api/cron/refresh`.

**Verify:** open `/api/dataops/health` → the `FRED` entry reads `LIVE` / `FRED reachable`,
and the Economics page shows `LIVE · FRED`.

---

## Option B — Vercel (serverless)

The repo ships a `vercel.json` (`framework: vite`, `buildCommand: npm run build:vercel`)
and a catch-all serverless function `api/[...path].ts` that adapts the request to the same
route registry.

### Setup
1. **Import the repo** as a **new** Vercel project.
2. **Framework Preset must be _Vite_** (or "Other"). If Vercel detected Next.js earlier,
   that's wrong — there is no `next` dependency.
3. **Do not set a dashboard Build Command override** — let `vercel.json` drive it
   (`npm run build:vercel`). A dashboard override beats `vercel.json`.
4. **Environment Variables:** `FRED_API_KEY` = your key (named exactly that — **not**
   `VITE_FRED_API_KEY`; the `VITE_` prefix is browser-only and the server won't see it).
   Add for the environment you'll view (Production/Preview), then **redeploy** (env changes
   only apply to new deployments).
5. Optional: `CRON_SECRET` to lock `/api/cron/refresh`; `MARKET_PIPELINE_URL` for live
   markets (prefer this over a direct `MARKET_DB_URL` on serverless — the `pg`/`duckdb`
   drivers aren't traced into the function bundle).

### Verify / troubleshoot (in order)
1. **`/api/_ping`** — a zero-dependency function. Open `https://<app>.vercel.app/api/_ping`:
   - **JSON** (`{"ok":true,"fredKeyPresent":…}`) → functions run. If `fredKeyPresent` is
     `false`, the env var isn't bound → fix step 4 + redeploy.
   - **The app UI or a 404** → **functions aren't deploying at all**. Check the deployment's
     **Build Logs** (did it run `build:vercel`?) and **Functions** tab (is `api/[...path]`
     listed?). If not listed, the `api/` directory isn't being picked up.
2. **`/api/dataops/health`** — once `_ping` works, this shows the real `FRED` status/detail.
3. **`/api/econ/indicators`** — `"source":"FRED"` means live econ is working.

> Note: the Vercel serverless path has been harder to validate than the process host. If
> `/api/_ping` returns the app/404 on a clean project, prefer **Option A** — it sidesteps
> all serverless bundling and routing.

---

## Environment variables (both options)

| Var | Effect |
|-----|--------|
| `FRED_API_KEY` | Live economics (FRED). Server-side only — never `VITE_`-prefixed. |
| `ANTHROPIC_API_KEY` | Live AI Copilot (else local keyword engine). |
| `MARKET_PIPELINE_URL` / `MARKET_DB_URL` / `MARKET_DATA_DIR` | Live market data (else committed snapshot). |
| `HTTPS_PROXY` / `FRED_PROXY_URL` | Route server fetch through a proxy (corporate networks). |
| `CRON_SECRET` | Locks `/api/cron/refresh`. |

Without any of these the terminal runs fully on committed snapshots / simulation — and the
provenance badges say so honestly.
