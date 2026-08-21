from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from bson import ObjectId

from jobs.speaker_identity import (
    SpeakerIdentityJobData,
    classify_identity,
    process_speaker_identity_job,
)


def valid_calibration(**overrides):
    calibration = {
        "status": "validated",
        "serverComputed": True,
        "contractVersion": "server-computed-v1",
        "computedBy": "speaker-segments",
        "targetPrecision": 0.98,
        "validationMetrics": {"positivePrecision": 0.99, "identified": 10},
        "profileRevision": 2,
        "embeddingSpaceId": "space-v1",
        "positiveThreshold": 0.8,
        "negativeThreshold": 0.2,
    }
    calibration.update(overrides)
    return calibration


def test_classifies_all_three_states() -> None:
    kwargs = {
        "positive_threshold": 0.72,
        "negative_threshold": 0.45,
        "segment_space": "space-v1",
        "profile_space": "space-v1",
    }
    assert classify_identity(0.81, **kwargs) == "matched"
    assert classify_identity(0.20, **kwargs) == "rejected"
    assert classify_identity(0.60, **kwargs) == "uncertain"


def test_rejects_invalid_threshold_order() -> None:
    with pytest.raises(ValueError, match="negative threshold"):
        classify_identity(0.5, positive_threshold=0.4, negative_threshold=0.5)


def test_blocks_cross_space_matching() -> None:
    with pytest.raises(ValueError, match="Embedding space mismatch"):
        classify_identity(
            0.9,
            positive_threshold=0.7,
            negative_threshold=0.4,
            segment_space="space-a",
            profile_space="space-b",
        )


def test_unknown_space_requires_explicit_compatibility() -> None:
    with pytest.raises(ValueError, match="unknown embedding space"):
        classify_identity(
            0.9,
            positive_threshold=0.7,
            negative_threshold=0.4,
            segment_space="legacy-unknown",
            profile_space="legacy-unknown",
        )

    assert (
        classify_identity(
            0.9,
            positive_threshold=0.7,
            negative_threshold=0.4,
            segment_space="legacy-unknown",
            profile_space="legacy-unknown",
            allow_legacy_compatibility=True,
        )
        == "matched"
    )


def test_job_persists_a_terminal_state_for_every_eligible_segment() -> None:
    profile_id = ObjectId()
    profile = {
        "_id": profile_id,
        "name": "Sky",
        "embedding": [1.0, 0.0],
        "revision": 2,
        "embeddingSpaceId": "space-v1",
    }
    segments = [
        {"_id": ObjectId(), "embedding": [1.0, 0.0], "embeddingSpaceId": "space-v1"},
        {"_id": ObjectId(), "embedding": [0.0, 1.0], "embeddingSpaceId": "space-v1"},
        {"_id": ObjectId(), "embedding": [0.6, 0.8], "embeddingSpaceId": "space-v1"},
    ]
    writes = []
    segment_queries = []

    def resource(_name, request):
        if request["collection"] == "speaker_calibrations":
            return valid_calibration()
        if request["action"] == "find":
            segment_queries.append(request["query"])
            return segments
        if request["action"] == "bulkWrite":
            writes.extend(request["operations"])
            return {"modifiedCount": 3}
        raise AssertionError(request)

    with (
        patch("jobs.speaker_identity.get_profile_by_id", return_value=profile),
        patch("jobs.speaker_identity.call_resource", side_effect=resource),
    ):
        result = process_speaker_identity_job(
            "job-1",
            SpeakerIdentityJobData(
                runId="run-1",
                profileId=str(profile_id),
                profileRevision=2,
                calibrationId="cal-1",
                limit=10,
            ),
            lambda _progress: None,
        )

    states = [
        operation["updateOne"]["update"]["$set"]["speakerIdentity"]["state"]
        for operation in writes
    ]
    assert states == ["matched", "rejected", "uncertain"]
    identities = [
        operation["updateOne"]["update"]["$set"]["speakerIdentity"]
        for operation in writes
    ]
    assert identities[0]["identityState"] == "identified"
    assert identities[1]["identityState"] == "unknown"
    assert identities[2]["identityState"] == "uncertain"
    assert identities[0]["candidates"][0]["profileId"] == profile_id
    assert {
        "speakerIdentity.topCandidate.profileId": {"$ne": profile_id}
    } in segment_queries[0]["$or"]
    assert not any(
        "speakerIdentity.profileId" in clause for clause in segment_queries[0]["$or"]
    )
    assert result["processed"] == 3
    assert result["hasMore"] is False


