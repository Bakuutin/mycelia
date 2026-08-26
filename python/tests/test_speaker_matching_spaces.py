from pathlib import Path
from sys import path

from bson import ObjectId

path.insert(0, str(Path(__file__).resolve().parents[1]))

from speaker_identification.matching import (  # noqa: E402
    match_segment_to_profiles,
    match_segments_batch,
)


def _profile(
    name: str,
    space: str | None,
    embedding: list[float],
    revision: int = 1,
):
    return {
        "_id": ObjectId(),
        "name": name,
        "embedding": embedding,
        "embeddingSpaceId": space,
        "revision": revision,
    }


def test_single_segment_matching_requires_exact_embedding_space() -> None:
    compatible = _profile("Compatible", "space-v1", [0.9, 0.1])
    closer_but_incompatible = _profile("Wrong space", "space-v0", [1.0, 0.0])

    match = match_segment_to_profiles(
        [1.0, 0.0],
        [closer_but_incompatible, compatible],
        threshold=0.5,
        segment_embedding_space_id="space-v1",
    )

    assert match is not None
    assert match[0] == compatible
    assert (
        match_segment_to_profiles(
            [1.0, 0.0],
            [compatible],
            threshold=0.5,
        )
        is None
    )


def test_profiles_without_a_revision_are_not_matched() -> None:
    unversioned = _profile("Unversioned", "space-v1", [1.0, 0.0])
    unversioned.pop("revision")

    assert (
        match_segment_to_profiles(
            [1.0, 0.0],
            [unversioned],
            threshold=0.5,
            segment_embedding_space_id="space-v1",
        )
        is None
    )


def test_batch_matching_skips_cross_space_and_records_provenance() -> None:
    compatible = _profile("Compatible", "space-v1", [1.0, 0.0], revision=4)
    incompatible = _profile("Wrong space", "space-v0", [1.0, 0.0], revision=9)
    compatible_segment_id = ObjectId()
    incompatible_segment_id = ObjectId()
    legacy_segment_id = ObjectId()
    segments = [
        {
            "_id": compatible_segment_id,
            "embedding": [1.0, 0.0],
            "embeddingSpaceId": "space-v1",
        },
        {
            "_id": incompatible_segment_id,
            "embedding": [1.0, 0.0],
            "embeddingSpaceId": "space-v2",
        },
        {
            "_id": legacy_segment_id,
            "embedding": [1.0, 0.0],
            "embeddingSpaceId": "legacy-unknown",
        },
    ]

    matches = list(
        match_segments_batch(
            [incompatible, compatible],
            segments,
            threshold=0.5,
        )
    )

    assert len(matches) == 1
    segment_id, matched_speaker = matches[0]
    assert segment_id == compatible_segment_id
    assert matched_speaker["profile_id"] == compatible["_id"]
    assert matched_speaker["profile_revision"] == 4
    assert matched_speaker["embedding_space_id"] == "space-v1"
