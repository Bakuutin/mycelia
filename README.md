# Mycelia

**Your self-hosted AI memory and timeline.**

Capture ideas, thoughts, and conversations in voice, screenshots, or text.
Ask anything later — _"What did I say about X last May?"_ Mycelia tells you, in your own words.

Local-first · Open-source · Modular · Hackable

---

## Quick Start

### Prerequisites

Install these before starting:

| Tool | macOS | Linux | Windows |
|------|-------|-------|---------|
| Docker | [Docker Desktop](https://www.docker.com/products/docker-desktop) | [Docker Engine](https://docs.docker.com/engine/install/) | [Docker Desktop](https://www.docker.com/products/docker-desktop) |
| Deno | `brew install deno` | `curl -fsSL https://deno.land/install.sh \| sh` | `irm https://deno.land/install.ps1 \| iex` |
| FFmpeg | `brew install ffmpeg` | `sudo apt install ffmpeg` | [ffmpeg.org](https://ffmpeg.org/download.html) |
| uv (Python) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | same | same |

### Setup (5 minutes)

```bash
# 1. Clone repo
git clone https://github.com/mycelia-tech/mycelia.git && cd mycelia

# 2. Create config (defaults work out of the box, no edits needed)
cp backend/.env.example backend/.env

# 3. Start databases
docker compose up -d

# 4. Start backend (first run auto-generates API credentials)
cd backend && deno task dev
```

**First run**: Copy the auto-generated credentials from console to `backend/.env`:
```
[AutoInit] ✅ Default API key created. Add to your .env file:
  MYCELIA_TOKEN=mycelia_xxxxx...
  MYCELIA_CLIENT_ID=xxxxxx...
```

```bash
# 5. Start frontend (new terminal)
cd frontend && deno task dev
```

**Open http://localhost:3001** and enter credentials in **Settings**:
- Client ID → `MYCELIA_CLIENT_ID` value
- Client Secret → `MYCELIA_TOKEN` value

### Verify It Works

- [ ] Backend running at http://localhost:5173
- [ ] Frontend running at http://localhost:3001
- [ ] Settings page accepts credentials
- [ ] Timeline page loads without errors

---

## Audio Processing Pipeline

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  1. Import  │ → │ 2. Transcribe│ → │3. Conversations│ → │ 4. Timeline │
│  daemon.py  │    │   stt.py    │    │  convos.cli  │    │  recalculate│
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       ↑                  ↑                  ↑
 Voice Memos        Whisper Server     LLM required
 Google Drive       (must be running)  (local or cloud)
 Local files
```

### Step 1: Import Audio

Import from Apple Voice Memos, Google Drive, or local folders:

```bash
cd python && uv sync && uv run daemon.py
```

**macOS**: Grant Full Disk Access first (System Settings → Privacy & Security → Full Disk Access).

The daemon runs continuously, importing new files as they appear. Press `Ctrl+C` to stop.

### Step 2: Transcribe (requires Whisper server)

Start Whisper server (Terminal 1):
```bash
cd python/whisper_server && uv sync && uv run server.py
```

Run transcription (Terminal 2):
```bash
cd python && uv run stt.py
```

### Step 3: Extract Conversations (requires LLM)

**Setup LLM first** (one-time): Configure an LLM in **Settings → LLMs → Add LLM Model**.
- **Local GPU**: Use Ollama with Llama 3.3 70B (see [LLM_DEVELOPER_GUIDE.md](docs/LLM_DEVELOPER_GUIDE.md#option-a--local-inference))
- **Cloud API**: Use OpenRouter with Gemini/Claude (see [LLM_DEVELOPER_GUIDE.md](docs/LLM_DEVELOPER_GUIDE.md#option-b--openrouter-hosted-models))

```bash
cd python && uv run python -m convos.cli --model medium --limit 50
```

### Step 4: Update Timeline

Recalculate histograms to see data in the UI. Two options:

**Option A: Frontend UI**
1. Go to Timeline page (http://localhost:3001/timeline)
2. Select a time range by clicking and dragging
3. Click the refresh button (🔄) to recalculate that range

**Option B: API (full recalculation)**
```bash
curl -X POST http://localhost:5173/api/resource/timeline \
  -H "Authorization: Bearer $MYCELIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "recalculate", "all": true}'
```

---

## Optional: Speaker Diarization

Identify who's speaking. Requires [HuggingFace token](https://huggingface.co/settings/tokens).

```bash
cd diarizator
cp .env.template .env
# Edit .env: set HF_TOKEN=your_token (see file for model license links)

docker compose up -d diarization-service
```

Set `DIARIZATION_SERVER_URL=http://localhost:8085` in `backend/.env`.

---

## Documentation

| Topic | Document |
|-------|----------|
| LLM Setup | [docs/LLM_DEVELOPER_GUIDE.md](docs/LLM_DEVELOPER_GUIDE.md) |
| Job Queue & Histograms | [docs/JOB_QUEUE.md](docs/JOB_QUEUE.md) |
| Timeline Features | [docs/TIMELINE_SUMMARY.md](docs/TIMELINE_SUMMARY.md) |
| Histogram Visualization | [docs/HISTOGRAMS.md](docs/HISTOGRAMS.md) |
| Data Model | [docs/objects.md](docs/objects.md) |
| Processing Pipeline | [docs/PROCESSING_AND_ARTIFACTS.md](docs/PROCESSING_AND_ARTIFACTS.md) |
| Development Roadmap | [docs/DX_ROADMAP.md](docs/DX_ROADMAP.md) |
| All Documentation | [docs/README.md](docs/README.md) |

---

## Commands Reference

### Backend

```bash
cd backend
deno task dev          # Start server (credentials auto-generated on first run)
deno task dev:quiet    # Start without HTTP request logging
deno run -A --env server.ts token-create  # Create additional API keys
```

### Frontend

```bash
cd frontend
deno task dev          # Start development server
deno task test         # Run tests
deno task type-check   # Type checking
```

### Python (Audio Processing)

See [Audio Processing Pipeline](#audio-processing-pipeline) for full workflow.

```bash
cd python
uv run daemon.py                       # Step 1: Import audio
uv run stt.py                          # Step 2: Transcribe (needs whisper server)
uv run python -m convos.cli --limit 50 # Step 3: Extract conversations
```

---

## Troubleshooting

### 403 Forbidden / API Credentials Required

1. Make sure backend is running: `cd backend && deno task dev`
2. Check console for auto-generated credentials
3. Copy `MYCELIA_TOKEN` and `MYCELIA_CLIENT_ID` to `backend/.env`
4. Enter credentials in frontend Settings

### WebSocket Connection Failed

Usually caused by missing API credentials. Configure them in Settings and refresh.

### Whisper CUDA Error on macOS

The server auto-detects macOS and uses CPU. If you see CUDA errors, set:
```bash
WHISPER_DEVICE=cpu WHISPER_MODEL=large-v3 uv run server.py
```

---

## Contributing

- [Discord](https://discord.gg/hPfYbpp2am)
- PRs welcome

## License

[MIT](./LICENSE)
