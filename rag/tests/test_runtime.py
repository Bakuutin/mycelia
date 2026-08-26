from __future__ import annotations

import asyncio
import json
import threading
from datetime import UTC, datetime

import pytest

from mycelia_rag.config import Settings
from mycelia_rag.embeddings import DeterministicEmbeddingProvider
from mycelia_rag.indexer import (
    CanonicalSourceUnavailable,
    IndexManager,
    ProjectionNotReady,
)
from mycelia_rag.state import StateStore

from .fakes import FakeMongoSource, FakeVectorStore


class RecordingEmbeddingProvider(DeterministicEmbeddingProvider):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[str] = []

    def embed_dense_documents(self, texts):
        self.calls.append("dense_documents")
        return super().embed_dense_documents(texts)

    def embed_sparse_documents(self, texts):
        self.calls.append("sparse_documents")
        return super().embed_sparse_documents(texts)

    def embed_dense_query(self, text):
        self.calls.append("dense_query")
        return super().embed_dense_query(text)

    def embed_sparse_query(self, text):
        self.calls.append("sparse_query")
        return super().embed_sparse_query(text)


def documents() -> dict[str, list[dict[str, object]]]:
    return {
        "transcriptions": [
            {
                "_id": "t1",
                "text": "Обсудили квантовый запуск проекта и срок в пятницу",
                "start": datetime(2026, 1, 10, tzinfo=UTC),
                "end": datetime(2026, 1, 10, 1, tzinfo=UTC),
            }
        ],
        "messages": [
            {
                "_id": "m1",
                "text": "The launch deadline moved to Monday",
                "platform": "mycelia",
                "chatId": "chat-1",
                "timestamp": datetime(2026, 2, 10, tzinfo=UTC),
            }
        ],
        "objects": [
            {
                "_id": "o1",
                "name": "Mycelia project",
                "details": "A personal knowledge system",
                "isProject": True,
                "createdAt": datetime(2025, 1, 1, tzinfo=UTC),
            }
        ],
        "media_visual_descriptions": [],
    }


def manager(tmp_path, docs=None) -> tuple[IndexManager, FakeMongoSource, FakeVectorStore]:
    settings = Settings(
        state_path=tmp_path / "rag.sqlite3",
        model_cache=tmp_path / "models",
        enable_background=False,
        chunk_size=200,
        chunk_overlap=20,
        batch_size=2,
    )
    mongo = FakeMongoSource(docs or documents())
    vectors = FakeVectorStore()
    runtime = IndexManager(
        settings=settings,
        state=StateStore(settings.state_path),
        mongo=mongo,
        vectors=vectors,
        embeddings=DeterministicEmbeddingProvider(),
    )
    return runtime, mongo, vectors


async def rebuild(runtime: IndexManager) -> None:
    runtime.request_rebuild("test")
    assert runtime._operation_task is not None
    await runtime._operation_task


@pytest.mark.asyncio
async def test_rebuild_activates_generation_and_exposes_status(tmp_path) -> None:
    runtime, _mongo, vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)

    status = await runtime.status()
    assert status["state"] == "ready"
    assert status["projection"]["state"] == "ready"
    assert status["projection"]["chunkerVersion"] == "char-boundary-v1"
    assert status["projection"]["inferenceContract"]["dense"]["modelRevision"]
    assert (
        status["inference"]["embeddingSpaceFingerprint"] == status["projection"]["modelFingerprint"]
    )
    assert status["inference"]["activeProjectionCompatible"] is True
    assert status["inference"]["reranker"]["enabled"] is False
    assert status["inference"]["executor"]["remoteExecutor"] is None
    assert status["qdrant"]["pointsCount"] == 3
    assert vectors.aliases["mycelia_rag_active"] == status["projection"]["collectionName"]


@pytest.mark.asyncio
async def test_build_and_search_use_role_specific_embedding_methods(tmp_path) -> None:
    runtime, _mongo, _vectors = manager(tmp_path)
    embeddings = RecordingEmbeddingProvider()
    runtime.embeddings = embeddings
    await runtime.start()
    await rebuild(runtime)

    assert "dense_documents" in embeddings.calls
    assert "sparse_documents" in embeddings.calls
    assert "dense_query" not in embeddings.calls
    assert "sparse_query" not in embeddings.calls

    embeddings.calls.clear()
    await runtime.search(
        query="launch",
        mode="hybrid",
        kinds=None,
        start=None,
        end=None,
        limit=5,
        min_score=None,
    )

    assert embeddings.calls == ["dense_query", "sparse_query"]


