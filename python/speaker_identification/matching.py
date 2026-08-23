"""Speaker matching logic for retroactive identification."""

import logging
import numpy as np
from datetime import datetime, UTC
from typing import Any, Dict, Generator, List, Optional, Tuple
from bson import ObjectId

logger = logging.getLogger(__name__)

# Default similarity threshold for matching
# 0.35 is optimal for wespeaker-voxceleb-resnet34-LM model
DEFAULT_SIMILARITY_THRESHOLD = 0.35
UNKNOWN_EMBEDDING_SPACES = {None, "", "unknown", "legacy-unknown"}


def compute_similarity(emb1: np.ndarray, emb2: np.ndarray) -> float:
    """
    Compute cosine similarity between two embeddings.
    
    Both embeddings should be L2-normalized, so similarity = dot product.
    """
    return float(np.dot(emb1, emb2))


def match_segment_to_profiles(
    segment_embedding: List[float],
    profiles: List[Dict[str, Any]],
    threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    *,
    segment_embedding_space_id: Optional[str] = None,
) -> Optional[Tuple[Dict[str, Any], float]]:
    """
    Match a single segment embedding against all profiles.
    
    Args:
        segment_embedding: 256-dim embedding from diarization segment
        profiles: List of speaker profiles with embeddings
        threshold: Minimum similarity to consider a match
        segment_embedding_space_id: Exact embedding space for the segment
    
    Returns:
        Tuple of (best_profile, similarity) if match found, None otherwise
    """
    if segment_embedding_space_id in UNKNOWN_EMBEDDING_SPACES:
        return None

    compatible_profiles = [
        profile
        for profile in profiles
        if profile.get("embeddingSpaceId") == segment_embedding_space_id
        and isinstance(profile.get("revision"), int)
        and not isinstance(profile.get("revision"), bool)
        and profile["revision"] > 0
    ]
    if not compatible_profiles:
        return None
    
    seg_emb = np.array(segment_embedding, dtype=np.float32)
    
    best_sim = -1.0
    best_profile = None
    
    for profile in compatible_profiles:
        profile_emb = np.array(profile["embedding"], dtype=np.float32)
        sim = compute_similarity(seg_emb, profile_emb)
        
        if sim > best_sim:
            best_sim = sim
            best_profile = profile
    
    if best_sim >= threshold:
        return (best_profile, best_sim)
    
    return None


def match_segments_batch(
    profiles: List[Dict[str, Any]],
    segments: List[Dict[str, Any]],
    threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
) -> Generator[Tuple[ObjectId, Dict[str, Any]], None, None]:
    """
    Match multiple segment embeddings against profiles.
    
    This is a pure MongoDB operation - no diarizator needed since
    embeddings are already stored in the diarizations collection.
    
    Args:
        profiles: List of speaker profiles with embeddings
        segments: List of diarization segments with embeddings
        threshold: Minimum similarity to consider a match
    
    Yields:
        Tuples of (segment_id, matched_speaker_data)
    """
    if not profiles:
        logger.warning("No profiles provided for matching")
        return
    
    # Pre-convert profiles and group them by exact embedding space. A cosine
    # score is meaningful only inside the same versioned embedding space.
    profiles_by_space: Dict[str, List[Tuple[Dict[str, Any], np.ndarray]]] = {}
    for profile in profiles:
        profile_space = profile.get("embeddingSpaceId")
        profile_revision = profile.get("revision")
        if (
            profile_space in UNKNOWN_EMBEDDING_SPACES
            or not isinstance(profile_revision, int)
            or isinstance(profile_revision, bool)
            or profile_revision <= 0
        ):
            logger.warning(
                "Skipping speaker profile %s without exact versioned embedding provenance",
                profile.get("name", profile.get("_id")),
            )
            continue
        profiles_by_space.setdefault(str(profile_space), []).append(
            (profile, np.array(profile["embedding"], dtype=np.float32))
        )
    
    for segment in segments:
        segment_id = segment["_id"]
        
        # Skip if already matched
        if "matched_speaker" in segment:
            continue
        
        # Get segment embedding
        seg_emb = segment.get("embedding")
        if not seg_emb:
            logger.debug(f"Segment {segment_id} has no embedding, skipping")
            continue
        segment_space = segment.get("embeddingSpaceId")
        if segment_space in UNKNOWN_EMBEDDING_SPACES:
            logger.debug(
                "Segment %s has no exact embedding provenance, skipping",
                segment_id,
            )
            continue
        compatible_profiles = profiles_by_space.get(str(segment_space), [])
        if not compatible_profiles:
            logger.debug(
                "No compatible profiles for segment %s in embedding space %s",
                segment_id,
                segment_space,
            )
            continue
        
        seg_emb_arr = np.array(seg_emb, dtype=np.float32)
        
        # Find best matching profile
        best_sim = -1.0
        best_profile = None
        
        for profile, profile_emb in compatible_profiles:
            sim = compute_similarity(seg_emb_arr, profile_emb)
            if sim > best_sim:
                best_sim = sim
                best_profile = profile
        
        # Check if above threshold
        if best_sim >= threshold:
            matched_speaker = {
                "profile_id": best_profile["_id"],
                "name": best_profile["name"],
                "similarity": round(float(best_sim), 4),
                "matched_at": datetime.now(UTC),
                "method": "retroactive",
                "profile_revision": best_profile["revision"],
                "embedding_space_id": str(segment_space),
            }
            yield (segment_id, matched_speaker)
