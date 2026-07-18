/**
 * GoldStore — unified read interface for the fred-bronze-to-gold-pipeline Gold layer.
 *
 * Backend is detected from MACRO_DB_URL:
 *   sqlite:./data/fred_local.db        local/dev (pipeline --local output)
 *   postgres://user:pass@host/db        deploy (pipeline Postgres publish)
 * Or set MACRO_DB_BACKEND=databricks with DATABRICKS_HOST/HTTP_PATH/TOKEN.
 *
 * Drivers are optional/lazy (better-sqlite3 | pg | @databricks/sql), so a
 * runtime only needs the driver for its configured backend.
 *
 * Physical table naming:
 *   SQLite: gold_<table>  (e.g. gold_macro_indicator_dashboard)
 *   Postgres/Delta: gold.<table> (or <catalog>.gold.<table>)
 *
 * No fallback on zero rows or connection failure — callers receive an explicit
 * error/empty result. This is the core behavioral contract of the migration.
 */
export const runtime = "nodejs";

export interface GoldStore {
  /** All rows from a Gold fact table, with optional equality filters. */
  latest<T>(table: string, where?: Record<string, unknown>): Promise<T[]>;
  /** Observation history for a series/entity, ascending by date. */
  history<T>(table: string, key: Record<string, unknown>, limit?: number): Promise<T[]>;
  /** Rows as-known-on a given realtime date. */
  asOf<T>(table: string, asOf: string, where?: Record<string, unknown>): Promise<T[]>;
  /** Escape hatch for complex queries. */
  raw<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Connection + latency probe. */
  health(): Promise<{ ok: boolean; backend: string; latencyMs: number; detail: string }>;
}

