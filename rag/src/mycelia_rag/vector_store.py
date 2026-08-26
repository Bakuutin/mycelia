from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from qdrant_client import QdrantClient, models

from .domain import ExactSource, SearchHit, SearchMode, SparseEmbedding, VectorPoint

DENSE_VECTOR = "dense"
SPARSE_VECTOR = "bm25"


class QdrantVectorStore:
    def __init__(
        self,
        url: str,
        *,
        api_key: str | None = None,
        timeout: float = 30,
    ) -> None:
        self.client = QdrantClient(url=url, api_key=api_key, timeout=timeout)

    def health(self) -> dict[str, Any]:
        collections = self.client.get_collections().collections
        return {"reachable": True, "collections": len(collections)}

    def has_projection(self, collection_name: str) -> bool:
        return self.client.collection_exists(collection_name)

    def create_projection(self, collection_name: str, dense_dimensions: int) -> None:
        self.client.create_collection(
            collection_name=collection_name,
            vectors_config={
                DENSE_VECTOR: models.VectorParams(
                    size=dense_dimensions,
                    distance=models.Distance.COSINE,
                )
            },
            sparse_vectors_config={
                SPARSE_VECTOR: models.SparseVectorParams(modifier=models.Modifier.IDF)
            },
        )
        for field, schema in (
            ("source.kind", models.PayloadSchemaType.KEYWORD),
            ("source.collection", models.PayloadSchemaType.KEYWORD),
            ("source.id", models.PayloadSchemaType.KEYWORD),
            ("source.platform", models.PayloadSchemaType.KEYWORD),
            ("source.sender_id", models.PayloadSchemaType.KEYWORD),
            ("source_key", models.PayloadSchemaType.KEYWORD),
            ("evidence_group", models.PayloadSchemaType.KEYWORD),
            ("start_ts", models.PayloadSchemaType.FLOAT),
            ("end_ts", models.PayloadSchemaType.FLOAT),
        ):
            self.client.create_payload_index(
                collection_name=collection_name,
                field_name=field,
                field_schema=schema,
                wait=True,
            )

    def activate_alias(self, collection_name: str, alias_name: str) -> None:
        aliases = {alias.alias_name for alias in self.client.get_aliases().aliases}
        operations: list[Any] = []
        if alias_name in aliases:
            operations.append(
                models.DeleteAliasOperation(delete_alias=models.DeleteAlias(alias_name=alias_name))
            )
        operations.append(
            models.CreateAliasOperation(
                create_alias=models.CreateAlias(
                    collection_name=collection_name,
                    alias_name=alias_name,
                )
            )
        )
        self.client.update_collection_aliases(change_aliases_operations=operations)

    def deactivate_alias(self, alias_name: str) -> None:
        aliases = {alias.alias_name for alias in self.client.get_aliases().aliases}
        if alias_name not in aliases:
            return
        self.client.update_collection_aliases(
            change_aliases_operations=[
                models.DeleteAliasOperation(delete_alias=models.DeleteAlias(alias_name=alias_name))
            ]
        )

    def projection_stats(self, collection_name: str) -> dict[str, Any]:
        info = self.client.get_collection(collection_name)
        status = getattr(info.status, "value", info.status)
        return {
            "collection": collection_name,
            "pointsCount": info.points_count,
            "indexedVectorsCount": info.indexed_vectors_count,
            "status": str(status),
        }

    def upsert(self, collection_name: str, points: Sequence[VectorPoint]) -> None:
        if not points:
            return
        self.client.upsert(
            collection_name=collection_name,
            wait=True,
            points=[
                models.PointStruct(
                    id=point.point_id,
                    vector={
                        DENSE_VECTOR: point.dense,
                        SPARSE_VECTOR: models.SparseVector(
                            indices=point.sparse.indices,
                            values=point.sparse.values,
                        ),
                    },
                    payload=point.payload,
                )
                for point in points
            ],
        )

    @staticmethod
    def _source_filter(collection: str, source_id: str) -> models.Filter:
        return models.Filter(
            must=[
                models.FieldCondition(
                    key="source.collection", match=models.MatchValue(value=collection)
                ),
                models.FieldCondition(key="source.id", match=models.MatchValue(value=source_id)),
            ]
        )

    def delete_source(self, collection_name: str, collection: str, source_id: str) -> int:
        query_filter = self._source_filter(collection, source_id)
        count = self.client.count(
            collection_name=collection_name,
            count_filter=query_filter,
            exact=True,
        ).count
        self.client.delete(
            collection_name=collection_name,
            points_selector=models.FilterSelector(filter=query_filter),
            wait=True,
        )
        return count

    @staticmethod
    def _filter(
        kinds: Sequence[str] | None,
        start: datetime | None,
        end: datetime | None,
        *,
        source_id: str | None = None,
        platforms: Sequence[str] | None = None,
        sender_ids: Sequence[str] | None = None,
        sources: Sequence[ExactSource] | None = None,
    ) -> models.Filter | None:
        must: list[models.Condition] = []
        if kinds:
            must.append(
                models.FieldCondition(key="source.kind", match=models.MatchAny(any=list(kinds)))
            )
        if source_id:
            must.append(
                models.FieldCondition(key="source.id", match=models.MatchValue(value=source_id))
            )
        if platforms:
            must.append(
                models.FieldCondition(
                    key="source.platform", match=models.MatchAny(any=list(platforms))
                )
            )
        if sender_ids:
            must.append(
                models.FieldCondition(
                    key="source.sender_id", match=models.MatchAny(any=list(sender_ids))
                )
            )
        if sources:
            must.append(
                models.FieldCondition(
                    key="source_key",
                    match=models.MatchAny(
                        any=[f"{collection}:{source_id}" for collection, source_id in sources]
                    ),
                )
            )
        # Overlap semantics: source.end >= requested start, source.start <= requested end.
        if start:
            value = start.replace(tzinfo=UTC) if start.tzinfo is None else start
            must.append(
                models.FieldCondition(key="end_ts", range=models.Range(gte=value.timestamp()))
            )
        if end:
            value = end.replace(tzinfo=UTC) if end.tzinfo is None else end
            must.append(
                models.FieldCondition(key="start_ts", range=models.Range(lte=value.timestamp()))
            )
        return models.Filter(must=must) if must else None

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
        query_filter = self._filter(
            kinds,
            start,
            end,
            platforms=platforms,
            sender_ids=sender_ids,
            sources=sources,
        )
        common = {
            "collection_name": collection_name,
            "query_filter": query_filter,
            "limit": limit,
            "score_threshold": min_score,
            "with_payload": True,
        }
        if mode == "hybrid":
            if dense is None or sparse is None:
                raise ValueError("hybrid search requires dense and sparse query embeddings")
            response = self.client.query_points(
                **common,
                prefetch=[
                    models.Prefetch(query=dense, using=DENSE_VECTOR, limit=max(limit * 4, 50)),
                    models.Prefetch(
                        query=models.SparseVector(
                            indices=sparse.indices,
                            values=sparse.values,
                        ),
                        using=SPARSE_VECTOR,
                        limit=max(limit * 4, 50),
                    ),
                ],
                query=models.FusionQuery(fusion=models.Fusion.RRF),
            )
        elif mode == "semantic":
            if dense is None:
                raise ValueError("semantic search requires a dense query embedding")
            response = self.client.query_points(**common, query=dense, using=DENSE_VECTOR)
        else:
            if sparse is None:
                raise ValueError("lexical search requires a sparse query embedding")
            response = self.client.query_points(
                **common,
                query=models.SparseVector(indices=sparse.indices, values=sparse.values),
                using=SPARSE_VECTOR,
            )
        return [
            SearchHit(point_id=str(point.id), score=float(point.score), payload=point.payload or {})
            for point in response.points
        ]

    def list_chunks(
        self,
        collection_name: str,
        kind: str | None,
        source_id: str | None,
        limit: int,
        offset: int,
    ) -> tuple[int, list[SearchHit]]:
        query_filter = self._filter([kind] if kind else None, None, None, source_id=source_id)
        total = self.client.count(
            collection_name=collection_name,
            count_filter=query_filter,
            exact=True,
        ).count
        points, _ = self.client.scroll(
            collection_name=collection_name,
            scroll_filter=query_filter,
            limit=offset + limit,
            with_payload=True,
            with_vectors=False,
        )
        selected = points[offset : offset + limit]
        return total, [
            SearchHit(point_id=str(point.id), score=0.0, payload=point.payload or {})
            for point in selected
        ]
