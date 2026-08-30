# news_nlp — Financial-text NLP stage

The "real" NLP tier for the NEWS and SENT modules: **FinBERT sentiment**, **NER /
ticker extraction**, and **event clustering**. It sits behind the same shapes the
terminal already consumes, so connecting it flips the provenance badge from a
heuristic/`SIM` source to `FinBERT` with no UI changes.

## Where it fits (the layering)

Sentiment is resolved best → fallback:

1. **Provider-native** (Alpha Vantage, Marketaux) — used as-is by the Next provider chain.
2. **This stage (FinBERT)** — via `NEWS_NLP_URL`; the Next route's `enrichWithNlp()` POSTs headlines to `/score` and re-scores them (`source` becomes `… + FinBERT`).
3. **In-house heuristic** (`src/lib/server/sentimentNlp.ts`) — negation-aware finance lexicon; always-on fallback.
4. **SIM** — deterministic engine when nothing is wired.

The model stack is an **optional extra**: without it the stage runs on a lexicon
fallback (kept in sync with the TS scorer) so it installs, imports, and tests
green on any machine.

## Install

```bash
cd news_nlp
pip install -e .            # core (lexicon fallback)
pip install -e ".[nlp]"     # + FinBERT / spaCy / sentence-transformers
python -m spacy download en_core_web_sm   # for NER (with the nlp extra)
```

## Use

```bash
# Ad-hoc scoring
news-nlp score "Nvidia surges as AI demand tops estimates" "Banks plunge on credit stress"

# Batch pipeline: raw → silver (scored) → gold (clusters)
#   reads data/raw/headlines.json  (array of {id, headline, source, tickers})
news-nlp run --raw data/raw/headlines.json

# Serve the API the Next app calls
news-nlp serve --port 8088
```

## API

| Endpoint | Purpose |
|---|---|
| `POST /score` `{texts:[...]}` → `{model, scores:[{score,label}]}` | what the Next `enrichWithNlp()` calls |
| `GET /headlines` | latest gold `ScoredHeadline` rows (Next can read as a primary feed) |
| `GET /health` | service status plus separate sentiment, clustering, NER, lexicon fallback, device, and runtime fields |

Health response shape:

```json
{
  "status": "ok",
  "model": "ProsusAI/finbert",
  "sentiment": { "ok": true, "model": "ProsusAI/finbert", "backend": "transformers" },
  "clustering": { "ok": true, "model": "sentence-transformers/all-MiniLM-L6-v2", "backend": "sentence-transformers" },
  "ner": { "ok": true, "model": "en_core_web_sm", "backend": "spacy" },
  "lexiconFallback": { "enabled": false, "model": "finance-lexicon", "version": "1" },
  "device": "cpu",
  "runtime": "python 3.12.0"
}
```

## Connecting to the terminal

Point the Next app at the service:

```bash
NEWS_NLP_URL=http://localhost:8088   # → /api/news enriches sentiment with FinBERT
```

## Medallion outputs

- `data/silver/news_scored.parquet` — headlines + sentiment + entities + cluster id
- `data/gold/news_clusters.parquet` — event clusters (powers NEWS-6)
- `data/gold/news_scored.json` — JSON export for a file-mount integration
- `data/news_nlp.duckdb` — `analytics_news_sentiment`, `analytics_news_clusters` views

## Layout

```
news_nlp/
  cli.py            # news-nlp run | serve | score
  src/
    settings.py     # env-driven config (NEWS_NLP_*)
    schema.py       # pydantic models aligned to the TS Headline shape
    sentiment.py    # FinBERT + lexicon fallback
    entities.py     # cashtags + ticker map + spaCy NER
    cluster.py      # sentence-transformers + agglomerative clustering (overlap fallback)
    pipeline.py     # raw → silver → gold orchestration
    storage.py      # parquet + DuckDB gold tables
    api.py          # FastAPI service
  tests/
```
