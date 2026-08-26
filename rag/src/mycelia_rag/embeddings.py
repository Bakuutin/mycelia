from __future__ import annotations

import hashlib
import math
import threading
from collections.abc import Sequence
from importlib.metadata import version as package_version
from pathlib import Path
from typing import Any

from huggingface_hub import snapshot_download

from .config import Settings
from .domain import (
    EncoderContract,
    InferenceContract,
    InstructionContract,
    RerankerContract,
    SparseEmbedding,
    TokenizerContract,
)

BM25_OPTIONS = (
    ("avgLen", 256.0),
    ("b", 0.75),
    ("disableStemmer", False),
    ("fastembedVersion", "0.8.0"),
    ("k", 1.2),
    ("language", "english"),
    ("qdrantModifier", "idf"),
    ("roleMethods", "passage_embed/query_embed"),
    ("tokenMaxLength", 40),
)


def stage1_inference_contract(settings: Settings) -> InferenceContract:
    """Create the immutable embedding-space contract for the local Stage 1 baseline."""

    return InferenceContract(
        profile_id=settings.inference_profile,
        dense=EncoderContract(
            provider="fastembed",
            model=settings.dense_model,
            model_revision=settings.dense_revision,
            artifact_repo=settings.dense_artifact_repo,
            tokenizer=TokenizerContract(
                id=settings.dense_tokenizer,
                revision=settings.dense_tokenizer_revision,
            ),
            document_instruction=InstructionContract.from_text(
                settings.dense_document_instruction_id,
                settings.dense_document_instruction,
            ),
            query_instruction=InstructionContract.from_text(
                settings.dense_query_instruction_id,
                settings.dense_query_instruction,
            ),
            dimensions=settings.dense_dimensions,
            normalization=settings.dense_normalization,
            options=(
                ("artifactFile", "model_optimized.onnx"),
                ("fastembedVersion", settings.fastembed_version),
                ("instructionFormat", "verbatim-prefix-newline-v1"),
                ("maxTokens", 512),
                ("pooling", "model-defined"),
                ("roleMethods", "passage_embed/query_embed"),
                ("truncation", "model-max-length"),
            ),
        ),
        sparse=EncoderContract(
            provider="fastembed",
            model=settings.sparse_model,
            model_revision=settings.sparse_revision,
            artifact_repo=settings.sparse_artifact_repo,
            tokenizer=TokenizerContract(
                id=settings.sparse_tokenizer,
                revision=settings.sparse_tokenizer_revision,
            ),
            document_instruction=InstructionContract.from_text(
                settings.sparse_document_instruction_id,
                settings.sparse_document_instruction,
            ),
            query_instruction=InstructionContract.from_text(
                settings.sparse_query_instruction_id,
                settings.sparse_query_instruction,
            ),
            dimensions=None,
            normalization=settings.sparse_normalization,
            options=tuple(
                (key, settings.fastembed_version if key == "fastembedVersion" else value)
                for key, value in BM25_OPTIONS
            ),
        ),
    )


