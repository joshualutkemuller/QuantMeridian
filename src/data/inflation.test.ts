import { describe, expect, test } from "vitest";
import { getInflationComponents, liveInflationItem } from "./inflation";

const expandedCpiIds = [
  "CUSR0000SAC",
  "CUSR0000SACL1E",
  "CUSR0000SAF",
  "CUSR0000SAH",
  "CUSR0000SAH2",
  "CUSR0000SAM1",
  "CUSR0000SAM2",
  "CUSR0000SAS",
  "CUSR0000SASLE",
  "CUSR0000SEHF02",
  "CUSR0000SAG",
];

const canonicalCoreIds = [
  "CUSR0000SA0E",
  "CUSR0000SAA",
  "CUSR0000SAE",
  "CUSR0000SAF1",
  "CUSR0000SAM",
  "CUSR0000SAR",
  "CUSR0000SAT",
];

const legacyCoreAliases = [
  "CPIUFDSL",
  "CPIENGSL",
  "CPIMEDSL",
  "CPIAPPSL",
  "CPITRNSL",
  "CPIRECSL",
  "CUSR0000SAE1",
];

const nsaCoreIds = [
  "CUUR0000SAH1",
  "CUUR0000SEHC",
  "CUUR0000SEHA",
  "CUUR0000SAF1",
  "CUUR0000SAF11",
  "CUUR0000SEFV",
  "CUUR0000SA0E",
  "CUUR0000SETB01",
  "CUUR0000SEHF01",
  "CUUR0000SAM",
  "CUUR0000SETA01",
  "CUUR0000SETA02",
  "CUUR0000SAA",
  "CUUR0000SAT",
  "CUUR0000SAR",
  "CUUR0000SAE",
];

describe("inflation components", () => {
  test("keeps the default CPI view to the existing 18 weighted components", () => {
    const core = getInflationComponents("CPI");

    expect(core).toHaveLength(18);
    expect(core.every((item) => item.weight != null)).toBe(true);
    expect(core.every((item) => item.contribution != null)).toBe(true);
    expect(core.every((item) => item.contributionEligible)).toBe(true);
  });

  test("uses canonical Gold CPI ids instead of legacy alias ids in the default view", () => {
    const ids = getInflationComponents("CPI").map((item) => item.id);

    for (const id of canonicalCoreIds) expect(ids).toContain(id);
    for (const id of legacyCoreAliases) expect(ids).not.toContain(id);
  });

  test("keeps NSA CPI rows behind the seasonality switch", () => {
    const saIds = getInflationComponents("CPI").map((item) => item.id);
    const nsa = getInflationComponents("CPI", "core", "NSA");
    const nsaIds = nsa.map((item) => item.id);

    expect(nsa).toHaveLength(16);
    expect(nsaIds.sort()).toEqual([...nsaCoreIds].sort());
    expect(saIds.some((id) => id.startsWith("CUUR"))).toBe(false);
    expect(nsa.every((item) => item.seasonalAdjustment === "NSA")).toBe(true);
    expect(nsa.every((item) => item.weight == null)).toBe(true);
  });

  test("adds DB-backed NSA expansion rows only in expanded NSA view", () => {
    const expanded = getInflationComponents("CPI", "expanded", "NSA");
    const ids = expanded.map((item) => item.id);

    expect(expanded).toHaveLength(28);
    expect(ids).toContain("CUUR0000SAF116");
    expect(ids).toContain("CUUR0000SASLE");
    expect(ids).not.toContain("CUSR0000SASLE");
  });

  test("adds phase 1 CPI components only in expanded view without non-DB weights", () => {
    const expanded = getInflationComponents("CPI", "expanded");
    const added = expanded.filter((item) => expandedCpiIds.includes(item.id));

    expect(expanded).toHaveLength(29);
    expect(added.map((item) => item.id).sort()).toEqual([...expandedCpiIds].sort());
    expect(added.every((item) => item.weight == null)).toBe(true);
    expect(added.every((item) => item.contribution == null)).toBe(true);
    expect(added.every((item) => !item.contributionEligible)).toBe(true);
  });

  test("uses DB-provided weights when deriving live values", () => {
    const component = getInflationComponents("CPI", "expanded").find((item) => item.id === "CUSR0000SAS");
    expect(component).toBeDefined();
    const dbWeighted = {
      ...component!,
      weight: 64.006,
      contributionEligible: true,
    };

    const observations = [
      { date: "2025-05-01", value: 100 },
      { date: "2025-06-01", value: 100 },
      { date: "2026-04-01", value: 108 },
      { date: "2026-05-01", value: 109 },
      { date: "2026-06-01", value: 110 },
    ];
    const live = liveInflationItem(dbWeighted, observations);

    expect(live.index).toBe(110);
    expect(live.yoy).toBe(10);
    expect(live.contribution).toBe(6.4);
    expect(live.contributionEligible).toBe(true);
  });

  test("derives inflation changes by calendar lag when an intermediate month is missing", () => {
    const component = getInflationComponents("CPI", "expanded").find((item) => item.id === "CUSR0000SAC");
    expect(component).toBeDefined();

    const observations = [
      { date: "2025-05-01", value: 100 },
      { date: "2025-06-01", value: 200 },
      { date: "2025-09-01", value: 205 },
      { date: "2025-11-01", value: 207 },
      { date: "2026-04-01", value: 100 },
      { date: "2026-05-01", value: 110 },
      { date: "2026-06-01", value: 220 },
    ];
    const live = liveInflationItem(component!, observations);

    expect(live.index).toBe(220);
    expect(live.mom).toBe(100);
    expect(live.priorMom).toBe(10);
    expect(live.yoy).toBe(10);
    expect(live.priorYoy).toBe(10);
  });
});