@pytest.mark.asyncio
async def test_failed_blue_green_rebuild_preserves_active_projection(tmp_path) -> None:
    runtime, _mongo, vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)
    previous = runtime.state.active_projection()

    vectors.fail_next_alias = True
    await rebuild(runtime)

    assert runtime.state.active_projection()["id"] == previous["id"]
    assert runtime.state.latest_operation()["state"] == "failed"
    assert runtime.state.latest_projection()["state"] == "error"
    response = await runtime.search(
        query="квантовый",
        mode="lexical",
        kinds=None,
        start=None,
        end=None,
        limit=5,
        min_score=None,
    )
    assert response["projectionId"] == previous["id"]


@pytest.mark.asyncio
async def test_write_during_activation_is_replayed_into_candidate(tmp_path) -> None:
    runtime, mongo, vectors = manager(tmp_path)
    await runtime.start()

    updated = {
        "_id": "m1",
        "text": "The activation-window fact is nebula",
        "platform": "mycelia",
        "chatId": "chat-1",
        "timestamp": datetime(2026, 2, 10, tzinfo=UTC),
    }

    def write_during_alias() -> None:
        mongo.replace("messages", "m1", updated)
        mongo.enqueue_change(
            {
                "_id": {"_data": "activation-window-token"},
                "operationType": "update",
                "ns": {"coll": "messages"},
                "documentKey": {"_id": "m1"},
                "fullDocument": updated,
                "wallTime": datetime.now(UTC),
            }
        )

    vectors.before_alias = write_during_alias
    await rebuild(runtime)

    result = await runtime.search(
        query="nebula",
        mode="lexical",
        kinds=["message"],
        start=None,
        end=None,
        limit=5,
        min_score=0.1,
    )
    assert [item["source"]["id"] for item in result["results"]] == ["m1"]
    status = await runtime.status()
    message = next(source for source in status["sources"] if source["kind"] == "message")
    assert message["changeStream"]["resumeTokenPresent"] is True
    search_freshness = result["freshness"]
    assert search_freshness["checkpointAt"] is not None
    assert search_freshness["checkpointState"] == "disabled"
    assert search_freshness["lagSeconds"] is None
    assert message["changeStream"]["lagSeconds"] is None


@pytest.mark.asyncio
async def test_lexical_exact_term_and_hard_kind_date_filters(tmp_path) -> None:
    runtime, _mongo, _vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)

    exact = await runtime.search(
        query="квантовый",
        mode="lexical",
        kinds=["transcription"],
        start=datetime(2026, 1, 1, tzinfo=UTC),
        end=datetime(2026, 1, 31, tzinfo=UTC),
        limit=5,
        min_score=0.1,
    )
    assert [item["source"]["id"] for item in exact["results"]] == ["t1"]

    excluded = await runtime.search(
        query="квантовый",
        mode="lexical",
        kinds=["message"],
        start=datetime(2026, 1, 1, tzinfo=UTC),
        end=datetime(2026, 1, 31, tzinfo=UTC),
        limit=5,
        min_score=0.1,
    )
    assert excluded["results"] == []


@pytest.mark.asyncio
async def test_message_platform_sender_and_exact_source_are_canonical_filters(tmp_path) -> None:
    docs = documents()
    docs["messages"] = [
        {
            "_id": "m1",
            "text": "shared launch evidence",
            "platform": "mycelia",
            "senderId": "person-me",
            "chatId": "chat-1",
            "timestamp": datetime(2026, 5, 10, tzinfo=UTC),
        },
        {
            "_id": "m2",
            "text": "shared launch evidence",
            "platform": "telegram",
            "senderId": "person-other",
            "chatId": "chat-2",
            "timestamp": datetime(2026, 5, 11, tzinfo=UTC),
        },
    ]
    runtime, _mongo, _vectors = manager(tmp_path, docs)
    await runtime.start()
    await rebuild(runtime)

    response = await runtime.search(
        query="shared launch evidence",
        mode="lexical",
        kinds=["message"],
        start=datetime(2026, 5, 1, tzinfo=UTC),
        end=datetime(2026, 5, 31, tzinfo=UTC),
        limit=10,
        min_score=0.1,
        platforms=["telegram"],
        sender_ids=["person-other"],
        sources=[("messages", "m2")],
    )

    assert [item["source"]["id"] for item in response["results"]] == ["m2"]
    evidence = response["results"][0]
    assert evidence["source"]["platform"] == "telegram"
    assert evidence["source"]["senderId"] == "person-other"
    assert evidence["source"]["groupId"] == "chat:telegram:chat-2"
    assert evidence["source"]["sourceHash"]
    assert evidence["evidenceId"].startswith(response["projectionId"])
    assert response["revalidation"] == {
        "state": "verified",
        "checkedSources": 1,
        "droppedCandidates": 0,
        "staleCandidates": 0,
        "filterRefinedCandidates": 0,
    }


