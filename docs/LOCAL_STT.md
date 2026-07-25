# Local STT with Argmax and Whisper

The Argmax OSS Swift CLI exposes WhisperKit through an OpenAI-compatible
`POST /v1/audio/transcriptions` endpoint. It requires macOS 14 or newer, Xcode
16 or newer, and an Apple Silicon Mac.

## Build the local server

Clone and build Argmax in a separate directory:

```bash
git clone https://github.com/argmaxinc/argmax-oss-swift.git
cd argmax-oss-swift
make build-local-server
```

Start the accuracy-oriented compressed Whisper Large V3 model:

```bash
BUILD_ALL=1 swift run argmax-cli serve \
  --host 0.0.0.0 \
  --port 10301 \
  --model large-v3-v20240930_626MB \
  --verbose
```

For faster transcription, start the Large V3 Turbo model instead:

```bash
BUILD_ALL=1 swift run argmax-cli serve \
  --host 0.0.0.0 \
  --port 10301 \
  --model large-v3-v20240930_turbo_632MB \
  --verbose
```

The first launch may take longer while the selected model is downloaded. The
server loads one model, so restart it to switch models.

## Test the server

Test the endpoint before connecting Mycelia:

```bash
curl -X POST http://127.0.0.1:10301/v1/audio/transcriptions \
  -H "Authorization: Bearer local" \
  -F "file=@/absolute/path/to/test.wav" \
  -F "model=large-v3-v20240930_turbo_632MB" \
  -F "response_format=verbose_json"
```

## Run `stt.py` on the host

Mycelia still needs backend access for MongoDB and resource APIs. Configure
`MYCELIA_URL`, `MYCELIA_CLIENT_ID`, and `MYCELIA_TOKEN` in the repo `.env`.

When `stt.py` runs directly on the same Mac, connect through `127.0.0.1`:

```bash
cd /path/to/mycelia/python
export UV_CACHE_DIR=/tmp/uv-cache

uv run stt.py \
  --server http://127.0.0.1:10301 \
  --api-key local \
  --model large-v3-v20240930_turbo_632MB \
  --limit 1
```

Argmax does not require an API key, but `stt.py` requires a non-empty value for
a dedicated STT endpoint. `local` is only a placeholder; it is sent as a bearer
token and is not a real credential.

## Run `stt.py` in Docker

Inside the Compose `python-worker`, `127.0.0.1` points to the container itself.
Use the Docker hostname for the Mac instead:

```bash
cd /path/to/mycelia

docker compose exec python-worker python stt.py \
  --server http://host.docker.internal:10301 \
  --api-key local \
  --model large-v3-v20240930_turbo_632MB \
  --limit 1
```

To make the Docker configuration persistent, add the following to the repo
`.env`, using the same model that was passed to `argmax-cli serve`:

```dotenv
STT_SERVER_URL=http://host.docker.internal:10301
PROXY_API_KEY=local
STT_MODEL=large-v3-v20240930_turbo_632MB
```

Recreate the worker so it receives the new environment, then perform a small
test run:

```bash
docker compose up -d --force-recreate python-worker
docker compose exec -T python-worker python stt.py --count
docker compose exec python-worker python stt.py --limit 1
```

`--count` verifies backend authentication and counts pending speech chunks; it
does not call the STT server. `--limit 1` makes a real transcription request and
writes the result to Mycelia.

Do not run this direct worker alongside Mycelia's healthy automatic
transcription pipeline, because both can claim the same pending chunks.
