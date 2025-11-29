# Mycelia [preview version]

**Mycelia is your self-hosted AI memory and timeline.**

Capture ideas, thoughts, and conversations in **voice, screenshots, or text**.
Ask anything later — _“What did I say about X last May?” Mycelia tells you, in
your own words.

📍 Local-first · 🔓 Open-source · 📦 Modular · 🛠 Hackable

## Roadmap

**Ready now**

- ✅ Continuous audio ingestion from Apple Voice Memos, Google Drive, and local libraries.
- ✅ Smart chunking, diarization-friendly VAD, and waveform normalization for aligned segments.
- ✅ Speech detection plus Whisper transcription via local or remote servers.
- ✅ Timeline UI with transcript-synced playback, jump controls, and search overlays.
- ✅ Modular resource-based backend for pluggable processors, storage, or prompts.
- ✅ MCP + CLI automation for remote operations and scripting.
- ✅ OAuth2 flows with `.well-known` metadata, JWT login, and token issuance.
- ✅ LLM summarizations and conversation extraction across the stack.
- ✅ MongoDB full-text search alongside GridFS-backed storage.
- ✅ Structured logging and observability for ingestion, STT, and LLM jobs.

**In Progress**

- 🚧 Chat with your memory via the Friend-Lite companion app + advanced backend (`friend/`) that is wiring semantic memories and wearable capture back into Mycelia.
- 🚧 Streaming ingestion & GPU diarization stack replacing the current batch-only flow (`python/diarization_worker.py`, `diarizator/` Helm charts + WebUI).
- 🚧 Multi-device & multi-modal capture (health, geolocation, photos, sensors) prototyped across `friend/extras/` and `friend/Docs/features.md`.
- 🚧 Semantic search + vector memory integration that connects the Qdrant-backed pipelines in `friend/backends/advanced/` and the OpenMemory MCP bridges into the main timeline.

**Planned / Up Next**

- 🧭 Unified dockerized stack with auto-initialization scripts so `docker compose up` brings up backend, frontend, and Python services (Phase 0 in `docs/DX_ROADMAP.md` & `docs/TASK_BREAKDOWN.md`).
- 🧭 Guided setup wizard (CLI + web), invite flow, and sample data path outlined in `docs/ONBOARDING_FLOW.md` (Phase 1).
- 🧭 Managed vs self-hosted inference configuration, remote GPU support, and connection testing UI (Phase 2 in `docs/DX_ROADMAP.md`/`docs/TASK_BREAKDOWN.md`).
- 🧭 LLM provider + model management, aliasing, quotas, and a model selection wiki (Phase 3 plus `docs/PROCESSING_AND_ARTIFACTS.md` + `docs/DX_ROADMAP.md`).
- 🧭 Privacy + usage dashboards, token metering, and formal privacy policy with export/acceptance flows (Phase 4 roadmap).
- 🧭 Processing/artifact templates, batch operations, sharing, and backup/export automation (Phases 5–6; see `docs/PROCESSING_AND_ARTIFACTS.md`).


## 🚀 Quick Start

### 1. Prerequisites

Install these system dependencies:

**macOS:**
```bash
brew install portaudio deno ffmpeg
curl -LsSf https://astral.sh/uv/install.sh | sh
# Install Docker Desktop: https://www.docker.com/products/docker-desktop
```

**Linux:**
```bash
sudo apt install portaudio19-dev ffmpeg
curl -fsSL https://deno.land/install.sh | sh
curl -LsSf https://astral.sh/uv/install.sh | sh
# Install Docker: https://docs.docker.com/engine/install/
```

**Windows:**
```powershell
# Install Deno
irm https://deno.land/install.ps1 | iex
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh
# Install FFmpeg: https://ffmpeg.org/download.html
# Install Docker Desktop: https://www.docker.com/products/docker-desktop
```

### 2. Setup & Run

```bash
# Clone the repo
git clone https://github.com/your-org/mycelia.git
cd mycelia

# Option A: Bring up databases + frontend in one go
docker compose up -d --build redis mongo mongo-search frontend

# Option B: Start stateful services only (run apps locally)
docker compose up -d redis mongo mongo-search

# Configure backend environment
cd backend
cp .env.example .env
# Edit .env with your preferred settings
# Make sure Mongo uses the direct connection string from .env:
# MONGO_URL=mongodb://localhost:27017?directConnection=true

# Generate auth credentials (requires services running)
deno run -A --env server.ts token-create
# Copy the printed MYCELIA_TOKEN and MYCELIA_CLIENT_ID into your .env

# Start the backend server
deno task dev
```

