#!/usr/bin/env python3
"""Audit, back up, and remove exact duplicate legacy diarization segments.

Duplicate identity is intentionally conservative: segments must share the same
run, recording, start, end, and speaker. Apply mode refuses to run while audio
chunks are claimed and stores every removed document in a backup collection.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4

from bson import ObjectId

sys.path.insert(0, str(Path(__file__).parent.parent))

from lib.api import exchange_api_key_for_jwt, job_session_var, job_token_var
from lib.resources import call_resource


BACKUP_COLLECTION = "diarization_duplicate_backups"
BATCH_SIZE = 50


def authorize_operator() -> None:
    job_token_var.set(exchange_api_key_for_jwt())
    job_session_var.set(None)


def mongo(action: str, collection: str, **kwargs: Any) -> Any:
    request = {"action": action, "collection": collection, **kwargs}
    for attempt in range(1, 6):
        try:
            return call_resource("mongo", request)
        except Exception as exc:
            if attempt == 5:
                raise
            delay = attempt * 2
            print(
                f"Mongo {action} attempt {attempt} failed; retrying in "
                f"{delay}s: {exc}",
                file=sys.stderr,
            )
            time.sleep(delay)
    raise RuntimeError("unreachable")


def batches(values: list[Any]) -> Iterable[list[Any]]:
    for start in range(0, len(values), BATCH_SIZE):
        yield values[start:start + BATCH_SIZE]


def duplicate_groups() -> list[dict[str, Any]]:
    return mongo(
        "aggregate",
        "diarizations",
        pipeline=[
            {"$match": {"runId": "legacy-v0"}},
            {"$group": {
                "_id": {
                    "runId": "$runId",
                    "originalId": "$original_id",
                    "start": "$start",
                    "end": "$end",
                    "speaker": "$speaker",
                },
                "documents": {"$push": {
                    "id": "$_id",
                    "createdAt": "$created_at",
                    "matched": {"$eq": [{"$type": "$matched_speaker"}, "object"]},
                    "similarity": {"$ifNull": ["$matched_speaker.similarity", -1]},
                }},
                "count": {"$sum": 1},
            }},
            {"$match": {"count": {"$gt": 1}}},
            {"$sort": {"_id.originalId": 1, "_id.start": 1}},
        ],
        options={"allowDiskUse": True, "maxTimeMS": 120_000},
    ) or []


def keeper_and_duplicates(group: dict[str, Any]) -> tuple[Any, list[Any]]:
    documents = sorted(
        group["documents"],
        key=lambda item: (
            not bool(item.get("matched")),
            -float(item.get("similarity", -1)),
            item.get("createdAt") or datetime.max.replace(tzinfo=UTC),
            str(item["id"]),
        ),
    )
    return documents[0]["id"], [item["id"] for item in documents[1:]]


def duplicate_ids(groups: list[dict[str, Any]]) -> list[Any]:
    return [
        duplicate_id
        for group in groups
        for duplicate_id in keeper_and_duplicates(group)[1]
    ]


def report(groups: list[dict[str, Any]]) -> None:
    extras = sum(group["count"] - 1 for group in groups)
    largest = max((group["count"] for group in groups), default=0)
    print(
        f"Exact legacy-v0 duplicates: groups={len(groups)}, "
        f"extraDocuments={extras}, largestGroup={largest}"
    )


def ensure_safe_to_apply() -> None:
    claimed = mongo(
        "count",
        "audio_chunks",
        query={"processing_by": {"$ne": None}},
    )
    config = mongo(
        "findOne",
        "configs",
        query={"_id": ObjectId("000000000000000000000000")},
        options={"projection": {"workers.diarization.paused": 1}},
    ) or {}
    paused = config.get("workers", {}).get("diarization", {}).get("paused") is True
    if claimed or not paused:
        raise RuntimeError(
            "Refusing cleanup until diarization is paused and all chunk claims "
            f"are released: paused={paused}, claimedChunks={claimed}"
        )


def back_up_documents(ids: list[Any], backup_run_id: str) -> int:
    backed_up = 0
    for id_batch in batches(ids):
        documents = mongo(
            "find",
            "diarizations",
            query={"_id": {"$in": id_batch}},
        ) or []
        operations = [{
            "updateOne": {
                "filter": {
                    "backupRunId": backup_run_id,
                    "originalDocumentId": document["_id"],
                },
                "update": {"$setOnInsert": {
                    "backupRunId": backup_run_id,
                    "originalDocumentId": document["_id"],
                    "backedUpAt": datetime.now(tz=UTC),
                    "document": document,
                }},
                "upsert": True,
            },
        } for document in documents]
        if operations:
            mongo(
                "bulkWrite",
                BACKUP_COLLECTION,
                operations=operations,
                options={"ordered": True},
            )
        backed_up += len(documents)
    return backed_up


def apply_cleanup(groups: list[dict[str, Any]], backup_run_id: str) -> None:
    ensure_safe_to_apply()
    ids = duplicate_ids(groups)
    if not ids:
        existing_backup = mongo(
            "count",
            BACKUP_COLLECTION,
            query={"backupRunId": backup_run_id},
        )
        print(
            f"Cleanup already complete: deleted=0, existingBackup={existing_backup}, "
            f"backupRunId={backup_run_id}"
        )
        return

    back_up_documents(ids, backup_run_id)
    backed_up = mongo(
        "count",
        BACKUP_COLLECTION,
        query={"backupRunId": backup_run_id},
    )
    if backed_up != len(ids):
        raise RuntimeError(
            f"Backup mismatch: expected={len(ids)}, backedUp={backed_up}"
        )

    for id_batch in batches(ids):
        mongo(
            "deleteMany",
            "diarizations",
            query={"_id": {"$in": id_batch}},
        )
    undeleted = mongo(
        "count",
        "diarizations",
        query={"_id": {"$in": ids}},
    )
    if undeleted:
        raise RuntimeError(f"Delete incomplete: {undeleted} document(s) remain")

    remaining = duplicate_groups()
    if remaining:
        raise RuntimeError(
            f"Cleanup incomplete: {len(remaining)} duplicate group(s) remain"
        )
    print(
        f"Cleanup complete: deleted={len(ids)}, backupCollection={BACKUP_COLLECTION}, "
        f"backupRunId={backup_run_id}"
    )


def restore_backup(backup_run_id: str) -> None:
    rows = mongo(
        "find",
        BACKUP_COLLECTION,
        query={"backupRunId": backup_run_id},
    ) or []
    restored = 0
    for row_batch in batches(rows):
        operations = [{
            "updateOne": {
                "filter": {"_id": row["document"]["_id"]},
                "update": {"$setOnInsert": row["document"]},
                "upsert": True,
            },
        } for row in row_batch]
        if operations:
            mongo(
                "bulkWrite",
                "diarizations",
                operations=operations,
                options={"ordered": True},
            )
        restored += len(operations)
    print(f"Restore complete: considered={restored}, backupRunId={backup_run_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-run")
    parser.add_argument("--restore-run")
    args = parser.parse_args()

    authorize_operator()
    if args.restore_run:
        restore_backup(args.restore_run)
        return

    groups = duplicate_groups()
    report(groups)
    if not args.apply:
        print("Dry run only. Add --apply after reviewing the report.")
        return

    backup_run_id = args.backup_run or (
        f"diarization-dedupe-{datetime.now(tz=UTC).strftime('%Y%m%dT%H%M%SZ')}-"
        f"{uuid4().hex[:8]}"
    )
    apply_cleanup(groups, backup_run_id)


if __name__ == "__main__":
    main()
