/**
 * detectorStateStore — Market-Terminal-owned transition state for spec006's
 * material-change detector (Phase 2).
 *
 * Deliberately NOT part of GoldStore: Gold is upstream-owned and read-only
 * (`goldStore.ts`'s own docstring — "no fallback on zero rows or connection
 * failure"), and this table (`mpub_detector_state`) holds this app's own
 * operational bookkeeping (which candidate was first flagged when), not
 * pipeline-published data. Per spec006 Phase 2's approved decision, it lives
 * in the *same* Postgres instance as Gold in deploy (no new infrastructure),
 * but as a clearly separate, non-`gold`-prefixed table.
 *
 * Credentials risk, flagged explicitly rather than assumed away: the
 * `MACRO_DB_URL` credentials may be intentionally read-only, since GoldStore
 * was designed around never writing to Gold. If so, `MPUB_STATE_DB_URL` can
 * point at the same instance with write-capable credentials instead — unset,
 * it falls back to `MACRO_DB_URL`. Either way, a permissions failure here
 * surfaces as an explicit error, never a silent no-op.
 *
 * Write path: `writeDetectorTransitions` — called ONLY from the daily cron
 * (`/api/cron/refresh`), never from the live `candidates` GET route, so
 * concurrent requests can never race on a read-modify-write cycle.
 * Read path: `readDetectorState` — safe to call from the GET route on every
 * request; it only ever reads what the last cron run wrote.
 */
import { createRequire } from "node:module";
import { goldConfigStatus } from "@/lib/server/goldStore";

export const runtime = "nodejs";

const TABLE = "mpub_detector_state";

export interface DetectorStateRow {
  candidateId: string;
  templateId: string;
  changeType: "new" | "continuing" | "resolved";
  firstFlaggedAt: string;
  lastSeenAt: string;
  lastRunAt: string;
}

export interface DetectorGroupInput {
  templateId: string;
  /** false when this run's Gold read for this signal failed — its previously-active ids must be left untouched, never marked resolved on missing information. */
  ok: boolean;
  readyIds: string[];
}

export interface TransitionResult {
  candidateId: string;
  changeType: DetectorStateRow["changeType"];
  firstFlaggedAt: string;
}

const requireFromRuntime = createRequire(import.meta.url);
function optionalRequire(name: string): any {
  try {
    return requireFromRuntime(name);
  } catch {
    return null;
  }
}

function stateDbUrl(): string {
  return process.env.MPUB_STATE_DB_URL || process.env.MACRO_DB_URL || "";
}

function backend(): "sqlite" | "postgres" {
  const url = stateDbUrl();
  return /^postgres(ql)?:\/\//.test(url) ? "postgres" : "sqlite";
}

export function detectorStateStoreEnabled(): boolean {
  // Databricks/Delta is a Gold-pipeline-publish target, not an app-owned
  // writable store — this feature only supports the two backends GoldStore
  // itself supports for local/deploy (sqlite, postgres).
  if (process.env.MACRO_DB_BACKEND === "databricks" && !process.env.MPUB_STATE_DB_URL) return false;
  return Boolean(stateDbUrl());
}

async function sqliteExec<T>(fn: (db: any) => T): Promise<T> {
  const Database = optionalRequire("better-sqlite3");
  if (!Database) throw new Error("better-sqlite3 is not installed — run `npm i better-sqlite3`");
  const path = stateDbUrl().replace(/^sqlite:/, "");
  const db = new Database(path, { fileMustExist: true }); // read-write, unlike GoldStore's readonly connection
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function pgExec<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const pg = optionalRequire("pg");
  if (!pg) throw new Error("pg is not installed — run `npm i pg`");
  const client = new pg.Client({ connectionString: stateDbUrl() });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

function ensureTableSql(): string {
  return `CREATE TABLE IF NOT EXISTS ${TABLE} (
    candidate_id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    change_type TEXT NOT NULL,
    first_flagged_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_run_at TEXT NOT NULL
  )`;
}

function isMissingTableError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return /no such table/i.test(msg) || /relation .* does not exist/i.test(msg);
}

/** Read-only. Safe to call on every request — never writes, never diffs, just reflects the last cron run. */
export async function readDetectorState(): Promise<Map<string, DetectorStateRow>> {
  if (!detectorStateStoreEnabled()) return new Map();
  const dialect = backend();
  try {
    const rows: any[] =
      dialect === "sqlite"
        ? await sqliteExec((db) => db.prepare(`SELECT * FROM ${TABLE}`).all())
        : await pgExec((client) => client.query(`SELECT * FROM ${TABLE}`).then((r: any) => r.rows));
    return new Map(
      rows.map((r) => [
        r.candidate_id,
        {
          candidateId: r.candidate_id,
          templateId: r.template_id,
          changeType: r.change_type,
          firstFlaggedAt: r.first_flagged_at,
          lastSeenAt: r.last_seen_at,
          lastRunAt: r.last_run_at,
        },
      ])
    );
  } catch (err) {
    if (isMissingTableError(err)) return new Map(); // first run ever — not an error
    throw err;
  }
}

