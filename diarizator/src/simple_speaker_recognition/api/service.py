"""FastAPI service for pyannote diarization with embeddings and speaker identification."""

import json
import logging
import os
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile

from simple_speaker_recognition.core.audio_backend import AudioBackend


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

# Global variable for audio backend
audio_backend: Optional[AudioBackend] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan event handler for startup and shutdown."""
    global audio_backend

    # Startup: Load models
    log.info("=== PyAnnote Diarization Service Starting ===")
    log.debug(f"HF_TOKEN present: {bool(hf_token)}")
    log.debug(f"Device: {device}")
    log.info("Loading models...")
    audio_backend = AudioBackend(hf_token, device)
    log.info("Models ready ✔ – device=%s", device)
    log.debug(f"AudioBackend initialized with device: {device}")

    # Yield control to the application
    yield

    # Shutdown: Clean up resources if needed
    log.info("Shutting down diarization service")


app = FastAPI(title="PyAnnote Diarization Service", version="1.0.0", lifespan=lifespan)

# Note: Speaker profiles are managed via MongoDB in the main Mycelia backend.
# The legacy SQLite/FAISS routers are not mounted. Only /diarize and /embed are exposed.


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "version": "1.0.0",
        "device": str(device),
        "service": "pyannote-diarization",
    }


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
    log.debug(f"Received embedding request: filename={file.filename}")

    if audio_backend is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # Read audio file
    audio_data = await file.read()

    if len(audio_data) == 0:
        raise HTTPException(status_code=400, detail="Audio file is empty")

    # Create temporary file for processing
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
        tmp_file.write(audio_data)
        tmp_file.flush()
        os.fsync(tmp_file.fileno())
        tmp_path = Path(tmp_file.name)

    try:
        # Load audio (optionally with time range)
        log.debug(f"Loading audio from {tmp_path}, start={start}, end={end}")
        wav = audio_backend.load_wave(tmp_path, start=start, end=end)

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
        emb = await audio_backend.async_embed(wav)
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

        log.info(f"Embedding extracted: dim={len(emb_flat)}, duration={duration:.2f}s")

        return {
            "embedding": emb_flat.tolist(),
            "dimension": len(emb_flat),
            "duration": round(duration, 3),
        }

    except ValueError as e:
        log.error(f"Error extracting embedding: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Embedding extraction failed: {str(e)}"
        )
    finally:
        tmp_path.unlink(missing_ok=True)


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
    log.debug(
        f"Received diarization request: filename={file.filename}, size={file.size if hasattr(file, 'size') else 'unknown'}"
    )
    log.debug(
        f"Parameters: min_speakers={min_speakers}, max_speakers={max_speakers}, collar={collar}, min_duration_off={min_duration_off}"
    )
    log.debug(
        f"Similarity threshold: {similarity_threshold}, clusters provided: {clusters is not None}"
    )

    if audio_backend is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

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

    # Read audio file
    log.debug("Reading audio file data")
    audio_data = await file.read()
    log.debug(f"Audio data size: {len(audio_data)} bytes")

    # Validate audio file is not empty
    if len(audio_data) == 0:
        raise HTTPException(
            status_code=400,
            detail="Audio file is empty (0 bytes). Please ensure the file was uploaded correctly.",
        )

    # Validate minimum file size (at least 1KB for a valid audio file)
    if len(audio_data) < 1024:
        log.warning(
            f"Audio file is very small ({len(audio_data)} bytes), may be invalid"
        )

    # Create temporary file for processing
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
        tmp_file.write(audio_data)
        tmp_file.flush()  # Ensure data is written to disk
        os.fsync(tmp_file.fileno())  # Force write to disk
        tmp_path = Path(tmp_file.name)

    # Verify file was written correctly
    if not tmp_path.exists():
        raise HTTPException(
            status_code=500, detail="Failed to create temporary audio file"
        )

    file_size = tmp_path.stat().st_size
    log.debug(f"Created temporary file: {tmp_path} ({file_size} bytes)")

    if file_size == 0:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail="Temporary audio file is empty. File upload may have failed.",
        )

    if file_size != len(audio_data):
        log.warning(
            f"File size mismatch: written {file_size} bytes, expected {len(audio_data)} bytes"
        )

    # Basic validation: check if file starts with common audio file signatures
    try:
        with open(tmp_path, "rb") as f:
            header = f.read(12)
            log.debug(f"File header (first 12 bytes): {header.hex()}")
            # WAV files typically start with "RIFF" (0x52494646)
            # But we'll let pyannote handle format detection
    except Exception as e:
        log.warning(f"Could not read file header for validation: {e}")

    try:
        # Perform diarization
        log.info(f"Performing diarization on {file.filename}")
        log.debug(
            f"Diarization params: min_speakers={min_speakers}, max_speakers={max_speakers}, collar={collar}, min_duration_off={min_duration_off}"
        )
        diarize_start = time.time()
        segments = await audio_backend.async_diarize(
            tmp_path,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
            collar=collar,
            min_duration_off=min_duration_off,
        )
        diarize_time = time.time() - diarize_start
        log.info(
            f"Diarization produced {len(segments)} segments in {diarize_time:.2f}s"
        )

        # Handle case where diarization produced no segments
        if len(segments) == 0:
            log.warning("Diarization produced no segments")
            total_time = time.time() - diarize_start
            return {
                "segments": [],
                "summary": {
                    "total_duration": 0.0,
                    "num_segments": 0,
                    "num_speakers": 0,
                    "speakers": [],
                    "reason": "No segments detected in audio",
                },
            }

        log.debug(
            f"First 3 segments: {segments[:3] if len(segments) >= 3 else segments}"
        )

        # Extract embeddings for all segments
        log.debug(f"Extracting embeddings for {len(segments)} segments")
        segment_embeddings = []
        segment_info = []
        valid_segments = []  # Keep track of which segments were successfully processed
        embed_start = time.time()

        for i, segment in enumerate(segments):
            log.debug(
                f"Processing segment {i+1}/{len(segments)}: {segment['start']:.2f}s - {segment['end']:.2f}s ({segment['speaker']})"
            )

            try:
                # Preserve the detected timestamps, but add surrounding context when
                # the embedding model cannot process a very short turn directly.
                wav = audio_backend.load_wave(
                    tmp_path,
                    start=segment["start"],
                    end=segment["end"],
                    min_duration=0.5,
                )
                log.debug(f"  Loaded audio shape: {wav.shape}")

                # Extract embedding
                emb = await audio_backend.async_embed(wav)
                emb_flat = emb.flatten()

                # Validate embedding
                if np.any(np.isnan(emb_flat)):
                    log.error(f"  Segment {i+1} produced NaN embedding, skipping")
                    continue

                log.debug(
                    f"  Embedding shape: {emb_flat.shape}, norm: {np.linalg.norm(emb_flat):.4f}"
                )

                segment_embeddings.append(emb_flat)
                segment_info.append(
                    {
                        "start": segment["start"],
                        "end": segment["end"],
                        "duration": segment["duration"],
                        "speaker": segment[
                            "speaker"
                        ],  # Original pyannote speaker label
                    }
                )
                valid_segments.append(segment)  # Keep track of valid segment
            except ValueError as e:
                log.error(f"  Failed to process segment {i+1}: {e}")
                continue
            except Exception as e:
                log.error(
                    f"  Unexpected error processing segment {i+1}: {e}", exc_info=True
                )
                continue

        embed_time = time.time() - embed_start
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
            total_time = time.time() - diarize_start
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
                total_time = time.time() - diarize_start
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
                }

        # Preserve Pyannote's speaker labels. Known-speaker matching must annotate
        # those clusters, not replace the diarization with a second clustering pass.
        cluster_id_to_name = {}
        clustering_stats = None
        cluster_time = 0.0
        speaker_labels = [seg["speaker"] for seg in valid_segments]
        confidence_scores = [None] * len(valid_segments)

        if cluster_list:
            log.info(
                f"Matching Pyannote speakers against {len(cluster_list)} known clusters"
            )
            for cluster in cluster_list:
                cluster_id = cluster["id"]
                cluster_id_to_name[cluster_id] = cluster.get("name")

            cluster_start = time.time()
            speaker_matches = {}
            for speaker in set(speaker_labels):
                indices = [
                    i for i, label in enumerate(speaker_labels) if label == speaker
                ]
                centroid = np.mean(embeddings_array[indices], axis=0)
                centroid_norm = np.linalg.norm(centroid)
                if centroid_norm > 0:
                    centroid = centroid / centroid_norm
                match = audio_backend.match_clusters(
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
            cluster_time = time.time() - cluster_start
        else:
            speaker_matches = {}

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

        total_time = time.time() - diarize_start
        log.info(
            f"Diarization complete: {len(result_segments)} segments, {len(unique_speakers)} speakers in {total_time:.2f}s total"
        )
        log.debug(
            f"Performance breakdown: diarization={diarize_time:.2f}s, embeddings={embed_time:.2f}s, clustering={cluster_time:.2f}s"
        )
        if cluster_list:
            log.info(
                f"Cluster matching: {len(matched_cluster_ids)} clusters matched, {unmatched_count} segments unmatched"
            )
            log.debug(f"Matched cluster IDs: {sorted(matched_cluster_ids)}")

        return {"segments": result_segments, "summary": summary}

    except Exception as e:
        log.error(f"Error during diarization: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Diarization failed: {str(e)}")
    finally:
        # Clean up temporary file
        tmp_path.unlink(missing_ok=True)


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
