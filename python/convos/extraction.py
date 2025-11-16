from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml
from langchain_core.messages import HumanMessage, SystemMessage

from lib.hist import SCALE_TO_RESOLUTION, date_to_bucket, mark_buckets_as
from lib.resources import call_resource
from lib.llm import get_llm

from .logger import logger
from .models import Conversation, ExtractConversationsInput
from .response_parser import extract_conversations_from_response
from .storage import (
    check_conversations_exist,
    create_conversation_object,
    create_mentioned_relationship,
    delete_conversations_in_range,
    find_or_create_entity,
)
from .transcripts import DEFAULT_SCALE, Transcript, chunk_to_prompt, iterate_conversations, utc


def setup_llm_tools(model: str = "small") -> Tuple[Any, str]:
    extract_conversations_tool = {
        "name": "extract_conversations",
        "description": "Extract and return the conversations from the transcript",
        "parameters": ExtractConversationsInput.model_json_schema(),
    }

    llm = get_llm(model)
    tool_llm = llm.bind_tools(
        [extract_conversations_tool],
        tool_choice={
            "type": "function",
            "function": {"name": "extract_conversations"},
        },
    )

    prompts_path = Path(__file__).resolve().parent.parent / "prompts.yml"
    with open(prompts_path, "r", encoding="utf-8") as handle:
        prompts = yaml.safe_load(handle)

    system_prompt = prompts["topics"]["system"]
    return tool_llm, system_prompt


def persist_debug_response(response: Any, model: str) -> None:
    if not hasattr(response, "content") or not response.content:
        return
    debug_file = os.path.expanduser("~/Library/mycelia/logs/llm_response_debug.txt")
    try:
        with open(debug_file, "w", encoding="utf-8") as handle:
            handle.write(f"Timestamp: {datetime.now(timezone.utc).isoformat()}\n")
            handle.write(f"Model: {model}\n")
            handle.write(f"Response Type: {type(response).__name__}\n")
            handle.write(f"Has tool_calls: {hasattr(response, 'tool_calls') and bool(response.tool_calls)}\n")
            handle.write(f"Content Length: {len(response.content)}\n")
            handle.write("\n" + "=" * 80 + "\n")
            handle.write("FULL RESPONSE CONTENT:\n")
            handle.write("=" * 80 + "\n\n")
            handle.write(response.content)
        logger.error(f"Saved full LLM response to {debug_file} for inspection")
    except Exception as exc:
        logger.debug(f"Failed to save debug file: {exc}")


def insert_conversations(objects_to_create: List[Dict[str, Any]]) -> List[Any]:
    result = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "insertMany",
            "collection": "objects",
            "docs": objects_to_create,
        },
    )
    inserted_ids = result.get("insertedIds", {})
    if isinstance(inserted_ids, dict):
        ordered_keys = sorted(inserted_ids.keys())
        return [inserted_ids[index] for index in ordered_keys]
    if isinstance(inserted_ids, list):
        return inserted_ids
    logger.error(f"Unexpected insertedIds type: {type(inserted_ids)}. Value: {inserted_ids}")
    return []


def insert_relationships(relationships: List[Dict[str, Any]]) -> int:
    if not relationships:
        return 0
    result = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "insertMany",
            "collection": "objects",
            "docs": relationships,
        },
    )
    inserted_ids = result.get("insertedIds", {})
    if isinstance(inserted_ids, dict):
        return len(inserted_ids)
    if isinstance(inserted_ids, list):
        return len(inserted_ids)
    return 0


