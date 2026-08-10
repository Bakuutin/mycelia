"""Voice enrollment job - enrolls a speaker from audio file."""

import logging
import os
import requests
import tempfile
from datetime import datetime, UTC
from typing import Any, Callable, Dict, Optional
from pydantic import BaseModel

from lib.resources import call_resource
from speaker_identification.profiles import (
    add_sample_to_profile,
    create_or_update_profile,
    get_profile_by_id,
)

logger = logging.getLogger(__name__)

# Diarization server URL for embedding extraction
DIARIZATION_SERVER_URL = os.environ.get("DIARIZATION_SERVER_URL", "http://localhost:8085")


class EnrollmentJobData(BaseModel):
    """Data model for enrollment job."""
    name: str  # Speaker name (e.g., "Me", "Wife")
    profile_id: Optional[str] = None
    is_primary: bool = False  # True if this is "my voice"
    audio_chunk_id: Optional[str] = None  # If enrolling from existing audio chunk
    audio_data_base64: Optional[str] = None  # If enrolling from uploaded audio (base64)
    sample_file_id: Optional[str] = None  # If enrolling from saved voice sample in GridFS
    start: Optional[float] = None  # Start time for segment extraction
    end: Optional[float] = None  # End time for segment extraction
    diarizationServerUrl: Optional[str] = None


def _get_audio_from_chunk(chunk_id: str) -> bytes:
    """Retrieve audio data from an audio chunk in GridFS."""
    result = call_resource("mongo", {
        "action": "findOne",
        "collection": "audio_chunks",
        "query": {"_id": {"$oid": chunk_id}},
    })
    
    chunk = (result or {}).get("data")
    if not chunk:
        raise ValueError(f"Audio chunk not found: {chunk_id}")
    
    # The chunk data is stored as binary
    audio_data = chunk.get("data")
    if not audio_data:
        raise ValueError(f"Audio chunk has no data: {chunk_id}")
    
    # Convert from opus to wav if needed
    # The chunking.py module has read_codec for this
    from chunking import read_codec, sample_rate
    import numpy as np
    import io
    import wave
    
    # Decode opus to PCM
    pcm = read_codec(audio_data, codec="opus", sample_rate=sample_rate)
    
    # Convert to WAV bytes
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        # Convert float32 to int16
        pcm_int16 = (pcm * 32767).astype(np.int16)
        wav_file.writeframes(pcm_int16.tobytes())
    
    return wav_buffer.getvalue()


def _get_audio_from_base64(data: str) -> bytes:
    """Decode base64 audio data."""
    import base64
    return base64.b64decode(data)


def _get_audio_from_gridfs(file_id: str, bucket: str = "voice_samples") -> bytes:
    """Retrieve audio data from GridFS bucket."""
    result = call_resource("fs", {
        "action": "download",
        "bucket": bucket,
        "id": file_id,
    })
    
    if result is None:
        raise ValueError(f"Voice sample not found in GridFS: {file_id}")
    
    # Result is the raw bytes from GridFS
    if isinstance(result, dict) and "$binary" in result:
        # EJSON binary format
        import base64
        return base64.b64decode(result["$binary"]["base64"])
    elif isinstance(result, dict):
        # Uint8Array serialized as dict with numeric string keys: {'0': 82, '1': 73, ...}
        keys = list(result.keys())
        if keys and all(k.isdigit() for k in keys[:10]):
            max_idx = max(int(k) for k in keys)
            byte_array = bytearray(max_idx + 1)
            for k, v in result.items():
                byte_array[int(k)] = v
            return bytes(byte_array)
        else:
            raise ValueError(f"Unexpected dict format from GridFS: keys sample={keys[:5]}")
    elif isinstance(result, bytes):
        return result
    elif isinstance(result, list):
        # Sometimes returns as list of ints
        return bytes(result)
    else:
        raise ValueError(f"Unexpected GridFS download result type: {type(result)}")