@pytest.mark.asyncio
async def test_search_drops_stale_qdrant_payload_after_mongo_revalidation(tmp_path) -> None:
    runtime, mongo, vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)

    collection = runtime.state.active_projection()["collectionName"]
    message_point = next(
        point
        for point in vectors.collections[collection].values()
        if point.payload["source"]["id"] == "m1"
    )
    message_point.payload["text"] = "forged vector payload"
    verified = await runtime.search(
        query="deadline moved Monday",
        mode="lexical",
        kinds=["message"],
        start=None,
        end=None,
        limit=5,
        min_score=0.1,
    )
    assert verified["results"][0]["text"] == "The launch deadline moved to Monday"

    mongo.replace(
        "messages",
        "m1",
        {
            "_id": "m1",
            "text": "The canonical message changed before the projection caught up",
            "platform": "telegram",
            "senderId": "person-new",
            "chatId": "chat-9",
            "timestamp": datetime(2026, 2, 10, tzinfo=UTC),
        },
    )
    response = await runtime.search(
        query="deadline moved Monday",
        mode="lexical",
        kinds=["message"],
        start=None,
        end=None,
        limit=5,
        min_score=0.1,
    )

    assert response["results"] == []
    assert response["degraded"] is True
    assert response["revalidation"]["state"] == "degraded"
    assert response["revalidation"]["droppedCandidates"] == 1
    assert response["revalidation"]["staleCandidates"] == 1
    assert response["revalidation"]["filterRefinedCandidates"] == 0


@pytest.mark.asyncio
async def test_search_diversifies_evidence_by_chat_or_recording(tmp_path) -> None:
    docs = documents()
    docs["messages"] = [
        {
            "_id": f"m{index}",
            "text": "shared evidence",
            "platform": "telegram",
            "senderId": "person-1",
            "chatId": chat_id,
            "timestamp": datetime(2026, 5, 10 + index, tzinfo=UTC),
        }
        for index, chat_id in enumerate(
            ["chat-a", "chat-a", "chat-a", "chat-a", "chat-b", "chat-c"],
            start=1,
        )
    ]
    runtime, _mongo, _vectors = manager(tmp_path, docs)
    await runtime.start()
    await rebuild(runtime)

    response = await runtime.search(
        query="shared evidence",
        mode="lexical",
        kinds=["message"],
        start=None,
        end=None,
        limit=3,
        min_score=0.1,
        max_per_source=1,
    )

    groups = [item["source"]["groupId"] for item in response["results"]]
    assert groups == [
        "chat:telegram:chat-a",
        "chat:telegram:chat-b",
        "chat:telegram:chat-c",
    ]
    assert response["selection"] == {
        "candidateCount": 6,
        "verifiedCandidates": 6,
        "returnedCount": 3,
        "distinctSources": 3,
        "distinctGroups": 3,
        "maxPerSource": 1,
    }


@pytest.mark.asyncio
async def test_search_fails_closed_when_canonical_revalidation_is_unavailable(tmp_path) -> None:
    runtime, mongo, _vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("MongoDB unavailable")

    mongo.get_documents = unavailable  # type: ignore[method-assign]
    with pytest.raises(CanonicalSourceUnavailable, match="MongoDB unavailable"):
        await runtime.search(
            query="deadline",
            mode="lexical",
            kinds=["message"],
            start=None,
            end=None,
            limit=5,
            min_score=0.1,
        )


@pytest.mark.asyncio
async def test_date_filter_treats_single_boundary_source_as_point_in_time(tmp_path) -> None:
    runtime, _mongo, _vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)

    inside = await runtime.search(
        query="Mycelia",
        mode="lexical",
        kinds=["object"],
        start=datetime(2024, 12, 31, tzinfo=UTC),
        end=datetime(2025, 1, 2, tzinfo=UTC),
        limit=5,
        min_score=0.1,
    )
    before = await runtime.search(
        query="Mycelia",
        mode="lexical",
        kinds=["object"],
        start=datetime(2024, 1, 1, tzinfo=UTC),
        end=datetime(2024, 12, 31, tzinfo=UTC),
        limit=5,
        min_score=0.1,
    )

    assert [item["source"]["id"] for item in inside["results"]] == ["o1"]
    assert before["results"] == []


