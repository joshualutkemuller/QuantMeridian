import type { Connect, Plugin, ViteDevServer } from "vite";
import { readBody, toWebRequest, sendWebResponse } from "../src/server/nodeAdapter";

/**
 * Vite plugin that serves the application's `src/app/api/**` route handlers as
 * dev-server middleware. The actual routing lives in `src/server/registry.ts`
 * (the same module the production server uses); this plugin just loads it
 * through `ssrLoadModule` so handlers share the app's module graph, aliases and
 * hot-reloading. Keeping dev and prod on one registry removes the "two truths"
 * risk where dev and a deployed build could resolve `/api/*` differently.
 */
export function devApiPlugin(): Plugin {
  const attach = (server: ViteDevServer) => {
    const middleware: Connect.NextHandleFunction = (req, res, next) => {
      const rawUrl = req.url ?? "/";
      if (!rawUrl.startsWith("/api/") && rawUrl !== "/api") return next();

      void (async () => {
        try {
          const url = new URL(rawUrl, `http://${req.headers.host ?? "localhost"}`);
          const method = (req.method ?? "GET").toUpperCase();
          const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
          const request = toWebRequest(req, url, body);

          // Re-loaded per request so route edits hot-reload; Vite's module graph
          // invalidates the registry (and its globbed handlers) on change.
          const registry = (await server.ssrLoadModule("/src/server/registry.ts")) as {
            handleApiRequest: (request: Request) => Promise<Response | null>;
          };
          const response = await registry.handleApiRequest(request);
          if (!response) return next();
          await sendWebResponse(res, response);
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          // eslint-disable-next-line no-console
          console.error(`[dev-api] ${req.method} ${req.url} failed:`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
          }
          res.end(JSON.stringify({ error: (err as Error).message ?? "internal error" }));
        }
      })();
    };
    // Register directly (not via the returned post-hook) so it runs ahead of
    // Vite's SPA history-fallback and html middleware, which would otherwise
    // serve index.html for /api requests.
    server.middlewares.use(middleware);
  };

  return {
    name: "market-terminal-dev-api",
    configureServer(server) {
      attach(server);
    },
  };
}
