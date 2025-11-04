# Mycelia [preview version]

**Mycelia is your self-hosted AI memory and timeline.**

Capture ideas, thoughts, and conversations in **voice, screenshots, or text**.
Ask anything later — _“What did I say about X last May?” Mycelia tells you, in
your own words.

📍 Local-first · 🔓 Open-source · 📦 Modular · 🛠 Hackable

## Roadmap

**Ready to use**

😐 Ingestion pipeline for audio files

😐 Audio chunking

😐 Speech Detection + Transcription

😐 Timeline UI for playback & search

😐 Transcript-synced playback

😐 Modular system (add your own!)

😐 MCP (Model Context Protocol)

😐 OAuth2

😐 Summarizations

😐 Full Text Search

😐 Observability

**In Progress**

🫥 Chat with your memory

🫥 Streaming ingestion (replace batch system)

🫥 Other modalities (health, geolocation, photos, etc.)

🫥 Sharing

🫥 Semantic Search

🫥 Backup Management


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

# Configure Docker Compose environment
cp .env.example .env
# Edit .env if you want to change passwords

# Start the services (MongoDB, Redis, Kafka)
docker compose up -d

# Configure backend environment
cd backend
cp .env.example .env
# Edit .env - ensure REDIS_PASSWORD and KAFKA_ADMIN_PASSWORD match root .env

# Generate auth credentials (requires services running)
deno run -A --env server.ts token create
# Copy the printed MYCELIA_TOKEN and MYCELIA_CLIENT_ID into your .env

# Start the backend server
deno task dev
```

The backend will be available at http://localhost:5173/

### 3. Frontend

#### Option A: Run via Docker Compose (production build)

```bash
# From repo root
docker compose build frontend
docker compose up -d frontend
```

Open http://localhost:8080.

#### Option B: Run in dev mode (Deno + Vite)

```bash
cd frontend
deno task dev
```

Open http://localhost:3001. Configure backend URL and credentials in the settings page.

## Commands

### Backend Server

```bash
cd backend

# Generate auth tokens (put in .env)
deno run -A --env server.ts token create

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

Mycelia uses a Whisper-based transcription server to convert audio chunks into text. You can either run the STT server locally or use a remote instance.

**Prerequisites:** Ensure you've installed PortAudio as described in [python/README.md](python/README.md#portaudio-required-for-sttpy).

#### Option 1: Run Whisper Server Locally

The local Whisper server uses the faster-whisper library and runs best on a machine with a CUDA-compatible GPU, though CPU mode is also supported.

**Requirements:**
- Python 3.12+
- CUDA-compatible GPU (recommended) or CPU
- FFmpeg (already installed in prerequisites)

**Setup:**

```bash
cd python/whisper_server

# Install dependencies using uv
uv sync

# Start the server
uv run server.py
```

The server will start on `http://localhost:8081` and use the `large-v3` Whisper model by default.

**Configuration:**

In your `backend/.env` file, set:
```bash
STT_SERVER_URL=http://localhost:8081/
```

#### Option 2: Use Remote STT Server

If you have access to a GPU-enabled machine, you can run the Whisper server there and connect remotely:

1. On the GPU machine, run the Whisper server:
```bash
cd python/whisper_server
uv sync
uv run server.py
```

2. In your local `backend/.env` file, set the remote URL:
```bash
STT_SERVER_URL=https://your-stt-server.com/
STT_API_KEY=your_api_key_if_needed
```

#### Processing Audio Chunks

Once the STT server is running (locally or remotely), process your audio chunks:

```bash
cd python
uv run stt.py
```

This will:
- Connect to the STT server specified in your `.env`
- Process audio chunks from the database
- Store transcriptions back to MongoDB


### Conversation Extraction (python/convos.py)

`python/convos.py` scans recent transcripts, groups them into time-bounded conversation chunks, uses an LLM to extract structured conversations, then writes conversation objects and "mentioned in" relationships to MongoDB.

When to run:
- After your audio has been imported and transcribed. In sequence: Import/daemon → STT → Conversation extraction → (optionally) timeline histogram recalculation.

What it does:
- Groups adjacent transcript segments into conversations based on silence gaps and total content length
- Prompts an LLM to extract: title, summary, entities, start/end, emoji
- Creates conversation objects in `objects` collection and links mentioned entities via relationships

How to run:
```bash
cd python
uv run convos.py \
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
