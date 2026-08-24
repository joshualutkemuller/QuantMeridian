import { getInflationComponents, type ComponentLevel, type SeasonalAdjustment } from "@/data/inflation";
import type { GoldStore } from "./goldStore";
import { goldParam, goldTable } from "./goldStore";

type CoverageLevel = ComponentLevel;

interface AggregateRow {
  series_id: string;
  row_count?: number;
  first_date?: string | null;
  latest_date?: string | null;
  null_rows?: number;
  latest_null_date?: string | null;
  weighted_rows?: number;
  latest_weight_date?: string | null;
}

interface ComponentMeta {
  series_id: string;
  label: string;
  seasonality: SeasonalAdjustment;
  level: CoverageLevel;
  legacy_id?: string;
}

export interface CpiCoverageRow extends ComponentMeta {
  transform_rows: number;
  first_transform_date: string | null;
  latest_transform_date: string | null;
  observation_rows: number;
  null_observation_rows: number;
  latest_observation_date: string | null;
  latest_null_observation_date: string | null;
  explorer_rows: number;
  weighted_rows: number;
  latest_weight_date: string | null;
  has_transform: boolean;
  has_null_observation: boolean;
  has_weight: boolean;
}

export interface CpiCoverageSummary {
  total_series: number;
  transform_missing: number;
  null_observation_series: number;
  missing_weight_series: number;
  latest_transform_date: string | null;
}

export interface CpiCoverageResult {
  summary: CpiCoverageSummary;
  rows: CpiCoverageRow[];
}

function componentUniverse(): ComponentMeta[] {
  const byId = new Map<string, ComponentMeta>();
  for (const seasonality of ["SA", "NSA"] as const) {
    const coreIds = new Set(getInflationComponents("CPI", "core", seasonality).map((item) => item.id));
    for (const item of getInflationComponents("CPI", "expanded", seasonality)) {
      byId.set(item.id, {
        series_id: item.id,
        label: item.label,
        seasonality,
        level: coreIds.has(item.id) ? "core" : "expanded",
        legacy_id: item.legacyId,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.series_id.localeCompare(b.series_id));
}

function bySeries(rows: AggregateRow[]): Map<string, AggregateRow> {
  return new Map(rows.map((row) => [row.series_id, row]));
}

function latestDate(rows: CpiCoverageRow[]): string | null {
  const dates = rows.map((row) => row.latest_transform_date).filter(Boolean) as string[];
  return dates.length ? dates.sort().at(-1)! : null;
}

export function buildCpiCoverage(
  meta: ComponentMeta[],
  transforms: AggregateRow[],
  observations: AggregateRow[],
  explorer: AggregateRow[]
): CpiCoverageResult {
  const transformById = bySeries(transforms);
  const observationById = bySeries(observations);
  const explorerById = bySeries(explorer);

  const rows: CpiCoverageRow[] = meta.map((item) => {
    const transform = transformById.get(item.series_id);
    const observation = observationById.get(item.series_id);
    const exp = explorerById.get(item.series_id);
    const transformRows = Number(transform?.row_count ?? 0);
    const nullObservationRows = Number(observation?.null_rows ?? 0);
    const weightedRows = Number(exp?.weighted_rows ?? 0);
    return {
      ...item,
      transform_rows: transformRows,
      first_transform_date: transform?.first_date ?? null,
      latest_transform_date: transform?.latest_date ?? null,
      observation_rows: Number(observation?.row_count ?? 0),
      null_observation_rows: nullObservationRows,
      latest_observation_date: observation?.latest_date ?? null,
      latest_null_observation_date: observation?.latest_null_date ?? null,
      explorer_rows: Number(exp?.row_count ?? 0),
      weighted_rows: weightedRows,
      latest_weight_date: exp?.latest_weight_date ?? null,
      has_transform: transformRows > 0,
      has_null_observation: nullObservationRows > 0,
      has_weight: weightedRows > 0,
    };
  });

  return {
    summary: {
      total_series: rows.length,
      transform_missing: rows.filter((row) => !row.has_transform).length,
      null_observation_series: rows.filter((row) => row.has_null_observation).length,
      missing_weight_series: rows.filter((row) => !row.has_weight).length,
      latest_transform_date: latestDate(rows),
    },
    rows,
  };
}

async function aggregate(
  store: GoldStore,
  table: string,
  ids: string[],
  select: string
): Promise<AggregateRow[]> {
  const placeholders = ids.map((_, index) => goldParam(index + 1)).join(",");
  return store.raw<AggregateRow>(
    `SELECT series_id, ${select}
     FROM ${goldTable(table)}
     WHERE series_id IN (${placeholders})
     GROUP BY series_id`,
    ids
  );
}

export async function buildCpiCoverageFromGold(store: GoldStore): Promise<CpiCoverageResult> {
  const meta = componentUniverse();
  const ids = meta.map((item) => item.series_id);
  const [transforms, observations, explorer] = await Promise.all([
    aggregate(
      store,
      "fred_feature_transforms",
      ids,
      "COUNT(*) AS row_count, MIN(observation_date) AS first_date, MAX(observation_date) AS latest_date"
    ),
    aggregate(
      store,
      "fred_latest_observation",
      ids,
      "COUNT(*) AS row_count, MAX(observation_date) AS latest_date, SUM(CASE WHEN value IS NULL THEN 1 ELSE 0 END) AS null_rows, MAX(CASE WHEN value IS NULL THEN observation_date ELSE NULL END) AS latest_null_date"
    ),
    aggregate(
      store,
      "inflation_explorer",
      ids,
      "COUNT(*) AS row_count, SUM(CASE WHEN weight IS NOT NULL THEN 1 ELSE 0 END) AS weighted_rows, MAX(CASE WHEN weight IS NOT NULL THEN observation_date ELSE NULL END) AS latest_weight_date"
    ),
  ]);
  return buildCpiCoverage(meta, transforms, observations, explorer);
}
