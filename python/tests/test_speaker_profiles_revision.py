from unittest.mock import patch

from bson import ObjectId

from speaker_identification.profiles import (
    add_sample_to_profile,
    create_or_update_profile,
)


def test_adding_a_sample_increments_profile_revision() -> None:
    profile = {
        "_id": ObjectId(),
        "name": "Sky",
        "embedding": [1.0, 0.0],
        "sample_count": 2,
        "total_duration": 20.0,
        "revision": 4,
        "embeddingSpaceId": "space-v1",
    }
    with patch(
        "speaker_identification.profiles.call_resource",
        return_value={"matchedCount": 1},
    ) as resource:
        updated = add_sample_to_profile(
            profile,
            [0.8, 0.2],
            5.0,
            "space-v1",
        )

    assert updated["revision"] == 5
    assert resource.call_args.args[1]["update"]["$set"]["revision"] == 5


def test_updating_a_named_profile_increments_profile_revision() -> None:
    profile = {
        "_id": ObjectId(),
        "name": "Sky",
        "embedding": [1.0, 0.0],
        "sample_count": 1,
        "total_duration": 10.0,
        "revision": 2,
        "embeddingSpaceId": "space-v1",
    }

    def resource(_name, request):
        if request["action"] == "findOne":
            return profile
        if request["action"] == "updateOne":
            return {"matchedCount": 1}
        raise AssertionError(request)

    with patch(
        "speaker_identification.profiles.call_resource",
        side_effect=resource,
    ):
        updated = create_or_update_profile(
            "Sky",
            [0.8, 0.2],
            5.0,
            embedding_space_id="space-v1",
        )

    assert updated["revision"] == 3
