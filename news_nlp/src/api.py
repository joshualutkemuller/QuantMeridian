"""FastAPI service — the NEWS_NLP_URL the Next app's enrichWithNlp() calls.

Endpoints:
  POST /score      {texts:[...]} → {model, scores:[{score,label}]}   (used by Next)
  POST /cluster    {headlines:[...]} → {model, clusters:[...]}        (NEWS-6 events)
  GET  /headlines  → latest gold ScoredHeadline rows (Next can read as primary)
  GET  /health
"""
from __future__ import annotations

import json
import platform

from fastapi import FastAPI

from . import entities
from . import sentiment
from . import cluster as clustering
from .pipeline import score_headlines
from .schema import ClusterRequest, ClusterResponse, HealthResponse, ScoreRequest, ScoreResponse
from .settings import settings

app = FastAPI(title="news-nlp", version="0.1.0")


def _device() -> str:
    try:
        import torch  # type: ignore

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001 - optional runtime dependency
        return "cpu"


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    sentiment_health = sentiment.health()
    return HealthResponse(
        status="ok",
        model=sentiment_health["model"],
        sentiment=sentiment_health,
        clustering=clustering.health(),
        ner=entities.health(),
        lexiconFallback={"enabled": sentiment_health["model"] == "lexicon-fallback"},
        device=_device(),
        runtime=f"python {platform.python_version()}",
    )


@app.post("/score", response_model=ScoreResponse)
def score(req: ScoreRequest) -> ScoreResponse:
    return ScoreResponse(model=sentiment.model_name(), scores=sentiment.score_texts(req.texts))


@app.post("/cluster", response_model=ClusterResponse)
def cluster(req: ClusterRequest) -> ClusterResponse:
    """Score + embed + cluster the posted headlines into events (NEWS-6)."""
    scored = score_headlines(req.headlines)
    return ClusterResponse(model=sentiment.model_name(), clusters=clustering.cluster(scored))


@app.get("/headlines")
def headlines() -> list[dict]:
    path = settings.gold_dir / "news_scored.json"
    if not path.exists():
        return []
    return json.loads(path.read_text())
