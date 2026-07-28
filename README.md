# Mycelia [preview version]

**Mycelia is your self-hosted AI memory and timeline.**

Capture ideas, thoughts, and conversations in **voice, screenshots, or text**.
Ask anything later — _"What did I say about X last May?" Mycelia tells you, in
your own words.

📍 Local-first · 🔓 Open-source · 📦 Modular · 🛠 Hackable

## Features

### Audio Ingestion & Processing

- Continuous import from Apple Voice Memos, Google Drive, and local folders.
- Automated pipeline: VAD → Transcription → Conversation extraction → Summarization.
- Smart chunking, waveform normalization, and diarization-friendly segments.
- Whisper transcription via local GPU or any remote OpenAI-compatible server.
- Audio recording, playback (0.5x–3x speed, volume up to 300%), and WAV export.
- Pipeline monitoring UI with real-time session tracking and error handling.

### Interactive Timeline

- D3.js-powered multi-track timeline with zoom and pan.
- Multi-resolution views (5 min, 1 hour, 1 day, 1 week).
- Transcript-synced audio playback with jump controls.
- Track visibility controls, object overlays, and event creation from selection.
- Quick presets (last hour, today, yesterday, this week, and more).

### AI Chat

- Chat with your memory — tool-calling agent with access to all backend resources.
- Streaming responses, file uploads, and speech input.
- Chat history with rename and management.

### Object Management

- Create, edit, and browse People, Events, Conversations, Relationships, and Promises.
- Per-object audio player with transcript sync and segment navigation.
- LLM summarization with model selection and cost estimation.
- Summary comparison (side-by-side, star/favorite).
- Autosave with per-field throttling and version history.
- Full-text search, category filtering, and relationship graph.

### Background Processing

- BullMQ job queue backed by Redis.
- Worker management UI with pause/resume, statistics, and success rates.
- Pipeline ordering and progress tracking.
- Configurable worker defaults and prompt templates.

### Infrastructure & Auth

- One-command Docker setup (`docker compose up -d`) with backend, frontend, Python worker, MongoDB, and Redis.
- OAuth 2.0 with PKCE, `.well-known` metadata, JWT login, and API key management.
- MCP (Model Context Protocol) server endpoint for remote operations and scripting.
- First-run setup wizard with automatic API key creation and inference provider configuration.
- OpenTelemetry observability (optional).
- Feature flags, access logging, and server configuration UI.

### Integrations

- Messenger platform import (Telegram, Signal).
- LLM provider configuration with model aliases (small / medium / large).
- OpenAI-compatible API endpoints (`/v1/audio/transcriptions`, `/llm/chat/completions`).
- MongoDB full-text search alongside GridFS-backed storage.

## Roadmap

**In progress**

- Friend-Lite companion app + advanced backend (`friend/`) wiring semantic memories and wearable capture back into Mycelia.
- GPU diarization stack replacing the current batch-only flow (`diarizator/` Helm charts + WebUI).
- Semantic search + vector memory integration connecting Qdrant-backed pipelines and the OpenMemory MCP bridges into the main timeline.

**Planned**

- Multi-device & multi-modal capture (health, geolocation, photos, sensors).
- Privacy + usage dashboards, token metering, and export flows.
- Processing / artifact templates, batch operations, and backup automation.


## 🚀 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

### Setup & Run

```bash
git clone https://github.com/mycelia-tech/mycelia.git
cd mycelia

./scripts/setup.sh --start
```

The setup script automatically:
- Creates `.env` from `.env.example`
- Generates a secure `SECRET_KEY`
- Starts all services with Docker Compose

