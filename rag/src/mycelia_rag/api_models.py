from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .domain import SOURCE_KINDS


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.title() for part in tail)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


SourceKind = Literal[
    "transcription",
    "message",
    "object",
    "media_visual_description",
]
SearchMode = Literal["hybrid", "semantic", "lexical"]
SourceCollection = Literal[
    "transcriptions",
    "messages",
    "objects",
    "media_visual_descriptions",
]
NonEmptyFilter = Annotated[str, Field(min_length=1, max_length=100)]


class ExactSourceFilter(ApiModel):
    collection: SourceCollection
    id: str = Field(min_length=1, max_length=500)


class ErrorBody(ApiModel):
    code: str
    message: str
    details: Any | None = None


class ErrorEnvelope(ApiModel):
    error: ErrorBody


class SearchRequest(ApiModel):
    query: str = Field(min_length=1, max_length=4_000)
    mode: SearchMode = "hybrid"
    kinds: list[SourceKind] | None = Field(default=None, min_length=1, max_length=20)
    start: datetime | None = None
    end: datetime | None = None
    limit: int = Field(default=20, ge=1, le=50)
    min_score: float | None = Field(default=None, ge=0)
    platforms: list[NonEmptyFilter] | None = Field(default=None, min_length=1, max_length=20)
    sender_ids: list[NonEmptyFilter] | None = Field(default=None, min_length=1, max_length=100)
    sources: list[ExactSourceFilter] | None = Field(default=None, min_length=1, max_length=100)
    max_per_source: int = Field(default=2, ge=1, le=10)

    @field_validator("start", "end")
    @classmethod
    def normalize_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value


class SourceRef(ApiModel):
    kind: SourceKind
    collection: str
    id: str
    uri: str
    title: str | None = None
    start: str | None = None
    end: str | None = None
    platform: str | None = None
    sender_id: str | None = None
    group_id: str
    source_hash: str


class ChunkRef(ApiModel):
    index: int
    content_hash: str


class SearchResult(ApiModel):
    evidence_id: str
    point_id: str
    score: float
    text: str
    source: SourceRef
    chunk: ChunkRef


class RevalidationStatus(ApiModel):
    state: Literal["verified", "degraded"]
    checked_sources: int
    dropped_candidates: int
    stale_candidates: int
    filter_refined_candidates: int


class EvidenceSelectionStatus(ApiModel):
    candidate_count: int
    verified_candidates: int
    returned_count: int
    distinct_sources: int
    distinct_groups: int
    max_per_source: int


class FreshnessStatus(ApiModel):
    lifecycle_state: str
    checkpoint_state: Literal["disabled", "watching", "retrying", "error"]
    checkpoint_at: str | None = None
    lag_seconds: float | None = None
    paused: bool


class SearchResponse(ApiModel):
    projection_id: str
    mode: SearchMode
    took_ms: float
    degraded: bool
    warnings: list[str]
    freshness: FreshnessStatus
    revalidation: RevalidationStatus
    selection: EvidenceSelectionStatus
    results: list[SearchResult]


class ChunkItem(ApiModel):
    point_id: str
    text: str
    source: SourceRef
    chunk: ChunkRef


class ChunkListResponse(ApiModel):
    projection_id: str
    total: int
    limit: int
    offset: int
    items: list[ChunkItem]


class InstructionContractStatus(ApiModel):
    id: str
    fingerprint: str


class TokenizerContractStatus(ApiModel):
    id: str
    revision: str


class EncoderInstructionsStatus(ApiModel):
    document: InstructionContractStatus
    query: InstructionContractStatus


class EncoderContractStatus(ApiModel):
    provider: str
    model: str
    model_revision: str
    artifact_repo: str
    tokenizer: TokenizerContractStatus
    instructions: EncoderInstructionsStatus
    dimensions: int | None
    normalization: Literal["l2", "none"]
    options: dict[str, str | int | float | bool | None]


