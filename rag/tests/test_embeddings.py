from __future__ import annotations

import math

import pytest

from mycelia_rag import embeddings as embeddings_module
from mycelia_rag.config import Settings
from mycelia_rag.domain import RerankerContract
from mycelia_rag.embeddings import FastEmbedProvider, stage1_inference_contract


class ArrayValue(list):
    def tolist(self):
        return list(self)


class DenseModel:
    def __init__(self) -> None:
        self.inputs: list[tuple[str, list[str]]] = []

    def passage_embed(self, texts):
        self.inputs.append(("passage", list(texts)))
        return [ArrayValue([3.0, 4.0, *([0.0] * 382)]) for _ in texts]

    def query_embed(self, texts):
        self.inputs.append(("query", list(texts)))
        return [ArrayValue([3.0, 4.0, *([0.0] * 382)]) for _ in texts]


class SparseValue:
    indices = ArrayValue([1, 3])
    values = ArrayValue([2.0, 1.0])


class SparseModel:
    def __init__(self) -> None:
        self.inputs: list[tuple[str, list[str]]] = []

    def passage_embed(self, texts):
        self.inputs.append(("passage", list(texts)))
        return [SparseValue() for _ in texts]

    def query_embed(self, texts):
        self.inputs.append(("query", list(texts)))
        return [SparseValue() for _ in texts]


def settings(tmp_path, **overrides) -> Settings:
    return Settings(model_cache=tmp_path / "models", **overrides)


def test_stage1_contract_pins_artifacts_tokenizers_and_output_semantics(tmp_path) -> None:
    contract = stage1_inference_contract(settings(tmp_path))

    assert contract.dense.model_revision == "faf4aa4225822f3bc6376869cb1164e8e3feedd0"
    assert contract.dense.tokenizer.revision == contract.dense.model_revision
    assert contract.dense.dimensions == 384
    assert contract.dense.normalization == "l2"
    assert dict(contract.dense.options) == {
        "artifactFile": "model_optimized.onnx",
        "fastembedVersion": "0.8.0",
        "instructionFormat": "verbatim-prefix-newline-v1",
        "maxTokens": 512,
        "pooling": "model-defined",
        "roleMethods": "passage_embed/query_embed",
        "truncation": "model-max-length",
    }
    assert contract.sparse.model_revision == "22b8d2af71a76161e18dd432d2cee0eefa66e412"
    assert dict(contract.sparse.options) == {
        "avgLen": 256.0,
        "b": 0.75,
        "disableStemmer": False,
        "fastembedVersion": "0.8.0",
        "k": 1.2,
        "language": "english",
        "qdrantModifier": "idf",
        "roleMethods": "passage_embed/query_embed",
        "tokenMaxLength": 40,
    }


def test_provider_resolves_the_exact_pinned_snapshot(tmp_path, monkeypatch) -> None:
    provider = FastEmbedProvider(settings=settings(tmp_path))
    revision = provider.contract.dense.model_revision
    snapshot = tmp_path / revision
    snapshot.mkdir()
    received = {}

    def fake_snapshot_download(**kwargs):
        received.update(kwargs)
        return str(snapshot)

    monkeypatch.setattr(embeddings_module, "snapshot_download", fake_snapshot_download)

    assert provider._pinned_snapshot("example/model", revision) == str(snapshot)
    assert received["repo_id"] == "example/model"
    assert received["revision"] == revision


def test_provider_rejects_a_snapshot_resolved_to_another_revision(tmp_path, monkeypatch) -> None:
    provider = FastEmbedProvider(settings=settings(tmp_path))
    wrong_snapshot = tmp_path / ("0" * 40)
    wrong_snapshot.mkdir()
    monkeypatch.setattr(
        embeddings_module,
        "snapshot_download",
        lambda **_kwargs: str(wrong_snapshot),
    )

    with pytest.raises(RuntimeError, match="does not match pinned revision"):
        provider._pinned_snapshot("example/model", provider.contract.dense.model_revision)


def test_document_and_query_roles_are_distinct_and_dense_is_l2_normalized(tmp_path) -> None:
    provider = FastEmbedProvider(settings=settings(tmp_path))
    dense = DenseModel()
    sparse = SparseModel()
    provider._dense = dense
    provider._sparse = sparse

    document = provider.embed_dense_documents(["fact"])[0]
    query = provider.embed_dense_query("fact")
    provider.embed_sparse_documents(["fact"])
    provider.embed_sparse_query("fact")

    assert dense.inputs == [
        ("passage", ["fact"]),
        ("query", ["fact"]),
    ]
    assert sparse.inputs == [
        ("passage", ["fact"]),
        ("query", ["fact"]),
    ]
    assert math.isclose(math.sqrt(sum(value * value for value in document)), 1.0)
    assert math.isclose(math.sqrt(sum(value * value for value in query)), 1.0)
    assert provider._prepare(["fact"], "query:") == ["query:\nfact"]


def test_runtime_version_mismatch_is_rejected_before_model_loading(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(embeddings_module, "package_version", lambda _name: "9.9.9")

    with pytest.raises(RuntimeError, match=r"installed=9\.9\.9, expected=0\.8\.0"):
        FastEmbedProvider(settings=settings(tmp_path))


@pytest.mark.parametrize(
    "override",
    [
        {"fastembed_version": "0.8.1"},
        {"dense_model": "BAAI/bge-small-en-v1.5"},
        {"dense_artifact_repo": "example/other-model"},
        {"dense_revision": "1" * 40, "dense_tokenizer_revision": "1" * 40},
        {"dense_dimensions": 768},
        {"dense_tokenizer": "different/tokenizer"},
        {"dense_tokenizer_revision": "1" * 40},
        {"sparse_tokenizer": "untracked-tokenizer"},
        {"dense_query_instruction": "query:"},
        {"dense_query_instruction_id": "query-v1", "dense_query_instruction": "query:"},
    ],
)
def test_unexecutable_contract_metadata_is_rejected(tmp_path, override) -> None:
    with pytest.raises(ValueError):
        settings(tmp_path, **override)


def test_reranker_runtime_contract_does_not_change_embedding_space_fingerprint(tmp_path) -> None:
    provider = FastEmbedProvider(settings=settings(tmp_path))
    fingerprint = provider.contract.contract_fingerprint

    provider.reranker = RerankerContract(
        enabled=True,
        provider="future-reranker",
        model="future-model",
        model_revision="future-revision",
    )

    assert provider.contract.contract_fingerprint == fingerprint
