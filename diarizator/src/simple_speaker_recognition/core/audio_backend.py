"""Audio processing backend using PyAnnote and SpeechBrain."""

import asyncio
import logging
import os
from functools import partial
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np
import soundfile as sf
import torch
from pyannote.audio import Pipeline
from pyannote.audio.pipelines.speaker_verification import PretrainedSpeakerEmbedding
from pyannote.audio.telemetry import set_telemetry_metrics

set_telemetry_metrics(False, save_choice_as_default=True)

logger = logging.getLogger(__name__)


def _positive_int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("Invalid %s=%r; using %d", name, raw, default)
        return default
    if value < 1:
        logger.warning("%s must be positive; using %d", name, default)
        return default
    return value


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
        default_pipeline_batch_size = 8 if device.type == "cuda" else 1
        default_segment_embedding_batch_size = 16 if device.type == "cuda" else 1
        self.segmentation_batch_size = _positive_int_env(
            "DIARIZATION_SEGMENTATION_BATCH_SIZE", default_pipeline_batch_size
        )
        self.embedding_batch_size = _positive_int_env(
            "DIARIZATION_EMBEDDING_BATCH_SIZE", default_pipeline_batch_size
        )
        self.segment_embedding_batch_size = _positive_int_env(
            "DIARIZATION_SEGMENT_EMBEDDING_BATCH_SIZE",
            default_segment_embedding_batch_size,
        )
        self.min_embedding_samples = 8000
        self.diarization_model = os.environ.get(
            "DIARIZATION_MODEL",
            "pyannote/speaker-diarization-community-1",
        )
        self.embedding_model = os.environ.get(
            "EMBEDDING_MODEL", "pyannote/wespeaker-voxceleb-resnet34-LM"
        )
        logger.debug(f"Initializing AudioBackend with device: {device}")
        logger.info("Loading diarization pipeline: %s", self.diarization_model)
        self.diar = Pipeline.from_pretrained(self.diarization_model, token=hf_token).to(
            device
        )
        if hasattr(self.diar, "segmentation_batch_size"):
            self.diar.segmentation_batch_size = self.segmentation_batch_size
        if hasattr(self.diar, "embedding_batch_size"):
            self.diar.embedding_batch_size = self.embedding_batch_size
        logger.info(
            "Diarization batching: segmentation=%d, pipeline_embeddings=%d, segment_embeddings=%d",
            self.segmentation_batch_size,
            self.embedding_batch_size,
            self.segment_embedding_batch_size,
        )
        logger.debug("Pipeline loaded and moved to device")

        # Use the EXACT same embedding model that the diarization pipeline uses internally
        logger.debug("Loading wespeaker-voxceleb-resnet34-LM embedding model")
        self.embedder = PretrainedSpeakerEmbedding(self.embedding_model, device=device)
        logger.debug(f"Embedding model loaded, dimension: {self.embedder.dimension}")
        logger.debug(f"AudioBackend ready (audio backend: {AUDIO_BACKEND})")

    def embed(self, wave: torch.Tensor) -> np.ndarray:
        return self.embed_batch([wave])

    def embed_batch(self, waves: Sequence[torch.Tensor]) -> np.ndarray:
        """Embed variable-length mono waveforms in one padded model call."""
        if not waves:
            return np.empty((0, int(self.embedder.dimension)), dtype=np.float32)

        prepared: List[torch.Tensor] = []
        lengths: List[int] = []
        for index, wave in enumerate(waves):
            if wave.ndim == 3 and wave.shape[0] == 1:
                wave = wave.squeeze(0)
            if wave.ndim != 2 or wave.shape[0] != 1:
                raise ValueError(
                    f"Embedding waveform {index} must have shape (1, 1, T) or (1, T); got {tuple(wave.shape)}"
                )
            audio_length = int(wave.shape[-1])
            if audio_length < self.min_embedding_samples:
                raise ValueError(
                    "Audio segment too short for embedding model: "
                    f"{audio_length} samples < {self.min_embedding_samples} samples minimum"
                )
            prepared.append(wave)
            lengths.append(audio_length)

        max_samples = max(lengths)
        batch = torch.zeros(
            (len(prepared), 1, max_samples),
            dtype=prepared[0].dtype,
        )
        masks = torch.zeros((len(prepared), max_samples), dtype=torch.float32)
        for index, (wave, length) in enumerate(zip(prepared, lengths)):
            batch[index, :, :length] = wave.cpu()
            masks[index, :length] = 1.0

        with torch.inference_mode():
            try:
                emb = self.embedder(
                    batch.to(self.device),
                    masks=masks.to(self.device),
                )
            except AssertionError as exc:
                logger.error(
                    "Batch embedding failed for shape %s: %s", batch.shape, exc
                )
                raise ValueError(
                    f"Audio segment too short for embedding model: {exc}"
                ) from exc
            except Exception:
                logger.exception("Unexpected error during batch embedding")
                raise

        if isinstance(emb, torch.Tensor):
            emb = emb.cpu().numpy()
        emb = np.asarray(emb)
        if emb.ndim != 2 or emb.shape[0] != len(prepared):
            raise ValueError(
                f"Embedding model returned unexpected shape {emb.shape} for batch {len(prepared)}"
            )
        if np.any(np.isnan(emb)):
            raise ValueError("Embedding computation produced NaN values")

        norm = np.linalg.norm(emb, axis=-1, keepdims=True)
        if np.any(norm == 0):
            logger.warning(
                "Zero norm detected in embedding, using identity normalization"
            )
            norm = np.where(norm == 0, 1.0, norm)
        normalized = emb / norm
        if np.any(np.isnan(normalized)):
            raise ValueError("Normalized embedding contains NaN values")
        return normalized

    async def async_embed(self, wave: torch.Tensor) -> np.ndarray:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.embed, wave)

    async def async_embed_batch(self, waves: Sequence[torch.Tensor]) -> np.ndarray:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.embed_batch, waves)

    def diarize(
        self,
        path: Path,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None,
        collar: Optional[float] = None,
        min_duration_off: Optional[float] = None,
        waveform: Optional[torch.Tensor] = None,
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

        # Preload audio through our configured backend instead of passing a
        # filename to Pyannote. Pyannote 4 delegates filename decoding to
        # TorchCodec, which may be unavailable even when soundfile can decode
        # the same WAV (notably in native CPU containers on Apple Silicon).
        # load_wave normalizes to mono 16 kHz and returns (batch, channel, time).
        if waveform is None:
            waveform = self.load_wave(path)
        audio_input = {"waveform": waveform.squeeze(0), "sample_rate": 16000}

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

            output = self.diar(audio_input, **kwargs)
            logger.debug(
                "Diarization output structure: type=%s, has_speaker_diarization=%s",
                type(output).__name__,
                hasattr(output, "speaker_diarization"),
            )

            # In pyannote.audio 4.0+, the pipeline returns a DiarizeOutput object
            # We need to access .speaker_diarization to get the Annotation object
            if hasattr(output, "speaker_diarization"):
                diarization = output.speaker_diarization
                logger.debug("Using speaker_diarization from output (pyannote 4.0+)")
            else:
                # Fallback for older versions (3.x) that return Annotation directly
                diarization = output
                logger.debug("Using output directly as Annotation (pyannote 3.x)")

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
        waveform: Optional[torch.Tensor] = None,
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
            partial(
                self.diarize,
                path,
                min_speakers,
                max_speakers,
                collar,
                min_duration_off,
                waveform,
            ),
        )

    async def async_load_wave(self, path: Path) -> torch.Tensor:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.load_wave, path)

    def crop_waveform(
        self,
        waveform: torch.Tensor,
        start: Optional[float] = None,
        end: Optional[float] = None,
        min_duration: Optional[float] = None,
    ) -> torch.Tensor:
        """Crop an already decoded mono 16 kHz waveform."""
        if waveform.ndim == 2:
            waveform = waveform.unsqueeze(0)
        if waveform.ndim != 3 or waveform.shape[0] != 1 or waveform.shape[1] != 1:
            raise ValueError(
                f"Expected waveform shape (1, 1, T) or (1, T), got {tuple(waveform.shape)}"
            )
        if start is None and end is None:
            return waveform

        file_duration = waveform.shape[-1] / 16000.0
        requested_start = 0.0 if start is None else start
        requested_end = file_duration if end is None else end
        start_clamped = max(0.0, min(requested_start, file_duration))
        end_clamped = max(start_clamped, min(requested_end, file_duration))

        if min_duration is not None and end_clamped - start_clamped < min_duration:
            missing = min_duration - (end_clamped - start_clamped)
            start_clamped = max(0.0, start_clamped - missing / 2)
            end_clamped = min(file_duration, end_clamped + missing / 2)
            remaining = min_duration - (end_clamped - start_clamped)
            if remaining > 0:
                if start_clamped == 0.0:
                    end_clamped = min(file_duration, end_clamped + remaining)
                elif end_clamped == file_duration:
                    start_clamped = max(0.0, start_clamped - remaining)

        if requested_start != start_clamped or requested_end != end_clamped:
            logger.warning(
                "Segment [%.6fs, %.6fs] clamped to [%.6fs, %.6fs] for file duration %.6fs",
                requested_start,
                requested_end,
                start_clamped,
                end_clamped,
                file_duration,
            )

        start_sample = int(start_clamped * 16000)
        end_sample = int(end_clamped * 16000)
        return waveform[..., start_sample:end_sample]

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

        return self.crop_waveform(
            waveform.unsqueeze(0),
            start=start,
            end=end,
            min_duration=min_duration,
        )

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