def test_job_skips_incompatible_spaces_without_failing_the_batch() -> None:
    profile_id = ObjectId()
    profile = {
        "_id": profile_id,
        "name": "Sky",
        "embedding": [1.0, 0.0],
        "revision": 2,
        "embeddingSpaceId": "space-v1",
    }
    segments = [
        {"_id": ObjectId(), "embedding": [1.0, 0.0], "embeddingSpaceId": "space-v1"},
        {"_id": ObjectId(), "embedding": [1.0, 0.0], "embeddingSpaceId": "space-v2"},
    ]
    writes = []

    def resource(_name, request):
        if request["collection"] == "speaker_calibrations":
            return valid_calibration()
        if request["action"] == "find":
            return segments
        if request["action"] == "bulkWrite":
            writes.extend(request["operations"])
            return {"modifiedCount": 1}
        raise AssertionError(request)

    with (
        patch("jobs.speaker_identity.get_profile_by_id", return_value=profile),
        patch("jobs.speaker_identity.call_resource", side_effect=resource),
    ):
        result = process_speaker_identity_job(
            "job-space",
            SpeakerIdentityJobData(
                runId="run-1",
                profileId=str(profile_id),
                profileRevision=2,
                calibrationId="cal-1",
                limit=10,
            ),
            lambda _progress: None,
        )

    assert len(writes) == 1
    assert result["processed"] == 2
    assert result["incompatibleSkipped"] == 1


@pytest.mark.parametrize(
    ("calibration", "message"),
    [
        (
            {
                "status": "validated",
                "profileRevision": 1,
                "embeddingSpaceId": "space-v1",
            },
            "current profile revision",
        ),
        (
            {
                "status": "validated",
                "profileRevision": 2,
                "embeddingSpaceId": "space-v2",
            },
            "current profile embedding space",
        ),
    ],
)
def test_job_rejects_stale_or_cross_space_calibration(calibration, message) -> None:
    profile_id = ObjectId()
    profile = {
        "_id": profile_id,
        "name": "Sky",
        "embedding": [1.0, 0.0],
        "revision": 2,
        "embeddingSpaceId": "space-v1",
    }

    with (
        patch("jobs.speaker_identity.get_profile_by_id", return_value=profile),
        patch(
            "jobs.speaker_identity.call_resource",
            return_value=valid_calibration(**calibration),
        ),
        pytest.raises(ValueError, match=message),
    ):
        process_speaker_identity_job(
            "job-stale-calibration",
            SpeakerIdentityJobData(
                runId="run-1",
                profileId=str(profile_id),
                profileRevision=2,
                calibrationId="cal-1",
                limit=10,
            ),
            lambda _progress: None,
        )


def test_job_rejects_legacy_client_asserted_calibration() -> None:
    profile_id = ObjectId()
    profile = {
        "_id": profile_id,
        "name": "Sky",
        "embedding": [1.0, 0.0],
        "revision": 2,
        "embeddingSpaceId": "space-v1",
    }
    legacy = valid_calibration()
    legacy.pop("serverComputed")
    legacy.pop("contractVersion")
    legacy.pop("computedBy")

    with (
        patch("jobs.speaker_identity.get_profile_by_id", return_value=profile),
        patch("jobs.speaker_identity.call_resource", return_value=legacy),
        pytest.raises(ValueError, match="server-computed contract"),
    ):
        process_speaker_identity_job(
            "job-legacy-calibration",
            SpeakerIdentityJobData(
                runId="run-1",
                profileId=str(profile_id),
                profileRevision=2,
                calibrationId="legacy-calibration",
                limit=10,
            ),
            lambda _progress: None,
        )


@pytest.mark.parametrize(
    ("start", "end", "message"),
    [
        (None, None, "require both start and end"),
        (
            datetime(2026, 8, 20, tzinfo=UTC),
            datetime(2026, 8, 21, 1, tzinfo=UTC),
            "cannot exceed 24 hours",
        ),
        (
            datetime(2026, 8, 21, tzinfo=UTC),
            datetime(2026, 8, 20, tzinfo=UTC),
            "end must be after start",
        ),
    ],
)
def test_pilot_calibration_requires_a_bounded_range(start, end, message) -> None:
    profile_id = ObjectId()
    profile = {
        "_id": profile_id,
        "name": "Sky",
        "embedding": [1.0, 0.0],
        "revision": 2,
        "embeddingSpaceId": "space-v1",
    }
    pilot = valid_calibration(
        targetPrecision=0.95,
        validationMetrics={"positivePrecision": 0.96, "identified": 10},
        classificationPolicy="pilot",
        operatorAcceptedLowerPrecision=True,
        maxRangeHours=24,
    )

    with (
        patch("jobs.speaker_identity.get_profile_by_id", return_value=profile),
        patch("jobs.speaker_identity.call_resource", return_value=pilot),
        pytest.raises(ValueError, match=message),
    ):
        payload = {
            "runId": "run-1",
            "profileId": str(profile_id),
            "profileRevision": 2,
            "calibrationId": "pilot-calibration",
            "start": start,
            "end": end,
            "limit": 10,
        }
        data = (
            SpeakerIdentityJobData.model_construct(**payload)
            if start is not None and end is not None and end <= start
            else SpeakerIdentityJobData(**payload)
        )
        process_speaker_identity_job(
            "job-pilot-range",
            data,
            lambda _progress: None,
        )


