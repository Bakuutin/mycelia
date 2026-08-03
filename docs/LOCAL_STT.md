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

## Choose a model and compute backend

Use the full Turbo variant for the local Mac route. It is the official Argmax
Turbo artifact and is the best starting point on this machine:

```bash
BUILD_ALL=1 swift run argmax-cli serve \
  --host 0.0.0.0 \
  --port 10301 \
  --model large-v3-v20240930_turbo \
  --download-model-path /private/tmp/argmax-whisper-models \
  --audio-encoder-compute-units cpuAndGPU \
  --text-decoder-compute-units cpuAndGPU \
  --verbose
```

The server loads one model only. Stop it and start the next command to switch
models. Do not run two models on port `10301`.

| Model ID | Official artifact size | Use it when |
| --- | ---: | --- |
| [`large-v3-v20240930_turbo`](https://huggingface.co/argmaxinc/whisperkit-coreml/tree/main/openai_whisper-large-v3-v20240930_turbo) | 1.64 GB | **Recommended local full Turbo.** The full Turbo artifact; highest disk and memory requirement. |
| [`large-v3-v20240930_turbo_632MB`](https://huggingface.co/argmaxinc/whisperkit-coreml/tree/main/openai_whisper-large-v3-v20240930_turbo_632MB) | 646 MB | A smaller, separately published 4-bit-compressed Turbo artifact. Try it only when the full model is too large or slow to load; benchmark quality and speed on the target Mac. |
| `large-v3-v20240930_626MB` | approximately 626 MB | The older compressed Large V3 option. Keep it as the low-footprint fallback. |

The 1.64 GB and 646 MB figures are download-artifact sizes, not a guarantee of
runtime memory use or transcription quality. The Argmax model repository marks
both `turbo` artifacts as 4-bit compressed; their disk footprints and Core ML
graphs are nevertheless different. Never infer which model processed a past
job from the server's current model: Mycelia records the selected profile model
in each job's `routingContext.model`.

### `cpuAndGPU` versus the default Neural Engine path

Argmax defaults both the audio encoder and text decoder to
`cpuAndNeuralEngine`. That is normally the power-efficient Apple Silicon path,
but the first Core ML specialization can take a long time and may appear stuck
before the HTTP server opens its port. The `cpuAndGPU` flags above keep those
models on CPU/GPU instead:

- Use **`cpuAndGPU`** for the full Turbo command above, or when the ANE path
  does not reach `/v1/models` after the model download. It avoids the long ANE
  AOT specialization we observed with the 632 MB artifact on this Mac.
- Try the default **`cpuAndNeuralEngine`** only after the server is otherwise
  stable and benchmark it on the same audio. It can be a good choice for
  sustained, energy-efficient local operation, but it is not automatically
  faster for every model/macOS combination.
- Do not call a model "faster" merely from its name or download size. Use the
  Jobs `× realtime` value from a newly completed job, or time the same test
  file with curl, before changing the production route.

For the 632 MB experimental variant, use the same explicit GPU options rather
than allowing the default ANE path:

```bash
BUILD_ALL=1 swift run argmax-cli serve \
  --host 0.0.0.0 \
  --port 10301 \
  --model large-v3-v20240930_turbo_632MB \
  --download-model-path /private/tmp/argmax-whisper-models \
  --audio-encoder-compute-units cpuAndGPU \
  --text-decoder-compute-units cpuAndGPU \
  --verbose
```

The first launch downloads model files, and the first load may still take time
to create Core ML caches. Wait for both `Server started` and
`GET /v1/models` before enabling the route in Mycelia.

## Which command should I run?

These commands have different roles; they must not run together.

| Command | Role | When to use it |
| --- | --- | --- |
| `argmax-cli serve` | Long-running local **STT server**. It loads one Whisper model and waits for HTTP requests. | Start this first and leave it running while Mycelia processes audio. |
| `docker compose exec python-worker python stt.py ...` | One-off direct **recovery/backfill client** inside the Mycelia container. | Use only when the automatic Jobs transcription pipeline is deliberately stopped or unavailable. This is the preferred manual form. |
| `uv run stt.py ...` | The same one-off direct client, run from the Mac host. | Use for Python-development debugging only, or when the Docker worker cannot be used. |

For normal operation, start one `argmax-cli serve` process, add it in
**Settings -> Speech-to-text** as `http://host.docker.internal:10301`, then use
the automatic transcription worker. Do not run either `stt.py` command while
that queue is healthy: direct processing and Jobs can claim the same audio.

## Test the server

Test the endpoint before connecting Mycelia:

```bash
curl -fsS http://127.0.0.1:10301/health
curl -fsS \
  -H 'Authorization: Bearer local-no-auth' \
  -F 'file=@test.wav;type=audio/wav' \
  -F 'model=large-v3-v20240930_turbo' \
  -F 'response_format=verbose_json' \
  http://127.0.0.1:10301/v1/audio/transcriptions | jq .
```

Run the second command from the directory containing `test.wav`, or replace
`@test.wav` with an absolute path. To create a predictable 16 kHz mono WAV:

```bash
ffmpeg -i input.m4a -ar 16000 -ac 1 -c:a pcm_s16le test.wav
```

Use the exact model passed to `argmax-cli serve`; this example uses the full
Turbo model `large-v3-v20240930_turbo`.

`argmax-cli serve` is model-fixed: the `model` form field sent by curl,
Mycelia, or `stt.py` does not switch its loaded model. Clients should send the
same model ID as the server for correct routing and provenance. Check it with:

```bash
curl -fsS http://127.0.0.1:10301/v1/models | jq .
```

## Configure multiple providers in Mycelia

Open **Settings -> Speech-to-text**. Every configured route is shown as a card.
Select a card to edit it or press **Add provider**, then set:

- **STT Base URL**: use `http://host.docker.internal:10301` for Argmax running
  on the same Mac as the Docker stack; use the remote proxy URL for a remote
  service.
- **STT API Key**: use the real proxy secret, or `local-no-auth` for Argmax.
- **STT model**: the exact model accepted by that server.
- **Priority**: `1` is highest. Routes at the same priority load-balance;
  lower-priority routes are overflow when earlier routes have no free slots.
- **Slots**: maximum parallel jobs reserved for that provider (`1-8`).
- **Enabled**: disabled routes receive no newly queued jobs.

Press **Save STT route**. The transcription worker concurrency becomes the sum
of enabled provider slots, up to the global limit of eight. Batch size remains
separate: sequences inside one transcription job are processed serially, while
provider slots control how many jobs can call STT servers in parallel.

The **Backend environment STT route** represents `STT_SERVER_URL`,
`PROXY_API_KEY`, and `STT_MODEL` from the backend environment. It can be enabled
alongside UI-managed providers and has one slot. Its secret is never displayed
in the form.

## Manual recovery: run `stt.py` in Docker (preferred)

Inside the Compose `python-worker`, `127.0.0.1` points to the container itself.
Use the Docker hostname for the Mac instead:

```bash
cd /path/to/mycelia

docker compose exec python-worker python stt.py \
  --server http://host.docker.internal:10301 \
  --api-key local \
  --model large-v3-v20240930_626MB \
  --limit 1
```

This uses the worker's existing Mycelia connection. `--limit 1` is a bounded
recovery run, not a server process.

## Manual recovery: run `stt.py` on the host

Mycelia still needs backend access for MongoDB and resource APIs. Configure
`MYCELIA_URL`, `MYCELIA_CLIENT_ID`, and `MYCELIA_TOKEN` in the repo `.env`.

When `stt.py` runs directly on the same Mac, connect through `127.0.0.1`:

```bash
cd /path/to/mycelia/python
export UV_CACHE_DIR=/tmp/uv-cache

uv run stt.py \
  --server http://127.0.0.1:10301 \
  --api-key local \
  --model large-v3-v20240930_626MB \
  --limit 1
```

Argmax does not require an API key, but `stt.py` requires a non-empty value for
a dedicated STT endpoint. `local` is only a placeholder; it is sent as a bearer
token and is not a real credential.

To make the Docker configuration persistent, add the following to the repo
`.env`, using the same model that was passed to `argmax-cli serve`:

```dotenv
STT_SERVER_URL=http://host.docker.internal:10301
PROXY_API_KEY=local
STT_MODEL=large-v3-v20240930_626MB
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

## Google Cloud Speech-to-Text

A Gemini API key from Google AI Studio is not accepted by Google Cloud
Speech-to-Text. Cloud STT uses Google Cloud authentication such as Application
Default Credentials or a service account. It also does not expose Mycelia's
OpenAI-compatible `/v1/audio/transcriptions` contract directly. A dedicated
adapter is therefore required before it can be selected as an STT provider in
this UI.

That adapter should authenticate with ADC, translate Mycelia's multipart audio
request to Google STT, normalize the transcript and segments back to the
OpenAI-compatible response shape, and handle long recordings through chunking or
Google Cloud Storage. Until then, do not place a Gemini key in the STT API key
field.

References:

- [Google Cloud STT authentication](https://docs.cloud.google.com/speech-to-text/docs/v1/authentication)
- [Synchronous recognition limits and usage](https://docs.cloud.google.com/speech-to-text/docs/v1/sync-recognize)
- [Speech-to-Text pricing](https://cloud.google.com/speech-to-text/pricing)
- [Google Cloud Free Program](https://cloud.google.com/free)
- [Cloud Vision pricing](https://cloud.google.com/vision/pricing)
- [Cloud Natural Language pricing](https://cloud.google.com/natural-language/pricing)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
