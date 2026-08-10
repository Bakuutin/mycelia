"""Versioned, tri-state identity matching over stored diarization embeddings."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any, Callable, Dict, Literal, Optional

import numpy as np
from bson import ObjectId
from pydantic import BaseModel, Field, model_validator

from lib.resources import call_resource
from speaker_identification.profiles import get_profile_by_id

UNKNOWN_SPACES = {"", "legacy-unknown", "unknown", None}


def classify_identity(
    score: float,
    *,
    positive_threshold: float,
    negative_threshold: float,
    segment_space: Optional[str] = None,
    profile_space: Optional[str] = None,
    allow_legacy_compatibility: bool = False,
) -> Literal["matched", "rejected", "uncertain"]:
    if negative_threshold >= positive_threshold:
        raise ValueError("negative threshold must be lower than positive threshold")
    if segment_space != profile_space:
        raise ValueError(
            f"Embedding space mismatch: segment={segment_space!r}, profile={profile_space!r}"
        )
    if segment_space in UNKNOWN_SPACES and not allow_legacy_compatibility:
        raise ValueError("Matching an unknown embedding space requires validated compatibility")
    if score >= positive_threshold:
        return "matched"
    if score <= negative_threshold:
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

    calibration = call_resource("mongo", {
        "action": "findOne",
        "collection": "speaker_calibrations",
        "query": {"calibrationId": data.calibrationId, "profileId": data.profileId},
    })
    if not calibration or calibration.get("status") != "validated":
        raise ValueError("A validated calibration is required before identity backfill")

    positive = float(calibration["positiveThreshold"])
    negative = float(calibration["negativeThreshold"])
    allow_legacy = bool(calibration.get("allowLegacyCompatibility", False))
    matcher_version = "profile-candidates-v2"

    query: Dict[str, Any] = {
        "runId": data.runId,
        "lifecycleStatus": "active",
        "embedding": {"$exists": True},
        "$or": [
            {"speakerIdentity": {"$exists": False}},
            {"speakerIdentity.profileId": {"$ne": ObjectId(data.profileId)}},
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
    if data.cursor:
        query["_id"] = {"$gt": ObjectId(data.cursor)}

    segments = call_resource("mongo", {
        "action": "find",
        "collection": "diarizations",
        "query": query,
        "options": {"sort": {"_id": 1}, "limit": data.limit},
    }) or []

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
        decision = {
            "state": state,
            "identityState": identity_state,
            "primaryScore": rounded_score,
            "topCandidate": candidate,
            "candidates": [candidate],
            "topTwoMargin": None,
            "thresholds": {"positive": positive, "negative": negative},
            "profileId": profile["_id"] if state == "matched" else None,
            "profileRevision": data.profileRevision,
            "embeddingSpaceId": segment_space,
            "matcherVersion": matcher_version,
            "calibrationId": data.calibrationId,
            "runId": data.runId,
            "evaluatedAt": datetime.now(UTC),
            "source": "automatic",
        }
        compatibility = None
        if state == "matched":
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
        operations.append({"updateOne": {"filter": {"_id": segment["_id"]}, "update": update}})

    if operations:
        call_resource("mongo", {
            "action": "bulkWrite",
            "collection": "diarizations",
            "operations": operations,
        })

    processed = len(segments)
    cursor = str(segments[-1]["_id"]) if segments else data.cursor
    progress_callback({
        "stage": "identity",
        "processed": processed,
        "incompatibleSkipped": incompatible_skipped,
        **counts,
    })
    return {
        "processed": processed,
        "hasMore": processed == data.limit,
        "cursor": cursor,
        "incompatibleSkipped": incompatible_skipped,
        **counts,
        "duration": round(time.time() - started, 2),
    }