class ProjectionInferenceContractStatus(ApiModel):
    profile_id: str
    contract_version: int
    dense: EncoderContractStatus
    sparse: EncoderContractStatus


class RuntimeEncoderContractStatus(ApiModel):
    dense: EncoderContractStatus
    sparse: EncoderContractStatus


class RemoteExecutorStatus(ApiModel):
    label: str


class InferenceExecutorStatus(ApiModel):
    kind: Literal["local", "remote"]
    label: str
    transport: Literal["in_process", "http"]
    dense_loaded: bool | None
    sparse_loaded: bool | None
    remote_executor: RemoteExecutorStatus | None


class RerankerStatus(ApiModel):
    enabled: bool
    provider: str | None
    model: str | None
    model_revision: str | None


class InferenceRuntimeStatus(ApiModel):
    profile_id: str
    contract_version: int
    embedding_space_fingerprint: str
    active_projection_compatible: bool | None
    executor: InferenceExecutorStatus
    contract: RuntimeEncoderContractStatus
    reranker: RerankerStatus


class ProjectionStatus(ApiModel):
    id: str
    fingerprint: str
    generation: str
    collection_name: str
    state: Literal["building", "catching_up", "ready", "superseded", "error"]
    created_at: str
    build_started_at: str
    activated_at: str | None = None
    superseded_at: str | None = None
    source_schema_fingerprint: str
    chunker_version: str
    chunker_fingerprint: str
    model_fingerprint: str
    dense_model: str
    dense_dimensions: int
    sparse_model: str
    inference_contract: ProjectionInferenceContractStatus | None = None
    error: str | None = None


class OperationStatus(ApiModel):
    id: str
    type: Literal["rebuild", "reconcile"]
    state: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    reason: str | None = None
    projection_id: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None


class ProgressStatus(ApiModel):
    phase: str
    processed_sources: int
    total_sources: int | None = None
    indexed_chunks: int
    deleted_chunks: int
    failed_sources: int
    updated_at: str | None = None


class ChangeStreamStatus(ApiModel):
    state: Literal["disabled", "watching", "retrying", "error"]
    resume_token_present: bool
    updated_at: str | None = None
    lag_seconds: float | None = None
    error: str | None = None


class SourceStatus(ApiModel):
    kind: SourceKind
    collection: str
    documents: int
    indexed_documents: int
    chunks: int
    high_watermark: str | None = None
    last_reconciled_at: str | None = None
    lag_seconds: float | None = None
    error: str | None = None
    change_stream: ChangeStreamStatus


class QdrantCapabilities(ApiModel):
    dense: bool
    sparse: bool
    hybrid_rrf: bool
    filters: bool


class QdrantStatus(ApiModel):
    reachable: bool
    collection: str | None = None
    points_count: int | None = None
    indexed_vectors_count: int | None = None
    status: str | None = None
    error: str | None = None
    capabilities: QdrantCapabilities


class StatusResponse(ApiModel):
    state: Literal[
        "empty",
        "building",
        "catching_up",
        "reconciling",
        "ready",
        "paused",
        "degraded",
        "error",
    ]
    paused: bool
    degraded: bool
    auth_mode: str
    active_projection_id: str | None = None
    projection: ProjectionStatus | None = None
    candidate_projection: ProjectionStatus | None = None
    operation: OperationStatus | None = None
    progress: ProgressStatus
    sources: list[SourceStatus]
    qdrant: QdrantStatus
    inference: InferenceRuntimeStatus
    warnings: list[str]


class OperationRequest(ApiModel):
    reason: str | None = Field(default=None, max_length=500)


class AcceptedOperation(ApiModel):
    accepted: bool = True
    operation: OperationStatus


class PauseResponse(ApiModel):
    state: str
    paused: bool


class HealthResponse(ApiModel):
    status: Literal["ok"] = "ok"


class ReadyResponse(ApiModel):
    status: Literal["ready"] = "ready"
    projection_id: str


assert set(SOURCE_KINDS) == set(SourceKind.__args__)