@pytest.mark.asyncio
async def test_object_date_revalidation_does_not_fill_time_range_gaps(tmp_path) -> None:
    docs = documents()
    docs["objects"][0]["timeRanges"] = [
        {
            "start": datetime(2026, 1, 1, tzinfo=UTC),
            "end": datetime(2026, 1, 2, tzinfo=UTC),
        },
        {
            "start": datetime(2026, 3, 1, tzinfo=UTC),
            "end": datetime(2026, 3, 2, tzinfo=UTC),
        },
    ]
    runtime, _mongo, _vectors = manager(tmp_path, docs)
    await runtime.start()
    await rebuild(runtime)

    response = await runtime.search(
        query="Mycelia",
        mode="lexical",
        kinds=["object"],
        start=datetime(2026, 2, 1, tzinfo=UTC),
        end=datetime(2026, 2, 28, tzinfo=UTC),
        limit=5,
        min_score=0.1,
    )

    assert response["results"] == []
    assert response["revalidation"]["droppedCandidates"] == 1
    assert response["revalidation"]["staleCandidates"] == 0
    assert response["revalidation"]["filterRefinedCandidates"] == 1
    assert response["revalidation"]["state"] == "verified"
    assert response["degraded"] is True  # background checkpoints are disabled in tests
    assert not any("stale or mismatched" in value for value in response["warnings"])


@pytest.mark.asyncio
async def test_object_open_ended_time_range_remains_searchable_later(tmp_path) -> None:
    docs = documents()
    docs["objects"][0]["timeRanges"] = [{"start": datetime(2026, 1, 1, tzinfo=UTC)}]
    runtime, _mongo, _vectors = manager(tmp_path, docs)
    await runtime.start()
    await rebuild(runtime)

    response = await runtime.search(
        query="Mycelia",
        mode="lexical",
        kinds=["object"],
        start=datetime(2026, 6, 1, tzinfo=UTC),
        end=datetime(2026, 6, 30, tzinfo=UTC),
        limit=5,
        min_score=0.1,
    )

    assert [item["source"]["id"] for item in response["results"]] == ["o1"]


@pytest.mark.asyncio
async def test_incremental_update_and_delete_refresh_search_and_ledger(tmp_path) -> None:
    runtime, mongo, _vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)

    updated = {
        "_id": "m1",
        "text": "The launch deadline is now aurora",
        "platform": "mycelia",
        "chatId": "chat-1",
        "timestamp": datetime(2026, 2, 10, tzinfo=UTC),
    }
    mongo.replace("messages", "m1", updated)
    await runtime._apply_change(
        {
            "_id": {"_data": "token-update"},
            "operationType": "update",
            "ns": {"coll": "messages"},
            "documentKey": {"_id": "m1"},
            "fullDocument": updated,
            "wallTime": datetime.now(UTC),
        }
    )
    result = await runtime.search(
        query="aurora",
        mode="lexical",
        kinds=["message"],
        start=None,
        end=None,
        limit=5,
        min_score=0.1,
    )
    assert [item["source"]["id"] for item in result["results"]] == ["m1"]
    assert result["freshness"]["checkpointAt"] is not None
    positions = [
        runtime.state.checkpoint(collection)["resumeToken"]
        for collection in (
            "transcriptions",
            "messages",
            "objects",
            "media_visual_descriptions",
        )
    ]
    assert positions == [{"_data": "token-update"}] * 4

    mongo.delete("messages", "m1")
    await runtime._apply_change(
        {
            "_id": {"_data": "token-delete"},
            "operationType": "delete",
            "ns": {"coll": "messages"},
            "documentKey": {"_id": "m1"},
            "wallTime": datetime.now(UTC),
        }
    )
    assert (
        runtime.state.source_chunk_hashes(runtime.state.active_projection()["id"], "messages", "m1")
        == []
    )
    deleted = await runtime.search(
        query="aurora",
        mode="lexical",
        kinds=["message"],
        start=None,
        end=None,
        limit=5,
        min_score=0.1,
    )
    assert deleted["results"] == []


