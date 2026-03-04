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
) -> Optional[Tuple[Dict[str, Any], float]]:
    """
    Match a single segment embedding against all profiles.
    
    Args:
        segment_embedding: 256-dim embedding from diarization segment
        profiles: List of speaker profiles with embeddings
        threshold: Minimum similarity to consider a match
    
    Returns:
        Tuple of (best_profile, similarity) if match found, None otherwise
    """
    if not profiles:
        return None
    
    seg_emb = np.array(segment_embedding, dtype=np.float32)
    
    best_sim = -1.0
    best_profile = None
    
    for profile in profiles:
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
    
    # Pre-convert profile embeddings to numpy
    profile_embeddings = [
        (profile, np.array(profile["embedding"], dtype=np.float32))
        for profile in profiles
    ]
    
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
        
        seg_emb_arr = np.array(seg_emb, dtype=np.float32)
        
        # Find best matching profile
        best_sim = -1.0
        best_profile = None
        
        for profile, profile_emb in profile_embeddings:
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
            }
            yield (segment_id, matched_speaker)
