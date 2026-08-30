"""Event clustering — embed headlines and group related ones (powers NEWS-6).

Uses sentence-transformers + agglomerative clustering when available; otherwise
falls back to a token-overlap heuristic so the stage still produces clusters.
"""
from __future__ import annotations

from functools import lru_cache

import structlog

from .schema import NewsCluster, ScoredHeadline
from .settings import settings

log = structlog.get_logger(__name__)


@lru_cache(maxsize=1)
def _embedder():
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore

        return SentenceTransformer(settings.embed_model)
    except Exception as exc:  # noqa: BLE001
        log.warning("embedder unavailable, using token-overlap clustering", error=str(exc))
        return None


def _labels_embeddings(texts: list[str]) -> list[int]:
    from sklearn.cluster import AgglomerativeClustering  # type: ignore

    emb = _embedder().encode(texts, normalize_embeddings=True)
    model = AgglomerativeClustering(
        n_clusters=None, metric="cosine", linkage="average", distance_threshold=settings.cluster_distance
    )
    return list(model.fit_predict(emb))


def _labels_overlap(texts: list[str]) -> list[int]:
    """Greedy token-overlap clustering fallback."""
    toksets = [set(t.lower().split()) for t in texts]
    labels = [-1] * len(texts)
    nxt = 0
    for i in range(len(texts)):
        if labels[i] != -1:
            continue
        labels[i] = nxt
        for j in range(i + 1, len(texts)):
            if labels[j] != -1:
                continue
            a, b = toksets[i], toksets[j]
            if a and b and len(a & b) / len(a | b) >= 0.34:
                labels[j] = nxt
        nxt += 1
    return labels


def cluster(rows: list[ScoredHeadline]) -> list[NewsCluster]:
    if not rows:
        return []
    texts = [r.headline for r in rows]
    labels = _labels_embeddings(texts) if _embedder() is not None else _labels_overlap(texts)

    groups: dict[int, list[ScoredHeadline]] = {}
    for row, lab in zip(rows, labels):
        row.cluster_id = int(lab)
        groups.setdefault(int(lab), []).append(row)

    clusters: list[NewsCluster] = []
    for cid, members in groups.items():
        rep = max(members, key=lambda r: abs(r.sentimentScore))  # most decisive headline as title
        clusters.append(
            NewsCluster(
                cluster_id=cid,
                title=rep.headline,
                size=len(members),
                avg_sentiment=round(sum(m.sentimentScore for m in members) / len(members), 4),
                assetClass=rep.assetClass,
                members=[m.id for m in members],
            )
        )
    return sorted(clusters, key=lambda c: c.size, reverse=True)


def health() -> dict:
    embedder = _embedder()
    if embedder is None:
        return {
            "ok": True,
            "model": "token-overlap-fallback",
            "backend": "token-overlap",
        }
    return {
        "ok": True,
        "model": settings.embed_model,
        "backend": "sentence-transformers",
    }