@pytest.mark.asyncio
async def test_incremental_insert_replay_and_delete_keep_document_counts_exact(tmp_path) -> None:
    runtime, mongo, _vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)
    inserted = {
        "_id": "m2",
        "text": "A second indexed message",
        "platform": "mycelia",
        "chatId": "chat-1",
        "timestamp": datetime(2026, 2, 11, tzinfo=UTC),
    }
    mongo.replace("messages", "m2", inserted)
    event = {
        "_id": {"_data": "token-insert-m2"},
        "operationType": "insert",
        "ns": {"coll": "messages"},
        "documentKey": {"_id": "m2"},
        "fullDocument": inserted,
        "wallTime": datetime.now(UTC),
    }

    await runtime._apply_change(event)
    await runtime._apply_change(event)
    status = await runtime.status()
    messages = next(source for source in status["sources"] if source["kind"] == "message")
    assert (messages["documents"], messages["indexedDocuments"], messages["chunks"]) == (
        2,
        2,
        2,
    )

    mongo.delete("messages", "m2")
    await runtime._apply_change(
        {
            "_id": {"_data": "token-delete-m2"},
            "operationType": "delete",
            "ns": {"coll": "messages"},
            "documentKey": {"_id": "m2"},
            "wallTime": datetime.now(UTC),
        }
    )
    status = await runtime.status()
    messages = next(source for source in status["sources"] if source["kind"] == "message")
    assert (messages["documents"], messages["indexedDocuments"], messages["chunks"]) == (
        1,
        1,
        1,
    )


@pytest.mark.asyncio
async def test_reconcile_refreshes_payload_when_text_is_unchanged(tmp_path) -> None:
    runtime, mongo, _vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)

    moved = {
        "_id": "m1",
        "text": "The launch deadline moved to Monday",
        "platform": "mycelia",
        "chatId": "chat-2",
        "timestamp": datetime(2026, 3, 10, tzinfo=UTC),
    }
    mongo.replace("messages", "m1", moved)

    runtime.request_reconcile("repair missed metadata-only update")
    assert runtime._operation_task is not None
    await runtime._operation_task

    chunks = await runtime.list_chunks(kind="message", source_id="m1", limit=5, offset=0)
    assert chunks["items"][0]["source"]["uri"] == "/chat/chat-2"
    assert chunks["items"][0]["source"]["start"].startswith("2026-03-10")
    march = await runtime.search(
        query="deadline",
        mode="lexical",
        kinds=["message"],
        start=datetime(2026, 3, 1, tzinfo=UTC),
        end=datetime(2026, 3, 31, tzinfo=UTC),
        limit=5,
        min_score=0.1,
    )
    assert [item["source"]["id"] for item in march["results"]] == ["m1"]


@pytest.mark.asyncio
async def test_pause_blocks_mutation_state_but_keeps_search_available(tmp_path) -> None:
    runtime, _mongo, _vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)
    runtime.pause()
    status = await runtime.status()
    assert status["state"] == "paused"
    response = await runtime.search(
        query="deadline",
        mode="hybrid",
        kinds=None,
        start=None,
        end=None,
        limit=5,
        min_score=None,
    )
    assert response["results"]
    assert response["degraded"] is True
    runtime.resume()


@pytest.mark.asyncio
async def test_pause_during_cutover_waits_and_resumes_to_ready(tmp_path) -> None:
    runtime, _mongo, vectors = manager(tmp_path)
    await runtime.start()
    alias_entered = threading.Event()
    release_alias = threading.Event()
    activate_alias = vectors.activate_alias

    def blocked_alias(collection_name: str, alias_name: str) -> None:
        alias_entered.set()
        if not release_alias.wait(timeout=2):
            raise TimeoutError("test did not release alias activation")
        activate_alias(collection_name, alias_name)

    vectors.activate_alias = blocked_alias
    runtime.request_rebuild("pause during cutover")
    assert runtime._operation_task is not None
    assert await asyncio.to_thread(alias_entered.wait, 2)

    runtime.pause()
    release_alias.set()
    await asyncio.sleep(0.05)

    assert runtime._operation_task.done() is False
    paused = await runtime.status()
    assert paused["state"] == "paused"
    assert runtime.state.get_meta("state") == "catching_up"

    runtime.resume()
    await runtime._operation_task

    assert runtime.state.get_meta("state") == "ready"
    assert (await runtime.status())["state"] == "ready"


