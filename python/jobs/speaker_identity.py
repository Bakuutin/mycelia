"""Versioned, tri-state identity matching over stored diarization embeddings."""

from __future__ import annotations

import logging
import math
import time
from datetime import UTC, datetime
from typing import Any, Callable, Dict, Literal, Optional

import numpy as np
from bson import ObjectId
from pydantic import BaseModel, Field, model_validator

from lib.resources import call_resource
from speaker_identification.profiles import get_profile_by_id

UNKNOWN_SPACES = {"", "legacy-unknown", "unknown", None}
FULL_TARGET_PRECISION = 0.98
PILOT_MIN_TARGET_PRECISION = 0.90
PILOT_MAX_RANGE_HOURS = 24
SPEAKER_CALIBRATION_MIN_CHECK_PER_CLASS = 20
SPEAKER_CALIBRATION_MIN_CHECK_AUTO_MATCHES = 20
SPEAKER_CALIBRATION_MIN_CHECK_AUTO_REJECTIONS = 20
logger = logging.getLogger(__name__)


def classify_identity(
    score: float,
    *,
    positive_threshold: float,
    negative_threshold: float,
    negative_decision_mode: Literal["calibrated", "uncertain_only"] = "calibrated",
    segment_space: Optional[str] = None,
    profile_space: Optional[str] = None,
    allow_legacy_compatibility: bool = False,
) -> Literal["matched", "rejected", "uncertain"]:
    if negative_threshold >= positive_threshold:
        raise ValueError("negative threshold must be lower than positive threshold")
    if negative_decision_mode not in {"calibrated", "uncertain_only"}:
        raise ValueError(f"Unknown negative decision mode: {negative_decision_mode}")
    if segment_space != profile_space:
        raise ValueError(
            f"Embedding space mismatch: segment={segment_space!r}, profile={profile_space!r}"
        )
    if segment_space in UNKNOWN_SPACES and not allow_legacy_compatibility:
        raise ValueError(
            "Matching an unknown embedding space requires validated compatibility"
        )
    if score >= positive_threshold:
        return "matched"
    if negative_decision_mode == "calibrated" and score <= negative_threshold:
        return "rejected"
    return "uncertain"


class SpeakerIdentityJobData(BaseModel):
    runId: str
    profileId: str
    profileRevision: int = Field(ge=1)
    calibrationId: str
    evidenceSnapshotHash: str = Field(min_length=1)
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    limit: int = Field(default=1000, ge=1, le=10000)
    cursor: Optional[str] = None
    campaignId: Optional[str] = None
    snapshotCutoff: Optional[datetime] = None
    partitions: list[dict[str, Any]] = Field(default_factory=list)
    partitionIndex: int = Field(default=0, ge=0)
    campaignTotalSegments: Optional[int] = Field(default=None, ge=0)
    campaignMode: Optional[Literal["classify_existing", "classify_automatic"]] = None

    @model_validator(mode="after")
    def validate_range(self) -> "SpeakerIdentityJobData":
        if self.start and self.end and self.end <= self.start:
            raise ValueError("end must be after start")
        if self.partitions:
            if self.partitionIndex >= len(self.partitions):
                raise ValueError("partitionIndex is outside the campaign plan")
            partition = self.partitions[self.partitionIndex]
            if partition.get("runId") != self.runId:
                raise ValueError("runId does not match the current campaign partition")
        return self


def _cosine(a: list[float], b: list[float]) -> float:
    av = np.asarray(a, dtype=np.float32)
    bv = np.asarray(b, dtype=np.float32)
    if av.shape != bv.shape:
        raise ValueError(f"Embedding dimension mismatch: {av.shape} != {bv.shape}")
    denominator = float(np.linalg.norm(av) * np.linalg.norm(bv))
    if denominator == 0:
        raise ValueError("Cannot match a zero-length embedding")
    return float(np.dot(av, bv) / denominator)


