from __future__ import annotations

import hmac
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api_models import (
    AcceptedOperation,
    ChunkListResponse,
    ErrorEnvelope,
    HealthResponse,
    OperationRequest,
    PauseResponse,
    ReadyResponse,
    SearchRequest,
    SearchResponse,
    SourceKind,
    StatusResponse,
)
from .config import Settings, get_settings
from .embeddings import FastEmbedProvider
from .indexer import IndexManager, OperationConflict, ProjectionNotReady
from .mongo_source import PyMongoSource
from .state import StateStore
from .vector_store import QdrantVectorStore

logger = logging.getLogger(__name__)


class ApiError(RuntimeError):
    def __init__(
        self, status_code: int, code: str, message: str, details: Any | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def error_response(
    status_code: int, code: str, message: str, details: Any | None = None
) -> JSONResponse:
    payload = ErrorEnvelope.model_validate(
        {"error": {"code": code, "message": message, "details": details}}
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(by_alias=True))


def build_manager(settings: Settings) -> IndexManager:
    token = settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None
    return IndexManager(
        settings=settings,
        state=StateStore(settings.state_path),
        mongo=PyMongoSource(
            settings.mongo_url,
            settings.mongo_database,
            settings.mongo_server_selection_timeout_ms,
        ),
        vectors=QdrantVectorStore(
            settings.qdrant_url,
            api_key=token,
            timeout=settings.qdrant_timeout_seconds,
        ),
        embeddings=FastEmbedProvider(
            dense_model=settings.dense_model,
            sparse_model=settings.sparse_model,
            dense_dimensions=settings.dense_dimensions,
            cache_dir=settings.model_cache,
        ),
    )


def create_app(settings: Settings | None = None, manager: IndexManager | None = None) -> FastAPI:
    config = settings or get_settings()
    runtime: IndexManager | None = manager

    def get_runtime() -> IndexManager:
        if runtime is None:
            raise RuntimeError("RAG runtime has not started")
        return runtime

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        nonlocal runtime
        runtime = runtime or build_manager(config)
        application.state.rag_manager = runtime
        await runtime.start()
        try:
            yield
        finally:
            await runtime.stop()

    application = FastAPI(
        title="Mycelia RAG",
        version="0.1.0",
        description="Independent, inspectable Qdrant projection of read-only Mycelia data.",
        lifespan=lifespan,
    )

    @application.middleware("http")
    async def internal_auth(request: Request, call_next):
        if request.url.path.startswith("/v1/") and config.auth_mode == "internal_token":
            expected = config.internal_token.get_secret_value() if config.internal_token else ""
            authorization = request.headers.get("authorization", "")
            scheme, _, supplied = authorization.partition(" ")
            if scheme.casefold() != "bearer" or not hmac.compare_digest(supplied, expected):
                return error_response(401, "unauthorized", "valid bearer token required")
        return await call_next(request)

    @application.exception_handler(ApiError)
    async def api_error_handler(_request: Request, error: ApiError) -> JSONResponse:
        return error_response(error.status_code, error.code, error.message, error.details)

    @application.exception_handler(OperationConflict)
    async def conflict_handler(_request: Request, error: OperationConflict) -> JSONResponse:
        return error_response(409, "operation_conflict", str(error))

    @application.exception_handler(ProjectionNotReady)
    async def not_ready_handler(_request: Request, error: ProjectionNotReady) -> JSONResponse:
        return error_response(503, "projection_not_ready", str(error))

    @application.exception_handler(RequestValidationError)
    async def validation_handler(_request: Request, error: RequestValidationError) -> JSONResponse:
        details = [
            {
                "type": item.get("type"),
                "loc": list(item.get("loc", ())),
                "msg": item.get("msg"),
            }
            for item in error.errors()
        ]
        return error_response(422, "validation_error", "request validation failed", details)

    @application.exception_handler(StarletteHTTPException)
    async def http_error_handler(_request: Request, error: StarletteHTTPException) -> JSONResponse:
        return error_response(error.status_code, "http_error", str(error.detail))

    @application.exception_handler(Exception)
    async def unexpected_error_handler(_request: Request, error: Exception) -> JSONResponse:
        logger.error(
            "unhandled RAG API error",
            exc_info=(type(error), error, error.__traceback__),
        )
        return error_response(500, "internal_error", "internal server error")

    @application.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse()

    @application.get(
        "/ready",
        response_model=ReadyResponse,
        responses={503: {"model": ErrorEnvelope}},
    )
    async def ready() -> ReadyResponse:
        is_ready, projection_id = await get_runtime().ready()
        if not is_ready or not projection_id:
            raise ApiError(503, "projection_not_ready", "no searchable active projection")
        return ReadyResponse(projection_id=projection_id)

    @application.get("/v1/status", response_model=StatusResponse)
    async def status() -> dict[str, Any]:
        return await get_runtime().status()

    @application.post(
        "/v1/search",
        response_model=SearchResponse,
        responses={503: {"model": ErrorEnvelope}},
    )
    async def search(payload: SearchRequest) -> dict[str, Any]:
        if payload.start and payload.end and payload.start > payload.end:
            raise ApiError(422, "invalid_date_range", "start must not be after end")
        return await get_runtime().search(
            query=payload.query,
            mode=payload.mode,
            kinds=payload.kinds,
            start=payload.start,
            end=payload.end,
            limit=payload.limit,
            min_score=payload.min_score,
        )

    @application.get(
        "/v1/chunks",
        response_model=ChunkListResponse,
        responses={503: {"model": ErrorEnvelope}},
    )
    async def chunks(
        kind: SourceKind | None = None,
        source_id: str | None = Query(default=None, alias="sourceId", max_length=500),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0, le=10_000),
    ) -> dict[str, Any]:
        return await get_runtime().list_chunks(
            kind=kind,
            source_id=source_id,
            limit=limit,
            offset=offset,
        )

    @application.post(
        "/v1/index/rebuild",
        response_model=AcceptedOperation,
        status_code=202,
        responses={409: {"model": ErrorEnvelope}},
    )
    async def rebuild(payload: OperationRequest | None = None) -> dict[str, Any]:
        operation = get_runtime().request_rebuild(payload.reason if payload else None)
        return {"accepted": True, "operation": operation}

    @application.post(
        "/v1/index/reconcile",
        response_model=AcceptedOperation,
        status_code=202,
        responses={409: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope}},
    )
    async def reconcile(payload: OperationRequest | None = None) -> dict[str, Any]:
        operation = get_runtime().request_reconcile(payload.reason if payload else None)
        return {"accepted": True, "operation": operation}

    @application.post("/v1/index/pause", response_model=PauseResponse)
    async def pause() -> dict[str, Any]:
        get_runtime().pause()
        return {"state": "paused", "paused": True}

    @application.post("/v1/index/resume", response_model=PauseResponse)
    async def resume() -> dict[str, Any]:
        get_runtime().resume()
        state = "ready" if get_runtime().state.active_projection() else "empty"
        return {"state": state, "paused": False}

    return application


app = create_app()
