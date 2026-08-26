from __future__ import annotations

import math
from collections.abc import Iterator, Sequence
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from mycelia_rag.domain import ExactSource, SearchHit, SearchMode, SparseEmbedding, VectorPoint
from mycelia_rag.sources import SourceAdapter


class FakeMongoSource:
    def __init__(self, documents: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self.documents = deepcopy(documents or {})
        self.change_events: list[dict[str, Any]] = []
        self.resume_token: dict[str, Any] = {"_data": "fake-boundary"}

    def ping(self) -> dict[str, Any]:
        return {"reachable": True}

    def verify_readonly(self) -> None:
        return None

    def count(self, adapter: SourceAdapter) -> int:
        return len(self._matching(adapter))

    def iter_batches(
        self, adapter: SourceAdapter, batch_size: int
    ) -> Iterator[list[dict[str, Any]]]:
        values = sorted(self._matching(adapter), key=lambda item: str(item["_id"]))
        for index in range(0, len(values), batch_size):
            yield deepcopy(values[index : index + batch_size])

    def _matching(self, adapter: SourceAdapter) -> list[dict[str, Any]]:
        values = self.documents.get(adapter.collection, [])
        if adapter.mongo_filter == {"active": {"$ne": False}}:
            return [value for value in values if value.get("active") is not False]
        return list(values)

    def get_document(self, adapter: SourceAdapter, source_id: Any) -> dict[str, Any] | None:
        for value in self._matching(adapter):
            if value["_id"] == source_id or str(value["_id"]) == str(source_id):
                return deepcopy(value)
        return None

    def get_documents(
        self, adapter: SourceAdapter, source_ids: Sequence[str]
    ) -> dict[str, dict[str, Any]]:
        requested = set(source_ids)
        return {
            str(value["_id"]): deepcopy(value)
            for value in self._matching(adapter)
            if str(value["_id"]) in requested
        }

    def poll_database_change(
        self,
        collections: Sequence[str],
        resume_token: dict[str, Any] | None,
        max_await_time_ms: int = 2_000,
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        del collections, resume_token, max_await_time_ms
        if self.change_events:
            event = self.change_events.pop(0)
            self.resume_token = event["_id"]
            return deepcopy(event), deepcopy(self.resume_token)
        return None, deepcopy(self.resume_token)

    def capture_database_resume_token(
        self, collections: Sequence[str], max_await_time_ms: int = 2_000
    ) -> dict[str, Any]:
        del collections, max_await_time_ms
        return deepcopy(self.resume_token)

    def enqueue_change(self, event: dict[str, Any]) -> None:
        self.change_events.append(deepcopy(event))

    def replace(self, collection: str, source_id: str, document: dict[str, Any]) -> None:
        values = self.documents.setdefault(collection, [])
        for index, value in enumerate(values):
            if str(value["_id"]) == source_id:
                values[index] = deepcopy(document)
                return
        values.append(deepcopy(document))

    def delete(self, collection: str, source_id: str) -> None:
        self.documents[collection] = [
            value for value in self.documents.get(collection, []) if str(value["_id"]) != source_id
        ]


class FakeVectorStore:
    def __init__(self) -> None:
        self.collections: dict[str, dict[str, VectorPoint]] = {}
        self.aliases: dict[str, str] = {}
        self.fail_next_create = False
        self.fail_next_alias = False
        self.before_alias = None

    def health(self) -> dict[str, Any]:
        return {"reachable": True, "collections": len(self.collections)}

    def has_projection(self, collection_name: str) -> bool:
        return collection_name in self.collections

    def create_projection(self, collection_name: str, dense_dimensions: int) -> None:
        del dense_dimensions
        if self.fail_next_create:
            self.fail_next_create = False
            raise RuntimeError("injected collection failure")
        if collection_name in self.collections:
            raise RuntimeError("collection already exists")
        self.collections[collection_name] = {}

    def activate_alias(self, collection_name: str, alias_name: str) -> None:
        if self.before_alias:
            callback, self.before_alias = self.before_alias, None
            callback()
        if self.fail_next_alias:
            self.fail_next_alias = False
            raise RuntimeError("injected alias failure")
        self.aliases[alias_name] = collection_name

    def deactivate_alias(self, alias_name: str) -> None:
        self.aliases.pop(alias_name, None)

    def projection_stats(self, collection_name: str) -> dict[str, Any]:
        count = len(self.collections[collection_name])
        return {
            "collection": collection_name,
            "pointsCount": count,
            "indexedVectorsCount": count,
            "status": "green",
        }

    def upsert(self, collection_name: str, points: Sequence[VectorPoint]) -> None:
        target = self.collections[collection_name]
        for point in points:
            target[point.point_id] = point

    def delete_source(self, collection_name: str, collection: str, source_id: str) -> int:
        target = self.collections[collection_name]
        deleted = [
            point_id
            for point_id, point in target.items()
            if point.payload["source"]["collection"] == collection
            and point.payload["source"]["id"] == source_id
        ]
        for point_id in deleted:
            del target[point_id]
        return len(deleted)

    @staticmethod
    def _dot(left: Sequence[float], right: Sequence[float]) -> float:
        return sum(a * b for a, b in zip(left, right, strict=True))

    @staticmethod
    def _sparse_dot(left: SparseEmbedding, right: SparseEmbedding) -> float:
        right_values = dict(zip(right.indices, right.values, strict=True))
        return sum(
            value * right_values.get(index, 0)
            for index, value in zip(left.indices, left.values, strict=True)
        )

    @staticmethod
    def _matches(
        point: VectorPoint,
        kinds: Sequence[str] | None,
        start: datetime | None,
        end: datetime | None,
        platforms: Sequence[str] | None = None,
        sender_ids: Sequence[str] | None = None,
        sources: Sequence[ExactSource] | None = None,
    ) -> bool:
        payload = point.payload
        if kinds and payload["source"]["kind"] not in kinds:
            return False
        if platforms and payload["source"].get("platform") not in platforms:
            return False
        if sender_ids and payload["source"].get("sender_id") not in sender_ids:
            return False
        if (
            sources
            and (
                payload["source"]["collection"],
                payload["source"]["id"],
            )
            not in sources
        ):
            return False
        if start:
            start_value = start if start.tzinfo else start.replace(tzinfo=UTC)
            if payload.get("end_ts") is None or payload["end_ts"] < start_value.timestamp():
                return False
        if end:
            end_value = end if end.tzinfo else end.replace(tzinfo=UTC)
            if payload.get("start_ts") is None or payload["start_ts"] > end_value.timestamp():
                return False
        return True

    def search(
        self,
        collection_name: str,
        mode: SearchMode,
        dense: list[float] | None,
        sparse: SparseEmbedding | None,
        kinds: Sequence[str] | None,
        start: datetime | None,
        end: datetime | None,
        limit: int,
        min_score: float | None,
        platforms: Sequence[str] | None = None,
        sender_ids: Sequence[str] | None = None,
        sources: Sequence[ExactSource] | None = None,
    ) -> list[SearchHit]:
        points = [
            point
            for point in self.collections[collection_name].values()
            if self._matches(point, kinds, start, end, platforms, sender_ids, sources)
        ]
        dense_scores = {
            point.point_id: self._dot(dense, point.dense) if dense is not None else 0.0
            for point in points
        }
        sparse_scores = {
            point.point_id: self._sparse_dot(sparse, point.sparse) if sparse is not None else 0.0
            for point in points
        }
        if mode == "semantic":
            scores = dense_scores
        elif mode == "lexical":
            scores = sparse_scores
        else:
            dense_rank = {
                point_id: rank
                for rank, (point_id, _) in enumerate(
                    sorted(dense_scores.items(), key=lambda item: item[1], reverse=True), start=1
                )
            }
            sparse_rank = {
                point_id: rank
                for rank, (point_id, _) in enumerate(
                    sorted(sparse_scores.items(), key=lambda item: item[1], reverse=True), start=1
                )
            }
            scores = {
                point.point_id: 1 / (60 + dense_rank[point.point_id])
                + 1 / (60 + sparse_rank[point.point_id])
                for point in points
            }
        selected = sorted(points, key=lambda point: scores[point.point_id], reverse=True)
        return [
            SearchHit(point.point_id, scores[point.point_id], point.payload)
            for point in selected
            if min_score is None or scores[point.point_id] >= min_score
        ][:limit]

    def list_chunks(
        self,
        collection_name: str,
        kind: str | None,
        source_id: str | None,
        limit: int,
        offset: int,
    ) -> tuple[int, list[SearchHit]]:
        points = sorted(
            self.collections[collection_name].values(),
            key=lambda point: (
                point.payload["source"]["collection"],
                point.payload["source"]["id"],
                point.payload["chunk"]["index"],
            ),
        )
        points = [
            point
            for point in points
            if (not kind or point.payload["source"]["kind"] == kind)
            and (not source_id or point.payload["source"]["id"] == source_id)
        ]
        return len(points), [
            SearchHit(point.point_id, 0.0, point.payload)
            for point in points[offset : offset + limit]
        ]


def cosine(left: Sequence[float], right: Sequence[float]) -> float:
    denominator = math.sqrt(sum(value * value for value in left)) * math.sqrt(
        sum(value * value for value in right)
    )
    return sum(a * b for a, b in zip(left, right, strict=True)) / (denominator or 1)