The backend dev server will be available at http://localhost:5173/.

### 3. Frontend

#### Option A: Run via Docker Compose (production build)

```bash
docker compose up -d --build frontend
```

Open http://localhost:8080.

#### Option B: Run in dev mode (Deno + Vite)

```bash
cd frontend
deno task dev
```

Open http://localhost:3001. Configure backend URL and credentials in the settings page.

### 4. Inference & Diarization Stack (optional)

#### Whisper STT server
```bash
cd python/whisper_server
uv sync
uv run server.py  # serves on http://localhost:8081 by default
```
Point `STT_SERVER_URL` to the host running this process (local or remote).

#### Speaker recognition / diarization service
Use the dedicated compose file under `diarizator/`:
```bash
cd diarizator
# CPU build
docker compose --profile cpu up -d speaker-service web-ui
# GPU build (requires NVIDIA runtime)
docker compose --profile gpu up -d speaker-service-gpu web-ui nginx
```
The web UI lives at `http://localhost:5173` (per `REACT_UI_PORT`) and the API exposes port `8085`. Configure `SPEAKER_SERVICE_URL` in your backend or processors to consume the service.

## LLM Setup

Need to wire up local inference or OpenRouter-hosted models? Check `docs/LLM_DEVELOPER_GUIDE.md` for the short developer guide on hardware picks, setup steps, and how to register models with Mycelia.

## Commands

### Backend Server

```bash
cd backend

# Generate auth tokens (put in .env)
deno run -A --env server.ts token-create

# Start the server
deno task dev
```

### Frontend Development

```bash
cd frontend

# Start development server
deno task dev

# Run tests
deno task test

# Type checking
deno task type-check

# Linting
deno lint
```

### Audio Import Setup

1. The `python/settings.py` works out-of-the-box and auto-detects:
   - Apple Voice Memos (if `CloudRecordings.db` exists)
   - Google Drive Easy Voice Recorder (scans `~/Library/CloudStorage/GoogleDrive-*`)
   - Local audio folder (`~/Library/mycelia/audio`)

   Customize paths/timezones via environment variables in `.env`:
   - `MYCELIA_APPLE_VOICEMEMOS_ROOT` - Apple Voice Memos path
   - `MYCELIA_GOOGLE_DRIVE_ROOT` - Google Drive Easy Voice Recorder path
   - `MYCELIA_LOCAL_AUDIO_ROOT` - Local audio folder path
   - `MYCELIA_GOOGLE_TZ` - Timezone for Google Drive timestamps (default: `UTC`)
   - `MYCELIA_LOCAL_TZ` - Timezone for local file timestamps (default: `UTC`)

2. **macOS only**: Grant Full Disk Access to your terminal app (Terminal, iTerm, VS Code, etc.) via System Settings → Privacy & Security → Full Disk Access. Restart the terminal after granting access.

3. Start the daemon, which will automatically import new recordings from your sources in the background.

```bash
# Run recordings import daemon
cd python
uv run daemon.py
```

   **Progress tracking**: The import process shows:
   - Discovery progress bars for each source (e.g., "Discovering apple_voicememos: 45/150 files")
   - Ingestion progress: "Starting ingestion: 23 files pending"
   - Per-file status: "Ingesting [5/23]: /path/to/file.m4a"
   - Batch summary: "Ingestion batch complete: 20 processed, 2 skipped, 1 errors, 3 remaining"

   **Processing frequency**: The daemon runs continuously, processing up to 20 files per batch, then sleeps briefly before the next batch. Failed files are skipped for 2 hours before retry.

   **Resumable**: The daemon tracks already-processed files in the database. If you cancel (Ctrl+C) and restart, it will skip files that were already discovered and continue from where it left off.

   **Logging**: All processing is logged to `~/Library/mycelia/logs/daemon.log` with detailed debug information including full ffmpeg errors. The console shows INFO level messages.

4. After the initial import completes, run the `Recalculate timeline histograms` command below.

#### Troubleshooting Import Issues

**FFmpeg errors**: If you see "ffmpeg error (see stderr output for detail)":
1. Check `~/Library/mycelia/logs/daemon.log` for the full error message
2. Common causes:
   - Corrupted audio file (try playing it in another app)
   - Unsupported codec (ffmpeg may need additional codecs)
   - File permission issues (verify Full Disk Access is granted)
