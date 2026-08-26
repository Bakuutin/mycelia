"""FastAPI service for pyannote diarization with embeddings and speaker identification."""

import asyncio
import gc
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse

from simple_speaker_recognition.api.inference_gate import (
    InferenceGate,
    InferenceGateFull,
)
from simple_speaker_recognition.core.audio_backend import (
    AudioBackend,
    _run_in_executor_to_completion,
)
from simple_speaker_recognition.provenance import build_runtime_fingerprint


# Load .env from root directory if running locally
# This allows using HF_TOKEN from the main project .env
def _load_dotenv():
    """Try to load .env from project root for local development."""
    try:
        from dotenv import load_dotenv

        # Try project root first (../../.env from this file)
        root_env = Path(__file__).parent.parent.parent.parent.parent / ".env"
        if root_env.exists():
            load_dotenv(root_env)
            return
        # Try diarizator root
        diarizator_env = Path(__file__).parent.parent.parent.parent / ".env"
        if diarizator_env.exists():
            load_dotenv(diarizator_env)
    except ImportError:
        pass  # python-dotenv not installed, skip


_load_dotenv()

# Configure logging
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("diarization_service")
log.debug(f"Logging initialized at level: {log_level}")

# Get HF_TOKEN from environment
hf_token = os.getenv("HF_TOKEN")
if not hf_token:
    raise ValueError(
        "HF_TOKEN environment variable is required. Please set it before running the service."
    )

# Device selection with environment override
log.info(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    log.info(f"CUDA device count: {torch.cuda.device_count()}")
    log.info(f"CUDA device name: {torch.cuda.get_device_name(0)}")
    log.info(f"CUDA version: {torch.version.cuda}")

compute_mode = os.getenv("COMPUTE_MODE", "cpu").lower()
if compute_mode == "gpu" and torch.cuda.is_available():
    device = torch.device("cuda")
    log.info("Using GPU mode via COMPUTE_MODE=gpu environment variable")
elif compute_mode == "gpu" and not torch.cuda.is_available():
    device = torch.device("cpu")
    log.warning(
        "COMPUTE_MODE=gpu requested but CUDA not available, falling back to CPU"
    )
else:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Model lifecycle state. The lock is created lazily so tests using separate
# event loops do not inherit a lock bound to an earlier loop.
audio_backend: Optional[AudioBackend] = None
model_lock: Optional[asyncio.Lock] = None
idle_unload_task: Optional[asyncio.Task] = None
model_state = "starting"
model_error: Optional[str] = None
last_model_activity = time.monotonic()
cached_runtime_fingerprint: Dict = {}
cached_batching: Optional[Dict[str, int]] = None


def _positive_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        log.warning("Invalid %s=%r; using %d", name, raw, default)
        return default
    if value < 1:
        log.warning("%s must be positive; using %d", name, default)
        return default
    return value


def _nonnegative_int_env(name: str, default: int) -> int:
    """Read an integer timeout where zero explicitly disables the feature."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        log.warning("Invalid %s=%r; using %d", name, raw, default)
        return default
    if value < 0:
        log.warning("%s must be non-negative; using %d", name, default)
        return default
    return value


def _bounded_int_env(
    name: str,
    default: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    """Read an integer env setting whose safe range is intentionally narrow."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(
            f"{name} must be an integer between {minimum} and {maximum}"
        ) from exc
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}; got {value}")
    return value


inference_gate = InferenceGate(
    concurrency=_positive_int_env("DIARIZATION_REQUEST_CONCURRENCY", 1),
    max_queued=_bounded_int_env(
        "DIARIZATION_MAX_QUEUED_REQUESTS",
        1,
        minimum=0,
        maximum=1,
    ),
)
idle_timeout_seconds = _nonnegative_int_env(
    "DIARIZATION_IDLE_TIMEOUT_SECONDS",
    0,
)


def _elapsed_ms(started_at: float) -> float:
    return round((time.perf_counter() - started_at) * 1000, 2)