@pytest.mark.asyncio
async def test_cancelled_reconcile_restores_ready_across_restart(tmp_path) -> None:
    runtime, mongo, vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)
    capture_entered = threading.Event()
    release_capture = threading.Event()
    capture = mongo.capture_database_resume_token

    def blocked_capture(collections, max_await_time_ms=2_000):
        capture_entered.set()
        if not release_capture.wait(timeout=2):
            raise TimeoutError("test did not release resume-token capture")
        return capture(collections, max_await_time_ms)

    mongo.capture_database_resume_token = blocked_capture
    runtime.request_reconcile("cancel during capture")
    assert runtime._operation_task is not None
    assert await asyncio.to_thread(capture_entered.wait, 2)
    assert runtime.state.get_meta("state") == "reconciling"

    runtime._operation_task.cancel()
    release_capture.set()
    with pytest.raises(asyncio.CancelledError):
        await runtime._operation_task

    assert runtime.state.get_meta("state") == "ready"
    restarted = IndexManager(
        settings=runtime.settings,
        state=StateStore(runtime.settings.state_path),
        mongo=mongo,
        vectors=vectors,
        embeddings=DeterministicEmbeddingProvider(),
    )
    await restarted.initialize()
    assert (await restarted.status())["state"] == "ready"


@pytest.mark.asyncio
async def test_cancelled_initial_rebuild_does_not_leave_building_state(tmp_path) -> None:
    runtime, mongo, vectors = manager(tmp_path)
    await runtime.start()
    capture_entered = threading.Event()
    release_capture = threading.Event()
    capture = mongo.capture_database_resume_token

    def blocked_capture(collections, max_await_time_ms=2_000):
        capture_entered.set()
        if not release_capture.wait(timeout=2):
            raise TimeoutError("test did not release resume-token capture")
        return capture(collections, max_await_time_ms)

    mongo.capture_database_resume_token = blocked_capture
    runtime.request_rebuild("cancel before candidate creation")
    assert runtime._operation_task is not None
    assert await asyncio.to_thread(capture_entered.wait, 2)
    assert runtime.state.get_meta("state") == "building"

    runtime._operation_task.cancel()
    release_capture.set()
    with pytest.raises(asyncio.CancelledError):
        await runtime._operation_task

    assert runtime.state.get_meta("state") == "empty"
    restarted = IndexManager(
        settings=runtime.settings,
        state=StateStore(runtime.settings.state_path),
        mongo=mongo,
        vectors=vectors,
        embeddings=DeterministicEmbeddingProvider(),
    )
    await restarted.initialize()
    assert (await restarted.status())["state"] in {"empty", "error"}


@pytest.mark.asyncio
async def test_chunk_inspection_is_filterable_and_paginated(tmp_path) -> None:
    runtime, _mongo, _vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)
    response = await runtime.list_chunks(kind="message", source_id="m1", limit=1, offset=0)
    assert response["total"] == 1
    assert response["items"][0]["source"]["uri"] == "/chat/chat-1"


@pytest.mark.asyncio
async def test_idle_change_stream_heartbeat_advances_durable_resume_token(tmp_path) -> None:
    runtime, mongo, _vectors = manager(tmp_path)
    runtime.settings.enable_background = True
    runtime.settings.change_stream_retry_seconds = 0.1
    await runtime.start()
    try:
        await rebuild(runtime)
        heartbeat = {"_data": "idle-heartbeat"}
        mongo.resume_token = heartbeat

        for _ in range(100):
            raw = runtime.state.get_meta("database_resume_token")
            if raw and json.loads(raw) == heartbeat:
                break
            await asyncio.sleep(0.01)

        assert json.loads(runtime.state.get_meta("database_resume_token") or "null") == heartbeat
        assert runtime.state.get_meta("database_resume_updated_at") is not None
    finally:
        await runtime.stop()


