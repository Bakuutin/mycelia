from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from pymongo.errors import OperationFailure

from .config import Settings
from .domain import (
    Chunk,
    Chunker,
    EmbeddingProvider,
    SearchMode,
    VectorPoint,
    VectorStore,
    isoformat,
    projection_fingerprint,
    utc_now,
)
from .mongo_source import MongoSource
from .sources import (
    ADAPTER_BY_COLLECTION,
    SOURCE_ADAPTERS,
    SourceAdapter,
    source_schema_fingerprint,
)
from .state import StateStore

logger = logging.getLogger(__name__)


class OperationConflict(RuntimeError):
    pass


class ProjectionNotReady(RuntimeError):
    pass


class IndexManager:
    def __init__(
        self,
        *,
        settings: Settings,
        state: StateStore,
        mongo: MongoSource,
        vectors: VectorStore,
        embeddings: EmbeddingProvider,
        adapters: Sequence[SourceAdapter] = SOURCE_ADAPTERS,
        chunker: Chunker | None = None,
    ) -> None:
        self.settings = settings
        self.state = state
        self.mongo = mongo
        self.vectors = vectors
        self.embeddings = embeddings
        self.adapters = tuple(adapters)
        self.chunker = chunker or Chunker(settings.chunk_size, settings.chunk_overlap)
        self._run_gate = asyncio.Event()
        self._run_gate.set()
        if state.paused:
            self._run_gate.clear()
        self._operation_task: asyncio.Task[None] | None = None
        self._mutation_lock = asyncio.Lock()
        self._background_tasks: set[asyncio.Task[Any]] = set()
        self._stop = asyncio.Event()
        self._last_probe_errors: dict[str, str] = {}

    async def initialize(self) -> None:
        recovery = self.state.recover_interrupted()
        if recovery["error"]:
            self._last_probe_errors["recovery"] = recovery["error"]
        self.state.initialize_checkpoints(
            [adapter.collection for adapter in self.adapters],
            enabled=self.settings.enable_background,
        )
        try:
            await asyncio.to_thread(self.mongo.ping)
            self._last_probe_errors.pop("mongo", None)
        except Exception as error:  # service remains inspectable while dependencies recover
            self._last_probe_errors["mongo"] = str(error)
        if self.settings.require_readonly_mongo:
            try:
                await asyncio.to_thread(self.mongo.verify_readonly)
                self._last_probe_errors.pop("mongoReadonly", None)
            except Exception as error:
                # Keep authorization verification independent from connectivity.
                # A later successful poll/rebuild may prove Mongo is reachable, but
                # must never make an unsafe principal ready for production use.
                self._last_probe_errors["mongoReadonly"] = str(error)
        else:
            self._last_probe_errors.pop("mongoReadonly", None)
        try:
            await asyncio.to_thread(self.vectors.health)
            self._last_probe_errors.pop("qdrant", None)
        except Exception as error:
            self._last_probe_errors["qdrant"] = str(error)

        active = self.state.active_projection()
        if active:
            try:
                exists = await asyncio.to_thread(
                    self.vectors.has_projection, active["collectionName"]
                )
            except Exception as error:
                self._last_probe_errors["qdrant"] = str(error)
                self._last_probe_errors["projection"] = (
                    f"could not verify active Qdrant collection: {error}"
                )
                if self.state.get_meta("state") == "ready":
                    self.state.set_meta("state", "degraded")
            else:
                if not exists:
                    self.state.set_meta("state", "error")
                    self._last_probe_errors["projection"] = "active Qdrant collection is missing"
                else:
                    self._last_probe_errors.pop("projection", None)
                    try:
                        await asyncio.to_thread(
                            self.vectors.activate_alias,
                            active["collectionName"],
                            f"{self.settings.collection_prefix}_active",
                        )
                        self._last_probe_errors.pop("alias", None)
                        self._refresh_compatibility(active)
                        self._restore_ready_after_dependency_recovery(active)
                    except Exception as error:
                        self._last_probe_errors["alias"] = str(error)
                        if self.state.get_meta("state") == "ready":
                            self.state.set_meta("state", "degraded")

    async def start(self) -> None:
        await self.initialize()
        if not self.settings.enable_background:
            return
        self._spawn_background(self._change_stream_loop(), "rag-change-stream")
        self._spawn_background(self._periodic_reconcile_loop(), "rag-periodic-reconcile")

    async def stop(self) -> None:
        self._stop.set()
        tasks = list(self._background_tasks)
        for task in tasks:
            task.cancel()
        if self._operation_task and not self._operation_task.done():
            self._operation_task.cancel()
            tasks.append(self._operation_task)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def _spawn_background(self, coroutine: Any, name: str) -> None:
        task = asyncio.create_task(coroutine, name=name)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    def _ensure_no_operation(self) -> None:
        if self._operation_task and not self._operation_task.done():
            raise OperationConflict("another index operation is already running")

    def _desired_projection_fingerprints(self) -> tuple[str, str]:
        return projection_fingerprint(
            source_schema_fingerprint=source_schema_fingerprint(self.adapters),
            chunker_fingerprint=self.chunker.config_fingerprint,
            dense_model=self.embeddings.dense_model,
            sparse_model=self.embeddings.sparse_model,
            dense_dimensions=self.embeddings.dense_dimensions,
        )

    def _projection_compatibility_error(self, projection: dict[str, Any]) -> str | None:
        desired_projection, _desired_model = self._desired_projection_fingerprints()
        if projection["fingerprint"] == desired_projection:
            return None
        return (
            "active projection contract does not match the configured "
            "source schema, chunker, or embedding models; run rebuild"
        )

    def _refresh_compatibility(self, projection: dict[str, Any]) -> str | None:
        error = self._projection_compatibility_error(projection)
        if error:
            self._last_probe_errors["compatibility"] = error
            if self.state.get_meta("state") == "ready":
                self.state.set_meta("state", "degraded")
        else:
            self._last_probe_errors.pop("compatibility", None)
        return error

    def _restore_ready_after_dependency_recovery(self, projection: dict[str, Any]) -> None:
        if projection.get("state") != "ready" or self._last_probe_errors:
            return
        latest = self.state.latest_operation()
        if latest and latest["state"] == "failed":
            return
        if self.state.get_meta("reconcile_required_reason"):
            return
        if self.settings.enable_background:
            for adapter in self.adapters:
                checkpoint = self.state.checkpoint(adapter.collection)
                if checkpoint and checkpoint["state"] in {"retrying", "error"}:
                    return
        if self.state.get_meta("state") in {"degraded", "error"}:
            self.state.set_meta("state", "ready")

    def request_rebuild(self, reason: str | None = None) -> dict[str, Any]:
        self._ensure_no_operation()
        operation = self.state.create_operation("rebuild", reason)
        self._operation_task = asyncio.create_task(
            self._rebuild(operation["id"]), name=f"rag-rebuild-{operation['id']}"
        )
        return operation

    def request_reconcile(self, reason: str | None = None) -> dict[str, Any]:
        self._ensure_no_operation()
        active = self.state.active_projection()
        if not active:
            raise ProjectionNotReady("no active projection; run rebuild first")
        compatibility_error = self._refresh_compatibility(active)
        if compatibility_error:
            raise ProjectionNotReady(compatibility_error)
        operation = self.state.create_operation("reconcile", reason)
        self._operation_task = asyncio.create_task(
            self._reconcile(operation["id"]), name=f"rag-reconcile-{operation['id']}"
        )
        return operation

    def pause(self) -> None:
        self._run_gate.clear()
        self.state.set_paused(True)

    def resume(self) -> None:
        self.state.set_paused(False)
        self._run_gate.set()

    async def _rebuild(self, operation_id: str) -> None:
        projection_id: str | None = None
        previous_active = self.state.active_projection()
        previous_state = self.state.get_meta("state", "empty") or "empty"
        alias_switched = False
        sqlite_activated = False

        async def rollback_alias_if_needed() -> None:
            if not alias_switched or sqlite_activated:
                return
            alias_name = f"{self.settings.collection_prefix}_active"
            if previous_active:
                await asyncio.to_thread(
                    self.vectors.activate_alias,
                    previous_active["collectionName"],
                    alias_name,
                )
            else:
                await asyncio.to_thread(self.vectors.deactivate_alias, alias_name)

        try:
            await self._run_gate.wait()
            self.state.update_operation(operation_id, state="running")
            self.state.set_meta("state", "building")
            tracked_collections = [adapter.collection for adapter in self.adapters]
            boundary_token = await asyncio.to_thread(
                self.mongo.capture_database_resume_token,
                tracked_collections,
                2_000,
            )
            schema_fp = source_schema_fingerprint(self.adapters)
            projection_fp, model_fp = self._desired_projection_fingerprints()
            generation = utc_now().strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(3)
            projection_id = f"{projection_fp[:12]}-{generation}"
            collection_name = f"{self.settings.collection_prefix}_{projection_id}".lower()
            now = isoformat(utc_now())
            projection = {
                "id": projection_id,
                "fingerprint": projection_fp,
                "generation": generation,
                "collectionName": collection_name,
                "state": "building",
                "createdAt": now,
                "buildStartedAt": now,
                "sourceSchemaFingerprint": schema_fp,
                "chunkerVersion": self.chunker.version,
                "chunkerFingerprint": self.chunker.config_fingerprint,
                "modelFingerprint": model_fp,
                "denseModel": self.embeddings.dense_model,
                "denseDimensions": self.embeddings.dense_dimensions,
                "sparseModel": self.embeddings.sparse_model,
            }
            self.state.create_projection(projection)
            self.state.update_operation(operation_id, state="running", projection_id=projection_id)
            totals = await asyncio.gather(
                *(asyncio.to_thread(self.mongo.count, adapter) for adapter in self.adapters)
            )
            self.state.reset_progress("creating_collection", sum(totals))
            await asyncio.to_thread(
                self.vectors.create_projection,
                collection_name,
                self.embeddings.dense_dimensions,
            )
            self.state.set_progress(phase="building", updatedAt=isoformat(utc_now()))
            for adapter, document_count in zip(self.adapters, totals, strict=True):
                await self._build_source(projection, adapter, document_count)

            # Second complete pass closes the rebuild window before activation.
            self.state.set_projection_state(projection_id, "catching_up")
            self.state.set_meta("state", "catching_up")
            self.state.set_progress(phase="catching_up", updatedAt=isoformat(utc_now()))
            async with self._mutation_lock:
                await self._reconcile_projection(projection, update_overall_progress=False)
                boundary_token = await self._drain_changes(projection, boundary_token)

                # Alias update is required before the SQLite pointer changes. A failed
                # alias operation leaves the old SQLite active projection untouched.
                await self._run_gate.wait()
                await asyncio.to_thread(
                    self.vectors.activate_alias,
                    collection_name,
                    f"{self.settings.collection_prefix}_active",
                )
                alias_switched = True
                # Drain once more: alias negotiation is an external call and writes may
                # land between the prior post-batch token and its completion.
                boundary_token = await self._drain_changes(projection, boundary_token)
                await self._run_gate.wait()
                checkpoint_state = "watching" if self.settings.enable_background else "disabled"
                self.state.activate_projection(
                    projection_id,
                    resume_token=boundary_token,
                    checkpoint_state=checkpoint_state,
                )
                sqlite_activated = True
            self.state.set_meta("reconcile_required_reason", "")
            self.state.set_progress(phase="idle", updatedAt=isoformat(utc_now()))
            self.state.update_operation(operation_id, state="succeeded")
            self._last_probe_errors.pop("recovery", None)
            self._last_probe_errors.pop("mongo", None)
            self._last_probe_errors.pop("compatibility", None)
        except asyncio.CancelledError:
            try:
                await rollback_alias_if_needed()
            except Exception:
                logger.exception("failed to roll back Qdrant active alias after cancellation")
            if projection_id:
                self.state.set_projection_state(
                    projection_id, "error", "index rebuild was cancelled"
                )
            active = self.state.active_projection()
            restored_state = (
                previous_state
                if active and previous_state in {"ready", "degraded", "error"}
                else ("ready" if active else ("error" if projection_id else "empty"))
            )
            self.state.set_meta("state", restored_state)
            self.state.set_progress(phase="cancelled", updatedAt=isoformat(utc_now()))
            self.state.update_operation(
                operation_id, state="cancelled", error="index rebuild was cancelled"
            )
            raise
        except Exception as error:
            logger.exception("RAG rebuild failed")
            try:
                await rollback_alias_if_needed()
            except Exception:
                logger.exception("failed to roll back Qdrant active alias")
            if projection_id:
                self.state.set_projection_state(projection_id, "error", str(error))
            self.state.set_meta("state", "degraded" if previous_active else "error")
            self.state.set_progress(
                phase="failed",
                failedSources=self.state.progress()["failedSources"] + 1,
                updatedAt=isoformat(utc_now()),
            )
            self.state.update_operation(operation_id, state="failed", error=str(error))

    async def _build_source(
        self,
        projection: dict[str, Any],
        adapter: SourceAdapter,
        document_count: int,
    ) -> None:
        indexed_documents = 0
        indexed_chunks = 0
        high_watermark: str | None = None
        for batch in self.mongo.iter_batches(adapter, self.settings.batch_size):
            await self._run_gate.wait()
            sources: list[Any] = []
            documents_with_sources: list[tuple[str, Any | None]] = []
            for document in batch:
                source_id = str(document.get("_id"))
                high_watermark = source_id
                source = adapter.adapt(document)
                documents_with_sources.append((source_id, source))
                if source:
                    sources.append(source)
            chunks_by_source = [(source, self.chunker.split(source)) for source in sources]
            flat_chunks = [chunk for _, chunks in chunks_by_source for chunk in chunks]
            await self._upsert_chunks(projection, flat_chunks)
            for _source, chunks in chunks_by_source:
                self.state.replace_source_chunks(projection["id"], chunks)
                if chunks:
                    indexed_documents += 1
                    indexed_chunks += len(chunks)
            for source_id, source in documents_with_sources:
                self.state.upsert_source_document(
                    projection["id"],
                    adapter.collection,
                    source_id,
                    source.source_hash if source else None,
                )
            current = self.state.progress()
            self.state.set_progress(
                processedSources=current["processedSources"] + len(batch),
                indexedChunks=current["indexedChunks"] + len(flat_chunks),
                updatedAt=isoformat(utc_now()),
            )
        self.state.upsert_source_status(
            projection["id"],
            adapter.kind,
            adapter.collection,
            documents=document_count,
            indexedDocuments=indexed_documents,
            chunks=indexed_chunks,
            highWatermark=high_watermark,
            error=None,
        )

    async def _upsert_chunks(self, projection: dict[str, Any], chunks: Sequence[Chunk]) -> None:
        if not chunks:
            return
        texts = [chunk.text for chunk in chunks]
        dense_future = asyncio.to_thread(self.embeddings.embed_dense, texts)
        sparse_future = asyncio.to_thread(self.embeddings.embed_sparse, texts)
        dense, sparse = await asyncio.gather(dense_future, sparse_future)
        points = [
            VectorPoint(
                point_id=chunk.point_id(projection["id"]),
                dense=dense[index],
                sparse=sparse[index],
                payload=chunk.payload(projection["id"]),
            )
            for index, chunk in enumerate(chunks)
        ]
        await asyncio.to_thread(self.vectors.upsert, projection["collectionName"], points)

    async def _reconcile(self, operation_id: str) -> None:
        previous_state = self.state.get_meta("state", "ready") or "ready"
        try:
            await self._run_gate.wait()
            projection = self.state.active_projection()
            if not projection:
                raise ProjectionNotReady("no active projection")
            compatibility_error = self._refresh_compatibility(projection)
            if compatibility_error:
                raise ProjectionNotReady(compatibility_error)
            self.state.update_operation(
                operation_id, state="running", projection_id=projection["id"]
            )
            self.state.set_meta("state", "reconciling")
            totals = await asyncio.gather(
                *(asyncio.to_thread(self.mongo.count, adapter) for adapter in self.adapters)
            )
            self.state.reset_progress("reconciling", sum(totals))
            async with self._mutation_lock:
                collections = [adapter.collection for adapter in self.adapters]
                boundary_token = await asyncio.to_thread(
                    self.mongo.capture_database_resume_token,
                    collections,
                    2_000,
                )
                await self._reconcile_projection(projection, update_overall_progress=True)
                boundary_token = await self._drain_changes(projection, boundary_token)
                self.state.persist_resume_token(
                    boundary_token,
                    checkpoint_state=(
                        "watching" if self.settings.enable_background else "disabled"
                    ),
                    lag_seconds=0 if self.settings.enable_background else None,
                    event_at=None,
                )
                self.state.set_meta("reconcile_required_reason", "")
            self.state.set_meta("state", "ready")
            self.state.set_progress(phase="idle", updatedAt=isoformat(utc_now()))
            self.state.update_operation(operation_id, state="succeeded")
            self._last_probe_errors.pop("recovery", None)
            self._last_probe_errors.pop("mongo", None)
        except asyncio.CancelledError:
            active = self.state.active_projection()
            restored_state = (
                previous_state
                if active and previous_state in {"ready", "degraded", "error"}
                else ("ready" if active else "empty")
            )
            self.state.set_meta("state", restored_state)
            self.state.set_progress(phase="cancelled", updatedAt=isoformat(utc_now()))
            self.state.update_operation(
                operation_id, state="cancelled", error="index reconcile was cancelled"
            )
            raise
        except Exception as error:
            logger.exception("RAG reconcile failed")
            self.state.set_meta("state", "degraded")
            self.state.set_progress(phase="failed", updatedAt=isoformat(utc_now()))
            self.state.update_operation(operation_id, state="failed", error=str(error))

    async def _reconcile_projection(
        self, projection: dict[str, Any], *, update_overall_progress: bool
    ) -> None:
        for adapter in self.adapters:
            await self._run_gate.wait()
            existing = self.state.source_ids(projection["id"], adapter.collection)
            document_count = 0
            high_watermark: str | None = None
            for batch in self.mongo.iter_batches(adapter, self.settings.batch_size):
                await self._run_gate.wait()
                for document in batch:
                    document_count += 1
                    source_id = str(document.get("_id"))
                    high_watermark = source_id
                    was_present = source_id in existing
                    existing.discard(source_id)
                    source = adapter.adapt(document)
                    chunks = self.chunker.split(source) if source else []
                    expected = [chunk.content_hash for chunk in chunks]
                    current = self.state.source_chunk_hashes(
                        projection["id"], adapter.collection, source_id
                    )
                    current_source_hash = self.state.source_hash(
                        projection["id"], adapter.collection, source_id
                    )
                    expected_source_hash = source.source_hash if source else None
                    if (
                        was_present
                        and current == expected
                        and current_source_hash == expected_source_hash
                    ):
                        continue
                    deleted = await asyncio.to_thread(
                        self.vectors.delete_source,
                        projection["collectionName"],
                        adapter.collection,
                        source_id,
                    )
                    self.state.delete_source_chunks(projection["id"], adapter.collection, source_id)
                    if chunks:
                        await self._upsert_chunks(projection, chunks)
                        self.state.replace_source_chunks(projection["id"], chunks)
                    self.state.upsert_source_document(
                        projection["id"],
                        adapter.collection,
                        source_id,
                        expected_source_hash,
                    )
                    progress = self.state.progress()
                    self.state.set_progress(
                        indexedChunks=progress["indexedChunks"] + len(chunks),
                        deletedChunks=progress["deletedChunks"] + deleted,
                        updatedAt=isoformat(utc_now()),
                    )
                if update_overall_progress:
                    progress = self.state.progress()
                    self.state.set_progress(
                        processedSources=progress["processedSources"] + len(batch),
                        updatedAt=isoformat(utc_now()),
                    )
            for stale_id in existing:
                deleted = await asyncio.to_thread(
                    self.vectors.delete_source,
                    projection["collectionName"],
                    adapter.collection,
                    stale_id,
                )
                self.state.delete_source_chunks(projection["id"], adapter.collection, stale_id)
                self.state.delete_source_document(projection["id"], adapter.collection, stale_id)
                progress = self.state.progress()
                self.state.set_progress(
                    deletedChunks=progress["deletedChunks"] + deleted,
                    updatedAt=isoformat(utc_now()),
                )
            chunks, indexed_documents = self.state.chunk_counts(
                projection["id"], adapter.collection
            )
            self.state.upsert_source_status(
                projection["id"],
                adapter.kind,
                adapter.collection,
                documents=document_count,
                indexedDocuments=indexed_documents,
                chunks=chunks,
                highWatermark=high_watermark,
                lastReconciledAt=isoformat(utc_now()),
                lagSeconds=0 if self.settings.enable_background else None,
                error=None,
            )

    async def _change_stream_loop(self) -> None:
        collections = [adapter.collection for adapter in self.adapters]
        while not self._stop.is_set():
            await self._run_gate.wait()
            active = self.state.active_projection()
            if not active:
                await asyncio.sleep(self.settings.change_stream_retry_seconds)
                continue
            compatibility_error = self._refresh_compatibility(active)
            if compatibility_error:
                self._mark_change_stream_error(collections, compatibility_error)
                await asyncio.sleep(self.settings.change_stream_retry_seconds)
                continue
            required_reason = self.state.get_meta("reconcile_required_reason")
            if required_reason:
                await self._request_reconcile_from_background(required_reason)
                await asyncio.sleep(self.settings.change_stream_retry_seconds)
                continue
            try:
                async with self._mutation_lock:
                    raw_token = self.state.get_meta("database_resume_token")
                    resume_token = json.loads(raw_token) if raw_token else None
                    event, next_token = await asyncio.to_thread(
                        self.mongo.poll_database_change,
                        collections,
                        resume_token,
                        2_000,
                    )
                    if event:
                        operation = str(event.get("operationType", ""))
                        if operation not in {"insert", "update", "replace", "delete"}:
                            reason = (
                                f"MongoDB structural change '{operation or 'unknown'}' "
                                "requires correctness reconcile"
                            )
                            token = (
                                None
                                if operation in {"invalidate", "dropDatabase"}
                                else (next_token or event.get("_id"))
                            )
                            self.state.mark_reconcile_required(token, reason=reason)
                            await self._request_reconcile_from_background(reason)
                            continue
                        projection = self.state.active_projection()
                        if projection:
                            lag, event_at = await self._apply_change_to_projection(
                                event, projection
                            )
                            if next_token:
                                self.state.persist_resume_token(
                                    next_token,
                                    checkpoint_state="watching",
                                    lag_seconds=lag,
                                    event_at=event_at,
                                )
                    elif next_token:
                        # Persist post-batch tokens even when no tracked document
                        # changed. Otherwise unrelated oplog traffic can age the
                        # last event token out while this projection is fully caught up.
                        self.state.persist_resume_token(
                            next_token,
                            checkpoint_state="watching",
                            lag_seconds=0,
                            event_at=None,
                        )
                self._last_probe_errors.pop("changeStream", None)
                self._last_probe_errors.pop("mongo", None)
            except asyncio.CancelledError:
                raise
            except OperationFailure as error:
                history_lost = error.code in {136, 237, 280, 286}
                message = (
                    f"change stream history unavailable: {error}" if history_lost else str(error)
                )
                self._mark_change_stream_error(collections, message)
                if history_lost:
                    self.state.set_meta("database_resume_token", "")
                    await self._request_reconcile_from_background("change stream history lost")
                await asyncio.sleep(self.settings.change_stream_retry_seconds)
            except Exception as error:
                self._mark_change_stream_error(collections, str(error))
                await asyncio.sleep(self.settings.change_stream_retry_seconds)

    def _mark_change_stream_error(self, collections: Sequence[str], message: str) -> None:
        self._last_probe_errors["changeStream"] = message
        for collection in collections:
            self.state.update_checkpoint(collection, state="retrying", error=message)
        if self.state.active_projection() and self.state.get_meta("state") == "ready":
            self.state.set_meta("state", "degraded")

    async def _request_reconcile_from_background(self, reason: str) -> None:
        try:
            self.request_reconcile(reason)
        except (OperationConflict, ProjectionNotReady):
            return

    async def _drain_changes(
        self, projection: dict[str, Any], resume_token: dict[str, Any]
    ) -> dict[str, Any]:
        collections = [adapter.collection for adapter in self.adapters]
        token = resume_token
        while True:
            await self._run_gate.wait()
            event, next_token = await asyncio.to_thread(
                self.mongo.poll_database_change,
                collections,
                token,
                100,
            )
            if next_token:
                token = next_token
            if not event:
                return token
            await self._apply_change_to_projection(event, projection)

    async def _apply_change(self, event: dict[str, Any]) -> None:
        async with self._mutation_lock:
            projection = self.state.active_projection()
            if not projection:
                return
            compatibility_error = self._refresh_compatibility(projection)
            if compatibility_error:
                raise ProjectionNotReady(compatibility_error)
            lag, event_at = await self._apply_change_to_projection(event, projection)
            if event.get("_id"):
                self.state.persist_resume_token(
                    event["_id"],
                    checkpoint_state=(
                        "watching" if self.settings.enable_background else "disabled"
                    ),
                    lag_seconds=lag if self.settings.enable_background else None,
                    event_at=event_at,
                )

    async def _apply_change_to_projection(
        self,
        event: dict[str, Any],
        projection: dict[str, Any],
    ) -> tuple[float, str]:
        collection = str(event.get("ns", {}).get("coll", ""))
        adapter = ADAPTER_BY_COLLECTION.get(collection)
        if not adapter:
            return 0.0, isoformat(utc_now()) or ""
        document_key = event.get("documentKey", {}).get("_id")
        if document_key is None:
            raise ValueError("change event has no documentKey._id")
        source_id = str(document_key)
        operation = event.get("operationType")
        document = None
        if operation != "delete":
            document = await asyncio.to_thread(self.mongo.get_document, adapter, document_key)
        source = adapter.adapt(document) if document else None
        chunks = self.chunker.split(source) if source else []

        deleted = await asyncio.to_thread(
            self.vectors.delete_source,
            projection["collectionName"],
            collection,
            source_id,
        )
        self.state.delete_source_chunks(projection["id"], collection, source_id)
        if chunks:
            await self._upsert_chunks(projection, chunks)
            self.state.replace_source_chunks(projection["id"], chunks)
        if document is not None:
            self.state.upsert_source_document(
                projection["id"],
                collection,
                source_id,
                source.source_hash if source else None,
            )
        else:
            self.state.delete_source_document(projection["id"], collection, source_id)

        cluster_time = event.get("wallTime")
        event_at = cluster_time if isinstance(cluster_time, datetime) else utc_now()
        if event_at.tzinfo is None:
            event_at = event_at.replace(tzinfo=UTC)
        lag = max(0.0, (utc_now() - event_at.astimezone(UTC)).total_seconds())
        chunks_count, indexed_documents = self.state.chunk_counts(projection["id"], collection)
        document_count = self.state.source_document_count(projection["id"], collection)
        self.state.upsert_source_status(
            projection["id"],
            adapter.kind,
            collection,
            documents=document_count,
            indexedDocuments=indexed_documents,
            chunks=chunks_count,
            highWatermark=source_id,
            lagSeconds=lag if self.settings.enable_background else None,
            error=None,
        )
        logger.debug(
            "applied RAG change %s/%s (deleted=%s, inserted=%s)",
            collection,
            source_id,
            deleted,
            len(chunks),
        )
        return lag, isoformat(event_at) or ""

    async def _periodic_reconcile_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self.settings.reconcile_interval_seconds
                )
                return
            except TimeoutError:
                pass
            await self._run_gate.wait()
            try:
                self.request_reconcile("periodic correctness reconcile")
            except (OperationConflict, ProjectionNotReady):
                continue

    async def ready(self) -> tuple[bool, str | None]:
        if self.settings.require_readonly_mongo and (
            "mongo" in self._last_probe_errors or "mongoReadonly" in self._last_probe_errors
        ):
            return False, None
        projection = self.state.active_projection()
        if not projection:
            return False, None
        if self._refresh_compatibility(projection):
            return False, None
        try:
            exists = await asyncio.to_thread(
                self.vectors.has_projection, projection["collectionName"]
            )
            if not exists:
                self._last_probe_errors["projection"] = "active Qdrant collection is missing"
                self.state.set_meta("state", "error")
                return False, None
            await asyncio.to_thread(
                self.vectors.activate_alias,
                projection["collectionName"],
                f"{self.settings.collection_prefix}_active",
            )
            self._last_probe_errors.pop("qdrant", None)
            self._last_probe_errors.pop("projection", None)
            self._last_probe_errors.pop("alias", None)
            self._restore_ready_after_dependency_recovery(projection)
            return True, projection["id"]
        except Exception as error:
            self._last_probe_errors["qdrant"] = str(error)
            self._last_probe_errors["projection"] = (
                f"could not verify active Qdrant collection: {error}"
            )
            if self.state.get_meta("state") == "ready":
                self.state.set_meta("state", "degraded")
            return False, None

    async def search(
        self,
        *,
        query: str,
        mode: SearchMode,
        kinds: Sequence[str] | None,
        start: datetime | None,
        end: datetime | None,
        limit: int,
        min_score: float | None,
    ) -> dict[str, Any]:
        started = time.perf_counter()
        projection = self.state.active_projection()
        if not projection:
            raise ProjectionNotReady("no active projection; run rebuild first")
        compatibility_error = self._refresh_compatibility(projection)
        if compatibility_error:
            raise ProjectionNotReady(compatibility_error)
        dense: list[float] | None = None
        sparse = None
        if mode in {"hybrid", "semantic"}:
            dense = (await asyncio.to_thread(self.embeddings.embed_dense, [query]))[0]
        if mode in {"hybrid", "lexical"}:
            sparse = (await asyncio.to_thread(self.embeddings.embed_sparse, [query]))[0]
        hits = await asyncio.to_thread(
            self.vectors.search,
            projection["collectionName"],
            mode,
            dense,
            sparse,
            kinds,
            start,
            end,
            limit,
            min_score,
        )
        warnings = self._warnings()
        lifecycle_state = self.state.get_meta("state", "empty")
        if lifecycle_state in {"degraded", "error"}:
            latest = self.state.latest_operation()
            detail = latest.get("error") if latest else None
            warnings.append(detail or f"index lifecycle is {lifecycle_state}")
        raw_lag = self.state.get_meta("database_resume_lag_seconds")
        try:
            lag_seconds = float(raw_lag) if raw_lag and self.settings.enable_background else None
        except ValueError:
            lag_seconds = None
        return {
            "projectionId": projection["id"],
            "mode": mode,
            "tookMs": round((time.perf_counter() - started) * 1_000, 2),
            "degraded": bool(warnings),
            "warnings": warnings,
            "freshness": {
                "lifecycleState": "paused" if self.state.paused else lifecycle_state,
                "checkpointState": self._checkpoint_state(),
                "checkpointAt": self.state.get_meta("database_resume_updated_at"),
                "lagSeconds": lag_seconds,
                "paused": self.state.paused,
            },
            "results": [self._search_result(hit, include_score=True) for hit in hits],
        }

    async def list_chunks(
        self, *, kind: str | None, source_id: str | None, limit: int, offset: int
    ) -> dict[str, Any]:
        projection = self.state.active_projection()
        if not projection:
            raise ProjectionNotReady("no active projection; run rebuild first")
        total, hits = await asyncio.to_thread(
            self.vectors.list_chunks,
            projection["collectionName"],
            kind,
            source_id,
            limit,
            offset,
        )
        return {
            "projectionId": projection["id"],
            "total": total,
            "limit": limit,
            "offset": offset,
            "items": [self._search_result(hit, include_score=False) for hit in hits],
        }

    @staticmethod
    def _search_result(hit: Any, *, include_score: bool) -> dict[str, Any]:
        payload = hit.payload
        result = {
            "pointId": hit.point_id,
            "text": payload.get("text", ""),
            "source": payload.get("source", {}),
            "chunk": {
                "index": payload.get("chunk", {}).get("index", 0),
                "contentHash": payload.get("chunk", {}).get("content_hash", ""),
            },
        }
        if include_score:
            result["score"] = hit.score
        return result

    def _warnings(self) -> list[str]:
        warnings = [f"{name}: {message}" for name, message in self._last_probe_errors.items()]
        if not self.settings.enable_background:
            warnings.append(
                "continuous updates are disabled; freshness depends on manual reconcile"
            )
        if self.state.paused:
            warnings.append("index updates are paused")
        for adapter in self.adapters:
            checkpoint = self.state.checkpoint(adapter.collection)
            if checkpoint and checkpoint["state"] in {"retrying", "error"}:
                warning = checkpoint["error"] or "change stream is not watching"
                warnings.append(f"{adapter.collection}: {warning}")
        return sorted(set(warnings))

    def _checkpoint_state(self) -> str:
        if not self.settings.enable_background:
            return "disabled"
        states = {
            checkpoint["state"]
            for adapter in self.adapters
            if (checkpoint := self.state.checkpoint(adapter.collection)) is not None
        }
        if "error" in states:
            return "error"
        if "retrying" in states or not states:
            return "retrying"
        return "watching"

    async def status(self) -> dict[str, Any]:
        active = self.state.active_projection()
        if active:
            self._refresh_compatibility(active)
        latest = self.state.latest_projection()
        candidate = latest if latest and (not active or latest["id"] != active["id"]) else None
        displayed = active or latest
        qdrant = {
            "reachable": False,
            "collection": active["collectionName"] if active else None,
            "pointsCount": None,
            "indexedVectorsCount": None,
            "status": None,
            "error": None,
            "capabilities": {
                "dense": True,
                "sparse": True,
                "hybridRrf": True,
                "filters": True,
            },
        }
        try:
            await asyncio.to_thread(self.vectors.health)
            qdrant["reachable"] = True
            if active:
                qdrant.update(
                    await asyncio.to_thread(self.vectors.projection_stats, active["collectionName"])
                )
            self._last_probe_errors.pop("qdrant", None)
        except Exception as error:
            qdrant["error"] = str(error)
            self._last_probe_errors["qdrant"] = str(error)

        source_rows = {
            row["collection"]: row
            for row in self.state.source_statuses(displayed["id"] if displayed else "")
        }
        sources = []
        for adapter in self.adapters:
            row = source_rows.get(adapter.collection) or {
                "kind": adapter.kind,
                "collection": adapter.collection,
                "documents": 0,
                "indexedDocuments": 0,
                "chunks": 0,
                "highWatermark": None,
                "lastReconciledAt": None,
                "lagSeconds": None,
                "error": None,
            }
            checkpoint = self.state.checkpoint(adapter.collection)
            row["changeStream"] = {
                "state": checkpoint["state"] if checkpoint else "disabled",
                "resumeTokenPresent": bool(checkpoint and checkpoint["resumeToken"]),
                "updatedAt": checkpoint["updatedAt"] if checkpoint else None,
                "lagSeconds": checkpoint["lagSeconds"] if checkpoint else None,
                "error": checkpoint["error"] if checkpoint else None,
            }
            sources.append(row)
        warnings = self._warnings()
        state = "paused" if self.state.paused else self.state.get_meta("state", "empty")
        return {
            "state": state,
            "paused": self.state.paused,
            "degraded": bool(warnings) or state in {"degraded", "error"},
            "authMode": self.settings.auth_mode,
            "activeProjectionId": active["id"] if active else None,
            "projection": active or latest,
            "candidateProjection": candidate,
            "operation": self.state.latest_operation(),
            "progress": self.state.progress(),
            "sources": sources,
            "qdrant": qdrant,
            "warnings": warnings,
        }
