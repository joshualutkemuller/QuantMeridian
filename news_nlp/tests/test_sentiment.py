"""Sentiment scorer tests — exercise the lexicon fallback (no model stack needed)."""
from news_nlp.src import sentiment
from news_nlp.src.api import health
from news_nlp.src.pipeline import score_headlines
from news_nlp.src.schema import RawHeadline


def test_directional_scores():
    bull, bear, neutral = sentiment.score_texts(
        ["Megacap surges as earnings beat estimates", "Bank stocks plunge on credit stress", "Company holds annual meeting"]
    )
    assert bull.score > 0.15 and bull.label == "BULLISH"
    assert bear.score < -0.15 and bear.label == "BEARISH"
    assert neutral.label == "NEUTRAL"


def test_negation_flips_polarity():
    (pos,) = sentiment.score_texts(["guidance beat expectations"])
    (neg,) = sentiment.score_texts(["guidance did not beat expectations"])
    assert pos.score > 0
    assert neg.score < pos.score  # negation pulls it down


def test_pipeline_scores_and_extracts():
    raw = [RawHeadline(id="1", headline="$NVDA surges as Nvidia AI demand tops estimates", source="test")]
    scored = score_headlines(raw)
    assert scored[0].sentiment == "BULLISH"
    assert "NVDA" in scored[0].tickers


def test_health_reports_component_contract():
    payload = health()
    assert payload.status == "ok"
    assert payload.model
    assert payload.sentiment.ok is True
    assert payload.sentiment.model
    assert payload.clustering.ok is True
    assert payload.clustering.model
    assert payload.ner.ok is True
    assert payload.ner.model
    assert payload.lexiconFallback.model == "finance-lexicon"
    assert payload.device
    assert payload.runtime.startswith("python ")
