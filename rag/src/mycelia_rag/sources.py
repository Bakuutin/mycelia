from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

from .domain import CanonicalSource, fingerprint

PAYLOAD_SCHEMA_VERSION = "rag-evidence-v2"
OBJECT_ID_PATTERN = re.compile(r"^[a-fA-F0-9]{24}$")


def _id(value: Any) -> str:
    return str(value)


def _datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            return None
    return None


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _flatten_text(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        output: list[str] = []
        for item in value:
            output.extend(_flatten_text(item))
        return output
    if isinstance(value, dict):
        output = []
        for key in ("summary", "text", "content", "description", "caption", "label"):
            output.extend(_flatten_text(value.get(key)))
        return output
    return []


@dataclass(frozen=True, slots=True)
class SourceAdapter:
    kind: str
    collection: str
    schema_version: str
    projection: dict[str, int]
    mongo_filter: dict[str, Any]
    adapt: Callable[[dict[str, Any]], CanonicalSource | None]


def adapt_transcription(doc: dict[str, Any]) -> CanonicalSource | None:
    text = _text(doc.get("text"))
    if not text:
        text = " ".join(
            _text(segment.get("text")) for segment in doc.get("segments", []) if segment
        )
    if not text:
        return None
    source_id = _id(doc["_id"])
    original = doc.get("original")
    start = _datetime(doc.get("start"))
    end = _datetime(doc.get("end"))
    query = urlencode(
        {
            key: value.isoformat()
            for key, value in (("start", start), ("end", end))
            if value is not None
        }
    )
    return CanonicalSource(
        kind="transcription",
        collection="transcriptions",
        source_id=source_id,
        uri=f"/transcript?{query}" if query else "/transcript",
        text=text,
        title=f"Transcription {original}" if original else None,
        start=start,
        end=end,
        updated_at=_datetime(doc.get("updatedAt")) or _datetime(doc.get("end")),
        metadata={
            "original": _id(original) if original is not None else None,
            "evidenceGroup": (f"recording:{_id(original)}" if original is not None else None),
        },
    )


def adapt_message(doc: dict[str, Any]) -> CanonicalSource | None:
    raw = doc.get("raw") if isinstance(doc.get("raw"), dict) else {}
    text = _text(doc.get("text")) or _text(raw.get("content"))
    if not text:
        return None
    source_id = _id(doc["_id"])
    timestamp = _datetime(doc.get("timestamp"))
    platform = _text(doc.get("platform")) or None
    chat_id = _id(doc.get("chatId")) if doc.get("chatId") is not None else None
    sender_id = _id(doc.get("senderId")) if doc.get("senderId") is not None else None
    route = "chat" if platform == "mycelia" else "messaging"
    route_path = f"/{route}/{chat_id}" if chat_id else f"/{route}"
    exact_message_query = (
        urlencode({"messageId": source_id})
        if chat_id and OBJECT_ID_PATTERN.fullmatch(chat_id)
        else None
    )
    return CanonicalSource(
        kind="message",
        collection="messages",
        source_id=source_id,
        uri=f"{route_path}?{exact_message_query}" if exact_message_query else route_path,
        text=text,
        title=(
            f"{platform} · {chat_id}"
            if platform and chat_id
            else (platform or (f"Message · {chat_id}" if chat_id else "Message"))
        ),
        start=timestamp,
        end=timestamp,
        updated_at=_datetime(doc.get("updatedAt")) or timestamp,
        metadata={
            "platform": platform,
            "chatId": chat_id,
            "role": raw.get("role"),
            "senderId": sender_id,
            "evidenceGroup": (f"chat:{platform or 'messages'}:{chat_id}" if chat_id else None),
        },
    )


OBJECT_TYPE_FLAGS = (
    ("person", "isPerson"),
    ("event", "isEvent"),
    ("relationship", "isRelationship"),
    ("promise", "isPromise"),
    ("place", "isPlace"),
    ("organization", "isOrganization"),
    ("product", "isProduct"),
    ("project", "isProject"),
    ("animal", "isAnimal"),
    ("concept", "isConcept"),
    ("media", "isMedia"),
)


def adapt_object(doc: dict[str, Any]) -> CanonicalSource | None:
    name = _text(doc.get("name"))
    aliases = [_text(value) for value in doc.get("aliases", []) if _text(value)]
    sections = [name]
    if aliases:
        sections.append("Aliases: " + ", ".join(aliases))
    sections.extend(_flatten_text(doc.get("details")))
    sections.extend(_flatten_text(doc.get("summaries")))
    text = "\n\n".join(section for section in sections if section)
    if not text:
        return None
    ranges = doc.get("timeRanges") if isinstance(doc.get("timeRanges"), list) else []
    canonical_ranges: list[dict[str, str | None]] = []
    for item in ranges:
        if not isinstance(item, dict):
            continue
        range_start = _datetime(item.get("start"))
        range_end = _datetime(item.get("end"))
        if range_start or range_end:
            canonical_ranges.append(
                {
                    "start": range_start.isoformat() if range_start else None,
                    "end": range_end.isoformat() if range_end else None,
                }
            )
    starts = [_datetime(item.get("start")) for item in ranges if isinstance(item, dict)]
    ends = [_datetime(item.get("end")) for item in ranges if isinstance(item, dict)]
    open_ended = any(
        isinstance(item, dict)
        and _datetime(item.get("start")) is not None
        and _datetime(item.get("end")) is None
        for item in ranges
    )
    starts = [value for value in starts if value]
    ends = [value for value in ends if value]
    kind = next((label for label, flag in OBJECT_TYPE_FLAGS if doc.get(flag) is True), "object")
    source_id = _id(doc["_id"])
    return CanonicalSource(
        kind="object",
        collection="objects",
        source_id=source_id,
        uri=f"/objects/{source_id}",
        text=text,
        title=name or None,
        start=min(starts) if starts else _datetime(doc.get("createdAt")),
        end=None if open_ended else (max(ends) if ends else None),
        updated_at=_datetime(doc.get("updatedAt")) or _datetime(doc.get("createdAt")),
        metadata={
            "objectType": kind,
            "aliases": aliases,
            "timeOpenEnded": open_ended,
            # The aggregate start/end below are only a candidate envelope.
            # Include every canonical interval in the advertised revision.
            "timeRanges": canonical_ranges,
        },
    )


def adapt_media_visual_description(doc: dict[str, Any]) -> CanonicalSource | None:
    if doc.get("active") is False:
        return None
    parts = _flatten_text(doc.get("searchText"))
    parts.extend(_flatten_text(doc.get("visualUnderstanding")))
    text = "\n\n".join(dict.fromkeys(part for part in parts if part))
    if not text:
        return None
    source_id = _id(doc["_id"])
    asset_id = _id(doc.get("assetId")) if doc.get("assetId") is not None else None
    return CanonicalSource(
        kind="media_visual_description",
        collection="media_visual_descriptions",
        source_id=source_id,
        uri=f"/media?{urlencode({'assetId': asset_id})}" if asset_id else "/media",
        text=text,
        title=f"Media {asset_id}" if asset_id else None,
        updated_at=_datetime(doc.get("updatedAt")) or _datetime(doc.get("createdAt")),
        metadata={"assetId": asset_id, "runId": _id(doc.get("runId"))},
    )


SOURCE_ADAPTERS = (
    SourceAdapter(
        kind="transcription",
        collection="transcriptions",
        schema_version="transcription-v1",
        projection={
            "_id": 1,
            "text": 1,
            "segments.text": 1,
            "start": 1,
            "end": 1,
            "updatedAt": 1,
            "original": 1,
        },
        mongo_filter={},
        adapt=adapt_transcription,
    ),
    SourceAdapter(
        kind="message",
        collection="messages",
        schema_version="message-v1",
        projection={
            "_id": 1,
            "text": 1,
            "raw.content": 1,
            "raw.role": 1,
            "timestamp": 1,
            "updatedAt": 1,
            "platform": 1,
            "chatId": 1,
            "senderId": 1,
        },
        mongo_filter={},
        adapt=adapt_message,
    ),
    SourceAdapter(
        kind="object",
        collection="objects",
        schema_version="object-v1",
        projection={
            "_id": 1,
            "name": 1,
            "aliases": 1,
            "details": 1,
            "summaries": 1,
            "timeRanges": 1,
            "createdAt": 1,
            "updatedAt": 1,
            **{flag: 1 for _, flag in OBJECT_TYPE_FLAGS},
        },
        mongo_filter={},
        adapt=adapt_object,
    ),
    SourceAdapter(
        kind="media_visual_description",
        collection="media_visual_descriptions",
        schema_version="media-visual-v1",
        projection={
            "_id": 1,
            "assetId": 1,
            "runId": 1,
            "active": 1,
            "searchText": 1,
            "visualUnderstanding": 1,
            "createdAt": 1,
            "updatedAt": 1,
        },
        mongo_filter={"active": {"$ne": False}},
        adapt=adapt_media_visual_description,
    ),
)

ADAPTER_BY_COLLECTION = {adapter.collection: adapter for adapter in SOURCE_ADAPTERS}


def source_schema_fingerprint(adapters: Iterable[SourceAdapter] = SOURCE_ADAPTERS) -> str:
    return fingerprint(
        {
            "payloadSchemaVersion": PAYLOAD_SCHEMA_VERSION,
            "adapters": [
                {
                    "kind": adapter.kind,
                    "collection": adapter.collection,
                    "version": adapter.schema_version,
                    "projection": adapter.projection,
                    "filter": adapter.mongo_filter,
                }
                for adapter in adapters
            ],
        }
    )