def _profile_score(
    segment_embedding: list[float],
    profile: dict[str, Any],
    strategy: Literal["centroid", "max_prototype", "top2_prototype_mean"],
) -> float:
    if strategy == "centroid":
        return _cosine(segment_embedding, profile["embedding"])
    prototypes = [
        item.get("embedding")
        for item in profile.get("embeddingPrototypes", [])
        if isinstance(item, dict) and isinstance(item.get("embedding"), list)
    ]
    if not prototypes:
        raise ValueError(
            f"Calibration requires {strategy}, but the profile has no saved prototypes"
        )
    scores = sorted(
        (_cosine(segment_embedding, prototype) for prototype in prototypes),
        reverse=True,
    )
    if strategy == "max_prototype":
        return scores[0]
    return scores[0] if len(scores) == 1 else (scores[0] + scores[1]) / 2


def _campaign_call(request: Dict[str, Any]) -> Any:
    """Observability failures must not discard valid identity decisions."""
    try:
        return call_resource("mongo", request)
    except Exception as exc:
        logger.warning("Could not persist speaker identity campaign telemetry: %s", exc)
        return None


def _update_campaign(
    campaign_id: str, fields: Dict[str, Any], *, owner_job_id: str | None = None
) -> None:
    query: Dict[str, Any] = {"campaignId": campaign_id}
    if owner_job_id is not None:
        query.update({"active": True, "currentJobId": owner_job_id})
    _campaign_call(
        {
            "action": "updateOne",
            "collection": "speaker_identity_campaigns",
            "query": query,
            "update": {"$set": {**fields, "updatedAt": datetime.now(UTC)}},
            "options": {"upsert": owner_job_id is None},
        }
    )


def _require_campaign_ownership(campaign_id: str, job_id: str) -> Dict[str, Any]:
    campaign = call_resource(
        "mongo",
        {
            "action": "findOne",
            "collection": "speaker_identity_campaigns",
            "query": {
                "campaignId": campaign_id,
                "active": True,
                "currentJobId": job_id,
            },
        },
    )
    if not campaign:
        raise ValueError(
            "Speaker identity campaign no longer owns this job; stop this batch"
        )
    return campaign


def _rate_estimate(samples: list[float]) -> Optional[float]:
    recent = [float(value) for value in samples[-10:] if value > 0]
    if len(recent) < 2:
        return None
    estimate = recent[0]
    for value in recent[1:]:
        estimate = 0.35 * value + 0.65 * estimate
    return estimate


def _validated_calibration_policy(
    calibration: dict[str, Any], data: SpeakerIdentityJobData
) -> tuple[Literal["full", "pilot"], float | None]:
    target_precision = float(calibration.get("targetPrecision", 0))
    validation = calibration.get("validationMetrics") or {}
    if (
        not math.isfinite(target_precision)
        or target_precision > 1
        or float(validation.get("positivePrecision", 0)) < target_precision
    ):
        raise ValueError(
            "Calibration does not prove the required independent validation precision"
        )
    if (
        int(validation.get("positives", 0)) < SPEAKER_CALIBRATION_MIN_CHECK_PER_CLASS
        or int(validation.get("negatives", 0)) < SPEAKER_CALIBRATION_MIN_CHECK_PER_CLASS
        or int(validation.get("identified", 0))
        < SPEAKER_CALIBRATION_MIN_CHECK_AUTO_MATCHES
    ):
        raise ValueError(
            "Calibration independent validation set has insufficient support: "
            "requires at least 20 positives, 20 negatives, and 20 identified "
            "auto-matches"
        )
    negative_mode = _validated_negative_decision_mode(
        calibration, float(calibration.get("negativeThreshold", -1))
    )
    if negative_mode == "calibrated" and (
        int(validation.get("rejected", 0))
        < SPEAKER_CALIBRATION_MIN_CHECK_AUTO_REJECTIONS
        or float(validation.get("negativePrecision", 0)) < target_precision
    ):
        raise ValueError(
            "Calibration automatic not-target decisions are not proven on "
            "independent validation; use uncertain-only mode"
        )

    configured_policy = calibration.get("classificationPolicy")
    if target_precision >= FULL_TARGET_PRECISION:
        if configured_policy not in (None, "full"):
            raise ValueError("Full calibration has an invalid classification policy")
        if calibration.get("maxRangeHours") is not None:
            raise ValueError("Full calibration must not have a range limit")
        if calibration.get("operatorAcceptedLowerPrecision") is True:
            raise ValueError("Full calibration cannot accept lower-precision risk")
        return "full", None

    if (
        target_precision < PILOT_MIN_TARGET_PRECISION
        or configured_policy != "pilot"
        or calibration.get("operatorAcceptedLowerPrecision") is not True
        or float(calibration.get("maxRangeHours", 0)) != PILOT_MAX_RANGE_HOURS
    ):
        raise ValueError(
            "Lower-precision calibration requires an explicitly accepted bounded pilot policy"
        )
    if data.start is None or data.end is None:
        raise ValueError("Pilot speaker identity jobs require both start and end")
    if data.end <= data.start:
        raise ValueError("Pilot speaker identity job end must be after start")
    range_hours = (data.end - data.start).total_seconds() / 3600
    if range_hours > PILOT_MAX_RANGE_HOURS:
        raise ValueError(
            f"Pilot speaker identity range cannot exceed {PILOT_MAX_RANGE_HOURS} hours"
        )
    return "pilot", float(PILOT_MAX_RANGE_HOURS)


