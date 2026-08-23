"""Rebuild a speaker profile from its saved source samples in one embedding space."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Callable, Dict

import numpy as np
from bson import ObjectId
from pydantic import BaseModel

from jobs.enrollment import _extract_embedding, _get_audio_from_gridfs
from lib.diarization_runtime import extract_diarizator_runtime_provenance
from lib.resources import call_resource
from speaker_identification.profiles import get_profile_by_id


class ProfileReenrollmentJobData(BaseModel):
    profileId: str
    diarizationServerUrl: str | None = None
    routingContext: Dict[str, Any] | None = None


def process_profile_reenrollment_job(
    job_id: str,
    data: ProfileReenrollmentJobData,
    progress_callback: Callable[[Dict[str, Any]], None],
) -> Dict[str, Any]:
    profile = get_profile_by_id(data.profileId)
    if not profile:
        raise ValueError(f"Profile not found: {data.profileId}")
    samples = call_resource("mongo", {
        "action": "find",
        "collection": "voice_samples.files",
        "query": {"metadata.profile_id": data.profileId},
        "options": {"sort": {"uploadDate": 1}},
    }) or []
    if not samples:
        raise ValueError("Profile has no saved samples to re-enroll")

    embeddings = []
    durations = []
    spaces = set()
    runtimes: set[tuple[str, str, str]] = set()
    for index, sample in enumerate(samples):
        result = _extract_embedding(
            _get_audio_from_gridfs(str(sample["_id"])),
            server_url=data.diarizationServerUrl,
        )
        embeddings.append(np.asarray(result["embedding"], dtype=np.float32))
        durations.append(float(result["duration"]))
        spaces.add(result.get("embeddingSpaceId", "legacy-unknown"))
        runtime = extract_diarizator_runtime_provenance(result)
        if runtime:
            runtimes.add((
                runtime["modelId"],
                runtime["modelVersion"],
                runtime["embeddingSpaceId"],
            ))
        progress_callback({"stage": "reenrollment", "processed": index + 1, "total": len(samples)})
    if len(spaces) != 1:
        raise ValueError(f"Diarizator changed embedding space during re-enrollment: {sorted(spaces)}")
    if len(runtimes) > 1:
        raise ValueError("Diarizator runtime changed during re-enrollment")

    merged = np.mean(np.stack(embeddings), axis=0)
    norm = float(np.linalg.norm(merged))
    if norm == 0:
        raise ValueError("Re-enrollment produced a zero embedding")
    merged /= norm
    embedding_space_id = spaces.pop()
    runtime_provenance = None
    if runtimes:
        model_id, model_version, runtime_space = runtimes.pop()
        runtime_provenance = {
            "modelId": model_id,
            "modelVersion": model_version,
            "embeddingSpaceId": runtime_space,
            "source": "inference_response",
        }
    expected_runtime = data.routingContext or {}
    for key in ("modelId", "modelVersion", "embeddingSpaceId"):
        expected = expected_runtime.get(key)
        if expected and (runtime_provenance or {}).get(key) != expected:
            raise ValueError(
                f"Diarizator {key} changed after route admission: "
                f"{(runtime_provenance or {}).get(key)} != {expected}"
            )
    revision = int(profile.get("revision", 1)) + 1
    now = datetime.now(UTC)
    update = {
        "embedding": merged.tolist(),
        "embeddingSpaceId": embedding_space_id,
        "revision": revision,
        "sample_count": len(samples),
        "total_duration": sum(durations),
        "enrollmentStatus": "ready",
        "enrollmentProvenance": {
            "source": "saved_samples_rebuild",
            "sampleIds": [sample["_id"] for sample in samples],
            "embeddingSpaceId": embedding_space_id,
            "jobId": job_id,
            "rebuiltAt": now,
            **(runtime_provenance or {}),
        },
        **(
            {"runtimeProvenance": runtime_provenance}
            if runtime_provenance
            else {}
        ),
        "updated_at": now,
    }
    result = call_resource("mongo", {
        "action": "updateOne",
        "collection": "speaker_profiles",
        "query": {"_id": ObjectId(data.profileId), "revision": profile.get("revision", 1)},
        "update": {"$set": update},
    })
    if (result or {}).get("matchedCount", 0) != 1:
        raise RuntimeError("Profile changed while it was being re-enrolled")
    return {
        "processed": len(samples),
        "profileId": data.profileId,
        "profileRevision": revision,
        "embeddingSpaceId": embedding_space_id,
        "runtimeProvenance": runtime_provenance,
        "hasMore": False,
    }