@pytest.mark.asyncio
async def test_pause_holds_event_returned_by_in_flight_change_stream_poll(tmp_path) -> None:
    runtime, mongo, vectors = manager(tmp_path)
    runtime.settings.enable_background = True
    runtime.settings.change_stream_retry_seconds = 0.1
    await runtime.start()
    poll_entered = threading.Event()
    release_poll = threading.Event()
    poll_returned = threading.Event()
    mutation_started = threading.Event()
    try:
        await rebuild(runtime)
        active = runtime.state.active_projection()
        assert active is not None
        original_source_hash = runtime.state.source_hash(active["id"], "messages", "m1")
        original_token = runtime.state.get_meta("database_resume_token")

        updated = {
            "_id": "m1",
            "text": "The launch deadline is now pause-race-aurora",
            "platform": "mycelia",
            "chatId": "chat-1",
            "timestamp": datetime(2026, 2, 10, tzinfo=UTC),
        }
        event_token = {"_data": "pause-race-event"}
        event = {
            "_id": event_token,
            "operationType": "update",
            "ns": {"coll": "messages"},
            "documentKey": {"_id": "m1"},
            "fullDocument": updated,
            "wallTime": datetime.now(UTC),
        }
        mongo.replace("messages", "m1", updated)
        original_poll = mongo.poll_database_change
        first_poll = True

        def blocked_poll(collections, resume_token, max_await_time_ms=2_000):
            nonlocal first_poll
            if first_poll:
                first_poll = False
                poll_entered.set()
                if not release_poll.wait(timeout=2):
                    raise TimeoutError("test did not release change-stream poll")
                mongo.resume_token = event_token
                poll_returned.set()
                return event, event_token
            return original_poll(collections, resume_token, max_await_time_ms)

        mongo.poll_database_change = blocked_poll
        original_delete = vectors.delete_source

        def tracked_delete(collection_name, collection, source_id):
            mutation_started.set()
            return original_delete(collection_name, collection, source_id)

        vectors.delete_source = tracked_delete

        assert await asyncio.to_thread(poll_entered.wait, 2)
        runtime.pause()
        release_poll.set()
        assert await asyncio.to_thread(poll_returned.wait, 2)
        await asyncio.sleep(0.05)

        assert mutation_started.is_set() is False
        assert runtime.state.source_hash(active["id"], "messages", "m1") == original_source_hash
        assert runtime.state.get_meta("database_resume_token") == original_token

        runtime.resume()
        assert await asyncio.to_thread(mutation_started.wait, 2)
        for _ in range(200):
            raw_token = runtime.state.get_meta("database_resume_token")
            if raw_token and json.loads(raw_token) == event_token:
                break
            await asyncio.sleep(0.01)

        assert json.loads(runtime.state.get_meta("database_resume_token") or "null") == event_token
        assert runtime.state.source_hash(active["id"], "messages", "m1") != original_source_hash
    finally:
        release_poll.set()
        runtime.resume()
        await runtime.stop()


@pytest.mark.asyncio
async def test_successful_reconcile_clears_interrupted_recovery_warning(tmp_path) -> None:
    runtime, mongo, vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)
    runtime.state.create_operation("reconcile", "interrupted before restart")

    recovered = IndexManager(
        settings=runtime.settings,
        state=StateStore(runtime.settings.state_path),
        mongo=mongo,
        vectors=vectors,
        embeddings=DeterministicEmbeddingProvider(),
    )
    await recovered.start()
    assert any("recovery" in warning for warning in recovered._warnings())

    recovered.request_reconcile("recover freshness")
    assert recovered._operation_task is not None
    await recovered._operation_task

    assert not any("recovery" in warning for warning in recovered._warnings())
    status = await recovered.status()
    assert status["degraded"] is True
    assert any("continuous updates are disabled" in warning for warning in status["warnings"])


@pytest.mark.asyncio
async def test_readonly_requirement_stays_not_ready_after_successful_rebuild(tmp_path) -> None:
    runtime, mongo, _vectors = manager(tmp_path)
    runtime.settings.require_readonly_mongo = True

    def reject_writable_principal() -> None:
        raise PermissionError("MongoDB principal has non-read-only roles: ['readWrite']")

    mongo.verify_readonly = reject_writable_principal
    await runtime.start()
    await rebuild(runtime)

    assert runtime.state.active_projection() is not None
    assert "mongo" not in runtime._last_probe_errors
    assert "mongoReadonly" in runtime._last_probe_errors
    assert await runtime.ready() == (False, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("drift", ["model", "dimension", "legacy-contract"])
async def test_incompatible_active_projection_blocks_search_and_mutation(tmp_path, drift) -> None:
    runtime, mongo, vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)
    if drift == "legacy-contract":
        with runtime.state._connect() as connection:
            connection.execute(
                "UPDATE projections SET inference_contract_json=NULL WHERE id=?",
                (runtime.state.active_projection()["id"],),
            )
    embeddings = DeterministicEmbeddingProvider(
        dimensions=64 if drift == "dimension" else 32,
        dense_model=(
            "different-deterministic-model" if drift == "model" else "deterministic-test-dense"
        ),
    )
    restarted = IndexManager(
        settings=runtime.settings,
        state=StateStore(runtime.settings.state_path),
        mongo=mongo,
        vectors=vectors,
        embeddings=embeddings,
    )
    await restarted.initialize()

    status = await restarted.status()
    assert status["state"] == "degraded"
    assert any("compatibility" in warning for warning in status["warnings"])
    assert await restarted.ready() == (False, None)
    with pytest.raises(ProjectionNotReady):
        await restarted.search(
            query="fact",
            mode="hybrid",
            kinds=None,
            start=None,
            end=None,
            limit=5,
            min_score=None,
        )
    with pytest.raises(ProjectionNotReady):
        restarted.request_reconcile("must rebuild instead")
    with pytest.raises(ProjectionNotReady):
        await restarted._apply_change(
            {
                "_id": {"_data": "incompatible"},
                "operationType": "update",
                "ns": {"coll": "messages"},
                "documentKey": {"_id": "m1"},
                "wallTime": datetime.now(UTC),
            }
        )


