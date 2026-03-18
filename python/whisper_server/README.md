# Mycelia Whisper Server

Lightweight OpenAI-compatible transcription server for local development on macOS.

## Features

- `POST /v1/audio/transcriptions` for direct Mycelia integration
- `GET /v1/models` so the Settings "Test API" action works
- `POST /asr` compatibility endpoint for the existing Whisper proxy flow
- Optional bearer auth via `WHISPER_API_KEY`

## Run With Docker

```bash
docker build -t mycelia-whisper-local -f python/whisper_server/Dockerfile .

docker container run --rm \
  -p 9000:9000 \
  -e WHISPER_MODEL=small \
  -e WHISPER_API_KEY=mycelia-local \
  -v mycelia-whisper-models:/models \
  mycelia-whisper-local
```

The server listens on `http://localhost:9000` by default.

## Run Natively

```bash
cd python/whisper_server
uv sync

WHISPER_MODEL=small \
WHISPER_API_KEY=mycelia-local \
uv run mycelia-whisper-server
```

## Configuration

- `WHISPER_HOST` default: `0.0.0.0`
- `WHISPER_PORT` default: `9000`
- `WHISPER_MODEL` default: `small`
- `WHISPER_DEVICE` default: `cpu`
- `WHISPER_COMPUTE_TYPE` default: `int8`
- `WHISPER_API_KEY` optional bearer token
- `WHISPER_CACHE_DIR` optional model cache directory
- `WHISPER_VAD_FILTER` default: `true`
- `WHISPER_BEAM_SIZE` default: `5`

The first request downloads the configured `faster-whisper` model if it is not already cached.
