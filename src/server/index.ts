/**
 * Standalone production server.
 *
 * Closes the dev-vs-deploy gap documented in
 * `docs/LIVE_DATA_READINESS_ASSESSMENT.md`: a plain `vite build` emits only a
 * static SPA, so the `/api/*` route handlers never run in production and every
 * data module silently falls back to committed snapshots. This server serves the
 * built client from `dist/` and mounts the exact same route registry the dev
 * server uses, so configured providers (`FRED_API_KEY`, `MARKET_DB_URL`,
 * `MARKET_PIPELINE_URL`, …) are actually reachable in a deployed build.
 *
 * Build with `npm run build` (client → `dist/`, this entry → `dist-server/`),
 * then run with `npm start`.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./registry";
import { readBody, toWebRequest, sendWebResponse } from "./nodeAdapter";
import { goldEnabled, goldStore } from "@/lib/server/goldStore";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// `dist-server/index.js` sits alongside the client build in `dist/`.
const CLIENT_DIR = process.env.CLIENT_DIR
  ? path.resolve(process.env.CLIENT_DIR)
  : path.resolve(HERE, "../dist");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function contentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Resolve a request path to a file inside CLIENT_DIR, guarding against
 *  traversal. Returns `null` when the path escapes the client directory. */
function resolveStatic(pathname: string): string | null {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  const full = path.resolve(CLIENT_DIR, rel);
  if (full !== CLIENT_DIR && !full.startsWith(CLIENT_DIR + path.sep)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      const rawUrl = req.url ?? "/";
      const url = new URL(rawUrl, `http://${req.headers.host ?? "localhost"}`);

      // 1. API routes — same registry the dev server uses.
      if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
        const body = await readBody(req);
        const request = toWebRequest(req, url, body);
        const response = await handleApiRequest(request);
        if (response) return void (await sendWebResponse(res, response));
      }

      // 2. Static assets from the client build.
      const target = resolveStatic(url.pathname);
      if (target && target !== CLIENT_DIR) {
        const stat = await fs.promises.stat(target).catch(() => null);
        if (stat?.isFile()) {
          res.statusCode = 200;
          res.setHeader("content-type", contentType(target));
          // Vite emits content-hashed asset filenames under /assets — cache hard.
          if (url.pathname.startsWith("/assets/")) {
            res.setHeader("cache-control", "public, max-age=31536000, immutable");
          }
          return void fs.createReadStream(target).pipe(res);
        }
      }

      // 3. SPA fallback — let react-router handle client-side routes.
      const indexHtml = path.join(CLIENT_DIR, "index.html");
      const html = await fs.promises.readFile(indexHtml).catch(() => null);
      if (html) {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        return void res.end(html);
      }

      res.statusCode = 404;
      res.end("Not found");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[server] ${req.method} ${req.url} failed:`, err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
      }
      res.end(JSON.stringify({ error: (err as Error).message ?? "internal error" }));
    }
  })();
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`market-terminal serving ${CLIENT_DIR} on http://${HOST}:${PORT}`);
  void (async () => {
    if (!goldEnabled()) return;
    const health = await goldStore().health();
    if (health.ok) {
      console.info(`[server] Gold DB startup check OK (backend=${health.backend}, latencyMs=${health.latencyMs}, ${health.detail})`);
    } else {
      console.warn(`[server] Gold DB startup check failed (backend=${health.backend}, latencyMs=${health.latencyMs}, ${health.detail})`);
    }
  })().catch((err) => {
    console.warn(`[server] Gold DB startup check failed: ${(err as Error).message}`);
  });
});
