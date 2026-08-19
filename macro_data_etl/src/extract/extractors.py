"""Extract layer — calls connectors and writes raw Parquet snapshots.

Each extractor returns the path of the Parquet file it wrote (under
``data/raw/<source>/``). Raw files are timestamped so reruns are non-destructive
and the manifest can point at the exact input that produced a transform.

All macro data is now sourced from the fred-bronze-to-gold-pipeline; this
extractor module is retained as scaffolding but has no active connectors.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import polars as pl

from macro_data_etl.src.utils.logging import get_logger

logger = get_logger(__name__)


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


class Extractor:
    """Coordinates connector calls and persists raw extracts."""

    def __init__(self, data_path: Path | str = Path("./data")) -> None:
        self.data_path = Path(data_path)
        self.raw_path = self.data_path / "raw"
        self.raw_path.mkdir(parents=True, exist_ok=True)

    def _write(self, df: pl.DataFrame, source: str, name: str) -> Path:
        out_dir = self.raw_path / source
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{name}_{_stamp()}.parquet"
        df.write_parquet(path, compression="zstd")
        logger.info("Wrote %d rows -> %s", df.height, path)
        return path

    def latest_raw(self, source: str, name: str) -> Path | None:
        """Return the most recent raw Parquet for a source/name, if any."""
        out_dir = self.raw_path / source
        if not out_dir.exists():
            return None
        matches = sorted(out_dir.glob(f"{name}_*.parquet"))
        return matches[-1] if matches else None
