from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from lib.resources import call_resource

from .logger import logger


def create_conversation_object(conv: Any, conv_start: datetime, conv_end: datetime, now: datetime, model: str) -> Dict[str, Any]:
    return {
        "name": conv.title,
        "details": conv.summary,
        "icon": {"text": conv.emoji},
        "timeRanges": [
            {
                "start": conv_start,
                "end": conv_end,
            }
        ],
        "createdAt": now,
        "updatedAt": now,
        "metadata": {
            "extractedWith": {
                "model": model,
                "timestamp": now,
            }
        },
    }


def create_entity_object(entity_name: str, now: datetime) -> Dict[str, Any]:
    return {
        "name": entity_name,
        "createdAt": now,
        "updatedAt": now,
    }


def create_mentioned_relationship(entity_id: Any, conversation_id: Any, now: datetime) -> Dict[str, Any]:
    return {
        "name": "mentioned in",
        "isRelationship": True,
        "relationship": {
            "subject": entity_id,
            "object": conversation_id,
            "symmetrical": False,
        },
        "createdAt": now,
        "updatedAt": now,
    }


def find_or_create_entity(entity_name: str, now: datetime) -> Any:
    existing = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "findOne",
            "collection": "objects",
            "query": {"name": entity_name},
        },
    )
    if existing:
        return existing["_id"]

    entity_obj = create_entity_object(entity_name, now)
    result = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "insertOne",
            "collection": "objects",
            "doc": entity_obj,
        },
    )
    return result["insertedId"]


def check_conversations_exist(start: datetime, end: datetime) -> bool:
    existing = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "findOne",
            "collection": "objects",
            "query": {
                "timeRanges": {
                    "$elemMatch": {
                        "start": {"$lt": end},
                        "end": {"$gt": start},
                    }
                }
            },
        },
    )
    return existing is not None


def delete_conversations_in_range(start: datetime, end: datetime) -> int:
    conversations = call_resource(
        "tech.mycelia.mongo",
        {
            "action": "find",
            "collection": "objects",
            "query": {
                "timeRanges": {
                    "$elemMatch": {
                        "start": {"$lt": end},
                        "end": {"$gt": start},
                    }
                }
            },
        },
    )
    if not conversations:
        return 0

    conversation_ids = [conv["_id"] for conv in conversations]

    call_resource(
        "tech.mycelia.mongo",
        {
            "action": "deleteMany",
            "collection": "objects",
            "query": {"_id": {"$in": conversation_ids}},
        },
    )

    call_resource(
        "tech.mycelia.mongo",
        {
            "action": "deleteMany",
            "collection": "objects",
            "query": {
                "isRelationship": True,
                "relationship.object": {"$in": conversation_ids},
            },
        },
    )
    logger.info(f"Deleted {len(conversation_ids)} existing conversations and their relationships")
    return len(conversation_ids)


__all__ = [
    "check_conversations_exist",
    "create_conversation_object",
    "create_entity_object",
    "create_mentioned_relationship",
    "delete_conversations_in_range",
    "find_or_create_entity",
]