@pytest.mark.asyncio
async def test_qdrant_startup_outage_recovers_lifecycle_and_alias(tmp_path) -> None:
    runtime, mongo, vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)
    health = vectors.health
    has_projection = vectors.has_projection

    def unavailable(*_args, **_kwargs):
        raise ConnectionError("temporary qdrant outage")

    vectors.health = unavailable
    vectors.has_projection = unavailable
    recovering = IndexManager(
        settings=runtime.settings,
        state=StateStore(runtime.settings.state_path),
        mongo=mongo,
        vectors=vectors,
        embeddings=DeterministicEmbeddingProvider(),
    )
    await recovering.initialize()
    assert recovering.state.get_meta("state") == "degraded"
    assert await recovering.ready() == (False, None)

    vectors.health = health
    vectors.has_projection = has_projection
    assert (await recovering.ready())[0] is True
    assert recovering.state.get_meta("state") == "ready"
    assert not any("projection" in warning for warning in recovering._warnings())

    restarted = IndexManager(
        settings=runtime.settings,
        state=StateStore(runtime.settings.state_path),
        mongo=mongo,
        vectors=vectors,
        embeddings=DeterministicEmbeddingProvider(),
    )
    await restarted.initialize()
    assert (await restarted.status())["state"] == "ready"


@pytest.mark.asyncio
async def test_structural_change_advances_boundary_and_schedules_reconcile(tmp_path) -> None:
    runtime, mongo, _vectors = manager(tmp_path)
    runtime.settings.enable_background = True
    runtime.settings.change_stream_retry_seconds = 0.1
    await runtime.start()
    try:
        await rebuild(runtime)
        structural_token = {"_data": "drop-messages-boundary"}
        mongo.enqueue_change(
            {
                "_id": structural_token,
                "operationType": "drop",
                "ns": {"coll": "messages"},
                "wallTime": datetime.now(UTC),
            }
        )

        for _ in range(200):
            operation = runtime.state.latest_operation()
            raw_token = runtime.state.get_meta("database_resume_token")
            if (
                operation
                and operation["type"] == "reconcile"
                and operation["state"] == "succeeded"
                and raw_token
                and json.loads(raw_token) == structural_token
            ):
                break
            await asyncio.sleep(0.01)

        operation = runtime.state.latest_operation()
        assert operation["type"] == "reconcile"
        assert operation["state"] == "succeeded"
        assert "structural change" in operation["reason"]
        assert runtime.state.get_meta("reconcile_required_reason") == ""
    finally:
        await runtime.stop()


@pytest.mark.asyncio
async def test_startup_recovers_interrupted_operation_and_restores_active_alias(
    tmp_path,
) -> None:
    runtime, mongo, vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)
    active = runtime.state.active_projection()
    operation = runtime.state.create_operation("rebuild", "interrupted")
    runtime.state.update_operation(operation["id"], state="running")
    candidate = {
        **active,
        "id": "interrupted-generation",
        "generation": "interrupted-generation",
        "collectionName": "mycelia_rag_interrupted",
        "state": "building",
        "createdAt": "2026-02-01T00:00:00Z",
        "buildStartedAt": "2026-02-01T00:00:00Z",
    }
    runtime.state.create_projection(candidate)
    vectors.aliases["mycelia_rag_active"] = candidate["collectionName"]

    restarted = IndexManager(
        settings=runtime.settings,
        state=StateStore(runtime.settings.state_path),
        mongo=mongo,
        vectors=vectors,
        embeddings=DeterministicEmbeddingProvider(),
    )
    await restarted.initialize()

    assert restarted.state.active_projection()["id"] == active["id"]
    assert restarted.state.projection(candidate["id"])["state"] == "error"
    assert restarted.state.latest_operation()["state"] == "failed"
    assert "service restarted" in restarted.state.latest_operation()["error"]
    assert restarted.state.get_meta("state") == "degraded"
    assert vectors.aliases["mycelia_rag_active"] == active["collectionName"]
