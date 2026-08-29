"""Entity extraction — cashtags + a ticker map, optionally enriched with spaCy NER."""
from __future__ import annotations

import re
from functools import lru_cache

import structlog

from .settings import settings

log = structlog.get_logger(__name__)

_CASHTAG = re.compile(r"\$([A-Za-z]{1,5})\b")

# Minimal company → ticker map; replace/extend with a security master in prod.
_NAME_TO_TICKER = {
    "nvidia": "NVDA", "apple": "AAPL", "microsoft": "MSFT", "tesla": "TSLA", "jpmorgan": "JPM",
    "meta": "META", "amazon": "AMZN", "alphabet": "GOOGL", "google": "GOOGL", "netflix": "NFLX",
    "bitcoin": "BTC", "ethereum": "ETH", "gamestop": "GME", "palantir": "PLTR", "coinbase": "COIN",
}


@lru_cache(maxsize=1)
def _nlp():
    try:
        import spacy  # type: ignore

        return spacy.load(settings.spacy_model, disable=["lemmatizer"])
    except Exception as exc:  # noqa: BLE001
        log.warning("spaCy unavailable, using regex/keyword extraction", error=str(exc))
        return None


def extract(text: str) -> tuple[list[str], list[str]]:
    """Return (tickers, entities) for one headline."""
    tickers: set[str] = {m.group(1).upper() for m in _CASHTAG.finditer(text)}
    entities: set[str] = set()
    lowered = text.lower()
    for name, tic in _NAME_TO_TICKER.items():
        if name in lowered:
            tickers.add(tic)
            entities.add(name.title())

    nlp = _nlp()
    if nlp is not None:
        for ent in nlp(text).ents:
            if ent.label_ in {"ORG", "GPE", "PRODUCT", "PERSON"}:
                entities.add(ent.text)
                tic = _NAME_TO_TICKER.get(ent.text.lower())
                if tic:
                    tickers.add(tic)
    return sorted(tickers), sorted(entities)


def health() -> dict:
    nlp = _nlp()
    if nlp is None:
        return {
            "ok": True,
            "model": "regex-keyword-fallback",
            "backend": "regex",
        }
    return {
        "ok": True,
        "model": settings.spacy_model,
        "backend": "spacy",
    }
