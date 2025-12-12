"""Minimal PyAnnote Diarization Service.

A lightweight inference provider for speaker diarization with embeddings using pyannote.
Supports seeded clustering with known speaker clusters.

Features:
- Speaker diarization using pyannote
- WeSpeaker ResNet34 embeddings for each segment
- Seeded clustering with known speaker clusters
- FastAPI service for easy integration

Usage:
    from simple_speaker_recognition.api.service import app
    from simple_speaker_recognition.core.audio_backend import AudioBackend
"""

__version__ = "1.0.0"
__author__ = "Friend-Lite Team"

# Import core classes for convenience
from .core.audio_backend import AudioBackend

__all__ = ["AudioBackend"]