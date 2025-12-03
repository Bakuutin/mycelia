"""Object creation and database operations for conversations."""

from datetime import datetime

from bson import ObjectId

from cachetools.func import lru_cache

from lib.resources import call_resource

from convos.config import logger


def create_conversation_object(conv, conv_start, conv_end, now, model: str = "small"):
    """Create a conversation object from extracted conversation data"""
    return 


def create_entity_object(entity_name):
    """Create an entity object"""
    return {
        'name': entity_name,
    }


def create_mentioned_relationship(entity_id, conversation_id, entity_name, conversation_title):
    """Create a 'mentioned in' relationship object"""
    return {
        'name': 'mentioned in',
        'isRelationship': True,
        'relationship': {
            'subject': entity_id,
            'object': conversation_id,
            'symmetrical': False
        },
    }

@lru_cache(maxsize=128)
def find_or_create_entity(entity_name: str) -> ObjectId:
    """Find existing entity or create new one"""
    # Check if entity already exists
    existing_list = call_resource("objects", {
        "action": "list",
        "filters": {"name": entity_name},
        "options": {"limit": 1}
    })

    if existing_list and len(existing_list) > 0:
        return existing_list[0]['_id']

    # Create new entity
    entity_obj = create_entity_object(entity_name)
    result = call_resource("objects", {
        "action": "create",
        "object": entity_obj
    })
    return result['insertedId']


def check_conversations_exist(start: datetime, end: datetime) -> bool:
    """Check if conversations already exist for this time range."""
    existing_list = call_resource("objects", {
        "action": "list",
        "filters": {
            "isConversation": True,
            "timeRanges": {
                "$elemMatch": {
                    "start": {"$lt": end},
                    "end": {"$gt": start}
                }
            }
        },
        "options": {"limit": 1}
    })
    return existing_list is not None and len(existing_list) > 0


def delete_conversations_in_range(start: datetime, end: datetime) -> int:
    """Delete existing conversations and their relationships in a time range."""
    conversations = call_resource("objects", {
        "action": "list",
        "filters": {
            "isConversation": True,
            "timeRanges": {
                "$elemMatch": {
                    "start": {"$lt": end},
                    "end": {"$gt": start}
                }
            }
        }
    })

    if not conversations:
        return 0

    conversation_ids = [conv['_id'] for conv in conversations]

    # Delete conversations using objects resource (one call per id)
    for conv_id in conversation_ids:
        call_resource("objects", {
            "action": "delete",
            "id": str(conv_id)
        })

    # Find and delete relationships
    relationships = call_resource("objects", {
        "action": "list",
        "filters": {
            "isRelationship": True,
            "relationship.object": {"$in": conversation_ids}
        }
    })

    # Delete relationships using objects resource (one call per id)
    for rel in relationships:
        call_resource("objects", {
            "action": "delete",
            "id": str(rel['_id'])
        })

    logger.info(f"Deleted {len(conversation_ids)} existing conversations and their relationships")
    return len(conversation_ids)

