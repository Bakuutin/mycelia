from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from .domain import Chunk, canonical_json, isoformat, utc_now


class StateStore:
    """SQLite control plane and per-generation indexing ledger."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
        return connection

    def initialize(self) -> None:
        schema = """
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projections (
          id TEXT PRIMARY KEY,
          fingerprint TEXT NOT NULL,
          generation TEXT NOT NULL,
          collection_name TEXT NOT NULL UNIQUE,
          state TEXT NOT NULL,
          created_at TEXT NOT NULL,
          build_started_at TEXT NOT NULL,
          activated_at TEXT,
          superseded_at TEXT,
          source_schema_fingerprint TEXT NOT NULL,
          chunker_version TEXT NOT NULL,
          chunker_fingerprint TEXT NOT NULL,
          model_fingerprint TEXT NOT NULL,
          dense_model TEXT NOT NULL,
          dense_dimensions INTEGER NOT NULL,
          sparse_model TEXT NOT NULL,
          inference_contract_json TEXT,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS operations (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          state TEXT NOT NULL,
          reason TEXT,
          projection_id TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          error TEXT
        );
        CREATE INDEX IF NOT EXISTS operations_created_at ON operations(created_at DESC);
        CREATE TABLE IF NOT EXISTS source_status (
          projection_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          collection_name TEXT NOT NULL,
          documents INTEGER NOT NULL DEFAULT 0,
          indexed_documents INTEGER NOT NULL DEFAULT 0,
          chunks INTEGER NOT NULL DEFAULT 0,
          high_watermark TEXT,
          last_reconciled_at TEXT,
          lag_seconds REAL,
          error TEXT,
          PRIMARY KEY (projection_id, collection_name),
          FOREIGN KEY (projection_id) REFERENCES projections(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS chunks (
          projection_id TEXT NOT NULL,
          point_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          collection_name TEXT NOT NULL,
          source_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (projection_id, point_id),
          UNIQUE (projection_id, collection_name, source_id, chunk_index),
          FOREIGN KEY (projection_id) REFERENCES projections(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS chunks_source
          ON chunks(projection_id, collection_name, source_id);
        CREATE TABLE IF NOT EXISTS source_documents (
          projection_id TEXT NOT NULL,
          collection_name TEXT NOT NULL,
          source_id TEXT NOT NULL,
          source_hash TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (projection_id, collection_name, source_id),
          FOREIGN KEY (projection_id) REFERENCES projections(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS source_documents_collection
          ON source_documents(projection_id, collection_name);
        CREATE TABLE IF NOT EXISTS change_checkpoints (
          collection_name TEXT PRIMARY KEY,
          resume_token TEXT,
          state TEXT NOT NULL DEFAULT 'disabled',
          updated_at TEXT,
          event_at TEXT,
          lag_seconds REAL,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS progress (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          phase TEXT NOT NULL,
          processed_sources INTEGER NOT NULL,
          total_sources INTEGER,
          indexed_chunks INTEGER NOT NULL,
          deleted_chunks INTEGER NOT NULL,
          failed_sources INTEGER NOT NULL,
          updated_at TEXT
        );
        INSERT OR IGNORE INTO progress(
          singleton, phase, processed_sources, total_sources,
          indexed_chunks, deleted_chunks, failed_sources, updated_at
        ) VALUES (1, 'idle', 0, NULL, 0, 0, 0, NULL);
        INSERT OR IGNORE INTO meta(key, value) VALUES ('state', 'empty');
        INSERT OR IGNORE INTO meta(key, value) VALUES ('paused', 'false');
        """
        with self._lock, self._connect() as connection:
            connection.executescript(schema)
            projection_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(projections)")
            }
            if "chunker_version" not in projection_columns:
                connection.execute(
                    "ALTER TABLE projections ADD COLUMN chunker_version TEXT NOT NULL "
                    "DEFAULT 'char-boundary-v1'"
                )
            if "inference_contract_json" not in projection_columns:
                connection.execute(
                    "ALTER TABLE projections ADD COLUMN inference_contract_json TEXT"
                )

    def set_meta(self, key: str, value: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO meta(key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )

    def get_meta(self, key: str, default: str | None = None) -> str | None:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return str(row["value"]) if row else default

    @property
    def paused(self) -> bool:
        return self.get_meta("paused", "false") == "true"

    def set_paused(self, paused: bool) -> None:
        self.set_meta("paused", "true" if paused else "false")
        # Pause is orthogonal to the durable lifecycle. Status/search overlay the
        # paused flag, while rebuild/reconcile may still advance the underlying
        # state after the gate is released. Repair state written by older builds
        # only when a user resumes such an existing database.
        if not paused and self.get_meta("state") == "paused":
            restored = self.get_meta("state_before_pause")
            self.set_meta("state", restored or ("ready" if self.active_projection() else "empty"))

    def create_projection(self, projection: dict[str, Any]) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO projections(
                  id, fingerprint, generation, collection_name, state,
                  created_at, build_started_at, source_schema_fingerprint,
                  chunker_version, chunker_fingerprint, model_fingerprint, dense_model,
                  dense_dimensions, sparse_model, inference_contract_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    projection["id"],
                    projection["fingerprint"],
                    projection["generation"],
                    projection["collectionName"],
                    projection.get("state", "building"),
                    projection["createdAt"],
                    projection["buildStartedAt"],
                    projection["sourceSchemaFingerprint"],
                    projection["chunkerVersion"],
                    projection["chunkerFingerprint"],
                    projection["modelFingerprint"],
                    projection["denseModel"],
                    projection["denseDimensions"],
                    projection["sparseModel"],
                    (
                        canonical_json(projection["inferenceContract"])
                        if projection.get("inferenceContract") is not None
                        else None
                    ),
                ),
            )

    def set_projection_state(
        self, projection_id: str, state: str, error: str | None = None
    ) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE projections SET state=?, error=? WHERE id=?",
                (state, error, projection_id),
            )

    def activate_projection(
        self,
        projection_id: str,
        *,
        resume_token: Any,
        checkpoint_state: str,
    ) -> None:
        """Atomically switch blue/green active pointer and supersede the old projection."""
        now = isoformat(utc_now())
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            active = connection.execute(
                "SELECT value FROM meta WHERE key='active_projection'"
            ).fetchone()
            previous = str(active["value"]) if active else None
            candidate = connection.execute(
                "SELECT state FROM projections WHERE id=?", (projection_id,)
            ).fetchone()
            if not candidate or candidate["state"] != "catching_up":
                raise ValueError("only a catching_up projection can be activated")
            if previous and previous != projection_id:
                connection.execute(
                    "UPDATE projections SET state='superseded', superseded_at=? WHERE id=?",
                    (now, previous),
                )
            connection.execute(
                "UPDATE projections SET state='ready', activated_at=?, error=NULL WHERE id=?",
                (now, projection_id),
            )
            connection.execute(
                "INSERT INTO meta(key, value) VALUES ('active_projection', ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (projection_id,),
            )
            connection.execute(
                "INSERT INTO meta(key, value) VALUES ('state', 'ready') "
                "ON CONFLICT(key) DO UPDATE SET value='ready'"
            )
            token = canonical_json(resume_token)
            lag_seconds = None if checkpoint_state == "disabled" else 0
            for key, value in (
                ("database_resume_token", token),
                ("database_resume_updated_at", now or ""),
                (
                    "database_resume_lag_seconds",
                    "" if lag_seconds is None else str(lag_seconds),
                ),
            ):
                connection.execute(
                    "INSERT INTO meta(key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (key, value),
                )
            connection.execute(
                """
                UPDATE change_checkpoints SET resume_token=?, state=?,
                  updated_at=?, lag_seconds=?, error=NULL
                """,
                (token, checkpoint_state, now, lag_seconds),
            )
            connection.commit()

    def persist_resume_token(
        self,
        resume_token: Any,
        *,
        checkpoint_state: str,
        lag_seconds: float | None,
        event_at: str | None,
    ) -> None:
        """Atomically persist the database-wide token and every source position."""
        token = canonical_json(resume_token)
        now = isoformat(utc_now())
        lag_value = "" if lag_seconds is None else str(lag_seconds)
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for key, value in (
                ("database_resume_token", token),
                ("database_resume_updated_at", now or ""),
                ("database_resume_lag_seconds", lag_value),
            ):
                connection.execute(
                    "INSERT INTO meta(key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (key, value),
                )
            connection.execute(
                """
                UPDATE change_checkpoints SET resume_token=?, state=?, updated_at=?,
                  event_at=COALESCE(?, event_at), lag_seconds=?, error=NULL
                """,
                (token, checkpoint_state, now, event_at, lag_seconds),
            )
            connection.commit()

    def mark_reconcile_required(self, resume_token: Any | None, *, reason: str) -> None:
        """Persist a structural-change boundary before scheduling correctness repair."""
        token = canonical_json(resume_token) if resume_token is not None else ""
        now = isoformat(utc_now())
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for key, value in (
                ("reconcile_required_reason", reason),
                ("database_resume_token", token),
                ("database_resume_updated_at", now or ""),
                ("database_resume_lag_seconds", ""),
            ):
                connection.execute(
                    "INSERT INTO meta(key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (key, value),
                )
            connection.execute(
                """
                UPDATE change_checkpoints SET resume_token=?, state='retrying',
                  updated_at=?, lag_seconds=NULL, error=?
                """,
                (token or None, now, reason),
            )
            connection.commit()

    def projection(self, projection_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM projections WHERE id=?", (projection_id,)
            ).fetchone()
        return self._projection_dict(row) if row else None

    def active_projection(self) -> dict[str, Any] | None:
        projection_id = self.get_meta("active_projection")
        return self.projection(projection_id) if projection_id else None

    def latest_projection(self) -> dict[str, Any] | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM projections ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
        return self._projection_dict(row) if row else None

    @staticmethod
    def _projection_dict(row: sqlite3.Row) -> dict[str, Any]:
        inference_contract_json = row["inference_contract_json"]
        return {
            "id": row["id"],
            "fingerprint": row["fingerprint"],
            "generation": row["generation"],
            "collectionName": row["collection_name"],
            "state": row["state"],
            "createdAt": row["created_at"],
            "buildStartedAt": row["build_started_at"],
            "activatedAt": row["activated_at"],
            "supersededAt": row["superseded_at"],
            "sourceSchemaFingerprint": row["source_schema_fingerprint"],
            "chunkerVersion": row["chunker_version"],
            "chunkerFingerprint": row["chunker_fingerprint"],
            "modelFingerprint": row["model_fingerprint"],
            "denseModel": row["dense_model"],
            "denseDimensions": row["dense_dimensions"],
            "sparseModel": row["sparse_model"],
            "inferenceContract": (
                json.loads(inference_contract_json) if inference_contract_json else None
            ),
            "error": row["error"],
        }

    def create_operation(self, operation_type: str, reason: str | None = None) -> dict[str, Any]:
        operation_id = str(uuid.uuid4())
        created = isoformat(utc_now())
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO operations(id, type, state, reason, created_at) "
                "VALUES (?, ?, 'queued', ?, ?)",
                (operation_id, operation_type, reason, created),
            )
        return {
            "id": operation_id,
            "type": operation_type,
            "state": "queued",
            "reason": reason,
            "createdAt": created,
        }

    def update_operation(
        self,
        operation_id: str,
        *,
        state: str,
        projection_id: str | None = None,
        error: str | None = None,
    ) -> None:
        now = isoformat(utc_now())
        started_at = now if state == "running" else None
        finished_at = now if state in {"succeeded", "failed", "cancelled"} else None
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                UPDATE operations SET state=?,
                  projection_id=COALESCE(?, projection_id),
                  started_at=COALESCE(?, started_at),
                  finished_at=COALESCE(?, finished_at), error=?
                WHERE id=?
                """,
                (state, projection_id, started_at, finished_at, error, operation_id),
            )

    def latest_operation(self) -> dict[str, Any] | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM operations ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "type": row["type"],
            "state": row["state"],
            "reason": row["reason"],
            "projectionId": row["projection_id"],
            "createdAt": row["created_at"],
            "startedAt": row["started_at"],
            "finishedAt": row["finished_at"],
            "error": row["error"],
        }

    def recover_interrupted(self) -> dict[str, Any]:
        """Close non-terminal work left by a previous service process."""
        now = isoformat(utc_now())
        message = "service restarted before the index operation completed"
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            active_row = connection.execute(
                "SELECT value FROM meta WHERE key='active_projection'"
            ).fetchone()
            active_id = str(active_row["value"]) if active_row else None
            operation_rows = connection.execute(
                "SELECT id FROM operations WHERE state IN ('queued', 'running')"
            ).fetchall()
            projection_rows = connection.execute(
                """
                SELECT id FROM projections
                WHERE state IN ('building', 'catching_up') AND id != COALESCE(?, '')
                """,
                (active_id,),
            ).fetchall()
            operation_ids = [str(row["id"]) for row in operation_rows]
            projection_ids = [str(row["id"]) for row in projection_rows]
            lifecycle_row = connection.execute(
                "SELECT value FROM meta WHERE key='state'"
            ).fetchone()
            lifecycle_state = str(lifecycle_row["value"]) if lifecycle_row else "empty"
            orphan_transient_state = (
                lifecycle_state in {"building", "catching_up", "reconciling"}
                and not operation_ids
                and not projection_ids
            )
            if operation_ids:
                connection.execute(
                    """
                    UPDATE operations SET state='failed', finished_at=?, error=?
                    WHERE state IN ('queued', 'running')
                    """,
                    (now, message),
                )
            if projection_ids:
                connection.execute(
                    """
                    UPDATE projections SET state='error', error=?
                    WHERE state IN ('building', 'catching_up')
                      AND id != COALESCE(?, '')
                    """,
                    (message, active_id),
                )
            if operation_ids or projection_ids or orphan_transient_state:
                recovered_state = "degraded" if active_id else "error"
                connection.execute(
                    "INSERT INTO meta(key, value) VALUES ('state', ?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (recovered_state,),
                )
                connection.execute(
                    """
                    UPDATE progress SET phase='interrupted',
                      failed_sources=failed_sources + 1, updated_at=?
                    WHERE singleton=1
                    """,
                    (now,),
                )
            connection.commit()
        return {
            "operations": operation_ids,
            "projections": projection_ids,
            "activeProjectionId": active_id,
            "error": (
                message if operation_ids or projection_ids or orphan_transient_state else None
            ),
        }

    def set_progress(self, **values: Any) -> None:
        current = self.progress()
        mapping = {
            "phase": "phase",
            "processedSources": "processed_sources",
            "totalSources": "total_sources",
            "indexedChunks": "indexed_chunks",
            "deletedChunks": "deleted_chunks",
            "failedSources": "failed_sources",
            "updatedAt": "updated_at",
        }
        current.update(values)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                UPDATE progress SET phase=?, processed_sources=?, total_sources=?,
                  indexed_chunks=?, deleted_chunks=?, failed_sources=?, updated_at=?
                WHERE singleton=1
                """,
                tuple(current[key] for key in mapping),
            )

    def reset_progress(self, phase: str, total_sources: int | None = None) -> None:
        self.set_progress(
            phase=phase,
            processedSources=0,
            totalSources=total_sources,
            indexedChunks=0,
            deletedChunks=0,
            failedSources=0,
            updatedAt=isoformat(utc_now()),
        )

    def progress(self) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM progress WHERE singleton=1").fetchone()
        return {
            "phase": row["phase"],
            "processedSources": row["processed_sources"],
            "totalSources": row["total_sources"],
            "indexedChunks": row["indexed_chunks"],
            "deletedChunks": row["deleted_chunks"],
            "failedSources": row["failed_sources"],
            "updatedAt": row["updated_at"],
        }

    def upsert_source_status(
        self,
        projection_id: str,
        kind: str,
        collection: str,
        **values: Any,
    ) -> None:
        current = self.source_status(projection_id, collection) or {
            "documents": 0,
            "indexedDocuments": 0,
            "chunks": 0,
            "highWatermark": None,
            "lastReconciledAt": None,
            "lagSeconds": None,
            "error": None,
        }
        current.update(values)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO source_status(
                  projection_id, kind, collection_name, documents, indexed_documents,
                  chunks, high_watermark, last_reconciled_at, lag_seconds, error
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(projection_id, collection_name) DO UPDATE SET
                  kind=excluded.kind, documents=excluded.documents,
                  indexed_documents=excluded.indexed_documents, chunks=excluded.chunks,
                  high_watermark=excluded.high_watermark,
                  last_reconciled_at=excluded.last_reconciled_at,
                  lag_seconds=excluded.lag_seconds, error=excluded.error
                """,
                (
                    projection_id,
                    kind,
                    collection,
                    current["documents"],
                    current["indexedDocuments"],
                    current["chunks"],
                    current["highWatermark"],
                    current["lastReconciledAt"],
                    current["lagSeconds"],
                    current["error"],
                ),
            )

    def source_status(self, projection_id: str, collection: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM source_status WHERE projection_id=? AND collection_name=?",
                (projection_id, collection),
            ).fetchone()
        return self._source_dict(row) if row else None

    def source_statuses(self, projection_id: str) -> list[dict[str, Any]]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM source_status WHERE projection_id=? ORDER BY collection_name",
                (projection_id,),
            ).fetchall()
        return [self._source_dict(row) for row in rows]

    @staticmethod
    def _source_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "kind": row["kind"],
            "collection": row["collection_name"],
            "documents": row["documents"],
            "indexedDocuments": row["indexed_documents"],
            "chunks": row["chunks"],
            "highWatermark": row["high_watermark"],
            "lastReconciledAt": row["last_reconciled_at"],
            "lagSeconds": row["lag_seconds"],
            "error": row["error"],
        }

    def replace_source_chunks(self, projection_id: str, chunks: Sequence[Chunk]) -> None:
        if not chunks:
            return
        source = chunks[0].source
        now = isoformat(utc_now())
        rows = [
            (
                projection_id,
                chunk.point_id(projection_id),
                source.kind,
                source.collection,
                source.source_id,
                chunk.index,
                chunk.content_hash,
                source.source_hash,
                now,
            )
            for chunk in chunks
        ]
        with self._lock, self._connect() as connection:
            connection.execute(
                "DELETE FROM chunks WHERE projection_id=? AND collection_name=? AND source_id=?",
                (projection_id, source.collection, source.source_id),
            )
            connection.executemany(
                """
                INSERT INTO chunks(
                  projection_id, point_id, kind, collection_name, source_id,
                  chunk_index, content_hash, source_hash, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

    def delete_source_chunks(self, projection_id: str, collection: str, source_id: str) -> int:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM chunks WHERE projection_id=? AND collection_name=? AND source_id=?",
                (projection_id, collection, source_id),
            )
        return cursor.rowcount

    def source_chunk_hashes(self, projection_id: str, collection: str, source_id: str) -> list[str]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT content_hash FROM chunks
                WHERE projection_id=? AND collection_name=? AND source_id=?
                ORDER BY chunk_index
                """,
                (projection_id, collection, source_id),
            ).fetchall()
        return [str(row["content_hash"]) for row in rows]

    def source_hash(self, projection_id: str, collection: str, source_id: str) -> str | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT source_hash FROM source_documents
                WHERE projection_id=? AND collection_name=? AND source_id=?
                """,
                (projection_id, collection, source_id),
            ).fetchone()
        return str(row["source_hash"]) if row and row["source_hash"] is not None else None

    def upsert_source_document(
        self,
        projection_id: str,
        collection: str,
        source_id: str,
        source_hash: str | None,
    ) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO source_documents(
                  projection_id, collection_name, source_id, source_hash, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(projection_id, collection_name, source_id) DO UPDATE SET
                  source_hash=excluded.source_hash, updated_at=excluded.updated_at
                """,
                (projection_id, collection, source_id, source_hash, isoformat(utc_now())),
            )

    def delete_source_document(self, projection_id: str, collection: str, source_id: str) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                """
                DELETE FROM source_documents
                WHERE projection_id=? AND collection_name=? AND source_id=?
                """,
                (projection_id, collection, source_id),
            )
        return cursor.rowcount > 0

    def source_document_count(self, projection_id: str, collection: str) -> int:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS count FROM source_documents
                WHERE projection_id=? AND collection_name=?
                """,
                (projection_id, collection),
            ).fetchone()
        return int(row["count"])

    def source_ids(self, projection_id: str, collection: str) -> set[str]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT source_id FROM source_documents
                WHERE projection_id=? AND collection_name=?
                """,
                (projection_id, collection),
            ).fetchall()
        return {str(row["source_id"]) for row in rows}

    def chunk_counts(self, projection_id: str, collection: str) -> tuple[int, int]:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) chunks, COUNT(DISTINCT source_id) sources FROM chunks
                WHERE projection_id=? AND collection_name=?
                """,
                (projection_id, collection),
            ).fetchone()
        return int(row["chunks"]), int(row["sources"])

    def update_checkpoint(
        self,
        collection: str,
        *,
        resume_token: Any | None = None,
        state: str,
        event_at: str | None = None,
        lag_seconds: float | None = None,
        error: str | None = None,
    ) -> None:
        token = canonical_json(resume_token) if resume_token is not None else None
        now = isoformat(utc_now())
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO change_checkpoints(
                  collection_name, resume_token, state, updated_at, event_at, lag_seconds, error
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(collection_name) DO UPDATE SET
                  resume_token=COALESCE(excluded.resume_token, resume_token),
                  state=excluded.state, updated_at=excluded.updated_at,
                  event_at=COALESCE(excluded.event_at, event_at),
                  lag_seconds=excluded.lag_seconds, error=excluded.error
                """,
                (collection, token, state, now, event_at, lag_seconds, error),
            )

    def checkpoint(self, collection: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM change_checkpoints WHERE collection_name=?", (collection,)
            ).fetchone()
        if not row:
            return None
        return {
            "state": row["state"],
            "resumeToken": json.loads(row["resume_token"]) if row["resume_token"] else None,
            "updatedAt": row["updated_at"],
            "eventAt": row["event_at"],
            "lagSeconds": row["lag_seconds"],
            "error": row["error"],
        }

    def initialize_checkpoints(self, collections: Iterable[str], enabled: bool) -> None:
        for collection in collections:
            if not self.checkpoint(collection):
                self.update_checkpoint(collection, state="retrying" if enabled else "disabled")
