"""Pipeline orchestration — coordinates transform -> load + quality.

All macro data is sourced from the fred-bronze-to-gold-pipeline. This module
retains the gold-rebuild and quality-check operations for working with the
silver/gold parquet files produced by that external pipeline.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import yaml

from macro_data_etl.src.extract.extractors import Extractor
from macro_data_etl.src.load.loaders import DuckDBLoader
from macro_data_etl.src.transform.transformers import Transformer
from macro_data_etl.src.utils.logging import get_logger
from macro_data_etl.src.utils.quality import QualityChecker

logger = get_logger(__name__)

_PKG_ROOT = Path(__file__).resolve().parents[2]  # .../macro_data_etl


class PipelineRun:
    """Tracks a single ETL run and writes a manifest."""

    def __init__(self, run_id: str | None = None, data_path: Path = Path("./data")) -> None:
        self.run_id = run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
        self.data_path = Path(data_path)
        self.manifest_path = self.data_path / "manifest"
        self.manifest_path.mkdir(parents=True, exist_ok=True)
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.log: list[dict] = []
        self.quality: list[dict] = []

    def record(
        self,
        stage: str,
        source: str,
        status: str,
        rows: int = 0,
        path: str = "",
        details: str = "",
    ) -> None:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "run_id": self.run_id,
            "stage": stage,
            "source": source,
            "status": status,
            "rows": rows,
            "path": str(path),
            "details": details,
        }
        self.log.append(entry)
        logger.info("[%s/%s] %s rows=%d %s", stage, source, status, rows, details)

    def add_quality(self, results: list[dict]) -> None:
        self.quality.extend(results)

    def save_manifest(self) -> Path:
        path = self.manifest_path / f"run_{self.run_id}.json"
        payload = {
            "run_id": self.run_id,
            "started_at": self.started_at,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "stages": self.log,
            "quality": self.quality,
            "status": "FAILED" if any(s["status"] == "error" for s in self.log) else "OK",
        }
        with open(path, "w") as f:
            json.dump(payload, f, indent=2, default=str)
        logger.info("manifest saved -> %s", path)
        return path


class Pipeline:
    """ETL pipeline wiring transform/load with quality gates.

    All extraction is delegated to the fred-bronze-to-gold-pipeline; this
    class handles gold-rebuild and DuckDB load operations only.
    """

    def __init__(
        self,
        config_path: str | None = None,
        catalog_path: str | None = None,
    ) -> None:
        config_path = config_path or str(_PKG_ROOT / "config" / "settings.yaml")
        catalog_path = catalog_path or str(_PKG_ROOT / "config" / "series_catalog.yaml")
        self.config = self._load_yaml(config_path)
        self.catalog = self._load_yaml(catalog_path)
        base = self.config.get("storage", {}).get("base_path", "./data")
        self.data_path = (
            Path(base) if Path(base).is_absolute() else (_PKG_ROOT / base).resolve()
        )
        self.data_path.mkdir(parents=True, exist_ok=True)

        self.extractor = Extractor(self.data_path)
        self.transformer = Transformer(self.data_path, catalog=self.catalog)
        self.db_path = str(self.data_path / "macro.duckdb")

    @staticmethod
    def _load_yaml(path: str) -> dict:
        with open(path) as f:
            return yaml.safe_load(f) or {}

    def rebuild_gold(self) -> PipelineRun:
        """Rebuild all gold tables from existing silver, and reload DuckDB."""
        run = PipelineRun(data_path=self.data_path)
        silver = self.data_path / "silver" / "macro_observations.parquet"
        if not silver.exists():
            run.record("gold", "all", "error", details="no silver table found")
            run.save_manifest()
            return run
        gold = self.transformer.build_all_gold(silver)
        for name, path in gold.items():
            run.record("gold", name, "ok", path=str(path))
        with DuckDBLoader(self.db_path) as db:
            db.load_silver(silver)
            db.load_gold(gold)
        run.record("load", "duckdb", "ok", details=self.db_path)
        run.save_manifest()
        return run

    def _quality_and_load(self, run: PipelineRun, silver: Path) -> None:
        import polars as pl

        try:
            df = pl.read_parquet(silver)
            checker = QualityChecker(self.config)
            checker.run_all(df)
            run.add_quality(checker.to_dicts())
            gate = "ok" if checker.passed else "error"
            run.record("quality", "silver", gate, details=f"{len(checker.results)} checks")
        except Exception as e:
            run.record("quality", "silver", "error", details=str(e))

        try:
            gold = {
                "country_macro_latest": self.data_path / "gold" / "country_macro_latest.parquet",
                "inflation_timeseries": self.data_path / "gold" / "inflation_timeseries.parquet",
                "policy_rate_timeseries": self.data_path / "gold" / "policy_rate_timeseries.parquet",
                "real_rates": self.data_path / "gold" / "real_rates.parquet",
                "vintage_snapshots": self.data_path / "gold" / "vintage_snapshots.parquet",
            }
            with DuckDBLoader(self.db_path) as db:
                n = db.load_silver(silver)
                db.load_gold(gold)
            run.record("load", "duckdb", "ok", rows=n, details=self.db_path)
        except Exception as e:
            run.record("load", "duckdb", "error", details=str(e))