def test_pilot_calibration_requires_explicit_risk_acceptance() -> None:
    profile_id = ObjectId()
    profile = {
        "_id": profile_id,
        "name": "Sky",
        "embedding": [1.0, 0.0],
        "revision": 2,
        "embeddingSpaceId": "space-v1",
    }
    unaccepted = valid_calibration(
        targetPrecision=0.95,
        validationMetrics={"positivePrecision": 0.96, "identified": 10},
        classificationPolicy="pilot",
        operatorAcceptedLowerPrecision=False,
        maxRangeHours=24,
    )
    end = datetime(2026, 8, 21, tzinfo=UTC)

    with (
        patch("jobs.speaker_identity.get_profile_by_id", return_value=profile),
        patch("jobs.speaker_identity.call_resource", return_value=unaccepted),
        pytest.raises(ValueError, match="explicitly accepted bounded pilot"),
    ):
        process_speaker_identity_job(
            "job-unaccepted-pilot",
            SpeakerIdentityJobData(
                runId="run-1",
                profileId=str(profile_id),
                profileRevision=2,
                calibrationId="pilot-calibration",
                start=end - timedelta(hours=24),
                end=end,
                limit=10,
            ),
            lambda _progress: None,
        )


def test_pilot_decisions_and_campaign_are_marked_provisional() -> None:
    profile_id = ObjectId()
    profile = {
        "_id": profile_id,
        "name": "Sky",
        "embedding": [1.0, 0.0],
        "revision": 2,
        "embeddingSpaceId": "space-v1",
    }
    segment = {
        "_id": ObjectId(),
        "embedding": [-1.0, 0.0],
        "embeddingSpaceId": "space-v1",
    }
    pilot = valid_calibration(
        targetPrecision=0.95,
        validationMetrics={"positivePrecision": 0.96, "identified": 10},
        classificationPolicy="pilot",
        operatorAcceptedLowerPrecision=True,
        maxRangeHours=24,
        negativeThreshold=-1,
        negativeDecisionMode="uncertain_only",
        recommendedPositiveThreshold=0.75,
        positiveThresholdSource="operator_stricter",
    )
    writes = []
    campaign_updates = []
    read_queries = []

    def resource(_name, request):
        collection = request["collection"]
        action = request["action"]
        if collection == "speaker_calibrations":
            return pilot
        if collection == "speaker_identity_campaigns":
            if action == "findOne":
                return None
            campaign_updates.append(request["update"]["$set"])
            return {"modifiedCount": 1}
        if collection == "diarizations" and action == "count":
            return 1
        if collection == "diarizations" and action == "find":
            read_queries.append(request["query"])
            return [segment]
        if collection == "diarizations" and action == "bulkWrite":
            writes.extend(request["operations"])
            return {"modifiedCount": 1}
        raise AssertionError(request)

    end = datetime(2026, 8, 21, tzinfo=UTC)
    with (
        patch("jobs.speaker_identity.get_profile_by_id", return_value=profile),
        patch("jobs.speaker_identity.call_resource", side_effect=resource),
    ):
        result = process_speaker_identity_job(
            "job-pilot",
            SpeakerIdentityJobData(
                runId="run-1",
                profileId=str(profile_id),
                profileRevision=2,
                calibrationId="pilot-calibration",
                start=end - timedelta(hours=24),
                end=end,
                limit=10,
            ),
            lambda _progress: None,
        )

    update = writes[0]["updateOne"]["update"]
    identity = update["$set"]["speakerIdentity"]
    assert identity["validity"] == "provisional"
    assert identity["classificationPolicy"] == "pilot"
    assert identity["state"] == "uncertain"
    assert identity["negativeDecisionMode"] == "uncertain_only"
    assert identity["recommendedPositiveThreshold"] == 0.75
    assert identity["positiveThresholdSource"] == "operator_stricter"
    expected_guard = [
        {"speakerIdentity.validity": "verified"},
        {"speakerIdentity.classificationPolicy": "full"},
    ]
    assert read_queries[0]["$nor"] == expected_guard
    assert writes[0]["updateOne"]["filter"]["$nor"] == expected_guard
    assert "matched_speaker" not in update["$set"]
    assert update["$unset"] == {"matched_speaker": ""}
    assert campaign_updates[0]["classificationPolicy"] == "pilot"
    assert campaign_updates[0]["decisionValidity"] == "provisional"
    assert result["classificationPolicy"] == "pilot"
    assert result["maxRangeHours"] == 24.0
