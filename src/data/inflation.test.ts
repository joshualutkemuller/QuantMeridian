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

const expandedWeights = new Map([
  ["CUSR0000SAC", 35.994],
  ["CUSR0000SACL1E", 19.176],
  ["CUSR0000SAF", 14.539],
  ["CUSR0000SAH", 44.469],
  ["CUSR0000SAH2", 4.546],
  ["CUSR0000SAM1", 1.489],
  ["CUSR0000SAM2", 6.935],
  ["CUSR0000SAS", 64.006],
  ["CUSR0000SASLE", 60.744],
  ["CUSR0000SEHF02", 0.773],
  ["CUSR0000SAG", 2.902],
]);

describe("inflation components", () => {
  test("keeps the default CPI view to the existing 18 weighted components", () => {
    const core = getInflationComponents("CPI");

    expect(core).toHaveLength(18);
    expect(core.every((item) => item.weight != null)).toBe(true);
    expect(core.every((item) => item.contribution != null)).toBe(true);
    expect(core.every((item) => item.contributionEligible)).toBe(true);
  });

  test("adds phase 1 CPI components only in expanded view with verified weights", () => {
    const expanded = getInflationComponents("CPI", "expanded");
    const added = expanded.filter((item) => expandedCpiIds.includes(item.id));

    expect(expanded).toHaveLength(29);
    expect(added.map((item) => item.id).sort()).toEqual([...expandedCpiIds].sort());
    expect(added.every((item) => item.weight != null)).toBe(true);
    expect(added.every((item) => item.contribution != null)).toBe(true);
    expect(added.every((item) => item.contributionEligible)).toBe(true);
    for (const item of added) expect(item.weight).toBe(expandedWeights.get(item.id));
  });

  test("uses verified weights when deriving live values", () => {
    const component = getInflationComponents("CPI", "expanded").find((item) => item.id === "CUSR0000SAS");
    expect(component).toBeDefined();

    const observations = [
      { date: "2025-05-01", value: 100 },
      { date: "2025-06-01", value: 100 },
      { date: "2026-04-01", value: 108 },
      { date: "2026-05-01", value: 109 },
      { date: "2026-06-01", value: 110 },
    ];
    const live = liveInflationItem(component!, observations);

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
