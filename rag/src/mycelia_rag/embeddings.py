from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from pathlib import Path

from .domain import SparseEmbedding


class FastEmbedProvider:
    """Lazy local embeddings; model artifacts are downloaded only when first used."""

    def __init__(
        self,
        *,
        dense_model: str,
        sparse_model: str,
        dense_dimensions: int,
        cache_dir: Path,
    ) -> None:
        self.dense_model = dense_model
        self.sparse_model = sparse_model
        self.dense_dimensions = dense_dimensions
        self.cache_dir = cache_dir
        self._dense: object | None = None
        self._sparse: object | None = None

    def _dense_model(self):
        if self._dense is None:
            from fastembed import TextEmbedding

            self.cache_dir.mkdir(parents=True, exist_ok=True)
            self._dense = TextEmbedding(
                model_name=self.dense_model,
                cache_dir=str(self.cache_dir),
            )
        return self._dense

    def _sparse_model(self):
        if self._sparse is None:
            from fastembed import SparseTextEmbedding

            self.cache_dir.mkdir(parents=True, exist_ok=True)
            self._sparse = SparseTextEmbedding(
                model_name=self.sparse_model,
                cache_dir=str(self.cache_dir),
            )
        return self._sparse

    def embed_dense(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        values = [vector.tolist() for vector in self._dense_model().embed(list(texts))]
        for vector in values:
            if len(vector) != self.dense_dimensions:
                raise ValueError(
                    f"dense model returned {len(vector)} dimensions; "
                    f"expected {self.dense_dimensions}"
                )
        return values

    def embed_sparse(self, texts: Sequence[str]) -> list[SparseEmbedding]:
        if not texts:
            return []
        return [
            SparseEmbedding(indices=value.indices.tolist(), values=value.values.tolist())
            for value in self._sparse_model().embed(list(texts))
        ]


class DeterministicEmbeddingProvider:
    """Small injectable fake for tests and offline contract checks."""

    dense_model = "deterministic-test-dense"
    sparse_model = "deterministic-test-bm25"

    def __init__(self, dimensions: int = 32) -> None:
        self.dense_dimensions = dimensions

    @staticmethod
    def _tokens(text: str) -> list[str]:
        return [token.casefold() for token in text.split() if token]

    def embed_dense(self, texts: Sequence[str]) -> list[list[float]]:
        output = []
        for text in texts:
            vector = [0.0] * self.dense_dimensions
            for token in self._tokens(text):
                digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
                index = int.from_bytes(digest, "big") % self.dense_dimensions
                vector[index] += 1.0
            norm = math.sqrt(sum(value * value for value in vector)) or 1.0
            output.append([value / norm for value in vector])
        return output

    def embed_sparse(self, texts: Sequence[str]) -> list[SparseEmbedding]:
        output = []
        for text in texts:
            counts: dict[int, float] = {}
            for token in self._tokens(text):
                index = (
                    int.from_bytes(hashlib.blake2b(token.encode(), digest_size=4).digest(), "big")
                    & 0x7FFFFFFF
                )
                counts[index] = counts.get(index, 0.0) + 1.0
            indices = sorted(counts)
            output.append(SparseEmbedding(indices, [counts[index] for index in indices]))
        return output
