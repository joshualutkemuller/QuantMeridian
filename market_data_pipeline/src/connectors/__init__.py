"""Connector layer: FRED macro data adapter (sole source)."""

from market_data_pipeline.src.connectors.base import (
    AdapterResult,
    MacroDataAdapter,
    MarketDataAdapter,
    RateLimiter,
    ResponseCache,
    ThrottledClient,
)
from market_data_pipeline.src.connectors.fred import FredConnector, fred_enabled

__all__ = [
    "MacroDataAdapter",
    "MarketDataAdapter",
    "AdapterResult",
    "RateLimiter",
    "ResponseCache",
    "ThrottledClient",
    "FredConnector",
    "fred_enabled",
]
