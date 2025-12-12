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

### Prerequisites

**Docker only!** Install Docker Desktop (includes Docker Compose):

- **macOS/Windows**: [Docker Desktop](https://www.docker.com/products/docker-desktop)
- **Linux**: [Docker Engine](https://docs.docker.com/engine/install/)

### Setup & Run (All-in-Docker)

```bash
# Clone the repo
git clone https://github.com/your-org/mycelia.git
cd mycelia

# Start all services (databases + frontend)
docker compose up -d --build redis mongo mongo-search frontend
```

**That's it!** The frontend will be available at http://localhost:8080.

### Next Steps

1. **Configure backend** (uncomment backend service in docker-compose.yml for fully dockerized setup)
2. **Add inference**: Start the Whisper STT server (see below)
3. **Import audio**: Use the audio import daemon (see Audio Import section)

### Optional: Inference & Diarization Stack

The inference stack provides GPU-accelerated (or CPU fallback) services for:
- **Whisper STT** - Speech-to-text transcription
- **Diarization** - Speaker identification
- **Ollama** - Local LLM inference

---

## 🖥️ Remote GPU Server Deployment

Deploy the full inference stack to a remote GPU server with one command.

### Prerequisites

1. **Remote server** with SSH access (Ubuntu 22.04/24.04 recommended)
2. **GPU** (optional but recommended) - NVIDIA with 8GB+ VRAM
3. **Configure server details**:
   ```bash
   cp deploy/.server.conf.example deploy/.server.conf
   # Edit with your server details:
   # SERVER_HOST=your-server-ip
   # SSH_USER=your-username
   # SSH_PORT=22
   ```

4. **Set up SSH key** (recommended):
   ```bash
   ssh-copy-id -p 22 user@your-server-ip
   ```

### Deploy

```bash
./deploy-remote.sh
```

This will:
1. ✅ Sync files to the remote server
2. ✅ Install Docker, NVIDIA drivers (if GPU detected), dev tools
3. ✅ Configure NVIDIA Container Toolkit
4. ✅ Build and start all inference containers
5. ✅ Display service URLs when complete

### After Deployment

If you see "**REBOOT required**" (first-time GPU driver install):
```bash
ssh -p 22 user@your-server-ip
sudo reboot
# Wait 1 minute, then run deploy again:
./deploy-remote.sh
```

---

## 🏠 Local Inference Setup

Run the inference stack on your local machine.

### Quick Start (Local)

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env - add your HF_TOKEN for diarization (optional)

# 2. Start the stack
./scripts/start-inference.sh
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `HF_TOKEN` | Hugging Face token for diarization models | For diarization only |
| `WHISPER_PORT` | Whisper STT port (default: 8081) | No |
| `DIARIZATION_PORT` | Diarization port (default: 8085) | No |
| `OLLAMA_PORT` | Ollama port (default: 11434) | No |

**Get HF_TOKEN**: https://huggingface.co/settings/tokens
**Accept model terms**:
- https://huggingface.co/pyannote/speaker-diarization-3.1
- https://huggingface.co/pyannote/segmentation-3.0

---

## 📁 Script Reference

| Script | Run From | Purpose |
|--------|----------|---------|
| `./deploy-remote.sh` | Your Mac/local | Full deployment to remote server (syncs files + setup + start) |
| `./scripts/start-inference.sh` | Remote server (SSH) | Quick start/restart containers only |
| `./deploy/setup.sh` | Remote server | Install Docker, drivers, dev tools (called by deploy-remote.sh) |

### When to Use Each

| Situation | Command |
|-----------|---------|
| First deploy to new server | `./deploy-remote.sh` (from local) |
| Changed code locally | `./deploy-remote.sh` (from local) |
| Restart after server reboot | `sudo ./scripts/start-inference.sh` (on server) |
| Just restart containers | `sudo ./scripts/start-inference.sh` (on server) |

### Running on Server

```bash
# SSH into your server
ssh -p 22 user@your-server-ip

# Navigate to the deployment directory
cd ~/mycelia-inference

# Start/restart the stack
sudo ./scripts/start-inference.sh

# Or if you're in the docker group:
./scripts/start-inference.sh
```

**To avoid needing sudo:**
```bash
sudo usermod -aG docker $USER
# Logout and login again
```

---

## 🔧 Troubleshooting

### GPU Not Detected
```bash
# Check if nvidia-smi works
nvidia-smi

# If "command not found", drivers aren't installed
# The setup script will auto-install, but needs reboot:
sudo reboot
```

### Docker Permission Denied
```bash
# Run with sudo
sudo ./scripts/start-inference.sh

# Or add yourself to docker group (permanent fix)
sudo usermod -aG docker $USER
exit  # logout and login again
```

### "could not select device driver nvidia"
The NVIDIA Container Toolkit isn't configured. Run:
```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
# Or on VMs without systemd:
sudo pkill dockerd && sudo dockerd &
```

### Check Service Status
```bash
docker compose -f docker-compose.inference.yml ps
docker compose -f docker-compose.inference.yml logs -f
```

---

## 📊 Service Endpoints

After successful deployment:

| Service | URL | Health Check |
|---------|-----|--------------|
| Whisper STT | http://localhost:8081 | /health |
| Diarization | http://localhost:8085 | /health |
| Ollama | http://localhost:11434 | /api/tags |

---

## 🛠 Dev Tools Installed

The setup script installs these tools on the server:
- `zsh` + Oh My Zsh
- `tmux` - Terminal multiplexer
- `btop` - Beautiful system monitor
- `nvtop` - GPU process monitor
- `htop`, `ncdu`, `tree`, `jq`

**Useful aliases** (after setup):
```bash
mstatus  # Show services & GPU status
mlogs    # View container logs
mup      # Start services
mdown    # Stop services
gpu      # nvidia-smi
gpuw     # Watch GPU (updates every second)
```

---

## 🛠 Local Development Setup

For contributors and advanced users who want to run services locally:

### Prerequisites

**macOS:**
```bash
brew install portaudio deno ffmpeg
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**Linux:**
```bash
sudo apt install portaudio19-dev ffmpeg
curl -fsSL https://deno.land/install.sh | sh
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**Windows:**
```powershell
irm https://deno.land/install.ps1 | iex  # Install Deno
curl -LsSf https://astral.sh/uv/install.sh | sh  # Install uv
# Install FFmpeg: https://ffmpeg.org/download.html
```

### Backend (Local Dev)

```bash
# Start databases only
docker compose up -d redis mongo mongo-search

# Configure environment
cd backend
cp .env.example .env
# Edit .env - use: MONGO_URL=mongodb://localhost:27017?directConnection=true

# Generate auth credentials
deno run -A --env server.ts token-create
# Copy MYCELIA_TOKEN and MYCELIA_CLIENT_ID to .env

# Start backend dev server
deno task dev  # Available at http://localhost:5173
```

### Frontend (Local Dev)

```bash
cd frontend
deno task dev  # Available at http://localhost:3001
```

Configure backend URL and credentials in the settings page.

### Python Services (Local Dev)

```bash
# Whisper STT server
cd python/whisper_server
uv sync
uv run server.py  # Serves on http://localhost:8081

# Audio import daemon
cd python
uv run daemon.py

# STT processing
uv run stt.py

# Conversation extraction
uv run python -m convos.cli --limit 5
```

## LLM Setup

Need to wire up local inference or OpenRouter-hosted models? Check `docs/LLM_DEVELOPER_GUIDE.md` for the short developer guide on hardware picks, setup steps, and how to register models with Mycelia.

## Commands

### Docker Operations

```bash
# Start all services
docker compose up -d --build

# View logs
docker compose logs -f [service-name]

# Stop all services
docker compose down

# Rebuild a specific service
docker compose up -d --build frontend
```

### Backend Server (Local Dev)

```bash
cd backend

# Generate auth tokens (put in .env)
deno run -A --env server.ts token-create

# Start the server
deno task dev
```

### Frontend Development (Local Dev)

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

> **Note**: Audio import currently requires local Python setup (see Local Development section above).

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

3. Install Python dependencies and start the daemon:

```bash
cd python
uv sync
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

1. **Start Whisper server** (choose one):
   - **Docker** (recommended): See "Optional: Inference & Diarization Stack" above
   - **Local**: See [backend/README.md#speech-to-text-stt](backend/README.md#speech-to-text-stt)

2. **Transcribe queued audio** (requires local Python setup):
   ```bash
   cd python
   uv sync
   uv run stt.py [--server https://your-stt-server.com/]
   ```

3. **Inspect backlog**: `uv run stt.py --count`

Detailed setup, advanced flags, queue/index maintenance, and Mongo helper commands live in `backend/README.md`.

#### Ensure Audio Chunk Indexes

To keep queue checks (`transcribed_at=null`, `processing_by=null`) fast, Mycelia now maintains a partial compound index on `audio_chunks`. The backend creates this index at startup and `python/stt.py` double-checks before processing, but you can rebuild it manually if needed:

```bash
cd backend
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call mongo \
  -a '{"action":"createIndex","collection":"audio_chunks","index":{"transcribed_at":1,"processing_by":1,"vad.has_speech":1,"start":-1},"options":{"name":"audio_chunks_pending_work","partialFilterExpression":{"transcribed_at":null,"processing_by":null,"vad.has_speech":true}}}'
```

If you routinely query `processing_by != null` or `transcribed_at != null`, there are also single-field helper indexes (`audio_chunks_processing_by`, `audio_chunks_transcribed_at`) created alongside the compound one.


### Conversation Extraction

> **Note**: Requires local Python setup (see Local Development section above).

`python/convos` scans recent transcripts, groups them into time-bounded conversation chunks, uses an LLM to extract structured conversations, then writes conversation objects and "mentioned in" relationships to MongoDB.

**When to run:**
After your audio has been imported and transcribed. Sequence: Import/daemon → STT → Conversation extraction → (optionally) timeline histogram recalculation.

**What it does:**
- Groups adjacent transcript segments into conversations based on silence gaps and total content length
- Prompts an LLM to extract: title, summary, entities, start/end, emoji
- Creates conversation objects in `objects` collection and links mentioned entities via relationships

**How to run:**
```bash
cd python
uv sync
uv run python -m convos.cli --limit 5 --model small
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

> **Note**: Requires local Deno setup (see Local Development section above).

For operations against a remote server (requires login & API key):

```bash
# Login to remote server
cd backend
deno run --env -E='MYCELIA_*' --allow-net cli.ts login

# Import audio file to remote server
deno run --env -E='MYCELIA_*' --allow-net cli.ts audio import /path/to/file.wav

# Timeline operations via MCP

# Mark timeline data as stale
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call timeline -a '{"action": "invalidate", "start": "10d"}'

# Recalculate timeline histograms
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call timeline -a '{"action": "recalculate", "all": true}'

# Ensure timeline indexes
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call timeline -a '{"action": "ensureIndex"}'

# MongoDB operations via MCP
# Find documents
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call mongo -a '{"action": "find", "collection": "audio_chunks", "query": {}, "options": {"limit": 10}}'

# Count documents
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call mongo -a '{"action": "count", "collection": "transcriptions", "query": {}}'

# Redis operations via MCP
# Get value
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call redis -a '{"action": "get", "key": "some-key"}'

# Set value
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call redis -a '{"action": "set", "key": "some-key", "value": "some-value"}'

# GridFS operations via MCP
# Find files
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call fs -a '{"action": "find", "bucket": "uploads", "query": {}}'
```

## Contributing

You’re welcome to fork, build plugins, suggest features, or break things
(metaphorically, c'mon, it's open source).

- Join the [Discord](https://discord.gg/hPfYbpp2am)
- PRs are welcome

## License

[MIT](./LICENSE)