Open [http://localhost:3210](http://localhost:3210) in your browser.

#### CLI/Python Daemon Users

If you need API tokens in `.env` (for Python daemon or CLI access):

```bash
./scripts/setup.sh --with-tokens --start
```

This starts MongoDB temporarily to generate `MYCELIA_CLIENT_ID` and `MYCELIA_TOKEN`.

#### Syncing After Updates

After pulling updates, new environment variables may be added to `.env.example`:

```bash
./scripts/sync-env.sh           # Interactive - prompts before adding
./scripts/sync-env.sh --dry-run # Preview changes without modifying
```

> **Note**: For local development, Mycelia uses a self-signed certificate. You may need to click "Advanced" and "Proceed" in your browser. See [NETWORKING.md](docs/NETWORKING.md) for more details on port configuration and SSL.

### Import Existing Audio Files

The Python daemon discovers new recordings, imports their metadata, splits each
audio file into chunks, and ingests up to 20 source files per cycle. It runs
continuously, starting another cycle approximately every 10 seconds, until you
stop it with `Ctrl+C`.

```bash
cd python
uv run daemon.py
```

The daemon can import:

- Apple Voice Memos
- Google Drive Folders
- Local Audio Folders

On macOS, give your terminal application **Full Disk Access** in System Settings
if you want to import Apple Voice Memos.

**Environment variables** (optional, set in `.env`):

- `MYCELIA_APPLE_VOICEMEMOS_ROOT` - Apple Voice Memos path
- `MYCELIA_GOOGLE_DRIVE_ROOT` - Google Drive path
- `MYCELIA_LOCAL_AUDIO_ROOT` - Local audio folder
- `MYCELIA_GOOGLE_TZ` / `MYCELIA_LOCAL_TZ` - Timezones (default: UTC)

#### Daemon Options

| Option | Purpose |
| --- | --- |
| `--once` | Run one cycle and exit instead of watching continuously. |
| `--reset-errors` | Clear cached source-file ingestion errors before importing again. |
| `--vad-only` | Skip discovery/import and process only chunks without VAD metadata. |
| `--vad-limit N` | Process at most `N` chunks per VAD cycle; default is `1000`. |
| `--vad-batch-size N` | Fetch `N` chunks per VAD database batch; default is `100`. |

`--reset-errors` cannot be combined with `--vad-only`. Both VAD numeric options
must be greater than zero.

Examples:

```bash
# Import one batch and exit
uv run daemon.py --once

# Retry source files with cached ingestion errors
uv run daemon.py --reset-errors
```

#### Run the Complete Automatic Pipeline

The recommended end-to-end command is:

```bash
cd /path/to/mycelia
./scripts/run-audio-pipeline.sh
```

It starts the Docker services and then runs local discovery/import on the host,
where Apple Voice Memos and other local files are accessible. After each audio
chunk is inserted, the backend automatically runs the remaining stages:

```text
daemon import -> VAD -> speech sequence creation -> remote STT -> conversations
```

The automatic transcription resource prefers the dedicated `STT_SERVER_URL`,
`PROXY_API_KEY`, and optional `STT_MODEL` values from `.env`. If those dedicated
variables are absent, it keeps the previous behavior and uses the inference
provider configured in Mycelia Settings.

LLM routing is configured separately in **Settings -> Inference**. Choose a
default model for new memory chats independently from the preset's background
task default, optionally override summaries, conversation extraction, or
tagging, and choose the failure policy for each feature:
**Stop with error** or retry once with a specific fallback model. The same
provider settings can be supplied with `OPENAI_BASE_URL`, `OPENAI_API_KEY`,
`OPENAI_MODEL`, and `OPENAI_CHAT_MODEL` in `.env`. Per-feature fallback defaults are
`SUMMARIZATION_FALLBACK_MODEL`, `CONVERSATION_EXTRACTION_FALLBACK_MODEL`, and
`TAGGER_FALLBACK_MODEL`; leave them unset to stop on error. Streaming chat never
switches models silently.

Before running it, configure at least:

```dotenv
STT_SERVER_URL=http://100.119.163.116:8001
PROXY_API_KEY=your-proxy-key
STT_MODEL=whisper
```

Use the `whisper` alias when the Portainer stack should use whichever
`ASR_MODEL` it has loaded. The service reports the actual model, and Mycelia
stores it in `transcriptions.metadata.model`.

Historically, `daemon.py` also performed only discovery and ingestion. VAD was
not calculated inside that process: the backend change-stream trigger created a
VAD job, `python-worker` calculated VAD, and later backend jobs created and
transcribed speech sequences. In other words, the normal old startup was
`docker compose up -d` plus `uv run daemon.py`; VAD appeared automatic because
the Docker backend and worker were already running.

`daemon.py --vad-only` and `stt.py` remain recovery/manual tools. Do not run
them alongside a healthy automatic pipeline: direct STT can race the backend
transcription jobs for the same chunks.

#### Run Import and VAD in Parallel

Use this recovery path only when the backend job queue is unavailable or
blocked. Keep file discovery/import on the host so it can access your local
recordings, and run VAD in the Python worker container where the Silero model
and cache are already available.

Terminal 1:

```bash
cd /path/to/mycelia/python
uv run daemon.py
```

Terminal 2:

```bash
cd /path/to/mycelia
docker compose exec python-worker python daemon.py --vad-only
```

For a bounded VAD run:

```bash
docker compose exec python-worker python daemon.py \
  --vad-only \
  --once \
  --vad-limit 1000 \
  --vad-batch-size 100
```

This is process-level parallelism: importing and VAD can run simultaneously.
Do not start multiple VAD-only processes against the same database; the current
Silero worker uses shared state within each process and VAD chunks are not
claimed for multi-worker execution.

After VAD marks speech chunks, inspect and run the direct STT worker only if the
automatic transcription queue is not running:

```bash
docker compose exec -T python-worker python stt.py --count
docker compose exec python-worker python stt.py
```

The host daemon log is written to `~/Library/mycelia/logs/daemon.log`.


### Configuration

When you first open the frontend, you'll be guided through a setup wizard:

1. **Server Connection** (`/setup`) - Connects to the backend and automatically creates your first API key.

2. **Inference Provider** (`/setup/inference`) - Configure an OpenAI-compatible
   endpoint and initial model. Settings → Inference then lets you separate the
   default for new memory chats from background-task routing. Local GPU stacks
   are supported; see [GPU README](gpu/README.md).

You can reconfigure these settings anytime in Settings.

#### Managing API Keys

- **Via Settings UI**: Go to Settings → API Keys to create, view, and revoke keys
- **Via Terminal** (for initial setup or automation):
  ```bash
  docker compose run --rm backend deno run -A server.ts token-create
  ```

## For Developers

See **[DEVELOPMENT.md](DEVELOPMENT.md)** for:
- Docker dev mode with hot reload
- Native development setup (Deno + Vite)
- Python tooling (audio import, STT, conversation extraction)
- GPU inference stack setup
- Database backup & point-in-time recovery
- Project structure and contributing guidelines

## Contributing

You're welcome to fork, build plugins, suggest features, or break things
(metaphorically, c'mon, it's open source).

- Join the [Discord](https://discord.gg/hPfYbpp2am)
- PRs are welcome

## License

[MIT](./LICENSE)
