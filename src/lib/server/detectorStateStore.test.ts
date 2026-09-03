import { afterEach, describe, expect, test } from "vitest";
import { computeTransitions, detectorStateStoreEnabled, type DetectorStateRow } from "./detectorStateStore";

const NOW = "2026-09-03T12:00:00.000Z";

function row(overrides: Partial<DetectorStateRow>): DetectorStateRow {
  return {
    candidateId: "id-1",
    templateId: "credit_stress",
    changeType: "continuing",
    firstFlaggedAt: "2026-09-01T12:00:00.000Z",
    lastSeenAt: "2026-09-02T12:00:00.000Z",
    lastRunAt: "2026-09-02T12:00:00.000Z",
    ...overrides,
  };
}

describe("computeTransitions", () => {
  test("a ready id absent from prior state is classified new, first-flagged now", () => {
    const { results, upserts } = computeTransitions(new Map(), [{ templateId: "credit_stress", ok: true, readyIds: ["credit-stress-CCC_OAS"] }], NOW);

    expect(results).toEqual([{ candidateId: "credit-stress-CCC_OAS", changeType: "new", firstFlaggedAt: NOW }]);
    expect(upserts[0]).toMatchObject({ candidateId: "credit-stress-CCC_OAS", templateId: "credit_stress", changeType: "new", firstFlaggedAt: NOW, lastSeenAt: NOW, lastRunAt: NOW });
  });

  test("a ready id already active in prior state is classified continuing, first-flagged date preserved", () => {
    const existing = new Map([["credit-stress-CCC_OAS", row({ candidateId: "credit-stress-CCC_OAS", changeType: "continuing", firstFlaggedAt: "2026-08-20T00:00:00.000Z" })]]);

    const { results } = computeTransitions(existing, [{ templateId: "credit_stress", ok: true, readyIds: ["credit-stress-CCC_OAS"] }], NOW);

    expect(results).toEqual([{ candidateId: "credit-stress-CCC_OAS", changeType: "continuing", firstFlaggedAt: "2026-08-20T00:00:00.000Z" }]);
  });

  test("a resolved id that reappears in the ready set is re-flagged new, not continuing", () => {
    const existing = new Map([["credit-stress-CCC_OAS", row({ candidateId: "credit-stress-CCC_OAS", changeType: "resolved", firstFlaggedAt: "2026-08-01T00:00:00.000Z" })]]);

    const { results } = computeTransitions(existing, [{ templateId: "credit_stress", ok: true, readyIds: ["credit-stress-CCC_OAS"] }], NOW);

    expect(results).toEqual([{ candidateId: "credit-stress-CCC_OAS", changeType: "new", firstFlaggedAt: NOW }]);
  });

  test("a previously active id no longer ready, group ok, is resolved with its original first-flagged date kept", () => {
    const existing = new Map([["credit-stress-CCC_OAS", row({ candidateId: "credit-stress-CCC_OAS", changeType: "continuing", firstFlaggedAt: "2026-08-20T00:00:00.000Z" })]]);

    const { results } = computeTransitions(existing, [{ templateId: "credit_stress", ok: true, readyIds: [] }], NOW);

    expect(results).toEqual([{ candidateId: "credit-stress-CCC_OAS", changeType: "resolved", firstFlaggedAt: "2026-08-20T00:00:00.000Z" }]);
  });

  test("a previously active id is left completely untouched when its group failed this run — never guessed as resolved", () => {
    const existing = new Map([["credit-stress-CCC_OAS", row({ candidateId: "credit-stress-CCC_OAS", changeType: "continuing" })]]);

    const { results, upserts } = computeTransitions(existing, [{ templateId: "credit_stress", ok: false, readyIds: [] }], NOW);

    expect(results).toEqual([]);
    expect(upserts).toEqual([]);
  });

  test("an already-resolved id absent from the ready set again produces no churn (no re-write)", () => {
    const existing = new Map([["credit-stress-CCC_OAS", row({ candidateId: "credit-stress-CCC_OAS", changeType: "resolved" })]]);

    const { results, upserts } = computeTransitions(existing, [{ templateId: "credit_stress", ok: true, readyIds: [] }], NOW);

    expect(results).toEqual([]);
    expect(upserts).toEqual([]);
  });

  test("resolution is scoped per template — one group's failure/absence never touches another group's ids", () => {
    const existing = new Map([
      ["credit-stress-CCC_OAS", row({ candidateId: "credit-stress-CCC_OAS", templateId: "credit_stress", changeType: "continuing" })],
      ["funding-stress", row({ candidateId: "funding-stress", templateId: "funding_stress", changeType: "continuing" })],
    ]);

    const { results } = computeTransitions(
      existing,
      [
        { templateId: "credit_stress", ok: false, readyIds: [] }, // failed — must not touch credit-stress-CCC_OAS
        { templateId: "funding_stress", ok: true, readyIds: [] }, // succeeded, no longer ready — must resolve funding-stress only
      ],
      NOW
    );

    expect(results).toEqual([{ candidateId: "funding-stress", changeType: "resolved", firstFlaggedAt: row({}).firstFlaggedAt }]);
  });

  test("multiple ids in one run: new, continuing, and resolved coexist correctly", () => {
    const existing = new Map([
      ["credit-stress-CCC_OAS", row({ candidateId: "credit-stress-CCC_OAS", changeType: "continuing", firstFlaggedAt: "2026-08-20T00:00:00.000Z" })],
      ["credit-stress-HY_OAS", row({ candidateId: "credit-stress-HY_OAS", changeType: "continuing", firstFlaggedAt: "2026-08-15T00:00:00.000Z" })],
    ]);

    const { results } = computeTransitions(
      existing,
      [{ templateId: "credit_stress", ok: true, readyIds: ["credit-stress-CCC_OAS", "credit-stress-BB_OAS"] }],
      NOW
    );

    const byId = Object.fromEntries(results.map((r) => [r.candidateId, r]));
    expect(byId["credit-stress-CCC_OAS"]).toEqual({ candidateId: "credit-stress-CCC_OAS", changeType: "continuing", firstFlaggedAt: "2026-08-20T00:00:00.000Z" });
    expect(byId["credit-stress-BB_OAS"]).toEqual({ candidateId: "credit-stress-BB_OAS", changeType: "new", firstFlaggedAt: NOW });
    expect(byId["credit-stress-HY_OAS"]).toEqual({ candidateId: "credit-stress-HY_OAS", changeType: "resolved", firstFlaggedAt: "2026-08-15T00:00:00.000Z" });
  });
});

describe("detectorStateStoreEnabled", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("disabled when neither MPUB_STATE_DB_URL nor MACRO_DB_URL is set", () => {
    delete process.env.MPUB_STATE_DB_URL;
    delete process.env.MACRO_DB_URL;
    delete process.env.MACRO_DB_BACKEND;
    expect(detectorStateStoreEnabled()).toBe(false);
  });

  test("enabled when MACRO_DB_URL is set (same Postgres/sqlite as Gold, per the approved Phase 2 decision)", () => {
    process.env.MACRO_DB_URL = "sqlite:./fred_local.db";
    delete process.env.MPUB_STATE_DB_URL;
    delete process.env.MACRO_DB_BACKEND;
    expect(detectorStateStoreEnabled()).toBe(true);
  });

  test("disabled on the Databricks backend unless a separate MPUB_STATE_DB_URL is given", () => {
    process.env.MACRO_DB_BACKEND = "databricks";
    delete process.env.MPUB_STATE_DB_URL;
    expect(detectorStateStoreEnabled()).toBe(false);
    process.env.MPUB_STATE_DB_URL = "postgres://example/state";
    expect(detectorStateStoreEnabled()).toBe(true);
  });
});