def _mark_model_activity() -> None:
    global last_model_activity
    last_model_activity = time.monotonic()


def _finish_timings(
    timings: Dict[str, float],
    request_started: float,
    expected_stages: tuple[str, ...],
) -> Dict[str, float]:
    for stage in expected_stages:
        timings.setdefault(stage, 0.0)
    timings["total_ms"] = _elapsed_ms(request_started)
    return dict(timings)


def _runtime_fingerprint(backend: AudioBackend) -> Dict:
    return build_runtime_fingerprint(
        diarization_model=backend.diarization_model,
        embedding_model=backend.embedding_model,
        sample_rate=16000,
        embedding_dimension=int(backend.embedder.dimension),
        preprocessing=f"{os.getenv('AUDIO_BACKEND', 'soundfile')}-mono-16khz-v1",
    )


def _backend_batching(backend: AudioBackend) -> Dict[str, int]:
    return {
        "segmentation": backend.segmentation_batch_size,
        "pipeline_embeddings": backend.embedding_batch_size,
        "segment_embeddings": backend.segment_embedding_batch_size,
    }


def _get_model_lock() -> asyncio.Lock:
    global model_lock
    if model_lock is None:
        model_lock = asyncio.Lock()
    return model_lock


def _create_audio_backend() -> AudioBackend:
    return AudioBackend(hf_token, device)


async def _ensure_audio_backend() -> AudioBackend:
    """Return the loaded backend, single-flight loading it after idle offload."""
    global audio_backend, cached_batching, cached_runtime_fingerprint
    global last_model_activity, model_error, model_state

    if audio_backend is not None:
        return audio_backend

    async with _get_model_lock():
        if audio_backend is not None:
            return audio_backend

        model_state = "loading"
        model_error = None
        log.info("Loading diarization models on %s", device)
        try:
            backend = await _run_in_executor_to_completion(_create_audio_backend)
            cached_runtime_fingerprint = _runtime_fingerprint(backend)
            cached_batching = _backend_batching(backend)
            audio_backend = backend
            last_model_activity = time.monotonic()
            model_state = "ready"
            log.info("Models ready ✔ – device=%s", device)
            return backend
        except asyncio.CancelledError:
            model_state = "idle"
            raise
        except Exception as error:
            model_error = str(error)
            model_state = "error"
            log.error("Failed to load diarization models", exc_info=True)
            raise HTTPException(
                status_code=503,
                detail=f"Diarization model load failed: {error}",
            ) from error


async def _unload_audio_backend_if_idle(*, now: Optional[float] = None) -> bool:
    """Release model references and cached CUDA allocations after inactivity."""
    global audio_backend, model_state

    if idle_timeout_seconds <= 0:
        return False

    async with _get_model_lock():
        if audio_backend is None or model_state != "ready":
            return False
        snapshot = await inference_gate.snapshot()
        if snapshot.inflight or snapshot.queued:
            return False
        checked_at = time.monotonic() if now is None else now
        if checked_at - last_model_activity < idle_timeout_seconds:
            return False

        backend = audio_backend
        audio_backend = None
        model_state = "idle"
        del backend
        gc.collect()
        if device.type == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        log.info(
            "Unloaded idle diarization models after %ds",
            idle_timeout_seconds,
        )
        return True


