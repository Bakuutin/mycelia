from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

SearchMode = Literal["hybrid", "semantic", "lexical"]
ProjectionState = Literal["building", "catching_up", "ready", "superseded", "error"]
OperationType = Literal["rebuild", "reconcile"]

SOURCE_KINDS = (
    "transcription",
    "message",
    "object",
    "media_visual_description",
)


def utc_now() -> datetime:
    return datetime.now(UTC)


def isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class CanonicalSource:
    kind: str
    collection: str
    source_id: str
    uri: str
    text: str
    title: str | None = None
    start: datetime | None = None
    end: datetime | None = None
    updated_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def source_hash(self) -> str:
        return fingerprint(
            {
                "kind": self.kind,
                "collection": self.collection,
                "id": self.source_id,
                "uri": self.uri,
                "text": self.text,
                "title": self.title,
                "start": isoformat(self.start),
                "end": isoformat(self.end),
                "metadata": self.metadata,
            }
        )


@dataclass(frozen=True, slots=True)
class Chunk:
    source: CanonicalSource
    index: int
    text: str
    content_hash: str

    def point_id(self, projection_id: str) -> str:
        key = (
            f"{projection_id}:{self.source.collection}:{self.source.source_id}:"
            f"{self.index}:{self.content_hash}"
        )
        return str(uuid.uuid5(uuid.NAMESPACE_URL, key))

    def payload(self, projection_id: str) -> dict[str, Any]:
        start = isoformat(self.source.start)
        end = isoformat(self.source.end)
        # Date filters use interval-overlap semantics. A source with only one
        # boundary is a point-in-time fact, while the public source fields stay
        # faithful to Mongo and keep the missing boundary as null.
        effective_start = self.source.start or self.source.end
        effective_end = self.source.end or self.source.start
        return {
            "projection_id": projection_id,
            "text": self.text,
            "source": {
                "kind": self.source.kind,
                "collection": self.source.collection,
                "id": self.source.source_id,
                "uri": self.source.uri,
                "title": self.source.title,
                "start": start,
                "end": end,
            },
            "chunk": {"index": self.index, "content_hash": self.content_hash},
            "source_key": f"{self.source.collection}:{self.source.source_id}",
            "start_ts": _timestamp(effective_start),
            "end_ts": _timestamp(effective_end),
        }


def _timestamp(value: datetime | None) -> float | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.timestamp()


class Chunker:
    version = "char-boundary-v1"

    def __init__(self, size: int = 1_200, overlap: int = 160) -> None:
        if size < 1 or overlap < 0 or overlap >= size:
            raise ValueError("invalid chunk size/overlap")
        self.size = size
        self.overlap = overlap

    @property
    def config_fingerprint(self) -> str:
        return fingerprint({"version": self.version, "size": self.size, "overlap": self.overlap})

    def split(self, source: CanonicalSource) -> list[Chunk]:
        text = re.sub(r"[\t\f\v ]+", " ", source.text).strip()
        if not text:
            return []
        chunks: list[Chunk] = []
        start = 0
        while start < len(text):
            hard_end = min(len(text), start + self.size)
            end = hard_end
            if hard_end < len(text):
                floor = start + int(self.size * 0.6)
                boundaries = [text.rfind("\n", floor, hard_end), text.rfind(" ", floor, hard_end)]
                boundary = max(boundaries)
                if boundary > start:
                    end = boundary
            value = text[start:end].strip()
            if value:
                chunks.append(
                    Chunk(
                        source=source,
                        index=len(chunks),
                        text=value,
                        content_hash=hashlib.sha256(value.encode()).hexdigest(),
                    )
                )
            if end >= len(text):
                break
            next_start = max(end - self.overlap, start + 1)
            while next_start < end and text[next_start].isspace():
                next_start += 1
            start = next_start
        return chunks


@dataclass(frozen=True, slots=True)
class SparseEmbedding:
    indices: list[int]
    values: list[float]


class EmbeddingProvider(Protocol):
    dense_model: str
    sparse_model: str
    dense_dimensions: int

    def embed_dense(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_sparse(self, texts: Sequence[str]) -> list[SparseEmbedding]: ...


@dataclass(frozen=True, slots=True)
class VectorPoint:
    point_id: str
    dense: list[float]
    sparse: SparseEmbedding
    payload: dict[str, Any]


@dataclass(frozen=True, slots=True)
class SearchHit:
    point_id: str
    score: float
    payload: dict[str, Any]


class VectorStore(Protocol):
    def health(self) -> dict[str, Any]: ...

    def create_projection(self, collection_name: str, dense_dimensions: int) -> None: ...

    def projection_stats(self, collection_name: str) -> dict[str, Any]: ...

    def has_projection(self, collection_name: str) -> bool: ...

    def activate_alias(self, collection_name: str, alias_name: str) -> None: ...

    def deactivate_alias(self, alias_name: str) -> None: ...

    def upsert(self, collection_name: str, points: Sequence[VectorPoint]) -> None: ...

    def delete_source(self, collection_name: str, collection: str, source_id: str) -> int: ...

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
    ) -> list[SearchHit]: ...

    def list_chunks(
        self,
        collection_name: str,
        kind: str | None,
        source_id: str | None,
        limit: int,
        offset: int,
    ) -> tuple[int, list[SearchHit]]: ...


def projection_fingerprint(
    *,
    source_schema_fingerprint: str,
    chunker_fingerprint: str,
    dense_model: str,
    sparse_model: str,
    dense_dimensions: int,
) -> tuple[str, str]:
    model_fp = fingerprint(
        {
            "dense": dense_model,
            "sparse": sparse_model,
            "dimensions": dense_dimensions,
        }
    )
    projection_fp = fingerprint(
        {
            "contract": 1,
            "sources": source_schema_fingerprint,
            "chunker": chunker_fingerprint,
            "models": model_fp,
        }
    )
    return projection_fp, model_fp


def public_dataclass(value: Any) -> dict[str, Any]:
    return asdict(value)
