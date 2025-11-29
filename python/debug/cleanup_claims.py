"""
Debug helper to inspect and clear stuck diarization claims.

Usage:
    uv run python/debug/cleanup_claims.py            # show current claims
    uv run python/debug/cleanup_claims.py --clean    # clear claims (if safe)
"""
from __future__ import annotations

import argparse
import os
import subprocess
from datetime import datetime, timezone
from typing import Any, Iterable

from lib.resources import call_resource

PROCESS_HINT = "diarization_worker.py"


def detect_running_workers() -> list[dict[str, Any]]:
    """Return a list of running diarization worker processes on this host."""
    try:
        result = subprocess.run(
            ["ps", "-axo", "pid=,command="],
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception as exc:  # pragma: no cover - ps should exist on mac/linux
        print(f"Unable to inspect running processes: {exc}")
        return []

    processes: list[dict[str, Any]] = []
    for line in result.stdout.strip().splitlines():
        if PROCESS_HINT not in line:
            continue

        parts = line.strip().split(maxsplit=1)
        if not parts:
            continue

        try:
            pid = int(parts[0])
        except ValueError:
            continue

        if pid == os.getpid():
            continue

        processes.append({"pid": pid, "command": parts[1] if len(parts) > 1 else ""})

    return processes


def fetch_claim_stats(collection: str, worker_id: str | None) -> list[dict[str, Any]]:
    """Aggregate claimed chunks by worker id."""
    if worker_id:
        match: dict[str, Any] = {"processing_by": worker_id}
    else:
        match = {"processing_by": {"$ne": None}}

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": "$processing_by",
                "count": {"$sum": 1},
                "oldest_claimed_at": {"$min": "$claimed_at"},
                "newest_claimed_at": {"$max": "$claimed_at"},
            }
        },
        {"$sort": {"count": -1}},
    ]

    stats = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "aggregate",
            "collection": collection,
            "pipeline": pipeline,
        },
    )
    return stats or []


def clear_claims(collection: str, worker_ids: Iterable[str] | None) -> int:
    """Reset processing_by/claimed_at for the selected chunks."""
    query: dict[str, Any] = {"processing_by": {"$ne": None}}
    if worker_ids:
        query["processing_by"]["$in"] = list(worker_ids)

    result = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "updateMany",
            "collection": collection,
            "query": query,
            "update": {"$set": {"processing_by": None, "claimed_at": None}},
        },
    )
    return result.get("modifiedCount", 0)


def format_ts(value: Any) -> str:
    if not value:
        return "-"
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect and clean stuck diarization claims.")
    parser.add_argument("--collection", default="audio_chunks", help="Mongo collection name")
    parser.add_argument("--worker-id", help="Limit output/cleanup to a specific worker id")
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Reset processing_by/claimed_at after verifying no workers are running.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip the running-worker check (use with caution).",
    )
    args = parser.parse_args()

    stats = fetch_claim_stats(args.collection, args.worker_id)
    if not stats:
        print("No claimed chunks found.")
        return

    print(f"Found {sum(item['count'] for item in stats)} claimed chunk(s) across {len(stats)} worker(s):")
    for item in stats:
        worker = item.get("_id") or "<unknown>"
        count = item.get("count", 0)
        oldest = format_ts(item.get("oldest_claimed_at"))
        newest = format_ts(item.get("newest_claimed_at"))
        print(f"  {worker:30}  {count:5d}  oldest={oldest}  newest={newest}")

    if not args.clean:
        print("\nUse --clean to clear these claims once you have stopped all workers.")
        return

    if not args.force:
        running = detect_running_workers()
        if running:
            print("Refusing to clean claims while diarization workers are still running:")
            for proc in running:
                print(f"  PID {proc['pid']}: {proc['command']}")
            print("Stop those processes or re-run with --force if you are sure they are stale.")
            return

    worker_filter = [args.worker_id] if args.worker_id else None
    cleared = clear_claims(args.collection, worker_filter)
    print(f"Cleared {cleared} chunk(s).")


if __name__ == "__main__":
    main()