def process_conversation_chunk(
    chunk: List[Transcript],
    tool_llm: Any,
    system_prompt: str,
    model: str = "small",
    force: bool = False,
) -> int:
    prompt, chunk_start, chunk_end = chunk_to_prompt(chunk)
    duration_seconds = int((chunk_end - chunk_start).total_seconds())
    hours = duration_seconds // 3600
    minutes = (duration_seconds % 3600) // 60
    seconds = duration_seconds % 60
    duration_text = f"{hours}h {minutes}m {seconds}s" if hours else f"{minutes}m {seconds}s"

    logger.info(f"Processing chunk: {chunk_start.strftime('%Y-%m-%d %H:%M')} -> {chunk_end.strftime('%Y-%m-%d %H:%M')}")
    logger.info(f"Duration: {duration_text}, Length: {len(prompt)} chars")

    if not force and check_conversations_exist(chunk_start, chunk_end):
        logger.info("Conversations already exist for this time range, skipping (use --force to recreate)")
        return -1

    if force:
        deleted_count = delete_conversations_in_range(chunk_start, chunk_end)
        if deleted_count > 0:
            logger.info("Force mode: recreating conversations for this time range")

    try:
        response = tool_llm.invoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=prompt),
            ]
        )
        extracted_conversations = extract_conversations_from_response(response, chunk_start, chunk_end)

        if not extracted_conversations:
            logger.error("No conversations found in chunk after all parsing attempts")
            persist_debug_response(response, model)
            return 0

        now = datetime.now(timezone.utc)
        conversation_objects: List[Dict[str, Any]] = []
        entity_to_id_map: Dict[str, Any] = {}

        for conv in extracted_conversations:
            conv_start, conv_end = sorted([utc(conv.start), utc(conv.end)])
            conversation_objects.append(create_conversation_object(conv, conv_start, conv_end, now, model))
            for entity_name in conv.entities:
                if entity_name and entity_name.strip():
                    entity_to_id_map.setdefault(entity_name, None)

        for entity_name in list(entity_to_id_map.keys()):
            entity_id = find_or_create_entity(entity_name, now)
            entity_to_id_map[entity_name] = entity_id
            logger.info(f"Entity '{entity_name}' -> Object ID: {entity_id}")

        conversation_ids = insert_conversations(conversation_objects)
        if not conversation_ids:
            logger.error("insertMany returned no insertedIds for conversations")
            return 0

        if len(extracted_conversations) != len(conversation_ids):
            logger.error(
                f"Mismatch: {len(extracted_conversations)} conversations extracted but {len(conversation_ids)} IDs returned"
            )
            return 0

        relationships: List[Dict[str, Any]] = []
        for conv, conversation_id in zip(extracted_conversations, conversation_ids):
            for entity_name in conv.entities:
                entity_id = entity_to_id_map.get(entity_name)
                if entity_name and entity_name.strip() and entity_id is not None:
                    relationships.append(create_mentioned_relationship(entity_id, conversation_id, now))

        inserted_relationships = insert_relationships(relationships)
        if inserted_relationships:
            logger.info(f"Created {inserted_relationships} entity mention relationships")

        return len(extracted_conversations)
    except Exception as exc:
        logger.error(f"Error processing chunk: {type(exc).__name__}: {exc}", exc_info=True)
        return 0


def extract_conversations(
    limit: Optional[int] = None,
    not_later_than: Optional[datetime] = None,
    model: str = "small",
    force: bool = False,
    scale: str = DEFAULT_SCALE,
) -> None:
    logger.info("=" * 60)
    logger.info("Starting conversation extraction")
    if force:
        logger.info("Force mode enabled: will recreate existing conversations")
    logger.info("=" * 60)

    tool_llm, system_prompt = setup_llm_tools(model)
    processed = 0
    skipped = 0
    total_conversations = 0
    bucket_ranges: Dict[datetime, Dict[str, datetime]] = {}
    delta = SCALE_TO_RESOLUTION[scale]

    try:
        conv_iterator = iterate_conversations(not_later_than, scale=scale)
        for chunk in conv_iterator:
            if limit is not None and processed >= limit:
                logger.info(f"Reached limit of {limit} chunks")
                break

            chunk_start = chunk[0]["start"]
            chunk_end = chunk[-1]["end"]
            chunk_bucket = date_to_bucket(chunk_start, scale)

            conversations_found = process_conversation_chunk(chunk, tool_llm, system_prompt, model, force)

            if conversations_found == -1:
                skipped += 1
                logger.debug(f"Skipped chunk in bucket {chunk_bucket}")
            else:
                total_conversations += conversations_found
                processed += 1

                range_info = bucket_ranges.get(chunk_bucket)
                if not range_info:
                    bucket_ranges[chunk_bucket] = {"start": chunk_start, "end": chunk_end}
                else:
                    range_info["start"] = min(range_info["start"], chunk_start)
                    range_info["end"] = max(range_info["end"], chunk_end)

            total_chunks = processed + skipped
            if total_chunks and total_chunks % 10 == 0:
                logger.info(f"Progress: {processed} processed, {skipped} skipped, {total_conversations} conversations found")

        for bucket, range_info in bucket_ranges.items():
            bucket_end = bucket + delta
            mark_buckets_as("done", "conversations", bucket, bucket_end, scale=scale)
            logger.info(f"Marked bucket as done: {bucket.strftime('%Y-%m-%d %H:%M')} -> {bucket_end.strftime('%Y-%m-%d %H:%M')}")

    except Exception as exc:
        logger.error(f"Error in conversation extraction: {exc}")
        raise

    logger.info("=" * 60)
    logger.info("Conversation extraction complete:")
    logger.info(f"  - Chunks processed: {processed}")
    logger.info(f"  - Chunks skipped: {skipped}")
    logger.info(f"  - Conversations found: {total_conversations}")
    logger.info(f"  - Buckets marked done: {len(bucket_ranges)}")
    logger.info("=" * 60)


__all__ = ["extract_conversations", "process_conversation_chunk", "setup_llm_tools"]
