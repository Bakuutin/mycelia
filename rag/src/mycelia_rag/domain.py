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
ExactSource = tuple[str, str]
ContractScalar = str | int | float | bool | None

SOURCE_KINDS = (
    "transcription",
    "message",
    "object",
    "media_visual_description",
)
MAX_FILTER_TIMESTAMP = 253_402_300_799.0


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
class InstructionContract:
    id: str
    fingerprint: str

    @classmethod
    def from_text(cls, instruction_id: str, text: str) -> InstructionContract:
        return cls(
            id=instruction_id,
            fingerprint=hashlib.sha256(text.encode()).hexdigest(),
        )

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "fingerprint": self.fingerprint}


@dataclass(frozen=True, slots=True)
class TokenizerContract:
    id: str
    revision: str

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "revision": self.revision}


@dataclass(frozen=True, slots=True)
class EncoderContract:
    provider: str
    model: str
    model_revision: str
    artifact_repo: str
    tokenizer: TokenizerContract
    document_instruction: InstructionContract
    query_instruction: InstructionContract
    dimensions: int | None
    normalization: Literal["l2", "none"]
    options: tuple[tuple[str, ContractScalar], ...] = ()

    def public(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "modelRevision": self.model_revision,
            "artifactRepo": self.artifact_repo,
            "tokenizer": self.tokenizer.public(),
            "instructions": {
                "document": self.document_instruction.public(),
                "query": self.query_instruction.public(),
            },
            "dimensions": self.dimensions,
            "normalization": self.normalization,
            "options": dict(self.options),
        }


@dataclass(frozen=True, slots=True)
class RerankerContract:
    enabled: bool = False
    provider: str | None = None
    model: str | None = None
    model_revision: str | None = None

    def public(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "provider": self.provider,
            "model": self.model,
            "modelRevision": self.model_revision,
        }


@dataclass(frozen=True, slots=True)
class InferenceContract:
    profile_id: str
    dense: EncoderContract
    sparse: EncoderContract
    contract_version: int = 1

    @property
    def contract_fingerprint(self) -> str:
        return fingerprint(self.public())

    def public(self) -> dict[str, Any]:
        return {
            "profileId": self.profile_id,
            "contractVersion": self.contract_version,
            "dense": self.dense.public(),
            "sparse": self.sparse.public(),
        }


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

    @property
    def evidence_group(self) -> str:
        value = self.metadata.get("evidenceGroup")
        if isinstance(value, str) and value:
            return value
        return f"{self.collection}:{self.source_id}"


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
        platform = self.source.metadata.get("platform")
        sender_id = self.source.metadata.get("senderId")
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
                "platform": platform if isinstance(platform, str) and platform else None,
                "sender_id": sender_id if isinstance(sender_id, str) and sender_id else None,
                "group_id": self.source.evidence_group,
                "source_hash": self.source.source_hash,
            },
            "chunk": {"index": self.index, "content_hash": self.content_hash},
            "source_key": f"{self.source.collection}:{self.source.source_id}",
            "evidence_group": self.source.evidence_group,
            "start_ts": _timestamp(effective_start),
            "end_ts": (
                MAX_FILTER_TIMESTAMP
                if self.source.metadata.get("timeOpenEnded") is True
                else _timestamp(effective_end)
            ),
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
    contract: InferenceContract

    def embed_dense_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_sparse_documents(self, texts: Sequence[str]) -> list[SparseEmbedding]: ...

    def embed_dense_query(self, text: str) -> list[float]: ...

    def embed_sparse_query(self, text: str) -> SparseEmbedding: ...

    def runtime_status(self) -> dict[str, Any]: ...


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
        platforms: Sequence[str] | None = None,
        sender_ids: Sequence[str] | None = None,
        sources: Sequence[ExactSource] | None = None,
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
    inference_contract: InferenceContract,
) -> tuple[str, str]:
    model_fp = inference_contract.contract_fingerprint
    projection_fp = fingerprint(
        {
            "contract": 2,
            "sources": source_schema_fingerprint,
            "chunker": chunker_fingerprint,
            "inference": inference_contract.public(),
            "inferenceFingerprint": model_fp,
        }
    )
    return projection_fp, model_fp


def public_dataclass(value: Any) -> dict[str, Any]:
    return asdict(value)
