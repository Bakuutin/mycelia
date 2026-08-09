"""Stable runtime provenance for versioned diarization and embeddings."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
from typing import Any


def _version(package: str) -> str:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def _lock_hash() -> str:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "uv.lock"
        if candidate.exists():
            return hashlib.sha256(candidate.read_bytes()).hexdigest()
    return "unknown"


def _hash(value: dict[str, Any]) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def build_runtime_fingerprint(
    *,
    diarization_model: str,
    embedding_model: str,
    sample_rate: int,
    embedding_dimension: int,
    preprocessing: str,
) -> dict[str, Any]:
    embedding = {
        "model": embedding_model,
        "resolvedRevision": os.getenv("EMBEDDING_MODEL_REVISION", "unknown"),
        "sampleRate": sample_rate,
        "preprocessing": preprocessing,
        "dimension": embedding_dimension,
        "lockHash": _lock_hash(),
    }
    diarization = {
        "model": diarization_model,
        "resolvedRevision": os.getenv("DIARIZATION_MODEL_REVISION", "unknown"),
        "pyannoteVersion": _version("pyannote.audio"),
        "torchVersion": _version("torch"),
        "numpyVersion": _version("numpy"),
        "preprocessing": preprocessing,
        "configHash": _hash({"diarization": diarization_model, "embedding": embedding}),
    }
    return {"diarizationFingerprint": diarization, "embeddingSpaceId": _hash(embedding)}