def _validate_calibration_head_and_evidence(
    profile: dict[str, Any],
    calibration: dict[str, Any],
    data: SpeakerIdentityJobData,
    classification_policy: Literal["full", "pilot"],
) -> None:
    try:
        calibration_evidence_revision = int(calibration.get("evidenceRevision", 0) or 0)
        profile_evidence_revision = int(
            profile.get("calibrationEvidenceRevision", 0) or 0
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("Calibration evidence revision is invalid") from exc
    if calibration_evidence_revision != profile_evidence_revision:
        raise ValueError(
            "Voice labels changed after calibration; recalculate calibration and "
            "run identity preflight again"
        )

    active_ids = profile.get("activeCalibrationIds")
    policy_head = (
        active_ids.get(classification_policy) if isinstance(active_ids, dict) else None
    )
    backward_head = profile.get("activeCalibrationId")
    authoritative_head = policy_head or backward_head
    has_any_head = bool(backward_head) or bool(active_ids)
    if authoritative_head:
        if str(authoritative_head) != data.calibrationId:
            raise ValueError(
                f"Calibration is no longer the active {classification_policy} "
                "profile calibration; run identity preflight again"
            )
        return
    if profile.get("calibrationHeadsInitialized") is not True and not has_any_head:
        return
    raise ValueError(
        f"The profile has no active {classification_policy} calibration; "
        "recalculate calibration and run identity preflight again"
    )


def _validated_negative_decision_mode(
    calibration: dict[str, Any], negative_threshold: float
) -> Literal["calibrated", "uncertain_only"]:
    mode = calibration.get("negativeDecisionMode", "calibrated")
    if mode == "calibrated":
        return "calibrated"
    if mode == "uncertain_only" and negative_threshold == -1:
        return "uncertain_only"
    raise ValueError("Calibration has an invalid negative decision mode")


def _validated_positive_threshold_provenance(
    calibration: dict[str, Any],
    positive_threshold: float,
    classification_policy: Literal["full", "pilot"],
) -> tuple[float, Literal["automatic", "operator_stricter"]]:
    recommended = float(
        calibration.get("recommendedPositiveThreshold", positive_threshold)
    )
    source = calibration.get("positiveThresholdSource", "automatic")
    if not math.isfinite(recommended):
        raise ValueError("Calibration has an invalid recommended positive threshold")
    if source == "automatic" and positive_threshold == recommended:
        return recommended, "automatic"
    if (
        source == "operator_stricter"
        and classification_policy == "pilot"
        and positive_threshold > recommended
    ):
        return recommended, "operator_stricter"
    raise ValueError("Calibration has invalid positive threshold provenance")


def _identity_query(
    data: SpeakerIdentityJobData,
    classification_policy: Literal["full", "pilot"],
) -> Dict[str, Any]:
    """Select segments not yet evaluated with this profile/calibration."""
    expected_validity = "verified" if classification_policy == "full" else "provisional"
    current_identity = {
        "speakerIdentity.calibrationId": data.calibrationId,
        "speakerIdentity.profileRevision": data.profileRevision,
        "speakerIdentity.embeddingSpaceId": data.partitions[data.partitionIndex].get(
            "embeddingSpaceId"
        )
        if data.partitions
        else {"$exists": True},
        "speakerIdentity.source": "automatic",
        "speakerIdentity.validity": expected_validity,
        "$or": [
            {"speakerIdentity.profileId": ObjectId(data.profileId)},
            {"speakerIdentity.topCandidate.profileId": ObjectId(data.profileId)},
        ],
    }
    query: Dict[str, Any] = {
        "runId": data.runId,
        "lifecycleStatus": "active",
        "embeddingSpaceId": data.partitions[data.partitionIndex].get("embeddingSpaceId")
        if data.partitions
        else {"$exists": True},
        "embedding": {"$exists": True},
        "$nor": [current_identity],
    }
    if data.start or data.end:
        query["start"] = {}
        if data.start:
            query["start"]["$gte"] = data.start
        if data.end:
            query["start"]["$lt"] = data.end
    if data.snapshotCutoff:
        query.setdefault("start", {})["$lt"] = min(
            data.snapshotCutoff,
            data.end or data.snapshotCutoff,
        )
    if classification_policy == "pilot":
        query["$nor"].extend(
            [
                {"speakerIdentity.validity": "verified"},
                {"speakerIdentity.classificationPolicy": "full"},
            ]
        )
    return query


def _source_query_for_partition(
    data: SpeakerIdentityJobData, partition: dict[str, Any]
) -> Dict[str, Any]:
    query: Dict[str, Any] = {
        "runId": partition["runId"],
        "lifecycleStatus": "active",
        "embeddingSpaceId": partition["embeddingSpaceId"],
        "embedding": {"$exists": True},
    }
    if data.start or data.end or data.snapshotCutoff:
        start: Dict[str, Any] = {}
        if data.start:
            start["$gte"] = data.start
        upper = data.end
        if data.snapshotCutoff and (upper is None or data.snapshotCutoff < upper):
            upper = data.snapshotCutoff
        if upper:
            start["$lt"] = upper
        query["start"] = start
    return query


def process_speaker_identity_job(
    job_id: str,
    data: SpeakerIdentityJobData,
    progress_callback: Callable[[Dict[str, Any]], None],
) -> Dict[str, Any]:
    started = time.time()
    profile = get_profile_by_id(data.profileId)
    if not profile:
        raise ValueError(f"Profile not found: {data.profileId}")
    if int(profile.get("revision", 1)) != data.profileRevision:
        raise ValueError("Profile revision changed; create a new identity job")

    calibration = call_resource(
        "mongo",
        {
            "action": "findOne",
            "collection": "speaker_calibrations",
            "query": {"calibrationId": data.calibrationId, "profileId": data.profileId},
        },
    )
    if not calibration or calibration.get("status") != "validated":
        raise ValueError("A validated calibration is required before identity backfill")
    if (
        calibration.get("serverComputed") is not True
        or calibration.get("contractVersion") != "server-computed-v1"
        or calibration.get("computedBy") != "speaker-segments"
    ):
        raise ValueError(
            "Calibration is stale; create it with the current server-computed contract"
        )
    if calibration.get("lifecycleStatus") != "active":
        raise ValueError(
            "Calibration is no longer active; run identity preflight again"
        )
    persisted_evidence_hash = calibration.get("evidenceSnapshotHash")
    if not isinstance(persisted_evidence_hash, str) or not persisted_evidence_hash:
        raise ValueError(
            "Calibration evidence snapshot is missing; recalculate calibration"
        )
    if persisted_evidence_hash != data.evidenceSnapshotHash:
        raise ValueError(
            "Calibration evidence snapshot changed; run identity preflight again"
        )
    classification_policy, max_range_hours = _validated_calibration_policy(
        calibration, data
    )
    _validate_calibration_head_and_evidence(
        profile, calibration, data, classification_policy
    )
    target_precision = float(calibration["targetPrecision"])
    if int(calibration.get("profileRevision", 0)) != data.profileRevision:
        raise ValueError(
            "Calibration does not match the current profile revision; validate a new calibration"
        )
    profile_space = profile.get("embeddingSpaceId")
    if not profile_space or calibration.get("embeddingSpaceId") != profile_space:
        raise ValueError(
            "Calibration does not match the current profile embedding space; validate a new calibration"
        )

    positive = float(calibration["positiveThreshold"])
    negative = float(calibration["negativeThreshold"])
    negative_decision_mode = _validated_negative_decision_mode(calibration, negative)
    recommended_positive_threshold, positive_threshold_source = (
        _validated_positive_threshold_provenance(
            calibration, positive, classification_policy
        )
    )
    allow_legacy = bool(calibration.get("allowLegacyCompatibility", False))
    scoring_strategy = calibration.get("scoringStrategy", "centroid")
    if scoring_strategy not in {
        "centroid",
        "max_prototype",
        "top2_prototype_mean",
    }:
        raise ValueError("Calibration has an unknown profile scoring strategy")
    matcher_version = "profile-prototypes-v3"

    campaign_id = data.campaignId or f"speaker-identity-{job_id}"
    campaign = (
        _require_campaign_ownership(campaign_id, job_id)
        if data.campaignId
        else (
            _campaign_call(
                {
                    "action": "findOne",
                    "collection": "speaker_identity_campaigns",
                    "query": {"campaignId": campaign_id},
                }
            )
            or {}
        )
    )
    base_query = _identity_query(data, classification_policy)
    total_segments = campaign.get("totalSegments", data.campaignTotalSegments)
    count_warning: Optional[str] = None
    if total_segments is None:
        progress_callback(
            {
                "stage": "counting",
                "campaignId": campaign_id,
                "evidenceSnapshotHash": data.evidenceSnapshotHash,
                "message": "Counting speaker embeddings to classify…",
            }
        )
        try:
            counted = call_resource(
                "mongo",
                {
                    "action": "count",
                    "collection": "diarizations",
                    "query": base_query,
                    "options": {"maxTimeMS": 5_000},
                },
            )
            total_segments = int(counted)
        except Exception as exc:
            count_warning = str(exc)
            logger.warning("Speaker identity count unavailable; continuing: %s", exc)

    cumulative_processed = int(campaign.get("processedSegments", 0))
    cumulative_matched = int(campaign.get("matched", 0))
    cumulative_rejected = int(campaign.get("rejected", 0))
    cumulative_uncertain = int(campaign.get("uncertain", 0))
    cumulative_skipped = int(campaign.get("incompatibleSkipped", 0))
    rate_samples = [
        float(value)
        for value in campaign.get("rateSamples", [])[-9:]
        if value is not None and float(value) > 0
    ]
    job_ids = [str(value) for value in campaign.get("jobIds", [])]
    if job_id not in job_ids:
        job_ids.append(job_id)
    batch_number = len(job_ids)
    estimated_batches = (
        max(batch_number, math.ceil(int(total_segments) / data.limit))
        if total_segments is not None and int(total_segments) > 0
        else batch_number
    )
    _update_campaign(
        campaign_id,
        {
            "campaignId": campaign_id,
            "mode": campaign.get("mode", data.campaignMode or "classify_existing"),
            "runId": data.runId,
            "partitionIndex": data.partitionIndex,
            **({"partitions": data.partitions} if data.partitions else {}),
            **({"snapshotCutoff": data.snapshotCutoff} if data.snapshotCutoff else {}),
            "profileId": data.profileId,
            "profileName": profile.get("name"),
            "profileRevision": data.profileRevision,
            "calibrationId": data.calibrationId,
            "evidenceSnapshotHash": data.evidenceSnapshotHash,
            "classificationPolicy": classification_policy,
            "decisionValidity": (
                "verified" if classification_policy == "full" else "provisional"
            ),
            "targetPrecision": target_precision,
            "maxRangeHours": max_range_hours,
            "negativeDecisionMode": negative_decision_mode,
            "recommendedPositiveThreshold": recommended_positive_threshold,
            "positiveThresholdSource": positive_threshold_source,
            "scoringStrategy": scoring_strategy,
            "range": {"start": data.start, "end": data.end},
            "status": "running",
            "active": True,
            "totalSegments": total_segments,
            "totalEstimated": total_segments is None,
            "countWarning": count_warning,
            "processedSegments": cumulative_processed,
            "matched": cumulative_matched,
            "rejected": cumulative_rejected,
            "uncertain": cumulative_uncertain,
            "incompatibleSkipped": cumulative_skipped,
            "currentJobId": job_id,
            "firstJobId": campaign.get("firstJobId", job_id),
            "jobIds": job_ids,
            "batchNumber": batch_number,
            "estimatedBatches": estimated_batches,
            "startedAt": campaign.get("startedAt", datetime.now(UTC)),
        },
        owner_job_id=job_id if data.campaignId else None,
    )

    query = dict(base_query)
    if data.cursor:
        query["_id"] = {"$gt": ObjectId(data.cursor)}

    candidates = (
        call_resource(
            "mongo",
            {
                "action": "find",
                "collection": "diarizations",
                "query": query,
                "options": {"sort": {"_id": 1}, "limit": data.limit + 1},
            },
        )
        or []
    )
    segments = candidates[: data.limit]

    operations = []
    counts = {"matched": 0, "rejected": 0, "uncertain": 0}
    incompatible_skipped = 0
    for segment in segments:
        segment_space = segment.get("embeddingSpaceId")
        profile_space = profile.get("embeddingSpaceId")
        if segment_space != profile_space or (
            segment_space in UNKNOWN_SPACES and not allow_legacy
        ):
            incompatible_skipped += 1
            continue
        score = _profile_score(segment["embedding"], profile, scoring_strategy)
        state = classify_identity(
            score,
            positive_threshold=positive,
            negative_threshold=negative,
            negative_decision_mode=negative_decision_mode,
            segment_space=segment_space,
            profile_space=profile_space,
            allow_legacy_compatibility=allow_legacy,
        )
        counts[state] += 1
        rounded_score = round(score, 6)
        identity_state = {
            "matched": "identified",
            "rejected": "unknown",
            "uncertain": "uncertain",
        }[state]
        candidate = {
            "profileId": profile["_id"],
            "name": profile.get("name"),
            "score": rounded_score,
            "profileRevision": data.profileRevision,
            "calibrationId": data.calibrationId,
        }
        decision_validity = (
            "verified" if classification_policy == "full" else "provisional"
        )
        decision = {
            "state": state,
            "identityState": identity_state,
            "primaryScore": rounded_score,
            "topCandidate": candidate,
            "candidates": [candidate],
            "topTwoMargin": None,
            "thresholds": {
                "positive": positive,
                "negative": negative,
                "negativeDecisionMode": negative_decision_mode,
                "recommendedPositiveThreshold": recommended_positive_threshold,
                "positiveThresholdSource": positive_threshold_source,
                "evidenceSnapshotHash": data.evidenceSnapshotHash,
            },
            "profileId": profile["_id"] if state == "matched" else None,
            "profileRevision": data.profileRevision,
            "embeddingSpaceId": segment_space,
            "matcherVersion": matcher_version,
            "calibrationId": data.calibrationId,
            "runId": data.runId,
            "evaluatedAt": datetime.now(UTC),
            "source": "automatic",
            "validity": decision_validity,
            "classificationPolicy": classification_policy,
            "maxRangeHours": max_range_hours,
            "negativeDecisionMode": negative_decision_mode,
            "recommendedPositiveThreshold": recommended_positive_threshold,
            "positiveThresholdSource": positive_threshold_source,
            "scoringStrategy": scoring_strategy,
            "calibrationContractVersion": calibration["contractVersion"],
        }
        compatibility = None
        if state == "matched" and classification_policy == "full":
            compatibility = {
                "profile_id": profile["_id"],
                "name": profile.get("name"),
                "similarity": round(score, 4),
                "matched_at": datetime.now(UTC),
                "method": "speakerIdentity",
                "profile_revision": data.profileRevision,
                "embedding_space_id": segment_space,
                "calibration_id": data.calibrationId,
            }
        update: Dict[str, Any] = {"$set": {"speakerIdentity": decision}}
        if compatibility:
            update["$set"]["matched_speaker"] = compatibility
        else:
            update["$unset"] = {"matched_speaker": ""}
        update_filter: Dict[str, Any] = {"_id": segment["_id"]}
        if classification_policy == "pilot":
            update_filter["$nor"] = [
                {"speakerIdentity.validity": "verified"},
                {"speakerIdentity.classificationPolicy": "full"},
            ]
        operations.append({"updateOne": {"filter": update_filter, "update": update}})

    if operations:
        if data.campaignId:
            _require_campaign_ownership(campaign_id, job_id)
        call_resource(
            "mongo",
            {
                "action": "bulkWrite",
                "collection": "diarizations",
                "operations": operations,
            },
        )

    processed = len(segments)
    cursor = str(segments[-1]["_id"]) if segments else data.cursor
    campaign_processed = cumulative_processed + processed
    campaign_matched = cumulative_matched + counts["matched"]
    campaign_rejected = cumulative_rejected + counts["rejected"]
    campaign_uncertain = cumulative_uncertain + counts["uncertain"]
    campaign_skipped = cumulative_skipped + incompatible_skipped
    elapsed = max(time.time() - started, 0.0)
    batch_rate = processed / elapsed if processed > 0 and elapsed > 0 else None
    final_rate_samples = (rate_samples + ([batch_rate] if batch_rate else []))[-10:]
    smoothed_rate = _rate_estimate(final_rate_samples)
    remaining: Optional[int] = (
        max(int(total_segments) - campaign_processed, 0)
        if total_segments is not None
        else None
    )
    has_more_in_partition = len(candidates) > data.limit
    next_run_id: Optional[str] = None
    next_partition_index: Optional[int] = None
    advance_partition = False
    source_changed = False
    if has_more_in_partition:
        has_more = True
        status = "running"
    elif data.partitions and data.partitionIndex + 1 < len(data.partitions):
        next_partition_index = data.partitionIndex + 1
        next_run_id = str(data.partitions[next_partition_index]["runId"])
        advance_partition = True
        has_more = True
        status = "running"
    elif data.partitions:
        actual_remaining = 0
        first_remaining_partition: Optional[int] = None
        for index, partition in enumerate(data.partitions):
            partition_data = data.model_copy(
                update={
                    "runId": str(partition["runId"]),
                    "partitionIndex": index,
                    "cursor": None,
                }
            )
            partition_remaining = int(
                call_resource(
                    "mongo",
                    {
                        "action": "count",
                        "collection": "diarizations",
                        "query": _identity_query(partition_data, classification_policy),
                        "options": {"maxTimeMS": 10_000},
                    },
                )
                or 0
            )
            actual_remaining += partition_remaining
            if partition_remaining > 0 and first_remaining_partition is None:
                first_remaining_partition = index
            actual_source = int(
                call_resource(
                    "mongo",
                    {
                        "action": "count",
                        "collection": "diarizations",
                        "query": _source_query_for_partition(data, partition),
                        "options": {"maxTimeMS": 10_000},
                    },
                )
                or 0
            )
            if actual_source != int(partition.get("sourceSegments", actual_source)):
                source_changed = True
        remaining = actual_remaining
        if source_changed:
            has_more = False
            status = "source_changed"
        elif actual_remaining > 0 and first_remaining_partition is not None:
            next_partition_index = first_remaining_partition
            next_run_id = str(data.partitions[first_remaining_partition]["runId"])
            advance_partition = True
            has_more = True
            status = "running"
        else:
            has_more = False
            status = "completed"
    else:
        has_more = has_more_in_partition
        status = (
            "running"
            if has_more
            else ("completed" if remaining in (None, 0) else "source_changed")
        )
    eta_seconds = (
        remaining / smoothed_rate
        if remaining is not None and remaining > 0 and smoothed_rate
        else 0.0
        if remaining == 0
        else None
    )
    next_cursor = None if advance_partition else cursor
    _update_campaign(
        campaign_id,
        {
            "status": status,
            "active": has_more,
            "processedSegments": campaign_processed,
            "pendingSegments": remaining,
            "matched": campaign_matched,
            "rejected": campaign_rejected,
            "uncertain": campaign_uncertain,
            "incompatibleSkipped": campaign_skipped,
            "currentJobId": job_id,
            "lastCursor": next_cursor,
            "partitionIndex": (
                next_partition_index
                if next_partition_index is not None
                else data.partitionIndex
            ),
            "runId": next_run_id or data.runId,
            "segmentsPerSecond": smoothed_rate or batch_rate,
            "currentSegmentsPerSecond": batch_rate,
            "etaSeconds": eta_seconds,
            "rateSamples": final_rate_samples,
            "finishedAt": datetime.now(UTC) if not has_more else None,
            "sourceChanged": source_changed,
        },
        owner_job_id=job_id if data.campaignId else None,
    )
    progress_callback(
        {
            "stage": "identity",
            "campaignId": campaign_id,
            "evidenceSnapshotHash": data.evidenceSnapshotHash,
            "classificationPolicy": classification_policy,
            "decisionValidity": (
                "verified" if classification_policy == "full" else "provisional"
            ),
            "targetPrecision": target_precision,
            "maxRangeHours": max_range_hours,
            "negativeDecisionMode": negative_decision_mode,
            "recommendedPositiveThreshold": recommended_positive_threshold,
            "positiveThresholdSource": positive_threshold_source,
            "scoringStrategy": scoring_strategy,
            "batchNumber": batch_number,
            "estimatedBatches": estimated_batches,
            "processed": campaign_processed,
            "total": total_segments,
            "remaining": remaining,
            "matched": campaign_matched,
            "rejected": campaign_rejected,
            "uncertain": campaign_uncertain,
            "incompatibleSkipped": campaign_skipped,
            "segmentsPerSecond": smoothed_rate or batch_rate,
            "etaSeconds": eta_seconds,
            "etaConfidence": "medium" if len(final_rate_samples) >= 5 else "low",
        }
    )
    return {
        "processed": processed,
        "hasMore": has_more,
        "cursor": next_cursor,
        "nextRunId": next_run_id,
        "nextPartitionIndex": next_partition_index,
        "advancePartition": advance_partition,
        "campaignStatus": status,
        "campaignId": campaign_id,
        "evidenceSnapshotHash": data.evidenceSnapshotHash,
        "classificationPolicy": classification_policy,
        "decisionValidity": (
            "verified" if classification_policy == "full" else "provisional"
        ),
        "targetPrecision": target_precision,
        "maxRangeHours": max_range_hours,
        "negativeDecisionMode": negative_decision_mode,
        "recommendedPositiveThreshold": recommended_positive_threshold,
        "positiveThresholdSource": positive_threshold_source,
        "scoringStrategy": scoring_strategy,
        "batchNumber": batch_number,
        "estimatedBatches": estimated_batches,
        "incompatibleSkipped": incompatible_skipped,
        **counts,
        "campaignProcessed": campaign_processed,
        "campaignMatched": campaign_matched,
        "campaignRejected": campaign_rejected,
        "campaignUncertain": campaign_uncertain,
        "campaignIncompatibleSkipped": campaign_skipped,
        "campaignTotal": total_segments,
        "campaignRemaining": remaining,
        "duration": round(elapsed, 2),
    }
