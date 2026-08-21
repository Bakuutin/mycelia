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
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    limit: int = Field(default=1000, ge=1, le=10000)
    cursor: Optional[str] = None
    campaignId: Optional[str] = None

    @model_validator(mode="after")
    def validate_range(self) -> "SpeakerIdentityJobData":
        if self.start and self.end and self.end <= self.start:
            raise ValueError("end must be after start")
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


def _campaign_call(request: Dict[str, Any]) -> Any:
    """Observability failures must not discard valid identity decisions."""
    try:
        return call_resource("mongo", request)
    except Exception as exc:
        logger.warning("Could not persist speaker identity campaign telemetry: %s", exc)
        return None


def _update_campaign(campaign_id: str, fields: Dict[str, Any]) -> None:
    _campaign_call(
        {
            "action": "updateOne",
            "collection": "speaker_identity_campaigns",
            "query": {"campaignId": campaign_id},
            "update": {"$set": {**fields, "updatedAt": datetime.now(UTC)}},
            "options": {"upsert": True},
        }
    )


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
        or int(validation.get("identified", 0)) < 1
    ):
        raise ValueError(
            "Calibration does not prove the required independent validation precision"
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
    query: Dict[str, Any] = {
        "runId": data.runId,
        "lifecycleStatus": "active",
        "embedding": {"$exists": True},
        "$or": [
            {"speakerIdentity": {"$exists": False}},
            {
                "speakerIdentity.topCandidate.profileId": {
                    "$ne": ObjectId(data.profileId)
                }
            },
            {"speakerIdentity.profileRevision": {"$ne": data.profileRevision}},
            {"speakerIdentity.calibrationId": {"$ne": data.calibrationId}},
        ],
    }
    if data.start or data.end:
        query["start"] = {}
        if data.start:
            query["start"]["$gte"] = data.start
        if data.end:
            query["start"]["$lt"] = data.end
    if classification_policy == "pilot":
        query["$nor"] = [
            {"speakerIdentity.validity": "verified"},
            {"speakerIdentity.classificationPolicy": "full"},
        ]
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
    classification_policy, max_range_hours = _validated_calibration_policy(
        calibration, data
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
    matcher_version = "profile-candidates-v2"

    campaign_id = data.campaignId or f"speaker-identity-{job_id}"
    campaign = (
        _campaign_call(
            {
                "action": "findOne",
                "collection": "speaker_identity_campaigns",
                "query": {"campaignId": campaign_id},
            }
        )
        or {}
    )
    base_query = _identity_query(data, classification_policy)
    total_segments = campaign.get("totalSegments")
    count_warning: Optional[str] = None
    if total_segments is None:
        progress_callback(
            {
                "stage": "counting",
                "campaignId": campaign_id,
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
            "mode": "classify_existing",
            "runId": data.runId,
            "profileId": data.profileId,
            "profileName": profile.get("name"),
            "profileRevision": data.profileRevision,
            "calibrationId": data.calibrationId,
            "classificationPolicy": classification_policy,
            "decisionValidity": (
                "verified" if classification_policy == "full" else "provisional"
            ),
            "targetPrecision": target_precision,
            "maxRangeHours": max_range_hours,
            "negativeDecisionMode": negative_decision_mode,
            "recommendedPositiveThreshold": recommended_positive_threshold,
            "positiveThresholdSource": positive_threshold_source,
            "range": {"start": data.start, "end": data.end},
            "status": "running",
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
        score = _cosine(segment["embedding"], profile["embedding"])
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
    remaining = (
        max(int(total_segments) - campaign_processed, 0)
        if total_segments is not None
        else None
    )
    eta_seconds = (
        remaining / smoothed_rate
        if remaining is not None and remaining > 0 and smoothed_rate
        else 0.0
        if remaining == 0 and smoothed_rate
        else None
    )
    has_more = len(candidates) > data.limit
    status = "running" if has_more else "completed"
    _update_campaign(
        campaign_id,
        {
            "status": status,
            "processedSegments": campaign_processed,
            "pendingSegments": remaining,
            "matched": campaign_matched,
            "rejected": campaign_rejected,
            "uncertain": campaign_uncertain,
            "incompatibleSkipped": campaign_skipped,
            "currentJobId": job_id,
            "lastCursor": cursor,
            "segmentsPerSecond": smoothed_rate or batch_rate,
            "currentSegmentsPerSecond": batch_rate,
            "etaSeconds": eta_seconds,
            "rateSamples": final_rate_samples,
            "finishedAt": datetime.now(UTC) if not has_more else None,
        },
    )
    progress_callback(
        {
            "stage": "identity",
            "campaignId": campaign_id,
            "classificationPolicy": classification_policy,
            "decisionValidity": (
                "verified" if classification_policy == "full" else "provisional"
            ),
            "targetPrecision": target_precision,
            "maxRangeHours": max_range_hours,
            "negativeDecisionMode": negative_decision_mode,
            "recommendedPositiveThreshold": recommended_positive_threshold,
            "positiveThresholdSource": positive_threshold_source,
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
        "cursor": cursor,
        "campaignId": campaign_id,
        "classificationPolicy": classification_policy,
        "decisionValidity": (
            "verified" if classification_policy == "full" else "provisional"
        ),
        "targetPrecision": target_precision,
        "maxRangeHours": max_range_hours,
        "negativeDecisionMode": negative_decision_mode,
        "recommendedPositiveThreshold": recommended_positive_threshold,
        "positiveThresholdSource": positive_threshold_source,
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
