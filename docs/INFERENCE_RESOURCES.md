# Inference Stack Resource Requirements

This document outlines the hardware and system requirements for running the Mycelia Inference Stack (Whisper, Diarization, Ollama).

## GPU Requirements (Recommended)

Running with NVIDIA GPU acceleration provides the best performance (order of magnitude faster).

| Component | VRAM Requirement | CUDA Version | Notes |
|-----------|------------------|--------------|-------|
| Whisper (large-v3) | ~6-10 GB | 12.0+ | VRAM usage depends on batch size and quantization |
| Diarization | ~2-4 GB | 12.0+ | Runs pyannote.audio pipeline |
| Ollama (7B model) | ~4-6 GB | - | 7B parameters usually fit in 6GB (4-bit quant) |
| **Total Stack** | **~12-16 GB** | **12.1+** | For running all simultaneously. |

**Minimum GPU**: NVIDIA RTX 3060 (12GB) or equivalent server GPU (T4, A10).
**Recommended GPU**: NVIDIA RTX 3090/4090 (24GB) or A100/H100.

## CPU Requirements (Fallback)

The stack can run on CPU, but performance will be significantly slower, especially for Whisper and LLM inference.

| Component | RAM Requirement | Cores | Notes |
|-----------|-----------------|-------|-------|
| Whisper | 4-8 GB | 4+ | High CPU usage during transcription |
| Diarization | 8 GB | 2+ | Requires decent RAM for audio processing |
| Ollama (7B) | 8-16 GB | 4+ | Very slow on CPU without AVX-512 |
| **Total Stack** | **16-32 GB** | **8+** | Modern CPU (AMD Ryzen 5xxx or Intel 12th gen+) |

## Disk Space

Models are downloaded and cached.

- **Whisper large-v3**: ~3 GB
- **Diarization models**: ~2 GB
- **Ollama models**:
  - Llama 3 (8B): ~4.7 GB
  - Qwen 2.5 (7B): ~4.5 GB
- **Docker Images**: ~10-15 GB (CUDA images are large)

**Total Disk**: Recommend at least **50 GB** free space.

## Network Bandwidth

For remote setups where the stack is on a server and accessed via API:
- **Audio Upload**: Upstream bandwidth from client is critical. 1 hour of audio (WAV) is ~600MB.
- **Latency**: Ensure <100ms ping for interactive feel, though these are batch processes.