/**
 * Write path — cron-only. Computes new/continuing/resolved per detector
 * group and persists it. A group with `ok: false` (its Gold read failed
 * this run) is skipped entirely: its previously-active ids are left
 * untouched rather than guessed at as resolved.
 */
/**
 * Pure diff: no I/O, so it's directly unit-testable without a database.
 * `writeDetectorTransitions` is a thin I/O wrapper around this.
 */
export function computeTransitions(
  existing: Map<string, DetectorStateRow>,
  groups: DetectorGroupInput[],
  nowIso: string
): { results: TransitionResult[]; upserts: DetectorStateRow[] } {
  const results: TransitionResult[] = [];
  const upserts: DetectorStateRow[] = [];

  for (const group of groups) {
    if (!group.ok) continue; // this run couldn't read the signal — leave every id it owns exactly as-is, never guess

    const readySet = new Set(group.readyIds);

    for (const id of group.readyIds) {
      const prior = existing.get(id);
      const isReappearing = prior?.changeType === "resolved";
      const changeType: DetectorStateRow["changeType"] = !prior || isReappearing ? "new" : "continuing";
      const firstFlaggedAt = changeType === "new" ? nowIso : prior!.firstFlaggedAt;
      upserts.push({ candidateId: id, templateId: group.templateId, changeType, firstFlaggedAt, lastSeenAt: nowIso, lastRunAt: nowIso });
      results.push({ candidateId: id, changeType, firstFlaggedAt });
    }

    // Resolved: previously active, owned by *this* (successfully-evaluated) group, not in its ready set today.
    for (const [id, prior] of existing) {
      if (prior.templateId !== group.templateId) continue;
      if (prior.changeType === "resolved") continue; // already resolved, no churn
      if (readySet.has(id)) continue; // still ready, handled above
      upserts.push({ candidateId: id, templateId: group.templateId, changeType: "resolved", firstFlaggedAt: prior.firstFlaggedAt, lastSeenAt: prior.lastSeenAt, lastRunAt: nowIso });
      results.push({ candidateId: id, changeType: "resolved", firstFlaggedAt: prior.firstFlaggedAt });
    }
  }

  return { results, upserts };
}

export async function writeDetectorTransitions(groups: DetectorGroupInput[], nowIso: string): Promise<TransitionResult[]> {
  if (!detectorStateStoreEnabled()) {
    throw new Error("Detector state store not configured (MPUB_STATE_DB_URL/MACRO_DB_URL missing).");
  }
  const dialect = backend();
  const existing = await readDetectorState();
  const { results, upserts } = computeTransitions(existing, groups, nowIso);

  if (!upserts.length) return results;

  if (dialect === "sqlite") {
    await sqliteExec((db) => {
      db.exec(ensureTableSql());
      const stmt = db.prepare(
        `INSERT INTO ${TABLE} (candidate_id, template_id, change_type, first_flagged_at, last_seen_at, last_run_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           template_id = excluded.template_id,
           change_type = excluded.change_type,
           first_flagged_at = excluded.first_flagged_at,
           last_seen_at = excluded.last_seen_at,
           last_run_at = excluded.last_run_at`
      );
      const tx = db.transaction((rows: DetectorStateRow[]) => {
        for (const r of rows) stmt.run(r.candidateId, r.templateId, r.changeType, r.firstFlaggedAt, r.lastSeenAt, r.lastRunAt);
      });
      tx(upserts);
    });
  } else {
    await pgExec(async (client) => {
      await client.query(ensureTableSql());
      for (const r of upserts) {
        await client.query(
          `INSERT INTO ${TABLE} (candidate_id, template_id, change_type, first_flagged_at, last_seen_at, last_run_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (candidate_id) DO UPDATE SET
             template_id = EXCLUDED.template_id,
             change_type = EXCLUDED.change_type,
             first_flagged_at = EXCLUDED.first_flagged_at,
             last_seen_at = EXCLUDED.last_seen_at,
             last_run_at = EXCLUDED.last_run_at`,
          [r.candidateId, r.templateId, r.changeType, r.firstFlaggedAt, r.lastSeenAt, r.lastRunAt]
        );
      }
    });
  }

  return results;
}