/** Require an optional module at runtime without the bundler resolving it. */
function optionalRequire(name: string): any {
  try {
    // eslint-disable-next-line no-eval
    return (eval("require") as NodeRequire)(name);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Table name resolution
// ---------------------------------------------------------------------------

type Backend = "sqlite" | "postgres" | "databricks";

function detectBackend(): Backend {
  if (process.env.MACRO_DB_BACKEND === "databricks") return "databricks";
  const url = process.env.MACRO_DB_URL ?? "";
  if (/^postgres(ql)?:\/\//.test(url)) return "postgres";
  return "sqlite";
}

function physicalTable(table: string, backend: Backend): string {
  const catalog = process.env.MACRO_CATALOG ?? "macro_prod";
  if (backend === "sqlite") return `gold_${table}`;
  if (backend === "databricks") return `${catalog}.gold.${table}`;
  return `gold.${table}`;
}

// ---------------------------------------------------------------------------
// Short in-process TTL cache (avoids per-request DB storms)
// ---------------------------------------------------------------------------

type CacheEntry = { at: number; data: unknown[] };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 1 min — Gold is batch, not tick-live

function cacheKey(table: string, qualifier: unknown): string {
  return `${table}:${JSON.stringify(qualifier)}`;
}

function fromCache<T>(key: string): T[] | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  return entry.data as T[];
}

function toCache(key: string, data: unknown[]): void {
  CACHE.set(key, { at: Date.now(), data });
}

// ---------------------------------------------------------------------------
// WHERE clause builder (parameterized, dialect-aware)
// ---------------------------------------------------------------------------

function buildWhere(
  where: Record<string, unknown>,
  backend: Backend,
  startIdx = 1
): { clause: string; params: unknown[] } {
  const keys = Object.keys(where);
  if (!keys.length) return { clause: "", params: [] };
  const params: unknown[] = [];
  const parts = keys.map((k, i) => {
    params.push(where[k]);
    const placeholder = backend === "sqlite" ? "?" : `$${startIdx + i}`;
    return `${k} = ${placeholder}`;
  });
  return { clause: `WHERE ${parts.join(" AND ")}`, params };
}

// ---------------------------------------------------------------------------
// SQLite backend
// ---------------------------------------------------------------------------

async function sqliteQuery<T>(sql: string, params: unknown[]): Promise<T[]> {
  const Database = optionalRequire("better-sqlite3");
  if (!Database) throw new Error("better-sqlite3 is not installed — run `npm i better-sqlite3`");
  const url = (process.env.MACRO_DB_URL ?? "").replace(/^sqlite:/, "");
  const db = new Database(url, { readonly: true, fileMustExist: true });
  try {
    const stmt = db.prepare(sql);
    return stmt.all(...params) as T[];
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Postgres backend
// ---------------------------------------------------------------------------

async function pgQuery<T>(sql: string, params: unknown[]): Promise<T[]> {
  const pg = optionalRequire("pg");
  if (!pg) throw new Error("pg is not installed — run `npm i pg`");
  const client = new pg.Client({ connectionString: process.env.MACRO_DB_URL });
  try {
    await client.connect();
    const r = await client.query(sql, params);
    return r.rows as T[];
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Databricks backend
// ---------------------------------------------------------------------------

async function databricksQuery<T>(sql: string, params: unknown[]): Promise<T[]> {
  const sdk = optionalRequire("@databricks/sql");
  if (!sdk) throw new Error("@databricks/sql is not installed — run `npm i @databricks/sql`");
  // Databricks SQL doesn't support positional params natively via the Node SDK;
  // inline them safely (numeric/bool/string only — our params are always those).
  let i = 0;
  const inlined = sql.replace(/\?|\$\d+/g, () => {
    const v = params[i++];
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
  const client = new sdk.DBSQLClient();
  await client.connect({
    host: process.env.DATABRICKS_HOST,
    path: process.env.DATABRICKS_HTTP_PATH,
    token: process.env.DATABRICKS_TOKEN,
  });
  try {
    const session = await client.openSession();
    const op = await session.executeStatement(inlined, { runAsync: false });
    const rows = await op.fetchAll();
    await op.close();
    await session.close();
    return rows as T[];
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function query<T>(sql: string, params: unknown[], backend: Backend): Promise<T[]> {
  if (backend === "sqlite") return sqliteQuery<T>(sql, params);
  if (backend === "postgres") return pgQuery<T>(sql, params);
  return databricksQuery<T>(sql, params);
}

// ---------------------------------------------------------------------------
// GoldStore factory
// ---------------------------------------------------------------------------

export function createGoldStore(): GoldStore {
  const backend = detectBackend();

  return {
    async latest<T>(table: string, where?: Record<string, unknown>): Promise<T[]> {
      const key = cacheKey(`latest:${table}`, where);
      const cached = fromCache<T>(key);
      if (cached) return cached;

      const phys = physicalTable(table, backend);
      const { clause, params } = buildWhere(where ?? {}, backend);
      const sql = `SELECT * FROM ${phys} ${clause}`.trim();
      const rows = await query<T>(sql, params, backend);
      toCache(key, rows);
      return rows;
    },

    async history<T>(table: string, key: Record<string, unknown>, limit?: number): Promise<T[]> {
      const cKey = cacheKey(`history:${table}`, { key, limit });
      const cached = fromCache<T>(cKey);
      if (cached) return cached;

      const phys = physicalTable(table, backend);
      const { clause, params } = buildWhere(key, backend);
      const limitClause = limit ? `LIMIT ${Number(limit)}` : "";
      const sql = `SELECT * FROM ${phys} ${clause} ORDER BY date ASC ${limitClause}`.trim();
      const rows = await query<T>(sql, params, backend);
      toCache(cKey, rows);
      return rows;
    },

    async asOf<T>(table: string, asOf: string, where?: Record<string, unknown>): Promise<T[]> {
      const cKey = cacheKey(`asOf:${table}`, { asOf, where });
      const cached = fromCache<T>(cKey);
      if (cached) return cached;

      const phys = physicalTable(table, backend);
      const combined = { ...(where ?? {}), realtime_start: asOf };
      const { clause, params } = buildWhere(combined, backend);
      const sql = `SELECT * FROM ${phys} ${clause}`.trim();
      const rows = await query<T>(sql, params, backend);
      toCache(cKey, rows);
      return rows;
    },

    async raw<T>(sql: string, params?: unknown[]): Promise<T[]> {
      return query<T>(sql, params ?? [], backend);
    },

    async health(): Promise<{ ok: boolean; backend: string; latencyMs: number; detail: string }> {
      const t0 = Date.now();
      try {
        const phys = physicalTable("dim_series", backend);
        const rows = await query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM ${phys}`, [], backend);
        const cnt = rows[0]?.cnt ?? 0;
        const latencyMs = Date.now() - t0;
        if (cnt === 0) {
          return { ok: false, backend, latencyMs, detail: `gold.dim_series exists but has 0 rows — run the pipeline` };
        }
        return { ok: true, backend, latencyMs, detail: `gold.dim_series has ${cnt} rows` };
      } catch (err) {
        return { ok: false, backend, latencyMs: Date.now() - t0, detail: (err as Error).message };
      }
    },
  };
}

/** Singleton for the process lifetime (avoids re-opening the DB on every request). */
let _store: GoldStore | null = null;
export function goldStore(): GoldStore {
  if (!_store) _store = createGoldStore();
  return _store;
}

/** True when MACRO_DB_URL (or Databricks vars) are configured. */
export function goldEnabled(): boolean {
  if (process.env.MACRO_DB_BACKEND === "databricks") {
    return Boolean(process.env.DATABRICKS_HOST && process.env.DATABRICKS_HTTP_PATH && process.env.DATABRICKS_TOKEN);
  }
  return Boolean(process.env.MACRO_DB_URL);
}
