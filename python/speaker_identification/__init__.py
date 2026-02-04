"""Speaker identification module for voice enrollment and matching."""

from .profiles import (
    create_or_update_profile,
    get_all_profiles,
    get_primary_profile,
    get_profile_by_id,
    delete_profile,
)
from .matching import (
    match_segment_to_profiles,
    match_segments_batch,
    compute_similarity,
    DEFAULT_SIMILARITY_THRESHOLD,
)

__all__ = [
    # Profiles
    "create_or_update_profile",
    "get_all_profiles",
    "get_primary_profile",
    "get_profile_by_id",
    "delete_profile",
    # Matching
    "match_segment_to_profiles",
    "match_segments_batch",
    "compute_similarity",
    "DEFAULT_SIMILARITY_THRESHOLD",
]
