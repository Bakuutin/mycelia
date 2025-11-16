from __future__ import annotations

import argparse
import signal
from datetime import datetime, timezone
from typing import Optional

from .extraction import extract_conversations
from .logger import logger, setup_logging

signal.signal(signal.SIGINT, signal.SIG_DFL)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract conversations from transcripts",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  uv run python/convos.py --limit 10\n"
            "  uv run python/convos.py --limit 10 --force\n"
            "  uv run python/convos.py --not-later-than 1699564800\n"
        ),
    )
    parser.add_argument("--limit", type=int, default=None, help="Limit number of conversation chunks to process")
    parser.add_argument("--not-later-than", type=int, help="Process transcripts not later than this timestamp")
    parser.add_argument(
        "--model",
        type=str,
        choices=["small", "medium", "large"],
        default="small",
        help="LLM size to use for extraction",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force recreation of existing conversations (deletes and recreates)",
    )
    return parser


def parse_not_later_than(value: Optional[int]) -> Optional[datetime]:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(value, tz=timezone.utc)
    except ValueError:
        logger.error(f"Invalid datetime format: {value}")
        return None


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    setup_logging()
    not_later_than = parse_not_later_than(args.not_later_than)
    if args.not_later_than and not_later_than is None:
        return 1

    try:
        extract_conversations(
            limit=args.limit,
            not_later_than=not_later_than,
            model=args.model,
            force=args.force,
        )
    except Exception as exc:
        logger.exception(f"Error in main: {exc}")
        return 1

    return 0


__all__ = ["main"]
