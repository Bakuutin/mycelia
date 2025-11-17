#!/usr/bin/env python3
"""
Conversation extraction console application.

This script processes transcripts to extract conversations using LLM analysis.
"""

import argparse
from datetime import datetime

import pytz

from convos.config import logger, setup_logging
from convos.extractor import extract_conversations


def main():
    """Main function with argument parsing."""
    parser = argparse.ArgumentParser(
        description="Extract conversations from transcripts",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process new conversations only (skip existing)
  uv run python -m convos.cli --limit 10

  # Force recreation of all conversations
  uv run python -m convos.cli --limit 10 --force

  # Process from a specific timestamp
  uv run python -m convos.cli --not-later-than 1699564800
        """
    )
    parser.add_argument('--limit', type=int, default=None, help='Limit number of conversation chunks to process')
    parser.add_argument('--not-later-than', type=int, help='Process transcripts not later than this timestamp')
    parser.add_argument('--model', type=str, default='small', help='LLM model alias to use for extraction (default: small). Can be any model alias configured in the system.')
    parser.add_argument('--force', action='store_true', help='Force recreation of existing conversations (deletes and recreates)')
    args = parser.parse_args()

    setup_logging()

    not_later_than = None
    if args.not_later_than:
        try:
            not_later_than = datetime.fromtimestamp(args.not_later_than, tz=pytz.UTC)
        except ValueError:
            logger.error(f"Invalid datetime format: {args.not_later_than}")
            return 1

    try:
        extract_conversations(
            limit=args.limit,
            not_later_than=not_later_than,
            model=args.model,
            force=args.force
        )
    except Exception as e:
        logger.exception(f"Error in main: {e}")
        return 1

    return 0


if __name__ == '__main__':
    exit(main())
