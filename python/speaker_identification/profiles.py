"""Speaker profile management using MongoDB."""

import logging
import numpy as np
from datetime import datetime, UTC
from typing import Any, Dict, List, Optional
from bson import ObjectId

from lib.resources import call_resource

logger = logging.getLogger(__name__)

# Pre-defined colors for speaker profiles (will be assigned in order)
PROFILE_COLORS = [
    "#3b82f6",  # Blue
    "#ef4444",  # Red
    "#10b981",  # Green
    "#f59e0b",  # Amber
    "#8b5cf6",  # Purple
    "#ec4899",  # Pink
    "#06b6d4",  # Cyan
    "#f97316",  # Orange
]


def _normalize_embedding(embedding: List[float]) -> List[float]:
    """Normalize embedding to unit length (L2 normalization)."""
    arr = np.array(embedding, dtype=np.float32)
    norm = np.linalg.norm(arr)
    if norm > 0:
        arr = arr / norm
    return arr.tolist()


def _get_next_color() -> str:
    """Get the next available color for a new profile."""
    # Get existing profiles to count
    result = call_resource("mongo", {
        "action": "find",
        "collection": "speaker_profiles",
        "query": {},
        "options": {"projection": {"color": 1}},
    })
    # find returns array directly, not {"data": [...]}
    existing_count = len(result) if isinstance(result, list) else 0
    return PROFILE_COLORS[existing_count % len(PROFILE_COLORS)]


def create_or_update_profile(
    name: str,
    embedding: List[float],
    duration: float,
    is_primary: bool = False,
) -> Dict[str, Any]:
    """
    Create a new speaker profile or update existing via weighted average.

    Args:
        name: Speaker name (must be unique)
        embedding: 256-dim speaker embedding (L2-normalized)
        duration: Duration of audio sample in seconds
        is_primary: True if this is the user's primary voice ("my voice")

    Returns:
        The created or updated profile document
    """
    logger.info(f"Creating/updating profile: name={name}, duration={duration:.2f}s, is_primary={is_primary}")

    # Normalize the embedding
    embedding = _normalize_embedding(embedding)

    # Check if profile exists
    result = call_resource("mongo", {
        "action": "findOne",
        "collection": "speaker_profiles",
        "query": {"name": name},
    })

    # findOne returns document directly, not {"data": doc}
    existing = result
    now = datetime.now(UTC)

    if existing:
        # Update existing profile with weighted average
        old_emb = np.array(existing["embedding"], dtype=np.float32)
        new_emb = np.array(embedding, dtype=np.float32)
        old_count = existing.get("sample_count", 1)
        old_duration = existing.get("total_duration", 0.0)

        # Weighted average: (old * count + new) / (count + 1)
        merged = (old_emb * old_count + new_emb) / (old_count + 1)
        merged = merged / np.linalg.norm(merged)  # Re-normalize

        new_count = old_count + 1
        new_duration = old_duration + duration

        update_data = {
            "embedding": merged.tolist(),
            "sample_count": new_count,
            "total_duration": new_duration,
            "updated_at": now,
        }

        # If setting as primary, also update that field
        if is_primary:
            # First, unset any other primary profile
            call_resource("mongo", {
                "action": "updateMany",
                "collection": "speaker_profiles",
                "query": {"is_primary": True, "_id": {"$ne": existing["_id"]}},
                "update": {"$set": {"is_primary": False}},
            })
            update_data["is_primary"] = True

        call_resource("mongo", {
            "action": "updateOne",
            "collection": "speaker_profiles",
            "query": {"_id": existing["_id"]},
            "update": {"$set": update_data},
        })

        logger.info(f"Updated profile '{name}': samples={new_count}, duration={new_duration:.2f}s")

        return {**existing, **update_data}

    else:
        # Create new profile
        color = _get_next_color()

        # If setting as primary, unset any other primary profile
        if is_primary:
            call_resource("mongo", {
                "action": "updateMany",
                "collection": "speaker_profiles",
                "query": {"is_primary": True},
                "update": {"$set": {"is_primary": False}},
            })

        new_profile = {
            "name": name,
            "embedding": embedding,
            "sample_count": 1,
            "total_duration": duration,
            "is_primary": is_primary,
            "color": color,
            "created_at": now,
            "updated_at": now,
        }

        result = call_resource("mongo", {
            "action": "insertOne",
            "collection": "speaker_profiles",
            "doc": new_profile,  # Fixed: schema expects "doc" not "document"
        })

        new_profile["_id"] = (result or {}).get("insertedId")
        logger.info(f"Created new profile '{name}': id={new_profile['_id']}, color={color}")

        return new_profile


def get_all_profiles() -> List[Dict[str, Any]]:
    """Get all speaker profiles."""
    result = call_resource("mongo", {
        "action": "find",
        "collection": "speaker_profiles",
        "query": {},
        "options": {"sort": {"created_at": 1}},
    })
    # find returns array directly
    return result if isinstance(result, list) else []


def get_primary_profile() -> Optional[Dict[str, Any]]:
    """Get the primary ("my voice") profile, if any."""
    result = call_resource("mongo", {
        "action": "findOne",
        "collection": "speaker_profiles",
        "query": {"is_primary": True},
    })
    # findOne returns document directly
    return result


def get_profile_by_id(profile_id: str) -> Optional[Dict[str, Any]]:
    """Get a profile by its ID."""
    result = call_resource("mongo", {
        "action": "findOne",
        "collection": "speaker_profiles",
        "query": {"_id": ObjectId(profile_id)},
    })
    # findOne returns document directly
    return result


def delete_profile(profile_id: str) -> bool:
    """Delete a speaker profile by ID."""
    result = call_resource("mongo", {
        "action": "deleteOne",
        "collection": "speaker_profiles",
        "query": {"_id": ObjectId(profile_id)},
    })
    deleted = (result or {}).get("deletedCount", 0) > 0
    if deleted:
        logger.info(f"Deleted profile: {profile_id}")
    return deleted
