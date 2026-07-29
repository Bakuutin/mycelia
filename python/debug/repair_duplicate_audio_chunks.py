#!/usr/bin/env python3
"""Audit and safely repair duplicate ``audio_chunks``.

Examples:
    uv run python debug/repair_duplicate_audio_chunks.py --source-id <ObjectId>
    uv run python debug/repair_duplicate_audio_chunks.py --source-id <ObjectId> --apply
    uv run python debug/repair_duplicate_audio_chunks.py --all
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from bson import ObjectId

sys.path.insert(0, str(Path(__file__).parent.parent))

from lib.api import exchange_api_key_for_jwt, job_session_var, job_token_var
from lib.resources import call_resource


BATCH_SIZE = 500


def authorize_operator() -> None:
    """Explicitly obtain an operator JWT for a standalone maintenance run."""
    job_token_var.set(exchange_api_key_for_jwt())
    job_session_var.set(None)


def mongo(action: str, collection: str, **kwargs: Any) -> Any:
    return call_resource("mongo", {"action": action, "collection": collection, **kwargs})


def batches(values: list[Any]) -> Iterable[list[Any]]:
    for start in range(0, len(values), BATCH_SIZE):
        yield values[start:start + BATCH_SIZE]


def duplicate_groups(source_id: ObjectId | None) -> list[dict[str, Any]]:
    match: dict[str, Any] = {} if source_id is None else {"original_id": source_id}
    # Mongo compares Binary values here: this is an exact bytes check, without
    # transferring every OPUS payload to the local script.
    return mongo("aggregate", "audio_chunks", pipeline=[
        {"$match": match},
        {"$sort": {"original_id": 1, "index": 1, "_id": 1}},
        {"$group": {
            "_id": {"source": "$original_id", "index": "$index"},
            "count": {"$sum": 1},
            "dataCount": {"$sum": {"$cond": [
                {"$eq": [{"$type": "$data"}, "binData"]}, 1, 0,
            ]}},
            "ids": {"$push": "$_id"},
            "minData": {"$min": "$data"},
            "maxData": {"$max": "$data"},
        }},
        {"$match": {"count": {"$gt": 1}}},
        {"$project": {
            "count": 1,
            "ids": 1,
            "byteIdentical": {"$eq": ["$minData", "$maxData"]},
            "allHaveAudio": {"$eq": ["$dataCount", "$count"]},
        }},
        {"$sort": {"_id.source": 1, "_id.index": 1}},
    ]) or []


def by_source(groups: list[dict[str, Any]]) -> dict[ObjectId, list[dict[str, Any]]]:
    result: dict[ObjectId, list[dict[str, Any]]] = defaultdict(list)
    for group in groups:
        result[group["_id"]["source"]].append(group)
    return result


def source_counts(source_id: ObjectId, groups: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "groups": len(groups),
        "extra": sum(group["count"] - 1 for group in groups),
        "sequences": mongo("count", "transcription_sequences", query={"original_id": source_id}),
        "transcriptions": mongo("count", "transcriptions", query={"original": source_id}),
        "conversation_chunks": mongo("count", "conversation_chunks", query={"original_id": source_id}),
    }


def report(grouped: dict[ObjectId, list[dict[str, Any]]]) -> None:
    if not grouped:
        print("No duplicate (original_id, index) audio chunks found.")
        return
    print("Duplicate audio-chunk report")
    for source_id, groups in grouped.items():
        counts = source_counts(source_id, groups)
        unsafe = [g for g in groups if g["count"] != 2 or not g["byteIdentical"] or not g["allHaveAudio"]]
        print(
            f"{source_id}: {'BLOCKED' if unsafe else 'repairable'}; "
            f"{counts['groups']} duplicate indexes / {counts['extra']} extra chunks; "
            f"derived: {counts['sequences']} sequences, {counts['transcriptions']} transcriptions, "
            f"{counts['conversation_chunks']} conversation chunks",
        )
        for group in unsafe[:10]:
            print(f"  index {group['_id']['index']}: count={group['count']}, bytes={group['byteIdentical']}, audio={group['allHaveAudio']}")


def ensure_safe(source_id: ObjectId, groups: list[dict[str, Any]]) -> None:
    unsafe = [g for g in groups if g["count"] != 2 or not g["byteIdentical"] or not g["allHaveAudio"]]
    processing_sequences = mongo("count", "transcription_sequences", query={"original_id": source_id, "state": "processing"})
    claimed_chunks = mongo("count", "audio_chunks", query={"original_id": source_id, "processing_by": {"$ne": None}})
    if unsafe or processing_sequences or claimed_chunks:
        raise RuntimeError(
            f"Refusing repair for {source_id}: unsafeGroups={len(unsafe)}, "
            f"processingSequences={processing_sequences}, claimedChunks={claimed_chunks}",
        )


def delete_conversation_derivatives(source_id: ObjectId) -> int:
    chunks = mongo("find", "conversation_chunks", query={"original_id": source_id}, options={"projection": {"_id": 1}}) or []
    chunk_ids = [str(chunk["_id"]) for chunk in chunks]
    if not chunk_ids:
        return 0
    conversations = mongo(
        "find", "objects",
        query={"isConversation": True, "metadata.extractedWith.chunkId": {"$in": chunk_ids}},
        options={"projection": {"_id": 1}},
    ) or []
    conversation_ids = [conversation["_id"] for conversation in conversations]
    if conversation_ids:
        mongo("deleteMany", "objects", query={"isRelationship": True, "relationship.subject": {"$in": conversation_ids}})
        mongo("deleteMany", "objects", query={"_id": {"$in": conversation_ids}})
    mongo("deleteMany", "conversation_chunks", query={"original_id": source_id})
    return len(conversation_ids)


def repair(source_id: ObjectId, groups: list[dict[str, Any]]) -> None:
    ensure_safe(source_id, groups)
    duplicate_ids = [group["ids"][1] for group in groups]
    deleted_conversations = delete_conversation_derivatives(source_id)
    mongo("deleteMany", "transcriptions", query={"original": source_id})
    mongo("deleteMany", "transcription_sequences", query={"original_id": source_id})
    for ids in batches(duplicate_ids):
        mongo("deleteMany", "audio_chunks", query={"_id": {"$in": ids}})
    # Keep VAD (it describes unchanged audio); reset every derived STT field.
    mongo("updateMany", "audio_chunks", query={"original_id": source_id}, update={
        "$set": {"transcribed_at": None, "processing_by": None, "claimed_at": None},
        "$unset": {"transcription_sequence_id": ""},
    })
    print(f"{source_id}: deleted {len(duplicate_ids)} audio copies and {deleted_conversations} derived conversation object(s).")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--source-id")
    target.add_argument("--all", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    authorize_operator()
    source_id = ObjectId(args.source_id) if args.source_id else None
    grouped = by_source(duplicate_groups(source_id))
    report(grouped)
    if not args.apply:
        print("Dry run only. Add --apply after reviewing the report.")
        return
    for affected_source, groups in grouped.items():
        repair(affected_source, groups)
    if duplicate_groups(source_id):
        raise RuntimeError("Duplicate groups remain after repair.")
    print("Repair complete. Run sequence creation, then transcription, in Jobs → Pipeline health & recovery.")


if __name__ == "__main__":
    main()
