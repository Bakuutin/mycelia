"""Audio processing backend using PyAnnote and SpeechBrain."""

import asyncio
import logging
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch
from pyannote.audio import Audio, Pipeline
from pyannote.audio.pipelines.speaker_verification import PretrainedSpeakerEmbedding
from pyannote.core import Segment

from pyannote.audio.telemetry import set_telemetry_metrics

set_telemetry_metrics(False, save_choice_as_default=True)

logger = logging.getLogger(__name__)


class AudioBackend:
    """Wrapper around PyAnnote & SpeechBrain components."""

    def __init__(self, hf_token: str, device: torch.device):
        self.device = device
        logger.debug(f"Initializing AudioBackend with device: {device}")
        logger.debug("Loading pyannote speaker-diarization-3.1 pipeline")
        self.diar = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1", token=hf_token
        ).to(device)
        logger.debug("Pipeline loaded and moved to device")
        
        # Configure pipeline with proper segmentation parameters to reduce over-segmentation
        # Note: embedding model is fixed in pre-trained pipeline and cannot be changed at instantiation
        pipeline_params = {
            'segmentation': {
                'min_duration_off': 1.5  # Fill gaps shorter than 1.5 seconds
            }
            # embedding_exclude_overlap is also fixed in the pre-trained pipeline
        }
        self.diar.instantiate(pipeline_params)
        logger.debug(f"Pipeline instantiated with params: {pipeline_params}")
        
        # Use the EXACT same embedding model that the diarization pipeline uses internally
        logger.debug("Loading wespeaker-voxceleb-resnet34-LM embedding model")
        self.embedder = PretrainedSpeakerEmbedding(
            "pyannote/wespeaker-voxceleb-resnet34-LM", device=device
        )
        logger.debug(f"Embedding model loaded, dimension: {self.embedder.dimension}")
        self.loader = Audio(sample_rate=16_000, mono="downmix")
        logger.debug("Audio loader initialized (16kHz, mono)")

    def embed(self, wave: torch.Tensor) -> np.ndarray:  # (1, T)
        logger.debug(f"Embedding audio: shape={wave.shape}, device={wave.device}")
        
        # Check minimum duration requirement (embedding model needs at least ~0.5 seconds)
        # At 16kHz, that's about 8000 samples
        audio_length = wave.shape[-1]
        min_samples = 8000  # ~0.5 seconds at 16kHz
        
        if audio_length < min_samples:
            logger.warning(f"Audio segment too short ({audio_length} samples, ~{audio_length/16000:.3f}s). Minimum required: {min_samples} samples (~{min_samples/16000:.3f}s)")
            raise ValueError(f"Audio segment too short for embedding model: {audio_length} samples < {min_samples} samples minimum")
        
        with torch.inference_mode():
            try:
                emb = self.embedder(wave.to(self.device))
            except AssertionError as e:
                logger.error(f"Embedding failed for audio shape {wave.shape}: {e}")
                raise ValueError(f"Audio segment too short for embedding model: {e}") from e
            except Exception as e:
                logger.error(f"Unexpected error during embedding: {e}")
                raise
        
        if isinstance(emb, torch.Tensor):
            emb = emb.cpu().numpy()
        
        # Check for NaN values
        if np.any(np.isnan(emb)):
            logger.error(f"Embedding contains NaN values! Input shape: {wave.shape}, embedding shape: {emb.shape}")
            raise ValueError("Embedding computation produced NaN values - audio segment may be too short or invalid")
        
        norm = np.linalg.norm(emb, axis=-1, keepdims=True)
        logger.debug(f"Raw embedding shape: {emb.shape}, norm: {norm.flatten()}")
        
        # Check for zero norm
        if np.any(norm == 0):
            logger.warning(f"Zero norm detected in embedding, using identity normalization")
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

    def diarize(self, path: Path, min_speakers: Optional[int] = None, max_speakers: Optional[int] = None, 
                collar: float = 2.0, min_duration_off: float = 1.5) -> List[Dict]:
        """Perform speaker diarization on an audio file.
        
        Args:
            path: Path to the audio file
            min_speakers: Minimum number of speakers to detect
            max_speakers: Maximum number of speakers to detect
            collar: Gap duration (seconds) to merge between speaker segments
            min_duration_off: Minimum silence duration (seconds) before treating as segment boundary
        """
        logger.debug(f"Diarizing audio file: {path}")
        logger.debug(f"Parameters: min_speakers={min_speakers}, max_speakers={max_speakers}, collar={collar}, min_duration_off={min_duration_off}")
        
        # Dynamically update pipeline parameters if min_duration_off is different from default
        if min_duration_off != 1.5:
            pipeline_params = {
                'segmentation': {
                    'min_duration_off': min_duration_off
                }
            }
            logger.debug(f"Updating pipeline params: {pipeline_params}")
            self.diar.instantiate(pipeline_params)
        
        with torch.inference_mode():
            # Pass speaker count parameters to pyannote
            kwargs = {}
            if min_speakers is not None:
                kwargs['min_speakers'] = min_speakers
            if max_speakers is not None:
                kwargs['max_speakers'] = max_speakers
            logger.debug(f"Calling diarization pipeline with kwargs: {kwargs}")

            output = self.diar(str(path), **kwargs)
            logger.info(f"Diarization output: {output}")
            logger.debug(f"Output type: {type(output)}, has speaker_diarization: {hasattr(output, 'speaker_diarization')}")

            # In pyannote.audio 4.0+, the pipeline returns a DiarizeOutput object
            # We need to access .speaker_diarization to get the Annotation object
            if hasattr(output, 'speaker_diarization'):
                diarization = output.speaker_diarization
                logger.info(f"Using speaker_diarization from output (pyannote 4.0+)")
            else:
                # Fallback for older versions (3.x) that return Annotation directly
                diarization = output
                logger.info(f"Using output directly as Annotation (pyannote 3.x)")

            # Apply PyAnnote's built-in gap filling using support() method with configurable collar
            # This fills gaps shorter than collar seconds between segments from same speaker
            logger.debug(f"Applying gap filling with collar={collar}s")
            diarization_before = len(list(diarization.itertracks(yield_label=True)))
            diarization = diarization.support(collar=collar)
            diarization_after = len(list(diarization.itertracks(yield_label=True)))
            logger.debug(f"Gap filling: {diarization_before} -> {diarization_after} segments (collar={collar}s)")
        
        segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append({
                "start": float(turn.start),
                "end": float(turn.end),
                "speaker": str(speaker),
                "duration": float(turn.end - turn.start)
            })
        
        logger.debug(f"Extracted {len(segments)} segments from diarization")
        if segments:
            logger.debug(f"Segment duration range: {min(s['duration'] for s in segments):.2f}s - {max(s['duration'] for s in segments):.2f}s")
            logger.debug(f"Unique speakers: {set(s['speaker'] for s in segments)}")
        
        return segments

    async def async_diarize(self, path: Path, min_speakers: Optional[int] = None, max_speakers: Optional[int] = None,
                           collar: float = 2.0, min_duration_off: float = 1.5) -> List[Dict]:
        """Async wrapper for diarization.
        
        Args:
            path: Path to the audio file
            min_speakers: Minimum number of speakers to detect
            max_speakers: Maximum number of speakers to detect
            collar: Gap duration (seconds) to merge between speaker segments
            min_duration_off: Minimum silence duration (seconds) before treating as segment boundary
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.diarize, path, min_speakers, max_speakers, collar, min_duration_off)

    def load_wave(self, path: Path, start: Optional[float] = None, end: Optional[float] = None) -> torch.Tensor:
        if start is not None and end is not None:
            # Get audio file duration to validate segment bounds
            file_info = self.loader.get_duration(str(path))
            file_duration = float(file_info)
            
            # Clamp segment bounds to file duration
            start_clamped = max(0.0, min(start, file_duration))
            end_clamped = max(start_clamped, min(end, file_duration))
            
            # Log if we had to clamp the segment
            if start != start_clamped or end != end_clamped:
                logger.warning(f"Segment [{start:.6f}s, {end:.6f}s] clamped to [{start_clamped:.6f}s, {end_clamped:.6f}s] for file duration {file_duration:.6f}s")
            
            seg = Segment(start_clamped, end_clamped)
            wav, _ = self.loader.crop(str(path), seg)
        else:
            wav, _ = self.loader(str(path))
        return wav.unsqueeze(0)  # (1, 1, T)

    @staticmethod
    def match_clusters(embedding: np.ndarray, clusters: List[Dict], threshold: float) -> Optional[Dict]:
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
            cluster_emb = np.array(cluster['embedding'], dtype=np.float32).flatten()
            
            # Ensure embeddings are normalized
            cluster_emb = cluster_emb / np.linalg.norm(cluster_emb)
            
            # Compute cosine similarity (dot product for normalized vectors)
            similarity = float(np.dot(embedding, cluster_emb))
            
            if similarity > best_similarity:
                best_similarity = similarity
                best_match = {
                    'cluster_id': cluster['id'],
                    'cluster_name': cluster.get('name'),
                    'similarity': similarity
                }
        
        # Return match only if above threshold
        if best_similarity >= threshold:
            return best_match
        
        return None