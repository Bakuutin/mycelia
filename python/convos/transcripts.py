"""Transcript iteration and grouping logic."""

from datetime import datetime, timedelta

import pytz

from lib.resources import call_resource
from lib.hist import get_ranges

from convos.config import logger, scale
from convos.utils import allowed_gap


def iterate_transcripts(not_later_than: datetime | None = None, batch_size: int = 100):
    """
    Iterate through all transcripts in reverse chronological order.
    Yields one transcript at a time.
    """
    known_ranges = [
        r for r in get_ranges("conversations", scale) if r.done
    ]

    def shift_if_in_known_range(cursor: datetime) -> datetime:
        for range in known_ranges:
            if range.start is not None and range.end is not None:
                if range.start <= cursor <= range.end:
                    return range.start
        return cursor

    cursor = not_later_than or datetime.now(pytz.UTC) + timedelta(days=1)

    while cursor:
        cursor = shift_if_in_known_range(cursor)

        transcripts = call_resource(
            "mongo",
            {
                "action": "find",
                "collection": "transcriptions",
                "query": {"start": {"$lt": cursor}},
                "options": {
                    "sort": {"start": -1},
                    "limit": batch_size,
                },
            }
        )
        logger.debug(f"Fetched {len(transcripts)} transcripts")

        if len(transcripts) < 2:
            return

        # Handle edge case where last few transcripts have same timestamp
        while len(transcripts) >= 2 and transcripts[-1]["start"] == transcripts[-2]["start"]:
            transcripts = transcripts[:-1]

        if len(transcripts) < 2:
            return

        cursor = transcripts[-1]["start"]

        for transcript in transcripts:
            yield {
                'start': transcript["start"],
                'end': transcript["end"],
                'text': ''.join(s["text"] for s in transcript["segments"]).strip(),
            }


def iterate_conversations(not_later_than: datetime | None = None):
    """
    Group transcripts into conversation chunks based on timing gaps.
    """
    buffer = []
    total_len = 0
    last_timestamp = None

    for transcript in iterate_transcripts(not_later_than):
        if not last_timestamp:
            last_timestamp = transcript["start"]

        gap = (last_timestamp - transcript["start"])

        if buffer:
            if total_len > 100 and gap > allowed_gap(total_len):
                yield sorted(buffer, key=lambda x: x["start"])
                buffer = []
                total_len = 0

        buffer.append(transcript)
        total_len += len(transcript["text"])
        last_timestamp = transcript["start"]

    if buffer:
        yield sorted(buffer, key=lambda x: x["start"])

