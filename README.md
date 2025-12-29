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
# 1. Clone and enter the repo
git clone https://github.com/mycelia-tech/mycelia.git
cd mycelia

# 2. Create environment file
cp .env.example .env

# 3. Start databases (Redis, MongoDB)
docker compose up -d

# 4. Setup and start backend
cd backend
cp .env.example .env
deno task dev
```

**First run only**: The backend prints credentials to the console:
```
[AutoInit] ✅ Default API key created. Add to your .env file:
  MYCELIA_TOKEN=mycelia_xxxxx...
  MYCELIA_CLIENT_ID=xxxxxx...
```

Copy these values to **both**:
- `backend/.env` (for backend)
- Root `.env` (for Python services)

```bash
# 5. Start frontend (new terminal)
cd frontend
deno task dev
```

**Open http://localhost:3001** and configure credentials in **Settings**:
- Client ID → `MYCELIA_CLIENT_ID` value
- Client Secret → `MYCELIA_TOKEN` value

### Verify It Works

- [ ] Backend running at http://localhost:5173
- [ ] Frontend running at http://localhost:3001
- [ ] Settings page accepts credentials
- [ ] Timeline page loads without errors

---

## Optional Services

### Speech-to-Text (Whisper)

Transcribe audio recordings locally:

```bash
cd python/whisper_server
uv sync
uv run server.py  # auto-detects CPU/GPU, uses large-v3 model
```

Serves at http://localhost:8081. Set `STT_SERVER_URL=http://localhost:8081` in `backend/.env`.

### Speaker Diarization

Identify who's speaking in recordings. Requires [HuggingFace token](https://huggingface.co/settings/tokens) with access to pyannote models.

```bash
cd diarizator
cp .env.template .env
# Edit .env: set HF_TOKEN=your_token

docker compose up -d diarization-service  # CPU
# OR for GPU: docker compose --profile gpu up -d diarization-service-gpu
```

Serves at http://localhost:8085. Set `DIARIZATION_SERVER_URL=http://localhost:8085` in `backend/.env`.

### Audio Import Daemon

Import recordings from Apple Voice Memos, Google Drive, or local folders:

```bash
cd python
uv sync
uv run daemon.py
```

**macOS**: Grant Full Disk Access to your terminal app first (System Settings → Privacy & Security → Full Disk Access).

**After importing**: Recalculate timeline histograms to see data in the UI:
```bash
curl -X POST http://localhost:5173/api/resource/timeline \
  -H "Authorization: Bearer $MYCELIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "recalculate", "all": true}'
```

See [docs/JOB_QUEUE.md](docs/JOB_QUEUE.md#timeline-histogram-recalculation) for more options.

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

### Python Services

```bash
cd python
uv run daemon.py       # Import audio files
uv run stt.py          # Transcribe audio
uv run python -m convos.cli --limit 5  # Extract conversations
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
