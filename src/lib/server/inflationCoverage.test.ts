import { describe, expect, it } from "vitest";
import { buildCpiCoverage } from "./inflationCoverage";

const meta = [
  { series_id: "CUSR0000SAC", label: "Commodities", seasonality: "SA" as const, level: "expanded" as const },
  { series_id: "CUSR0000SAF", label: "Food & Beverages", seasonality: "SA" as const, level: "expanded" as const },
  { series_id: "CUUR0000SAC", label: "Commodities", seasonality: "NSA" as const, level: "expanded" as const },
];

describe("buildCpiCoverage", () => {
  it("summarizes transform, null observation, and weight coverage by series", () => {
    const coverage = buildCpiCoverage(
      meta,
      [
        { series_id: "CUSR0000SAC", row_count: 29, first_date: "2024-01-01", latest_date: "2026-06-01" },
        { series_id: "CUSR0000SAF", row_count: 29, first_date: "2024-01-01", latest_date: "2026-06-01" },
      ],
      [
        { series_id: "CUSR0000SAC", row_count: 30, latest_date: "2026-06-01", null_rows: 1, latest_null_date: "2025-10-01" },
        { series_id: "CUSR0000SAF", row_count: 30, latest_date: "2026-06-01", null_rows: 0, latest_null_date: null },
      ],
      [
        { series_id: "CUSR0000SAF", row_count: 29, weighted_rows: 29, latest_weight_date: "2026-06-01" },
      ]
    );

    expect(coverage.summary).toEqual({
      total_series: 3,
      transform_missing: 1,
      null_observation_series: 1,
      missing_weight_series: 2,
      latest_transform_date: "2026-06-01",
    });
    expect(coverage.rows.find((row) => row.series_id === "CUSR0000SAC")).toMatchObject({
      has_transform: true,
      has_null_observation: true,
      has_weight: false,
      latest_null_observation_date: "2025-10-01",
    });
    expect(coverage.rows.find((row) => row.series_id === "CUUR0000SAC")).toMatchObject({
      has_transform: false,
      has_weight: false,
    });
  });
});
