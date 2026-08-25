from __future__ import annotations

from fastapi.testclient import TestClient

from mycelia_rag.app import create_app
from mycelia_rag.config import Settings
from mycelia_rag.embeddings import DeterministicEmbeddingProvider
from mycelia_rag.indexer import IndexManager
from mycelia_rag.state import StateStore

from .fakes import FakeMongoSource, FakeVectorStore
from .test_runtime import documents


def api(tmp_path, *, auth_mode="none") -> tuple[TestClient, IndexManager]:
    settings = Settings(
        state_path=tmp_path / "api.sqlite3",
        model_cache=tmp_path / "models",
        enable_background=False,
        chunk_size=200,
        chunk_overlap=20,
        auth_mode=auth_mode,
        internal_token="secret" if auth_mode == "internal_token" else None,
    )
    manager = IndexManager(
        settings=settings,
        state=StateStore(settings.state_path),
        mongo=FakeMongoSource(documents()),
        vectors=FakeVectorStore(),
        embeddings=DeterministicEmbeddingProvider(),
    )
    return TestClient(create_app(settings, manager)), manager


def test_health_is_live_but_ready_requires_active_projection(tmp_path) -> None:
    client, _manager = api(tmp_path)
    with client:
        assert client.get("/health").json() == {"status": "ok"}
        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "projection_not_ready"


def test_api_rebuild_search_status_and_chunks_contract(tmp_path) -> None:
    client, manager = api(tmp_path)
    with client:
        accepted = client.post("/v1/index/rebuild", json={"reason": "contract"})
        assert accepted.status_code == 202
        assert accepted.json()["accepted"] is True
        # TestClient's event loop owns the background operation; wait through its task.
        import time

        deadline = time.monotonic() + 3
        while manager.state.latest_operation()["state"] not in {"succeeded", "failed"}:
            assert time.monotonic() < deadline
            time.sleep(0.01)

        assert client.get("/ready").status_code == 200
        status = client.get("/v1/status").json()
        assert status["state"] == "ready"
        assert status["projection"]["fingerprint"]
        result = client.post(
            "/v1/search",
            json={"query": "квантовый", "mode": "lexical", "limit": 5},
        )
        assert result.status_code == 200
        assert result.json()["results"][0]["source"]["kind"] == "transcription"
        assert result.json()["freshness"]["checkpointAt"] is not None
        assert result.json()["freshness"]["checkpointState"] == "disabled"
        assert result.json()["freshness"]["lagSeconds"] is None
        chunks = client.get("/v1/chunks", params={"kind": "message", "limit": 50})
        assert chunks.status_code == 200
        assert chunks.json()["items"][0]["chunk"]["contentHash"]


def test_validation_and_auth_use_stable_error_envelope(tmp_path) -> None:
    client, _manager = api(tmp_path, auth_mode="internal_token")
    with client:
        unauthorized = client.get("/v1/status")
        assert unauthorized.status_code == 401
        assert unauthorized.json() == {
            "error": {
                "code": "unauthorized",
                "message": "valid bearer token required",
                "details": None,
            }
        }
        invalid = client.post(
            "/v1/search",
            headers={"Authorization": "Bearer secret"},
            json={"query": "", "limit": 51},
        )
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == "validation_error"
