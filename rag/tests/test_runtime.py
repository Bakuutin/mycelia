from __future__ import annotations

import asyncio
import json
import threading
from datetime import UTC, datetime

import pytest

from mycelia_rag.config import Settings
from mycelia_rag.embeddings import DeterministicEmbeddingProvider
from mycelia_rag.indexer import IndexManager, ProjectionNotReady
from mycelia_rag.state import StateStore

from .fakes import FakeMongoSource, FakeVectorStore


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
    assert status["qdrant"]["pointsCount"] == 3
    assert vectors.aliases["mycelia_rag_active"] == status["projection"]["collectionName"]


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
@pytest.mark.parametrize("drift", ["model", "dimension"])
async def test_incompatible_active_projection_blocks_search_and_mutation(tmp_path, drift) -> None:
    runtime, mongo, vectors = manager(tmp_path)
    await runtime.start()
    await rebuild(runtime)
    embeddings = DeterministicEmbeddingProvider(dimensions=64 if drift == "dimension" else 32)
    if drift == "model":
        embeddings.dense_model = "different-deterministic-model"
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
