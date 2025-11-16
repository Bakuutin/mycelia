from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Generator, Iterable, List, Optional, TypedDict, Union

from lib.hist import get_ranges
from lib.resources import call_resource

from .logger import logger

DEFAULT_SCALE = "1day"


class Transcript(TypedDict):
    start: datetime
    end: datetime
    text: str


def utc(value: Union[datetime, int]) -> datetime:
    if isinstance(value, int):
        value = datetime.fromtimestamp(value, tz=timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def allowed_gap(length: int) -> timedelta:
    if length < 500:
        return timedelta(minutes=45)
    if length < 20000:
        return timedelta(minutes=5)
    return timedelta(seconds=40)


def get_silence_message(gap: timedelta) -> str:
    minutes = gap.total_seconds() / 60
    seconds = gap.total_seconds() % 60
    return f"silence for {minutes:.0f}m {seconds:.0f}s"


def get_timestamp_message(timestamp: datetime) -> str:
    return f"time: {utc(timestamp).isoformat()}"


def iterate_transcripts(
    not_later_than: Optional[datetime] = None,
    batch_size: int = 100,
    scale: str = DEFAULT_SCALE,
) -> Generator[Transcript, None, None]:
    known_ranges = [range_info for range_info in get_ranges("conversations", scale) if range_info.done]

    def shift_if_in_known_range(cursor: datetime) -> datetime:
        for range_info in known_ranges:
            if range_info.start is not None and range_info.end is not None:
                if range_info.start <= cursor <= range_info.end:
                    return range_info.start
        return cursor

    cursor = not_later_than or datetime.now(timezone.utc) + timedelta(days=1)

    while cursor:
        cursor = shift_if_in_known_range(cursor)
        transcripts = call_resource(
            "tech.mycelia.mongo",
            {
                "action": "find",
                "collection": "transcriptions",
                "query": {"start": {"$lt": cursor}},
                "options": {
                    "sort": {"start": -1},
                    "limit": batch_size,
                },
            },
        )
        logger.debug(f"Fetched {len(transcripts)} transcripts")

        if len(transcripts) < 2:
            return

        while len(transcripts) >= 2 and transcripts[-1]["start"] == transcripts[-2]["start"]:
            transcripts = transcripts[:-1]

        if len(transcripts) < 2:
            return

        cursor = transcripts[-1]["start"]

        for transcript in transcripts:
            yield {
                "start": transcript["start"],
                "end": transcript["end"],
                "text": "".join(segment["text"] for segment in transcript["segments"]).strip(),
            }


def iterate_conversations(
    not_later_than: Optional[datetime] = None,
    scale: str = DEFAULT_SCALE,
) -> Generator[List[Transcript], None, None]:
    buffer: List[Transcript] = []
    total_len = 0
    last_timestamp: Optional[datetime] = None

    for transcript in iterate_transcripts(not_later_than, scale=scale):
        if last_timestamp is None:
            last_timestamp = transcript["start"]

        gap = last_timestamp - transcript["start"]

        if buffer and total_len > 100 and gap > allowed_gap(total_len):
            yield sorted(buffer, key=lambda item: item["start"])
            buffer = []
            total_len = 0

        buffer.append(transcript)
        total_len += len(transcript["text"])
        last_timestamp = transcript["start"]

    if buffer:
        yield sorted(buffer, key=lambda item: item["start"])


def chunk_to_prompt(chunk: Iterable[Transcript]) -> tuple[str, datetime, datetime]:
    items = list(chunk)
    if not items:
        raise ValueError("chunk must contain at least one transcript")

    earliest = items[0]["start"]
    latest = items[0]["end"]
    segments = [get_timestamp_message(earliest)]

    for entry in items:
        gap = entry["start"] - latest
        if gap > timedelta(seconds=30):
            segments.append(get_timestamp_message(latest))
            segments.append(get_silence_message(gap))
            segments.append(get_timestamp_message(entry["start"]))
        segments.append(entry["text"])
        latest = max(latest, entry["end"])

    segments.append(get_timestamp_message(latest))
    return "\n".join(segments), earliest, latest


__all__ = [
    "DEFAULT_SCALE",
    "Transcript",
    "allowed_gap",
    "chunk_to_prompt",
    "get_silence_message",
    "get_timestamp_message",
    "iterate_conversations",
    "iterate_transcripts",
    "utc",
]