3. Files with errors are automatically retried after 2 hours
4. To force immediate retry, remove the error from MongoDB or wait for the retry window


### Speech-to-Text (STT)

Quick start:

1. Start a Whisper server (local or remote) as documented in [backend/README.md#speech-to-text-stt](backend/README.md#speech-to-text-stt).
2. Transcribe queued audio:
   ```bash
   cd python
   uv run stt.py [--server https://your-stt-server.com/]
   ```
3. Inspect the backlog without processing: `uv run stt.py --count`.

Detailed setup, advanced flags, queue/index maintenance, and Mongo helper commands now live in `backend/README.md`.

#### Ensure Audio Chunk Indexes

To keep queue checks (`transcribed_at=null`, `processing_by=null`) fast, Mycelia now maintains a partial compound index on `audio_chunks`. The backend creates this index at startup and `python/stt.py` double-checks before processing, but you can rebuild it manually if needed:

```bash
cd backend
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.mongo \
  -a '{"action":"createIndex","collection":"audio_chunks","index":{"transcribed_at":1,"processing_by":1,"vad.has_speech":1,"start":-1},"options":{"name":"audio_chunks_pending_work","partialFilterExpression":{"transcribed_at":null,"processing_by":null,"vad.has_speech":true}}}'
```

If you routinely query `processing_by != null` or `transcribed_at != null`, there are also single-field helper indexes (`audio_chunks_processing_by`, `audio_chunks_transcribed_at`) created alongside the compound one.


### Conversation Extraction (python/convos)

`python/convos` scans recent transcripts, groups them into time-bounded conversation chunks, uses an LLM to extract structured conversations, then writes conversation objects and "mentioned in" relationships to MongoDB.

When to run:
- After your audio has been imported and transcribed. In sequence: Import/daemon → STT → Conversation extraction → (optionally) timeline histogram recalculation.

What it does:
- Groups adjacent transcript segments into conversations based on silence gaps and total content length
- Prompts an LLM to extract: title, summary, entities, start/end, emoji
- Creates conversation objects in `objects` collection and links mentioned entities via relationships

How to run:
```bash
cd python
uv run python -m convos.cli \
  --limit 5 \
  --model small
```

Flags:
- `--limit <n>`: Maximum number of conversation chunks to process in this run
- `--not-later-than <unix_ts>`: Only consider transcripts earlier than this UTC UNIX timestamp
- `--model <small|medium|large>`: LLM size used for extraction (default: `small`)

Model selection guidance:
- `small`: Fastest and cheapest. Good for routine runs and iterative backfills
- `medium`: Balanced quality vs. speed for mixed content
- `large`: Highest quality summaries/titles/entity extraction; slower and more costly

Notes:
- Logs are written to `~/Library/mycelia/logs/convos.log` and INFO is printed to console
- The script marks daily buckets as processed to avoid re-processing the same time windows


### Remote Operations (cli.ts)

For operations against a remote server (requires login & API key), from /backend directory:

```bash
# Login to remote server
cd backend
deno run --env -E='MYCELIA_*' --allow-net cli.ts login

# Import audio file to remote server
deno run --env -E='MYCELIA_*' --allow-net cli.ts audio import /path/to/file.wav

# Timeline operations via MCP

# Mark timeline data as stale
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "invalidate", "start": "10d"}'

# Recalculate timeline histograms
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "recalculate", "all": true}'

# Ensure timeline indexes
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "ensureIndex"}'

# MongoDB operations via MCP
# Find documents
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.mongo -a '{"action": "find", "collection": "audio_chunks", "query": {}, "options": {"limit": 10}}'

# Count documents
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.mongo -a '{"action": "count", "collection": "transcriptions", "query": {}}'

# Redis operations via MCP
# Get value
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.redis -a '{"action": "get", "key": "some-key"}'

# Set value
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.redis -a '{"action": "set", "key": "some-key", "value": "some-value"}'

# GridFS operations via MCP
# Find files
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.fs -a '{"action": "find", "bucket": "uploads", "query": {}}'
```

## Contributing

You’re welcome to fork, build plugins, suggest features, or break things
(metaphorically, c'mon, it's open source).

- Join the [Discord](https://discord.gg/hPfYbpp2am)
- PRs are welcome

## License

[MIT](./LICENSE)
