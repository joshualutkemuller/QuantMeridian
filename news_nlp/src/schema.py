"""Output schemas — aligned with the TS `Headline` shape the NEWS module consumes."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Sentiment = Literal["BULLISH", "BEARISH", "NEUTRAL"]
AssetClass = Literal["EQUITY", "RATES", "CREDIT", "COMMODITY", "FX", "CRYPTO", "MACRO", "SEC-FIN"]


class RawHeadline(BaseModel):
    """Input row (as produced by the TS provider chain or any ingest)."""
    id: str
    headline: str
    source: str = "unknown"
    published_at: str | None = None
    tickers: list[str] = Field(default_factory=list)


class ScoredHeadline(BaseModel):
    """Silver row — sentiment + entities attached."""
    id: str
    headline: str
    source: str
    published_at: str | None = None
    sentimentScore: float  # [-1, 1]
    sentiment: Sentiment
    assetClass: AssetClass = "EQUITY"
    tickers: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    cluster_id: int | None = None


class NewsCluster(BaseModel):
    """Gold row — an event cluster of related headlines (powers NEWS-6)."""
    cluster_id: int
    title: str
    size: int
    avg_sentiment: float
    assetClass: AssetClass
    members: list[str]  # headline ids


class ScoreRequest(BaseModel):
    texts: list[str]


class ScoreItem(BaseModel):
    score: float
    label: Sentiment


class ScoreResponse(BaseModel):
    model: str
    scores: list[ScoreItem]


class ClusterRequest(BaseModel):
    headlines: list[RawHeadline]


class ClusterResponse(BaseModel):
    model: str
    clusters: list[NewsCluster]


class HealthComponent(BaseModel):
    ok: bool
    model: str
    backend: str | None = None
    version: str | None = None
    error: str | None = None


class LexiconFallbackHealth(BaseModel):
    enabled: bool
    model: str = "finance-lexicon"
    version: str = "1"


class HealthResponse(BaseModel):
    status: Literal["ok"]
    model: str
    sentiment: HealthComponent
    clustering: HealthComponent
    ner: HealthComponent
    lexiconFallback: LexiconFallbackHealth
    device: str
    runtime: str
