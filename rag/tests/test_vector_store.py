from __future__ import annotations

from datetime import UTC, datetime

import pytest
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import ResponseHandlingException

from mycelia_rag.domain import SparseEmbedding, VectorPoint
from mycelia_rag.vector_store import QdrantVectorStore


def vector_point() -> VectorPoint:
    return VectorPoint(
        point_id="00000000-0000-0000-0000-000000000001",
        dense=[1.0, 0.0, 0.0, 0.0],
        sparse=SparseEmbedding([7], [1.0]),
        payload={"text": "retry contract"},
    )


def test_upsert_retries_transient_response_handling_failure(monkeypatch) -> None:
    class FlakyClient:
        def __init__(self) -> None:
            self.calls = 0
            self.point_batches: list[list[object]] = []

        def upsert(self, *, collection_name, wait, points):
            assert collection_name == "contract"
            assert wait is True
            self.calls += 1
            self.point_batches.append(points)
            if self.calls < 3:
                raise ResponseHandlingException(RuntimeError("connection closed"))
            return object()

    client = FlakyClient()
    store = QdrantVectorStore.__new__(QdrantVectorStore)
    store.client = client
    sleeps: list[float] = []
    monkeypatch.setattr("mycelia_rag.vector_store.time.sleep", sleeps.append)

    store.upsert("contract", [vector_point()])

    assert client.calls == 3
    assert sleeps == [0.25, 0.75]
    assert client.point_batches[0] is client.point_batches[1]
    assert client.point_batches[1] is client.point_batches[2]


@pytest.mark.filterwarnings("ignore:Payload indexes have no effect in the local Qdrant")
def test_real_qdrant_client_hybrid_and_filter_contract(tmp_path, monkeypatch) -> None:
    # qdrant-client writes a process-session marker in the current directory
    # even when local storage has an explicit path. Keep it under pytest tmp.
    monkeypatch.chdir(tmp_path)
    store = QdrantVectorStore.__new__(QdrantVectorStore)
    store.client = QdrantClient(path=str(tmp_path / "qdrant"))
    store.create_projection("contract", 4)
    store.create_projection("next_contract", 4)
    store.activate_alias("contract", "rag_active")
    store.activate_alias("next_contract", "rag_active")
    assert store.client.get_collection_aliases("next_contract").aliases[0].alias_name == (
        "rag_active"
    )
    store.deactivate_alias("rag_active")
    assert store.client.get_aliases().aliases == []
    start = datetime(2026, 1, 1, tzinfo=UTC)
    store.upsert(
        "contract",
        [
            VectorPoint(
                point_id="00000000-0000-0000-0000-000000000001",
                dense=[1.0, 0.0, 0.0, 0.0],
                sparse=SparseEmbedding([7], [1.0]),
                payload={
                    "text": "точный термин",
                    "source": {
                        "kind": "message",
                        "collection": "messages",
                        "id": "m1",
                        "uri": "/chat/c1",
                        "title": None,
                        "start": start.isoformat(),
                        "end": start.isoformat(),
                        "platform": "telegram",
                        "sender_id": "person-1",
                    },
                    "chunk": {"index": 0, "content_hash": "hash"},
                    "source_key": "messages:m1",
                    "start_ts": start.timestamp(),
                    "end_ts": start.timestamp(),
                },
            )
        ],
    )

    hits = store.search(
        "contract",
        "hybrid",
        [1.0, 0.0, 0.0, 0.0],
        SparseEmbedding([7], [1.0]),
        ["message"],
        datetime(2025, 12, 31, tzinfo=UTC),
        datetime(2026, 1, 2, tzinfo=UTC),
        10,
        None,
        ["telegram"],
        ["person-1"],
        [("messages", "m1")],
    )
    assert [hit.payload["source"]["id"] for hit in hits] == ["m1"]
    total, chunks = store.list_chunks("contract", "message", "m1", 10, 0)
    assert total == 1
    assert chunks[0].payload["chunk"]["content_hash"] == "hash"

    excluded = store.search(
        "contract",
        "lexical",
        None,
        SparseEmbedding([7], [1.0]),
        ["message"],
        None,
        None,
        10,
        None,
        ["mycelia"],
        None,
        None,
    )
    assert excluded == []
