# GPU Services

This directory contains Docker Compose configuration for GPU-accelerated AI services used by Mycelia, including Whisper transcription and Ollama LLM inference.

## Services

### Whisper ASR
- **Image**: `onerahmet/openai-whisper-asr-webservice:v1.9.1-gpu`
- **Purpose**: Audio transcription using OpenAI Whisper

### Ollama
- **Image**: `ollama/ollama:0.13.5`
- **Purpose**: Local LLM inference with GPU acceleration

### Proxy Server
- **Purpose**: API gateway providing:
  - OpenAI-compatible transcription endpoint
  - Authentication
  - Unified API access to both services

## Prerequisites
- Docker with GPU support (NVIDIA Docker runtime)
- NVIDIA GPU with CUDA support

## Setup

```bash
# on your GPU machine
git clone https://github.com/mycelia-tech/mycelia.git
cd mycelia/gpu
docker compose up -d --build
```
