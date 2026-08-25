from __future__ import annotations

from collections.abc import Iterator, Sequence
from typing import Any, ClassVar, Protocol

from pymongo import MongoClient
from pymongo.database import Database

from .sources import SourceAdapter


class MongoSource(Protocol):
    def ping(self) -> dict[str, Any]: ...

    def verify_readonly(self) -> None: ...

    def count(self, adapter: SourceAdapter) -> int: ...

    def iter_batches(
        self, adapter: SourceAdapter, batch_size: int
    ) -> Iterator[list[dict[str, Any]]]: ...

    def get_document(self, adapter: SourceAdapter, source_id: Any) -> dict[str, Any] | None: ...

    def capture_database_resume_token(
        self, collections: Sequence[str], max_await_time_ms: int = 2_000
    ) -> dict[str, Any]: ...

    def poll_database_change(
        self,
        collections: Sequence[str],
        resume_token: dict[str, Any] | None,
        max_await_time_ms: int = 2_000,
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]: ...


class PyMongoSource:
    """Read-only MongoDB adapter. No mutating collection method is exposed."""

    SAFE_ROLES: ClassVar[set[str]] = {"read", "readAnyDatabase", "clusterMonitor"}

    def __init__(self, url: str, database: str, server_selection_timeout_ms: int = 5_000) -> None:
        self.client: MongoClient[Any] = MongoClient(
            url,
            appname="mycelia-rag-readonly",
            serverSelectionTimeoutMS=server_selection_timeout_ms,
        )
        self.db: Database[Any] = self.client[database]

    def ping(self) -> dict[str, Any]:
        result = self.client.admin.command("ping")
        return {"reachable": result.get("ok") == 1}

    def verify_readonly(self) -> None:
        """Fail closed when the deployment requires a provably read-only Mongo principal."""
        result = self.client.admin.command("connectionStatus", showPrivileges=False)
        roles = result.get("authInfo", {}).get("authenticatedUserRoles", [])
        names = {str(role.get("role")) for role in roles if isinstance(role, dict)}
        if not names:
            raise PermissionError(
                "RAG_REQUIRE_READONLY_MONGO=true but MongoDB did not report an authenticated role"
            )
        unsafe = names - self.SAFE_ROLES
        if unsafe:
            raise PermissionError(f"MongoDB principal has non-read-only roles: {sorted(unsafe)}")

    def count(self, adapter: SourceAdapter) -> int:
        return self.db[adapter.collection].count_documents(adapter.mongo_filter)

    def iter_batches(
        self, adapter: SourceAdapter, batch_size: int
    ) -> Iterator[list[dict[str, Any]]]:
        cursor = (
            self.db[adapter.collection]
            .find(adapter.mongo_filter, adapter.projection)
            .sort("_id", 1)
            .batch_size(batch_size)
        )
        batch: list[dict[str, Any]] = []
        for document in cursor:
            batch.append(document)
            if len(batch) >= batch_size:
                yield batch
                batch = []
        if batch:
            yield batch

    def get_document(self, adapter: SourceAdapter, source_id: Any) -> dict[str, Any] | None:
        query = {"$and": [{"_id": source_id}, adapter.mongo_filter]}
        return self.db[adapter.collection].find_one(query, adapter.projection)

    def poll_database_change(
        self,
        collections: Sequence[str],
        resume_token: dict[str, Any] | None,
        max_await_time_ms: int = 2_000,
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        pipeline = [
            {
                "$match": {
                    "$or": [
                        {"ns.coll": {"$in": list(collections)}},
                        {
                            "operationType": {
                                "$in": ["drop", "rename", "dropDatabase", "invalidate"]
                            }
                        },
                    ]
                }
            }
        ]
        options: dict[str, Any] = {
            "full_document": "updateLookup",
            "max_await_time_ms": max_await_time_ms,
        }
        if resume_token:
            options["resume_after"] = resume_token
        with self.db.watch(pipeline, **options) as stream:
            event = stream.try_next()
            return event, stream.resume_token

    def capture_database_resume_token(
        self, collections: Sequence[str], max_await_time_ms: int = 2_000
    ) -> dict[str, Any]:
        _event, token = self.poll_database_change(
            collections,
            resume_token=None,
            max_await_time_ms=max_await_time_ms,
        )
        if not token:
            raise RuntimeError("MongoDB change stream did not provide a post-batch resume token")
        return token
