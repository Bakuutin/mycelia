#!/usr/bin/env python3
"""Audit and repair duplicate audio chunks created by a retried ingestion.

The repair is source-scoped and dry-run by default. It removes only
byte-identical copies of the same ``(original_id, index)`` chunk, then clears
derived STT state so the normal pipeline can recreate it from the remaining
audio copy.

Usage:
    cd python
    uv run debug/repair_duplicate_audio_chunks.py --source-id <ObjectId>
    uv run debug/repair_duplicate_audio_chunks.py --source-id <ObjectId> --apply
    uv run debug/repair_duplicate_audio_chunks.py --all
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from bson import ObjectId

sys.path.insert(0, str(Path(__file__).parent.parent))

from lib.resources import call_resource


BATCH_SIZE = 500


def mongo(action: str, collection: str, **kwargs: Any) -> Any:
    return call_resource("mongo", {"action": action, "collection": collection, **kwargs})


def batches(values: list[Any], size: int = BATCH_SIZE) -> Iterable[list[Any]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


def find_duplicate_groups(source_id: ObjectId | None) -> list[dict[str, Any]]:
    match: dict[str, Any] = {}
    if source_id:
        match["original_id"] = source_id

    # $min/$max compare BSON binary values in Mongo. Thus byteIdentical is an
    # exact payload check without sending every opus blob through the API.
    pipeline = [
        {"$match": match},
        {"$sort": {"original_id": 1, "index": 1, "_id": 1}},
        {
            "$group": {
                "_id": {"original_id": "$original_id", "index": "$index"},
                "count": {"$sum": 1},
                "dataCount": {
                    "$sum": {
                        "$cond": [
                            {"$eq": [{"$type": "$data"}, "binData"]},
                            1,
                            0,
                        ]
                    }
                },
                "ids": {"$push": "$_id"},
                "minData": {"$min": "$data"},
                "maxData": {"$max": "$data"},
            }
        },
        {"$match": {"count": {"$gt": 1}}},
        {
            "$project": {
                "count": 1,
                "ids": 1,
                "byteIdentical": {"$eq": ["$minData", "$maxData"]},
                "allHaveAudio": {"$eq": ["$dataCount", "$count"]},
            }
        },
        {"$sort": {"_id.original_id": 1, "_id.index": 1}},
    ]
    return mongo("aggregate", "audio_chunks", pipeline=pipeline) or []


def source_summary(source_id: ObjectId, groups: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "duplicate_groups": len(groups),
        "duplicate_chunks": sum(group["count"] - 1 for group in groups),
        "sequences": mongo("count", "transcription_sequences", query={"original_id": source_id}),
        "transcriptions": mongo("count", "transcriptions", query={"original": source_id}),
        "conversation_chunks": mongo("count", "conversation_chunks", query={"original_id": source_id}),
    }


def print_report(by_source: dict[ObjectId, list[dict[str, Any]]]) -> None:
    if not by_source:
        print("No duplicate (original_id, index) audio chunks found.")
        return

    print("Duplicate audio-chunk report")
    print("=" * 74)
    for source_id, groups in by_source.items():
        summary = source_summary(source_id, groups)
        invalid = [
            g for g in groups
            if g["count"] != 2 or not g["byteIdentical"] or not g["allHaveAudio"]
        ]
        status = "BLOCKED" if invalid else "repairable"
        print(
            f"{source_id}: {status}; "
            f"{summary['duplicate_groups']} duplicate indexes / "
            f"{summary['duplicate_chunks']} extra chunks; "
            f"derived: {summary['sequences']} sequences, "
            f"{summary['transcriptions']} transcriptions, "
            f"{summary['conversation_chunks']} conversation chunks"
        )
        for group in invalid[:10]:
            print(
                f"  index {group['_id']['index']}: count={group['count']}, "
                f"byteIdentical={group['byteIdentical']}, allHaveAudio={group['allHaveAudio']}",
            )


def assert_repairable(groups: list[dict[str, Any]]) -> None:
    unsafe = [
        g for g in groups
        if g["count"] != 2 or not g["byteIdentical"] or not g["allHaveAudio"]
    ]
    if unsafe:
        raise RuntimeError(
            "Refusing repair: every group must contain exactly two byte-identical "
            f"chunks; found {len(unsafe)} unsafe group(s).",
        )


def assert_no_active_stt_work(source_id: ObjectId) -> None:
    active_sequences = mongo(
        "count",
        "transcription_sequences",
        query={"original_id": source_id, "state": "processing"},
    )
    active_chunks = mongo(
        "count",
        "audio_chunks",
        query={"original_id": source_id, "processing_by": {"$ne": None}},
    )
    if active_sequences or active_chunks:
        raise RuntimeError(
            f"Refusing repair while STT is active for {source_id}: "
            f"{active_sequences} processing sequence(s), {active_chunks} claimed chunk(s).",
        )


def delete_derived_conversations(source_id: ObjectId) -> int:
    chunks = mongo(
        "find",
        "conversation_chunks",
        query={"original_id": source_id},
        options={"projection": {"_id": 1}},
    ) or []
    chunk_ids = [str(chunk["_id"]) for chunk in chunks]
    if not chunk_ids:
        return 0

    conversations = mongo(
        "find",
        "objects",
        query={
            "isConversation": True,
            "metadata.extractedWith.chunkId": {"$in": chunk_ids},
        },
        options={"projection": {"_id": 1}},
    ) or []
    conversation_ids = [conversation["_id"] for conversation in conversations]
    if conversation_ids:
        mongo(
            "deleteMany",
            "objects",
            query={
                "isRelationship": True,
                "relationship.subject": {"$in": conversation_ids},
            },
        )
        mongo("deleteMany", "objects", query={"_id": {"$in": conversation_ids}})
    mongo("deleteMany", "conversation_chunks", query={"original_id": source_id})
    return len(conversation_ids)


def repair_source(source_id: ObjectId, groups: list[dict[str, Any]]) -> None:
    assert_repairable(groups)
    assert_no_active_stt_work(source_id)
    duplicate_ids = [group["ids"][1] for group in groups]

    # These are projections of the bad duplicated audio. Delete them before
    # resetting chunks so none point at a transcription being removed.
    deleted_conversations = delete_derived_conversations(source_id)
    mongo("deleteMany", "transcriptions", query={"original": source_id})
    mongo("deleteMany", "transcription_sequences", query={"original_id": source_id})

    for ids in batches(duplicate_ids):
        mongo("deleteMany", "audio_chunks", query={"_id": {"$in": ids}})

    # VAD belongs to unchanged audio and is kept. Clear only downstream state
    # so sequence creation, STT, and conversation extraction rebuild cleanly.
    mongo(
        "updateMany",
        "audio_chunks",
        query={"original_id": source_id},
        update={
            "$set": {
                "transcribed_at": None,
                "processing_by": None,
                "claimed_at": None,
            },
            "$unset": {"transcription_sequence_id": ""},
        },
    )

    print(
        f"{source_id}: deleted {len(duplicate_ids)} duplicate audio chunks; "
        f"cleared derived STT state; deleted {deleted_conversations} derived conversation object(s).",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--source-id", help="One source_files ObjectId to inspect or repair")
    target.add_argument("--all", action="store_true", help="Inspect or repair every affected source")
    parser.add_argument("--apply", action="store_true", help="Perform the repair; otherwise report only")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_id = ObjectId(args.source_id) if args.source_id else None
    groups = find_duplicate_groups(source_id)
    by_source: dict[ObjectId, list[dict[str, Any]]] = defaultdict(list)
    for group in groups:
        by_source[group["_id"]["original_id"]].append(group)

    print_report(by_source)
    if not args.apply:
        print("\nDry run only. Re-run with --apply after reviewing this report.")
        return

    for affected_source_id, source_groups in by_source.items():
        repair_source(affected_source_id, source_groups)

    remaining = find_duplicate_groups(source_id)
    if remaining:
        raise RuntimeError(f"Repair left {len(remaining)} duplicate group(s); inspect before retrying.")
    print("Repair complete. In Jobs → Pipeline health & recovery, run sequence creation, then transcription; conversation chunks and extraction rebuild from clean transcriptions.")


if __name__ == "__main__":
    main()
