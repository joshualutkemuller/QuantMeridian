"""FinBERT sentiment scorer with a deterministic lexicon fallback.

If the `nlp` extra (transformers + torch) is installed, scores with FinBERT
(ProsusAI/finbert) → score = p_positive − p_negative ∈ [-1, 1]. Otherwise falls
back to a small finance lexicon so the stage still runs (and tests pass) without
the model stack. This mirrors the TS heuristic so behaviour is consistent across
the fallback tiers.
"""
from __future__ import annotations

import re
from functools import lru_cache

import structlog

from .schema import ScoreItem, Sentiment
from .settings import settings

log = structlog.get_logger(__name__)


def _label(score: float) -> Sentiment:
    return "BULLISH" if score > 0.15 else "BEARISH" if score < -0.15 else "NEUTRAL"


# ── Lexicon fallback (kept in sync with src/lib/server/sentimentNlp.ts) ──────
_LEX = {
    "surge": 2.2, "jump": 1.8, "soar": 2.4, "rally": 2.0, "gain": 1.4, "beat": 1.8, "tops": 1.6,
    "upgrade": 1.8, "record": 1.6, "strong": 1.3, "bullish": 2.2, "rebound": 1.6, "optimism": 1.6,
    "slump": -2.2, "slide": -1.8, "plunge": -2.6, "tumble": -2.2, "miss": -1.8, "cut": -1.2,
    "downgrade": -1.8, "warn": -1.6, "weak": -1.4, "fear": -1.8, "stress": -1.8, "bearish": -2.2,
    "recession": -2.0, "crash": -2.6, "default": -2.0, "selloff": -2.0,
}
_NEG = {"not", "no", "never", "without", "fails", "fail", "lacks", "less", "lower"}


def _lexicon_score(text: str) -> float:
    toks = re.sub(r"[^a-z\s']", " ", text.lower()).split()
    total, neg = 0.0, 0
    for tok in toks:
        if tok in _NEG:
            neg = 3
            continue
        v = _LEX.get(tok)
        if v is not None:
            total += v * (-0.74 if neg > 0 else 1.0)
        if neg > 0:
            neg -= 1
    return max(-1.0, min(1.0, total / (total * total + 13) ** 0.5)) if total else 0.0


@lru_cache(maxsize=1)
def _finbert():
    """Lazily build the FinBERT pipeline; return None if the stack is unavailable."""
    try:
        from transformers import pipeline  # type: ignore

        log.info("loading FinBERT", model=settings.finbert_model)
        return pipeline("text-classification", model=settings.finbert_model, top_k=None, truncation=True)
    except Exception as exc:  # noqa: BLE001 — optional dependency / offline
        log.warning("FinBERT unavailable, using lexicon fallback", error=str(exc))
        return None


def model_name() -> str:
    return settings.finbert_model if _finbert() is not None else "lexicon-fallback"


def health() -> dict:
    clf = _finbert()
    if clf is None:
        return {
            "ok": True,
            "model": "lexicon-fallback",
            "backend": "lexicon",
        }
    return {
        "ok": True,
        "model": settings.finbert_model,
        "backend": "transformers",
    }


def score_texts(texts: list[str]) -> list[ScoreItem]:
    clf = _finbert()
    if clf is None:
        return [ScoreItem(score=round(s := _lexicon_score(t), 4), label=_label(s)) for t in texts]

    out: list[ScoreItem] = []
    for res in clf(texts):  # list[list[{label, score}]]
        probs = {r["label"].lower(): float(r["score"]) for r in res}
        score = round(probs.get("positive", 0.0) - probs.get("negative", 0.0), 4)
        out.append(ScoreItem(score=score, label=_label(score)))
    return out