async def _idle_unload_loop() -> None:
    interval = max(1.0, min(5.0, idle_timeout_seconds / 2))
    while True:
        await asyncio.sleep(interval)
        await _unload_audio_backend_if_idle()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan event handler for startup and shutdown."""
    global idle_unload_task, model_lock

    log.info("=== PyAnnote Diarization Service Starting ===")
    log.debug(f"HF_TOKEN present: {bool(hf_token)}")
    log.debug(f"Device: {device}")
    model_lock = asyncio.Lock()
    await _ensure_audio_backend()
    if idle_timeout_seconds > 0:
        idle_unload_task = asyncio.create_task(_idle_unload_loop())
        log.info("Idle model offload enabled: timeout=%ds", idle_timeout_seconds)

    try:
        yield
    finally:
        if idle_unload_task is not None:
            idle_unload_task.cancel()
            try:
                await idle_unload_task
            except asyncio.CancelledError:
                pass
            idle_unload_task = None
        log.info("Shutting down diarization service")


app = FastAPI(title="PyAnnote Diarization Service", version="1.0.0", lifespan=lifespan)

# Note: Speaker profiles are managed via MongoDB in the main Mycelia backend.
# The legacy SQLite/FAISS routers are not mounted. Only /diarize and /embed are exposed.


@app.exception_handler(InferenceGateFull)
async def inference_capacity_exhausted(
    _request: Request,
    _error: InferenceGateFull,
):
    snapshot = await inference_gate.snapshot()
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": "1"},
        content={
            "error": "inference_capacity_exhausted",
            "message": "All inference slots and the bounded wait slot are occupied",
            "retryable": True,
            "retryAfterSeconds": 1,
            "concurrency": snapshot.concurrency,
            "inflight": snapshot.inflight,
            "queued": snapshot.queued,
        },
    )


async def _health_payload() -> Dict:
    snapshot = await inference_gate.snapshot()
    device_ready = not (compute_mode == "gpu" and device.type != "cuda")
    model_ready = model_state in {"idle", "loading"} or (
        model_state == "ready" and audio_backend is not None
    )
    runtime_ready = device_ready and model_ready
    idle_seconds = max(0.0, time.monotonic() - last_model_activity)
    return {
        "status": "ok",
        "version": "1.0.0",
        "device": str(device),
        "computeMode": compute_mode,
        "service": "pyannote-diarization",
        "ready": runtime_ready,
        "modelState": model_state,
        "modelsLoaded": audio_backend is not None,
        "idleTimeoutSeconds": idle_timeout_seconds,
        "idleSeconds": round(idle_seconds, 1),
        "modelError": model_error,
        "concurrency": snapshot.concurrency,
        "inflight": snapshot.inflight,
        "queued": snapshot.queued,
        "maxQueued": snapshot.max_queued,
        "batching": cached_batching,
        **cached_runtime_fingerprint,
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return await _health_payload()


@app.get("/ready")
async def ready():
    """Report whether the process can accept work, including cold-start work."""
    payload = await _health_payload()
    if not payload["ready"]:
        return JSONResponse(status_code=503, content=payload)
    return payload


@app.post("/embed")
async def embed(
    file: UploadFile = File(..., description="Audio file to extract embedding from"),
    start: Optional[float] = Query(
        default=None, description="Start time in seconds (optional)"
    ),
    end: Optional[float] = Query(
        default=None, description="End time in seconds (optional)"
    ),
):
    """
    Extract speaker embedding from an audio file.

    This endpoint is used for voice enrollment - it extracts a 256-dimensional
    speaker embedding vector from the provided audio.

    Args:
        file: Audio file (WAV, MP3, etc.)
        start: Optional start time for extracting a segment
        end: Optional end time for extracting a segment

    Returns:
        embedding: List of 256 floats (L2-normalized)
        dimension: Embedding dimension (256)
        duration: Duration of audio processed in seconds
    """
    request_started = time.perf_counter()
    timings: Dict[str, float] = {}
    log.debug(f"Received embedding request: filename={file.filename}")

    lease = None
    backend = None
    audio_data = b""
    try:
        lease = await inference_gate.acquire()
        timings["queue_ms"] = round(lease.queue_seconds * 1000, 2)
        load_started = time.perf_counter()
        backend = await _ensure_audio_backend()
        timings["model_load_ms"] = _elapsed_ms(load_started)

        # Do not copy the upload into process memory until capacity is reserved.
        upload_started = time.perf_counter()
        audio_data = await file.read()
        timings["upload_read_ms"] = _elapsed_ms(upload_started)
        if len(audio_data) == 0:
            raise HTTPException(status_code=400, detail="Audio file is empty")

        # Decode the upload once in memory and preserve the existing crop behavior.
        decode_started = time.perf_counter()
        wav = await backend.async_load_wave_bytes(
            audio_data,
            start=start,
            end=end,
        )
        timings["decode_ms"] = _elapsed_ms(decode_started)

        # Calculate duration
        duration = wav.shape[-1] / 16000.0  # 16kHz sample rate
        log.debug(f"Audio loaded: shape={wav.shape}, duration={duration:.2f}s")

        # Check minimum duration
        if duration < 0.5:
            raise HTTPException(
                status_code=400,
                detail=f"Audio too short ({duration:.2f}s). Minimum 0.5 seconds required.",
            )

        # Extract embedding
        log.debug("Extracting embedding...")
        embedding_started = time.perf_counter()
        emb = await backend.async_embed(wav)
        timings["embedding_ms"] = _elapsed_ms(embedding_started)
        emb_flat = emb.flatten()

        # Validate embedding
        if np.any(np.isnan(emb_flat)):
            raise HTTPException(
                status_code=500, detail="Embedding extraction produced NaN values"
            )

        # Ensure normalization
        emb_norm = np.linalg.norm(emb_flat)
        if abs(emb_norm - 1.0) > 0.01:
            emb_flat = emb_flat / emb_norm

        timings["total_ms"] = _elapsed_ms(request_started)
        log.info(
            "Embedding complete: dim=%d, duration=%.2fs, "
            "queue=%.2fms, decode=%.2fms, embedding=%.2fms, total=%.2fms",
            len(emb_flat),
            duration,
            timings.get("queue_ms", 0.0),
            timings.get("decode_ms", 0.0),
            timings.get("embedding_ms", 0.0),
            timings["total_ms"],
        )

        return {
            "embedding": emb_flat.tolist(),
            "dimension": len(emb_flat),
            "duration": round(duration, 3),
            "timings": timings,
            **_runtime_fingerprint(backend),
        }

    except InferenceGateFull:
        log.warning(
            "Embedding rejected: inference capacity exhausted, bytes=%d, total=%.2fms",
            len(audio_data),
            _elapsed_ms(request_started),
        )
        raise
    except ValueError as e:
        log.error(f"Error extracting embedding: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Embedding extraction failed: {str(e)}"
        )
    finally:
        if lease is not None:
            _mark_model_activity()
            await inference_gate.release()


@app.post("/diarize")
async def diarize(
    file: UploadFile = File(..., description="Audio file for diarization"),
    min_speakers: Optional[int] = Query(
        default=None, description="Minimum number of speakers to detect"
    ),
    max_speakers: Optional[int] = Query(
        default=None, description="Maximum number of speakers to detect"
    ),
    collar: Optional[float] = Query(
        default=None, ge=0, description="Optional post-processing gap merge duration"
    ),
    min_duration_off: Optional[float] = Query(
        default=None, ge=0, description="Optional legacy segmentation override"
    ),
    clusters: Optional[str] = Form(
        default=None, description="JSON array of known speaker clusters with embeddings"
    ),
    similarity_threshold: float = Query(
        default=0.15, description="Cosine similarity threshold for cluster matching"
    ),
):
    """
    Perform speaker diarization on an audio file and optionally match segments against known clusters.

    Returns segments with embeddings. If clusters are provided, segments are matched against them.
    """
    request_started = time.perf_counter()
    timings: Dict[str, float] = {}
    log.debug(
        f"Received diarization request: filename={file.filename}, size={file.size if hasattr(file, 'size') else 'unknown'}"
    )
    log.debug(
        f"Parameters: min_speakers={min_speakers}, max_speakers={max_speakers}, collar={collar}, min_duration_off={min_duration_off}"
    )
    log.debug(
        f"Similarity threshold: {similarity_threshold}, clusters provided: {clusters is not None}"
    )

    # Parse clusters if provided
    cluster_list: Optional[List[Dict]] = None
    if clusters:
        log.debug(f"Parsing clusters JSON (length: {len(clusters)} chars)")
        try:
            cluster_list = json.loads(clusters)
            if not isinstance(cluster_list, list):
                raise ValueError("clusters must be a JSON array")

            # Validate cluster structure
            log.debug(f"Validating {len(cluster_list)} clusters")
            for i, cluster in enumerate(cluster_list):
                if not isinstance(cluster, dict):
                    raise ValueError("Each cluster must be a dictionary")
                if "id" not in cluster or "embedding" not in cluster:
                    raise ValueError(
                        "Each cluster must have 'id' and 'embedding' fields"
                    )
                if not isinstance(cluster["embedding"], list):
                    raise ValueError("Cluster embedding must be an array")
                emb_len = len(cluster["embedding"])
                log.debug(
                    f"Cluster {i}: id={cluster.get('id')}, name={cluster.get('name')}, embedding_dim={emb_len}"
                )
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=400, detail=f"Invalid JSON in clusters parameter: {str(e)}"
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    lease = None
    backend = None
    audio_data = b""
    try:
        lease = await inference_gate.acquire()
        timings["queue_ms"] = round(lease.queue_seconds * 1000, 2)
        load_started = time.perf_counter()
        backend = await _ensure_audio_backend()
        timings["model_load_ms"] = _elapsed_ms(load_started)

        # Do not copy the upload into process memory until capacity is reserved.
        log.debug("Reading audio file data")
        upload_started = time.perf_counter()
        audio_data = await file.read()
        timings["upload_read_ms"] = _elapsed_ms(upload_started)
        log.debug(f"Audio data size: {len(audio_data)} bytes")

        if len(audio_data) == 0:
            raise HTTPException(
                status_code=400,
                detail="Audio file is empty (0 bytes). Please ensure the file was uploaded correctly.",
            )
        if len(audio_data) < 1024:
            log.warning(
                f"Audio file is very small ({len(audio_data)} bytes), may be invalid"
            )

        # Perform diarization
        log.info(f"Performing diarization on {file.filename}")
        log.debug(
            f"Diarization params: min_speakers={min_speakers}, max_speakers={max_speakers}, collar={collar}, min_duration_off={min_duration_off}"
        )
        decode_started = time.perf_counter()
        full_waveform = await backend.async_load_wave_bytes(audio_data)
        timings["decode_ms"] = _elapsed_ms(decode_started)
        payload_duration = full_waveform.shape[-1] / 16000.0

        diarize_started = time.perf_counter()
        segments = await backend.async_diarize(
            Path(file.filename or "upload.wav"),
            min_speakers=min_speakers,
            max_speakers=max_speakers,
            collar=collar,
            min_duration_off=min_duration_off,
            waveform=full_waveform,
        )
        timings["diarization_ms"] = _elapsed_ms(diarize_started)
        diarize_time = timings["diarization_ms"] / 1000
        log.info(
            f"Diarization produced {len(segments)} segments in {diarize_time:.2f}s"
        )

        # Handle case where diarization produced no segments
        if len(segments) == 0:
            log.warning("Diarization produced no segments")
            response_timings = _finish_timings(
                timings,
                request_started,
                ("segment_embedding_ms", "cluster_matching_ms"),
            )
            log.info(
                "Diarization complete: segments=0 audio=%.2fs queue=%.2fms "
                "decode=%.2fms diarization=%.2fms total=%.2fms",
                payload_duration,
                response_timings.get("queue_ms", 0.0),
                response_timings.get("decode_ms", 0.0),
                response_timings.get("diarization_ms", 0.0),
                response_timings["total_ms"],
            )
            return {
                "segments": [],
                "summary": {
                    "total_duration": 0.0,
                    "num_segments": 0,
                    "num_speakers": 0,
                    "speakers": [],
                    "reason": "No segments detected in audio",
                },
                "timings": response_timings,
                **_runtime_fingerprint(backend),
            }

        log.debug(
            f"First 3 segments: {segments[:3] if len(segments) >= 3 else segments}"
        )

        # Extract embeddings for all segments
        log.debug(f"Extracting embeddings for {len(segments)} segments")
        segment_embeddings = []
        segment_info = []
        valid_segments = []  # Keep track of which segments were successfully processed
        embed_start = time.perf_counter()
        embedding_candidates = []

        for i, segment in enumerate(segments):
            log.debug(
                f"Processing segment {i+1}/{len(segments)}: {segment['start']:.2f}s - {segment['end']:.2f}s ({segment['speaker']})"
            )

            try:
                # Preserve the detected timestamps, but add surrounding context when
                # the embedding model cannot process a very short turn directly.
                wav = backend.crop_waveform(
                    full_waveform,
                    start=segment["start"],
                    end=segment["end"],
                    min_duration=0.5,
                )
                if wav.shape[-1] < backend.min_embedding_samples:
                    raise ValueError(
                        f"cropped segment has only {wav.shape[-1]} samples"
                    )
                embedding_candidates.append((i, segment, wav))
            except ValueError as e:
                log.error(f"  Failed to process segment {i+1}: {e}")
                continue
            except Exception as e:
                log.error(
                    f"  Unexpected error processing segment {i+1}: {e}", exc_info=True
                )
                continue

        def append_embedding(segment, embedding):
            emb_flat = np.asarray(embedding).flatten()
            if np.any(np.isnan(emb_flat)):
                raise ValueError("segment produced a NaN embedding")
            segment_embeddings.append(emb_flat)
            segment_info.append(
                {
                    "start": segment["start"],
                    "end": segment["end"],
                    "duration": segment["duration"],
                    "speaker": segment["speaker"],
                }
            )
            valid_segments.append(segment)

        embedding_batch_size = backend.segment_embedding_batch_size
        for offset in range(0, len(embedding_candidates), embedding_batch_size):
            batch_candidates = embedding_candidates[
                offset : offset + embedding_batch_size
            ]
            try:
                batch_embeddings = await backend.async_embed_batch(
                    [candidate[2] for candidate in batch_candidates]
                )
                for (_, segment, _), embedding in zip(
                    batch_candidates, batch_embeddings
                ):
                    append_embedding(segment, embedding)
            except Exception as batch_error:
                log.warning(
                    "Batch embedding failed for %d segments; retrying individually: %s",
                    len(batch_candidates),
                    batch_error,
                )
                for index, segment, wav in batch_candidates:
                    try:
                        embedding = await backend.async_embed(wav)
                        append_embedding(segment, embedding)
                    except Exception as segment_error:
                        log.error(
                            "Failed to embed segment %d/%d: %s",
                            index + 1,
                            len(segments),
                            segment_error,
                        )

        timings["segment_embedding_ms"] = _elapsed_ms(embed_start)
        embed_time = timings["segment_embedding_ms"] / 1000
        num_processed = len(segment_embeddings)
        num_skipped = len(segments) - num_processed

        if num_skipped > 0:
            log.warning(
                f"Skipped {num_skipped} segments (too short or invalid), processed {num_processed} segments"
            )

        # Handle case where no segments were processed
        if num_processed == 0:
            log.warning(
                f"No valid segments found. All {len(segments)} segments were too short or invalid."
            )
            # Return empty result instead of raising error
            response_timings = _finish_timings(
                timings,
                request_started,
                ("cluster_matching_ms",),
            )
            return {
                "segments": [],
                "summary": {
                    "total_duration": 0.0,
                    "num_segments": 0,
                    "num_speakers": 0,
                    "speakers": [],
                    "skipped_segments": len(segments),
                    "reason": "All segments were too short or invalid",
                },
                "timings": response_timings,
                **_runtime_fingerprint(backend),
            }

        log.debug(
            f"Embedding extraction completed in {embed_time:.2f}s ({embed_time/num_processed*1000:.1f}ms per segment)"
        )

        # Convert to numpy array
        embeddings_array = np.array(segment_embeddings)
        log.debug(f"Embeddings array shape: {embeddings_array.shape}")

        # Final validation: check for any NaN values in embeddings array
        nan_mask = np.isnan(embeddings_array).any(axis=1)
        nan_count = np.sum(nan_mask)
        if nan_count > 0:
            log.warning(
                f"Found {nan_count} segments with NaN embeddings, filtering them out"
            )
            # Filter out NaN embeddings and corresponding metadata
            valid_mask = ~nan_mask
            embeddings_array = embeddings_array[valid_mask]
            segment_info = [
                seg_info for i, seg_info in enumerate(segment_info) if valid_mask[i]
            ]
            valid_segments = [
                seg for i, seg in enumerate(valid_segments) if valid_mask[i]
            ]
            segment_embeddings = [
                emb for i, emb in enumerate(segment_embeddings) if valid_mask[i]
            ]
            log.debug(f"After NaN filtering: {len(embeddings_array)} valid segments")

            # Handle case where all segments had NaN after filtering
            if len(embeddings_array) == 0:
                log.warning("All segments produced NaN embeddings after filtering.")
                response_timings = _finish_timings(
                    timings,
                    request_started,
                    ("cluster_matching_ms",),
                )
                return {
                    "segments": [],
                    "summary": {
                        "total_duration": 0.0,
                        "num_segments": 0,
                        "num_speakers": 0,
                        "speakers": [],
                        "skipped_segments": len(segments),
                        "reason": "All segments produced NaN embeddings",
                    },
                    "timings": response_timings,
                    **_runtime_fingerprint(backend),
                }

        # Preserve Pyannote's speaker labels. Known-speaker matching must annotate
        # those clusters, not replace the diarization with a second clustering pass.
        cluster_id_to_name = {}
        clustering_stats = None
        speaker_labels = [seg["speaker"] for seg in valid_segments]
        confidence_scores = [None] * len(valid_segments)

        if cluster_list:
            log.info(
                f"Matching Pyannote speakers against {len(cluster_list)} known clusters"
            )
            for cluster in cluster_list:
                cluster_id = cluster["id"]
                cluster_id_to_name[cluster_id] = cluster.get("name")

            cluster_start = time.perf_counter()
            speaker_matches = {}
            for speaker in set(speaker_labels):
                indices = [
                    i for i, label in enumerate(speaker_labels) if label == speaker
                ]
                centroid = np.mean(embeddings_array[indices], axis=0)
                centroid_norm = np.linalg.norm(centroid)
                if centroid_norm > 0:
                    centroid = centroid / centroid_norm
                match = backend.match_clusters(
                    centroid, cluster_list, similarity_threshold
                )
                if match:
                    speaker_matches[speaker] = match

            for i, speaker in enumerate(speaker_labels):
                match = speaker_matches.get(speaker)
                if match:
                    confidence_scores[i] = match["similarity"]

            clustering_stats = {
                "method": "pyannote_cluster_centroid_matching",
                "num_pyannote_speakers": len(set(speaker_labels)),
                "num_matched_speakers": len(speaker_matches),
                "similarity_threshold": similarity_threshold,
            }
            timings["cluster_matching_ms"] = _elapsed_ms(cluster_start)
        else:
            speaker_matches = {}
            timings["cluster_matching_ms"] = 0.0

        # Build result segments
        log.debug("Building result segments")
        result_segments = []
        matched_cluster_ids = set()
        unmatched_count = 0

        # Use valid_segments which matches segment_embeddings and speaker_labels
        for i, segment in enumerate(valid_segments):
            emb_flat = segment_embeddings[i].tolist()
            speaker_label = speaker_labels[i]
            confidence = (
                confidence_scores[i] if confidence_scores[i] is not None else None
            )

            log.debug(
                f"Segment {i+1}: speaker={speaker_label}, confidence={confidence}, duration={segment['duration']:.2f}s"
            )

            # Build segment result
            segment_result = {
                "start": round(segment["start"], 3),
                "end": round(segment["end"], 3),
                "speaker": speaker_label,
                "duration": round(segment["duration"], 3),
                "embedding": emb_flat,
            }

            # Add cluster information if clusters were provided
            if cluster_list:
                match = speaker_matches.get(speaker_label)
                if match:
                    cluster_id = match["cluster_id"]
                    segment_result["cluster_id"] = cluster_id
                    segment_result["cluster_name"] = cluster_id_to_name[cluster_id]
                    segment_result["similarity"] = (
                        round(confidence, 4) if confidence is not None else None
                    )
                    matched_cluster_ids.add(cluster_id)
                    log.debug(
                        f"  Matched {speaker_label} to cluster {cluster_id} with similarity {confidence:.4f}"
                    )
                else:
                    segment_result["cluster_id"] = None
                    segment_result["cluster_name"] = None
                    segment_result["similarity"] = None
                    unmatched_count += 1
                    log.debug(f"  No cluster match (label: {speaker_label})")

            result_segments.append(segment_result)

        # Calculate summary
        total_duration = max(s["end"] for s in valid_segments) if valid_segments else 0
        unique_speakers = sorted(list(set(speaker_labels)))

        summary = {
            "total_duration": round(total_duration, 2),
            "num_segments": len(result_segments),
            "num_speakers": len(unique_speakers),
            "speakers": unique_speakers,
        }

        # Add cluster matching summary if clusters were provided
        if cluster_list:
            summary["matched_clusters"] = sorted(list(matched_cluster_ids))
            summary["unmatched_segments"] = unmatched_count
            if clustering_stats:
                summary["clustering_stats"] = clustering_stats

        response_timings = _finish_timings(timings, request_started, ())
        log.info(
            "Diarization complete: %d segments, %d speakers, audio=%.2fs; "
            "queue=%.2fms, decode=%.2fms, diarization=%.2fms, "
            "embeddings=%.2fms, clustering=%.2fms, total=%.2fms",
            len(result_segments),
            len(unique_speakers),
            payload_duration,
            response_timings.get("queue_ms", 0.0),
            response_timings.get("decode_ms", 0.0),
            response_timings.get("diarization_ms", 0.0),
            response_timings.get("segment_embedding_ms", 0.0),
            response_timings.get("cluster_matching_ms", 0.0),
            response_timings["total_ms"],
        )
        if cluster_list:
            log.info(
                f"Cluster matching: {len(matched_cluster_ids)} clusters matched, {unmatched_count} segments unmatched"
            )
            log.debug(f"Matched cluster IDs: {sorted(matched_cluster_ids)}")

        return {
            "segments": result_segments,
            "summary": summary,
            "timings": response_timings,
            **_runtime_fingerprint(backend),
        }

    except InferenceGateFull:
        log.warning(
            "Diarization rejected: inference capacity exhausted, bytes=%d, total=%.2fms",
            len(audio_data),
            _elapsed_ms(request_started),
        )
        raise
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error during diarization: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Diarization failed: {str(e)}")
    finally:
        if lease is not None:
            _mark_model_activity()
            await inference_gate.release()


def main():
    """Main entry point for the service."""
    host = os.getenv("SPEAKER_SERVICE_HOST", "0.0.0.0")
    port = int(os.getenv("SPEAKER_SERVICE_PORT", "8085"))

    log.info(f"Starting PyAnnote Diarization Service on {host}:{port}")
    uvicorn.run(
        "simple_speaker_recognition.api.service:app",
        host=host,
        port=port,
        reload=bool(os.getenv("DEV", False)),
    )


if __name__ == "__main__":
    main()
