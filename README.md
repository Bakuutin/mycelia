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

**In Progress**

🫥 Chat with your memory

🫥 Streaming ingestion (replace batch system)

🫥 Full-text & semantic search

🫥 Other modalities (health, geolocation, photos, etc.)

🫥 Summarizations

🫥 Sharing

🫥 Backup Management

🫥 Observability

## 🚀 Quick Start

### 1. Install Deno

```bash
# Mac/Linux
curl -fsSL https://deno.land/x/install/install.sh | sh

# Windows (PowerShell)
irm https://deno.land/install.ps1 | iex
```

### 2. Setup & Run

```bash
# Clone the repo
git clone https://github.com/your-org/mycelia.git
cd mycelia

# Install deno deps
deno install

# Start the services
mkdir .docker
docker compose up -d

# Configure environment (edit your .env accordingly)
cp .env.example .env

# Start the server
deno run -A --env server.ts serve
```

## Commands

### Local Server Management (server.ts)

For local development and server management:

```bash
# Generate auth tokens and put
# `MYCELIA_CLIENT_ID` and `MYCELIA_TOKEN` in .env
deno run -A --env server.ts token create
```
```bash
# Start the server
deno run -A --env server.ts serve
```

Then open http://localhost:5173/ and use generated token to login.

### Setup Recordings Import

1. Copy `python/settings.example.py` to `python/settings.py` and configure your import sources (for example, Google Drive export, Apple Voice Memos, or a local folder).

2. Start the daemon, which will automatically import new recordings from your sources in the background.

```bash
# Run recordings import daemon
cd python
uv run daemon.py
```

3. After the initial import completes, run the `Recalculate timeline histograms` command below.


### Speech-to-Text (STT)

Configure and run the STT processor:

- Run python/whisper_server/server.py on a gpu machine and set the `STT_SERVER_URL` in .env
- Run `uv run stt.py` to process the audio chunks


### Remote Operations (cli.ts)

For operations against a remote server (requires login & API key):

```bash
# Login to remote server
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
