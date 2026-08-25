from __future__ import annotations

from datetime import UTC, datetime

from mycelia_rag.domain import Chunker, projection_fingerprint
from mycelia_rag.sources import (
    adapt_media_visual_description,
    adapt_message,
    adapt_object,
    adapt_transcription,
    source_schema_fingerprint,
)


def test_transcription_falls_back_to_segments_and_links_time_range() -> None:
    source = adapt_transcription(
        {
            "_id": "t1",
            "segments": [{"text": "Привет"}, {"text": "мир"}],
            "start": datetime(2026, 1, 1, tzinfo=UTC),
            "end": datetime(2026, 1, 1, 0, 1, tzinfo=UTC),
        }
    )
    assert source is not None
    assert source.text == "Привет мир"
    assert source.uri.startswith("/transcript?start=")
    assert "end=" in source.uri


def test_message_uses_raw_content_and_native_chat_route() -> None:
    source = adapt_message(
        {
            "_id": "m1",
            "raw": {"content": "fallback", "role": "user"},
            "platform": "mycelia",
            "chatId": "c1",
            "timestamp": "2026-01-01T00:00:00Z",
        }
    )
    assert source is not None
    assert source.text == "fallback"
    assert source.uri == "/chat/c1"


def test_object_combines_name_alias_details_and_summaries() -> None:
    source = adapt_object(
        {
            "_id": "o1",
            "name": "Mycelia",
            "aliases": ["Мицелий"],
            "details": "Knowledge system",
            "summaries": [{"summary": "Personal graph"}],
            "isProject": True,
        }
    )
    assert source is not None
    assert all(value in source.text for value in ("Mycelia", "Мицелий", "Personal graph"))
    assert source.metadata["objectType"] == "project"
    assert source.uri == "/objects/o1"


def test_inactive_media_projection_is_not_indexed() -> None:
    assert (
        adapt_media_visual_description(
            {"_id": "run-1", "active": False, "searchText": "private photo"}
        )
        is None
    )


def test_media_projection_has_asset_link_and_search_text() -> None:
    source = adapt_media_visual_description(
        {
            "_id": "run-2",
            "assetId": "asset-7",
            "runId": "run-2",
            "active": True,
            "searchText": "OCR exact phrase",
            "visualUnderstanding": {"description": "A mountain at dusk"},
        }
    )
    assert source is not None
    assert "OCR exact phrase" in source.text
    assert "mountain" in source.text
    assert source.uri == "/media?assetId=asset-7"


def test_chunk_ids_are_stable_within_projection_and_generation_specific() -> None:
    source = adapt_message({"_id": "m1", "text": "one two three", "platform": "telegram"})
    assert source is not None
    chunk = Chunker(size=20, overlap=2).split(source)[0]
    assert chunk.point_id("projection-a") == chunk.point_id("projection-a")
    assert chunk.point_id("projection-a") != chunk.point_id("projection-b")


def test_projection_fingerprint_tracks_schema_chunker_and_models() -> None:
    schema = source_schema_fingerprint()
    first, model = projection_fingerprint(
        source_schema_fingerprint=schema,
        chunker_fingerprint="chunk-a",
        dense_model="dense",
        sparse_model="bm25",
        dense_dimensions=384,
    )
    second, _ = projection_fingerprint(
        source_schema_fingerprint=schema,
        chunker_fingerprint="chunk-b",
        dense_model="dense",
        sparse_model="bm25",
        dense_dimensions=384,
    )
    assert first != second
    assert len(first) == len(model) == 64
