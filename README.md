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

### 0. Prerequisites

Install docker compose


### 1. Setup & Run

```bash
# Clone the repo
git clone https://github.com/mycelia-tech/mycelia.git
cd mycelia

cp .env.example .env
docker compose up -d --build

```

The backend dev server will be available at http://localhost:5173/.
The frontend will be available at http://localhost:8080.


#### Option B: Run in dev mode (Deno + Vite)

```bash
cd frontend
deno task dev
```

The frontend dev server will be available at http://localhost:3001/.

```bash
cd backend
deno task dev
```

The backend dev server will be available at http://localhost:5173/.

### 3. Inference Stack

On your GPU machine, run the inference stack:

```bash
git clone https://github.com/mycelia-tech/mycelia.git
cd mycelia/gpu
docker compose up -d --build
```

## LLM Setup

Need to wire up local inference or OpenRouter-hosted models? Check `docs/LLM_DEVELOPER_GUIDE.md` for the short developer guide on hardware picks, setup steps, and how to register models with Mycelia.

## Commands

### Backend Server

```bash
cd backend

deno run -A server.ts token-create

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


## Contributing

You’re welcome to fork, build plugins, suggest features, or break things
(metaphorically, c'mon, it's open source).

- Join the [Discord](https://discord.gg/hPfYbpp2am)
- PRs are welcome

## License

[MIT](./LICENSE)