def _extract_embedding(audio_data: bytes, start: Optional[float] = None, end: Optional[float] = None, server_url: Optional[str] = None) -> Dict[str, Any]:
    """
    Extract speaker embedding from audio using the diarizator service.
    
    Returns:
        Dict with 'embedding' (list of floats), 'dimension', and 'duration'
    """
    # Build URL with query params
    url = f"{(server_url or DIARIZATION_SERVER_URL).rstrip('/')}/embed"
    params = {}
    if start is not None:
        params["start"] = start
    if end is not None:
        params["end"] = end
    
    logger.info(f"Extracting embedding from {len(audio_data)} bytes of audio")
    
    # Send audio to diarizator
    response = requests.post(
        url,
        files={"file": ("audio.wav", audio_data, "audio/wav")},
        params=params,
        timeout=60,
    )
    
    if response.status_code != 200:
        error_detail = response.text
        logger.error(f"Embedding extraction failed: {response.status_code} - {error_detail}")
        raise ValueError(f"Embedding extraction failed: {error_detail}")
    
    result = response.json()
    logger.info(f"Embedding extracted: dim={result.get('dimension')}, duration={result.get('duration')}s")
    
    return result


def process_enrollment_job(
    job_id: str,
    data: EnrollmentJobData,
    progress_callback: Callable[[Dict[str, Any]], None],
) -> Dict[str, Any]:
    """
    Process a voice enrollment job.
    
    Steps:
    1. Get audio data (from chunk or base64)
    2. Extract embedding via diarizator /embed endpoint
    3. Create or update speaker profile in MongoDB
    """
    logger.info(f"Starting enrollment job {job_id} for speaker '{data.name}'")
    
    progress_callback({
        "stage": "loading_audio",
        "message": "Loading audio data...",
    })
    
    # Get audio data
    try:
        if data.audio_chunk_id:
            logger.info(f"Loading audio from chunk: {data.audio_chunk_id}")
            audio_data = _get_audio_from_chunk(data.audio_chunk_id)
        elif data.audio_data_base64:
            logger.info("Loading audio from base64 data")
            audio_data = _get_audio_from_base64(data.audio_data_base64)
        elif data.sample_file_id:
            logger.info(f"Loading audio from saved sample: {data.sample_file_id}")
            audio_data = _get_audio_from_gridfs(data.sample_file_id)
        else:
            raise ValueError("Either audio_chunk_id, audio_data_base64, or sample_file_id must be provided")
    except Exception as e:
        logger.error(f"Failed to load audio: {e}")
        raise
    
    progress_callback({
        "stage": "extracting_embedding",
        "message": "Extracting voice embedding...",
    })
    
    # Extract embedding
    try:
        embed_result = _extract_embedding(
            audio_data, data.start, data.end, data.diarizationServerUrl
        )
    except Exception as e:
        logger.error(f"Failed to extract embedding: {e}")
        raise
    
    embedding = embed_result["embedding"]
    duration = embed_result["duration"]
    embedding_space_id = embed_result.get("embeddingSpaceId", "legacy-unknown")
    
    progress_callback({
        "stage": "saving_profile",
        "message": "Saving speaker profile...",
    })
    
    # Create or update profile
    try:
        if data.profile_id:
            existing = get_profile_by_id(data.profile_id)
            if not existing:
                raise ValueError(f"Profile not found: {data.profile_id}")
            profile = add_sample_to_profile(existing, embedding, duration, embedding_space_id)
        else:
            profile = create_or_update_profile(
                name=data.name,
                embedding=embedding,
                duration=duration,
                is_primary=data.is_primary,
                embedding_space_id=embedding_space_id,
            )
    except Exception as e:
        logger.error(f"Failed to save profile: {e}")
        raise
    
    # Link the sample to the profile if using a saved sample
    if data.sample_file_id and profile.get("_id"):
        from bson import ObjectId
        link_result = call_resource("mongo", {
            "action": "updateOne",
            "collection": "voice_samples.files",
            "query": {"_id": ObjectId(data.sample_file_id)},
            "update": {"$set": {"metadata.profile_id": str(profile["_id"])}},
        })
        if (link_result or {}).get("matchedCount", 0) != 1:
            raise RuntimeError(
                f"Voice sample {data.sample_file_id} was not linked to profile {profile['_id']}"
            )
        logger.info(f"Linked sample {data.sample_file_id} to profile {profile['_id']}")
    
    logger.info(f"Enrollment job {job_id} completed successfully")
    
    return {
        "success": True,
        "profile_id": str(profile.get("_id")),
        "profile_name": profile.get("name"),
        "sample_count": profile.get("sample_count"),
        "total_duration": profile.get("total_duration"),
        "is_primary": profile.get("is_primary"),
        "embeddingSpaceId": profile.get("embeddingSpaceId"),
        "revision": profile.get("revision", 1),
    }
