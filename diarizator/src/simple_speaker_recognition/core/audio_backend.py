"""Audio processing backend using PyAnnote and SpeechBrain."""

import asyncio
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import soundfile as sf
import torch
from pyannote.audio import Pipeline
from pyannote.audio.pipelines.speaker_verification import PretrainedSpeakerEmbedding

from pyannote.audio.telemetry import set_telemetry_metrics

set_telemetry_metrics(False, save_choice_as_default=True)

logger = logging.getLogger(__name__)

# Audio loading backend selection:
# - "soundfile": Pure Python, works on Mac without FFmpeg (recommended for local dev)
# - "torchaudio": Uses torchcodec/FFmpeg, works on GPU servers with FFmpeg installed
AUDIO_BACKEND = os.environ.get("AUDIO_BACKEND", "soundfile")
logger.info(f"Audio backend: {AUDIO_BACKEND}")

# Only import torchaudio if needed (it triggers torchcodec loading)
if AUDIO_BACKEND == "torchaudio":
    import torchaudio
    import torchaudio.functional as F


class AudioBackend:
    """Wrapper around PyAnnote & SpeechBrain components."""

    def __init__(self, hf_token: str, device: torch.device):
        self.device = device
        self.diarization_model = os.environ.get(
            "DIARIZATION_MODEL",
            "pyannote/speaker-diarization-community-1",
        )
        logger.debug(f"Initializing AudioBackend with device: {device}")
        logger.info("Loading diarization pipeline: %s", self.diarization_model)
        self.diar = Pipeline.from_pretrained(self.diarization_model, token=hf_token).to(
            device
        )
        logger.debug("Pipeline loaded and moved to device")

        # Use the EXACT same embedding model that the diarization pipeline uses internally
        logger.debug("Loading wespeaker-voxceleb-resnet34-LM embedding model")
        self.embedder = PretrainedSpeakerEmbedding(
            "pyannote/wespeaker-voxceleb-resnet34-LM", device=device
        )
        logger.debug(f"Embedding model loaded, dimension: {self.embedder.dimension}")
        logger.debug(f"AudioBackend ready (audio backend: {AUDIO_BACKEND})")

    def embed(self, wave: torch.Tensor) -> np.ndarray:  # (1, T)
        logger.debug(f"Embedding audio: shape={wave.shape}, device={wave.device}")

        # Check minimum duration requirement (embedding model needs at least ~0.5 seconds)
        # At 16kHz, that's about 8000 samples
        audio_length = wave.shape[-1]
        min_samples = 8000  # ~0.5 seconds at 16kHz

        if audio_length < min_samples:
            logger.warning(
                f"Audio segment too short ({audio_length} samples, ~{audio_length/16000:.3f}s). Minimum required: {min_samples} samples (~{min_samples/16000:.3f}s)"
            )
            raise ValueError(
                f"Audio segment too short for embedding model: {audio_length} samples < {min_samples} samples minimum"
            )

        with torch.inference_mode():
            try:
                emb = self.embedder(wave.to(self.device))
            except AssertionError as e:
                logger.error(f"Embedding failed for audio shape {wave.shape}: {e}")
                raise ValueError(
                    f"Audio segment too short for embedding model: {e}"
                ) from e
            except Exception as e:
                logger.error(f"Unexpected error during embedding: {e}")
                raise

        if isinstance(emb, torch.Tensor):
            emb = emb.cpu().numpy()

        # Check for NaN values
        if np.any(np.isnan(emb)):
            logger.error(
                f"Embedding contains NaN values! Input shape: {wave.shape}, embedding shape: {emb.shape}"
            )
            raise ValueError(
                "Embedding computation produced NaN values - audio segment may be too short or invalid"
            )

        norm = np.linalg.norm(emb, axis=-1, keepdims=True)
        logger.debug(f"Raw embedding shape: {emb.shape}, norm: {norm.flatten()}")

        # Check for zero norm
        if np.any(norm == 0):
            logger.warning(
                f"Zero norm detected in embedding, using identity normalization"
            )
            norm = np.ones_like(norm)

        normalized = emb / norm

        # Final NaN check after normalization
        if np.any(np.isnan(normalized)):
            logger.error(f"Normalized embedding contains NaN values!")
            raise ValueError("Normalized embedding contains NaN values")

        logger.debug(f"Normalized embedding shape: {normalized.shape}")
        return normalized

    async def async_embed(self, wave: torch.Tensor) -> np.ndarray:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.embed, wave)

    def diarize(
        self,
        path: Path,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None,
        collar: Optional[float] = None,
        min_duration_off: Optional[float] = None,
    ) -> List[Dict]:
        """Perform speaker diarization on an audio file.

        Args:
            path: Path to the audio file
            min_speakers: Minimum number of speakers to detect
            max_speakers: Maximum number of speakers to detect
            collar: Optional post-processing gap duration. Disabled by default.
            min_duration_off: Legacy 3.1 segmentation override. Disabled by default.
        """
        logger.debug(f"Diarizing audio file: {path}")
        logger.debug(
            f"Parameters: min_speakers={min_speakers}, max_speakers={max_speakers}, collar={collar}, min_duration_off={min_duration_off}"
        )

        # Community-1 is already tuned. Keep this only as an explicit legacy-model
        # escape hatch; mutating the pipeline per request is not thread-safe.
        if min_duration_off is not None:
            pipeline_params = {"segmentation": {"min_duration_off": min_duration_off}}
            logger.debug(f"Updating pipeline params: {pipeline_params}")
            self.diar.instantiate(pipeline_params)

        with torch.inference_mode():
            # Pass speaker count parameters to pyannote
            kwargs = {}
            if min_speakers is not None:
                kwargs["min_speakers"] = min_speakers
            if max_speakers is not None:
                kwargs["max_speakers"] = max_speakers
            logger.debug(f"Calling diarization pipeline with kwargs: {kwargs}")

            output = self.diar(str(path), **kwargs)
            logger.info(f"Diarization output: {output}")
            logger.debug(
                f"Output type: {type(output)}, has speaker_diarization: {hasattr(output, 'speaker_diarization')}"
            )

            # In pyannote.audio 4.0+, the pipeline returns a DiarizeOutput object
            # We need to access .speaker_diarization to get the Annotation object
            if hasattr(output, "speaker_diarization"):
                diarization = output.speaker_diarization
                logger.info(f"Using speaker_diarization from output (pyannote 4.0+)")
            else:
                # Fallback for older versions (3.x) that return Annotation directly
                diarization = output
                logger.info(f"Using output directly as Annotation (pyannote 3.x)")

            if collar is not None and collar > 0:
                logger.debug(f"Applying explicit gap filling with collar={collar}s")
                diarization = diarization.support(collar=collar)

        segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append(
                {
                    "start": float(turn.start),
                    "end": float(turn.end),
                    "speaker": str(speaker),
                    "duration": float(turn.end - turn.start),
                }
            )

        logger.debug(f"Extracted {len(segments)} segments from diarization")
        if segments:
            logger.debug(
                f"Segment duration range: {min(s['duration'] for s in segments):.2f}s - {max(s['duration'] for s in segments):.2f}s"
            )
            logger.debug(f"Unique speakers: {set(s['speaker'] for s in segments)}")

        return segments

    async def async_diarize(
        self,
        path: Path,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None,
        collar: Optional[float] = None,
        min_duration_off: Optional[float] = None,
    ) -> List[Dict]:
        """Async wrapper for diarization.

        Args:
            path: Path to the audio file
            min_speakers: Minimum number of speakers to detect
            max_speakers: Maximum number of speakers to detect
            collar: Gap duration (seconds) to merge between speaker segments
            min_duration_off: Minimum silence duration (seconds) before treating as segment boundary
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            self.diarize,
            path,
            min_speakers,
            max_speakers,
            collar,
            min_duration_off,
        )

    def load_wave(
        self,
        path: Path,
        start: Optional[float] = None,
        end: Optional[float] = None,
        min_duration: Optional[float] = None,
    ) -> torch.Tensor:
        """Load audio file and convert to tensor.

        Uses soundfile (default) or torchaudio based on AUDIO_BACKEND env var.
        Soundfile works on Mac without FFmpeg, torchaudio needs FFmpeg/torchcodec.

        Args:
            path: Path to the audio file
            start: Optional start time in seconds for segment extraction
            end: Optional end time in seconds for segment extraction
            min_duration: Expand the crop symmetrically to at least this duration.

        Returns:
            Tensor of shape (1, 1, T) at 16kHz sample rate
        """
        if AUDIO_BACKEND == "soundfile":
            # Soundfile-based loading (Mac compatible, no FFmpeg needed)
            waveform, sample_rate = self._load_with_soundfile(path)
        else:
            # Torchaudio-based loading (GPU server with FFmpeg)
            waveform, sample_rate = self._load_with_torchaudio(path)

        logger.debug(f"Loaded audio: shape={waveform.shape}, sample_rate={sample_rate}")

        # Convert to mono if needed (average channels)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
            logger.debug(f"Converted to mono: shape={waveform.shape}")

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            waveform = self._resample(waveform, sample_rate, 16000)
            logger.debug(f"Resampled to 16kHz: shape={waveform.shape}")

        # Get duration for clamping
        file_duration = waveform.shape[1] / 16000.0

        # Crop if start and/or end specified
        if start is not None or end is not None:
            # Default start to 0 if only end is provided
            if start is None:
                start = 0.0
            # Default end to file duration if only start is provided
            if end is None:
                end = file_duration
            # Clamp segment bounds to file duration
            start_clamped = max(0.0, min(start, file_duration))
            end_clamped = max(start_clamped, min(end, file_duration))

            if min_duration is not None and end_clamped - start_clamped < min_duration:
                missing = min_duration - (end_clamped - start_clamped)
                start_clamped = max(0.0, start_clamped - missing / 2)
                end_clamped = min(file_duration, end_clamped + missing / 2)

                # If one edge was clamped, take the remaining context from the other edge.
                remaining = min_duration - (end_clamped - start_clamped)
                if remaining > 0:
                    if start_clamped == 0.0:
                        end_clamped = min(file_duration, end_clamped + remaining)
                    elif end_clamped == file_duration:
                        start_clamped = max(0.0, start_clamped - remaining)

            # Log if we had to clamp the segment
            if start != start_clamped or end != end_clamped:
                logger.warning(
                    f"Segment [{start:.6f}s, {end:.6f}s] clamped to [{start_clamped:.6f}s, {end_clamped:.6f}s] for file duration {file_duration:.6f}s"
                )

            start_sample = int(start_clamped * 16000)
            end_sample = int(end_clamped * 16000)
            waveform = waveform[:, start_sample:end_sample]
            logger.debug(
                f"Cropped to [{start_clamped:.3f}s, {end_clamped:.3f}s]: shape={waveform.shape}"
            )

        return waveform.unsqueeze(0)  # (1, 1, T)

    def _load_with_soundfile(self, path: Path) -> tuple:
        """Load audio using soundfile (pure Python, Mac compatible)."""
        audio, sample_rate = sf.read(str(path), dtype="float32")

        # Convert to torch tensor
        waveform = torch.from_numpy(audio)

        # Handle mono vs stereo: soundfile returns (samples,) for mono, (samples, channels) for stereo
        if waveform.ndim == 1:
            waveform = waveform.unsqueeze(0)  # (1, T)
        else:
            waveform = waveform.T  # (channels, T)

        return waveform, sample_rate

    def _load_with_torchaudio(self, path: Path) -> tuple:
        """Load audio using torchaudio (requires FFmpeg/torchcodec)."""
        waveform, sample_rate = torchaudio.load(str(path))
        return waveform, sample_rate

    def _resample(
        self, waveform: torch.Tensor, orig_sr: int, target_sr: int
    ) -> torch.Tensor:
        """Resample audio to target sample rate."""
        if AUDIO_BACKEND == "torchaudio":
            return F.resample(waveform, orig_sr, target_sr)
        else:
            # Use scipy for resampling when using soundfile backend
            from scipy import signal

            # Calculate resampling ratio
            num_samples = int(waveform.shape[1] * target_sr / orig_sr)

            # Resample each channel
            resampled = torch.zeros(
                (waveform.shape[0], num_samples), dtype=waveform.dtype
            )
            for i in range(waveform.shape[0]):
                resampled[i] = torch.from_numpy(
                    signal.resample(waveform[i].numpy(), num_samples).astype(np.float32)
                )

            return resampled

    @staticmethod
    def match_clusters(
        embedding: np.ndarray, clusters: List[Dict], threshold: float
    ) -> Optional[Dict]:
        """Match an embedding against known clusters using cosine similarity.

        Args:
            embedding: Normalized embedding vector (1D numpy array)
            clusters: List of cluster dictionaries with 'id', 'embedding', and optionally 'name'
            threshold: Minimum cosine similarity threshold for a match

        Returns:
            Dictionary with 'cluster_id', 'cluster_name', 'similarity' if match found, None otherwise
        """
        if not clusters or len(embedding) == 0:
            return None

        embedding = embedding.flatten()  # Ensure 1D

        best_match = None
        best_similarity = -1.0

        for cluster in clusters:
            cluster_emb = np.array(cluster["embedding"], dtype=np.float32).flatten()

            if cluster_emb.shape != embedding.shape:
                logger.warning(
                    "Skipping cluster %s: embedding dimension %s does not match %s",
                    cluster.get("id"),
                    cluster_emb.shape,
                    embedding.shape,
                )
                continue

            # Ensure embeddings are normalized
            cluster_norm = np.linalg.norm(cluster_emb)
            if cluster_norm == 0 or not np.isfinite(cluster_norm):
                logger.warning(
                    "Skipping cluster %s: invalid embedding norm", cluster.get("id")
                )
                continue
            cluster_emb = cluster_emb / cluster_norm

            # Compute cosine similarity (dot product for normalized vectors)
            similarity = float(np.dot(embedding, cluster_emb))

            if similarity > best_similarity:
                best_similarity = similarity
                best_match = {
                    "cluster_id": cluster["id"],
                    "cluster_name": cluster.get("name"),
                    "similarity": similarity,
                }

        # Return match only if above threshold
        if best_similarity >= threshold:
            return best_match

        return None