class FastEmbedProvider:
    """Pinned local MiniLM + BM25 execution for the Stage 1 embedding space."""

    def __init__(self, *, settings: Settings) -> None:
        installed_version = package_version("fastembed")
        if installed_version != settings.fastembed_version:
            raise RuntimeError(
                "FastEmbed runtime does not match the inference contract: "
                f"installed={installed_version}, expected={settings.fastembed_version}"
            )
        self.contract = stage1_inference_contract(settings)
        self.reranker = RerankerContract()
        self.cache_dir = settings.model_cache
        self._dense_document_instruction = settings.dense_document_instruction
        self._dense_query_instruction = settings.dense_query_instruction
        self._sparse_document_instruction = settings.sparse_document_instruction
        self._sparse_query_instruction = settings.sparse_query_instruction
        self._dense: object | None = None
        self._sparse: object | None = None
        self._dense_lock = threading.Lock()
        self._sparse_lock = threading.Lock()

    def _pinned_snapshot(self, repo_id: str, revision: str) -> str:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path = Path(
            snapshot_download(
                repo_id=repo_id,
                revision=revision,
                cache_dir=str(self.cache_dir / "huggingface"),
            )
        )
        if path.name != revision:
            raise RuntimeError(
                f"resolved model revision {path.name!r} does not match pinned revision {revision!r}"
            )
        return str(path)

    def _dense_model(self):
        if self._dense is None:
            with self._dense_lock:
                if self._dense is None:
                    from fastembed import TextEmbedding

                    contract = self.contract.dense
                    model_path = self._pinned_snapshot(
                        contract.artifact_repo,
                        contract.model_revision,
                    )
                    self._dense = TextEmbedding(
                        model_name=contract.model,
                        cache_dir=str(self.cache_dir),
                        specific_model_path=model_path,
                    )
        return self._dense

    def _sparse_model(self):
        if self._sparse is None:
            with self._sparse_lock:
                if self._sparse is None:
                    from fastembed import SparseTextEmbedding

                    contract = self.contract.sparse
                    options = dict(contract.options)
                    model_path = self._pinned_snapshot(
                        contract.artifact_repo,
                        contract.model_revision,
                    )
                    self._sparse = SparseTextEmbedding(
                        model_name=contract.model,
                        cache_dir=str(self.cache_dir),
                        specific_model_path=model_path,
                        k=options["k"],
                        b=options["b"],
                        avg_len=options["avgLen"],
                        language=options["language"],
                        token_max_length=options["tokenMaxLength"],
                        disable_stemmer=options["disableStemmer"],
                    )
        return self._sparse

    @staticmethod
    def _prepare(texts: Sequence[str], instruction: str) -> list[str]:
        if not instruction:
            return list(texts)
        return [f"{instruction}\n{text}" for text in texts]

    def _embed_dense(
        self,
        texts: Sequence[str],
        instruction: str,
        *,
        query: bool,
    ) -> list[list[float]]:
        if not texts:
            return []
        prepared = self._prepare(texts, instruction)
        model = self._dense_model()
        embedded = model.query_embed(prepared) if query else model.passage_embed(prepared)
        values = [vector.tolist() for vector in embedded]
        dimensions = self.contract.dense.dimensions
        for index, vector in enumerate(values):
            if dimensions is not None and len(vector) != dimensions:
                raise ValueError(
                    f"dense model returned {len(vector)} dimensions; expected {dimensions}"
                )
            if self.contract.dense.normalization == "l2":
                norm = math.sqrt(sum(value * value for value in vector))
                if not norm:
                    raise ValueError(f"dense model returned a zero vector at index {index}")
                values[index] = [value / norm for value in vector]
        return values

    def _embed_sparse(
        self,
        texts: Sequence[str],
        instruction: str,
        *,
        query: bool,
    ) -> list[SparseEmbedding]:
        if not texts:
            return []
        prepared = self._prepare(texts, instruction)
        model = self._sparse_model()
        embedded = model.query_embed(prepared) if query else model.passage_embed(prepared)
        return [
            SparseEmbedding(indices=value.indices.tolist(), values=value.values.tolist())
            for value in embedded
        ]

    def embed_dense_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return self._embed_dense(texts, self._dense_document_instruction, query=False)

    def embed_sparse_documents(self, texts: Sequence[str]) -> list[SparseEmbedding]:
        return self._embed_sparse(texts, self._sparse_document_instruction, query=False)

    def embed_dense_query(self, text: str) -> list[float]:
        return self._embed_dense([text], self._dense_query_instruction, query=True)[0]

    def embed_sparse_query(self, text: str) -> SparseEmbedding:
        return self._embed_sparse([text], self._sparse_query_instruction, query=True)[0]

    def runtime_status(self) -> dict[str, Any]:
        return {
            "profileId": self.contract.profile_id,
            "contractVersion": self.contract.contract_version,
            "embeddingSpaceFingerprint": self.contract.contract_fingerprint,
            "executor": {
                "kind": "local",
                "label": f"FastEmbed {package_version('fastembed')} (local)",
                "transport": "in_process",
                "denseLoaded": self._dense is not None,
                "sparseLoaded": self._sparse is not None,
                "remoteExecutor": None,
            },
            "contract": {
                "dense": self.contract.dense.public(),
                "sparse": self.contract.sparse.public(),
            },
            "reranker": self.reranker.public(),
        }


class DeterministicEmbeddingProvider:
    """Small injectable fake for tests and offline contract checks."""

    def __init__(
        self,
        dimensions: int = 32,
        *,
        dense_model: str = "deterministic-test-dense",
        dense_revision: str = "dense-test-v1",
    ) -> None:
        no_instruction = InstructionContract.from_text("none", "")
        self.contract = InferenceContract(
            profile_id="deterministic-test-v1",
            dense=EncoderContract(
                provider="deterministic-test",
                model=dense_model,
                model_revision=dense_revision,
                artifact_repo="test/dense",
                tokenizer=TokenizerContract("whitespace-casefold", "v1"),
                document_instruction=no_instruction,
                query_instruction=no_instruction,
                dimensions=dimensions,
                normalization="l2",
            ),
            sparse=EncoderContract(
                provider="deterministic-test",
                model="deterministic-test-bm25",
                model_revision="sparse-test-v1",
                artifact_repo="test/sparse",
                tokenizer=TokenizerContract("whitespace-casefold-hash", "v1"),
                document_instruction=no_instruction,
                query_instruction=no_instruction,
                dimensions=None,
                normalization="none",
            ),
        )
        self.reranker = RerankerContract()

    @property
    def dense_dimensions(self) -> int:
        dimensions = self.contract.dense.dimensions
        assert dimensions is not None
        return dimensions

    @staticmethod
    def _tokens(text: str) -> list[str]:
        return [token.casefold() for token in text.split() if token]

    def _embed_dense(self, texts: Sequence[str]) -> list[list[float]]:
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

    def _embed_sparse(self, texts: Sequence[str]) -> list[SparseEmbedding]:
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

    def embed_dense_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return self._embed_dense(texts)

    def embed_sparse_documents(self, texts: Sequence[str]) -> list[SparseEmbedding]:
        return self._embed_sparse(texts)

    def embed_dense_query(self, text: str) -> list[float]:
        return self._embed_dense([text])[0]

    def embed_sparse_query(self, text: str) -> SparseEmbedding:
        return self._embed_sparse([text])[0]

    def runtime_status(self) -> dict[str, Any]:
        return {
            "profileId": self.contract.profile_id,
            "contractVersion": self.contract.contract_version,
            "embeddingSpaceFingerprint": self.contract.contract_fingerprint,
            "executor": {
                "kind": "local",
                "label": "Deterministic test executor",
                "transport": "in_process",
                "denseLoaded": True,
                "sparseLoaded": True,
                "remoteExecutor": None,
            },
            "contract": {
                "dense": self.contract.dense.public(),
                "sparse": self.contract.sparse.public(),
            },
            "reranker": self.reranker.public(),
        }
