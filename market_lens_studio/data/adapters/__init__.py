"""Adapters wrapping existing market_data_pipeline connectors."""

from .fred_adapter import FredAdapter
from .proxy_resolver import ProxyResolver

__all__ = ["FredAdapter", "ProxyResolver"]
