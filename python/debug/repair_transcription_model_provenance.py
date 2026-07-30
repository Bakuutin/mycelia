#!/usr/bin/env python3
"""Audit or correct historical remote-STT model provenance.

This is intentionally a bounded repair. It does not change transcript text or
audio; it only changes ``transcriptions.metadata.model`` for records whose
stored remote model is ``large-v3``. The default is a dry run.

Examples (run from ``python/``):

    uv run debug/repair_transcription_model_provenance.py
    uv run debug/repair_transcription_model_provenance.py --apply --confirm-turbo

Only use ``--apply`` when there is evidence that the affected historical
requests were processed by Turbo. The repair records that decision in
``metadata.modelCorrection`` on every changed document.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

from lib.api import exchange_api_key_for_jwt, job_session_var, job_token_var
from lib.resources import call_resource


OLD_MODEL = "large-v3"
NEW_MODEL = "large-v3-turbo"
PROVIDER = "remote_openai_compatible"
SAMPLE_LIMIT = 10


def authorize_operator() -> None:
    """Obtain an operator JWT for a standalone maintenance run."""
    job_token_var.set(exchange_api_key_for_jwt())
    job_session_var.set(None)


def mongo(action: str, **kwargs: Any) -> Any:
    return call_resource(
        "mongo",
        {"action": action, "collection": "transcriptions", **kwargs},
    )


def parse_date(value: str) -> datetime:
    """Parse an ISO timestamp and normalize it to UTC."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def build_query(args: argparse.Namespace) -> dict[str, Any]:
    query: dict[str, Any] = {
        "metadata.model": OLD_MODEL,
        "metadata.provider": PROVIDER,
    }
    bounds: dict[str, datetime] = {}
    if args.start_after:
        bounds["$gt"] = parse_date(args.start_after)
    if args.start_before:
        bounds["$lt"] = parse_date(args.start_before)
    if bounds:
        query["start"] = bounds
    return query


def sample(query: dict[str, Any]) -> list[dict[str, Any]]:
    return mongo(
        "find",
        query=query,
        options={
            "limit": SAMPLE_LIMIT,
            "sort": {"start": 1, "_id": 1},
            "projection": {
                "_id": 1,
                "original": 1,
                "start": 1,
                "metadata.model": 1,
                "metadata.provider": 1,
            },
        },
    ) or []


def format_sample(documents: list[dict[str, Any]]) -> None:
    for document in documents:
        metadata = document.get("metadata") or {}
        print(
            f"  id={document.get('_id')} start={document.get('start')} "
            f"model={metadata.get('model')} provider={metadata.get('provider')}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the correction; without this flag the script is read-only",
    )
    parser.add_argument(
        "--confirm-turbo",
        action="store_true",
        help="required with --apply to confirm historical Turbo provenance",
    )
    parser.add_argument(
        "--start-after",
        help="optional ISO timestamp; include records whose start is after it",
    )
    parser.add_argument(
        "--start-before",
        help="optional ISO timestamp; include records whose start is before it",
    )
    args = parser.parse_args()

    if args.apply and not args.confirm_turbo:
        parser.error("--apply requires --confirm-turbo")

    authorize_operator()
    query = build_query(args)
    total = mongo("count", query=query) or 0
    print(f"Matching transcriptions: {total}")
    print(f"Filter: provider={PROVIDER}, metadata.model={OLD_MODEL}")
    if args.start_after or args.start_before:
        print(
            f"Time bounds: after={args.start_after or '-'} "
            f"before={args.start_before or '-'}"
        )
    print("Sample:")
    format_sample(sample(query))

    if not args.apply:
        print("Dry run only. Re-run with --apply --confirm-turbo to write changes.")
        return 0

    if total == 0:
        print("Nothing to update.")
        return 0

    correction = {
        "from": OLD_MODEL,
        "to": NEW_MODEL,
        "reason": "Historical remote STT model relabelled after deployment audit",
        "correctedAt": datetime.now(timezone.utc),
    }
    result = mongo(
        "updateMany",
        query=query,
        update={
            "$set": {
                "metadata.model": NEW_MODEL,
                "metadata.modelCorrection": correction,
            },
        },
    ) or {}
    modified = result.get("modifiedCount", 0)
    print(f"Updated transcriptions: {modified}/{total}")
    return 0 if modified == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
