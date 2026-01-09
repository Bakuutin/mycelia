# Mycelia [preview version]

**Mycelia is your self-hosted AI memory and timeline.**

Capture ideas, thoughts, and conversations in **voice, screenshots, or text**.
Ask anything later — _"What did I say about X last May?" Mycelia tells you, in
your own words.

📍 Local-first · 🔓 Open-source · 📦 Modular · 🛠 Hackable

## Roadmap

**Ready now**

- ✅ Continuous audio ingestion from Apple Voice Memos, Google Drive, and local libraries.
- ✅ Automated pipeline: Speech detection (VAD) and Transcription trigger automatically.
- ✅ Smart chunking, diarization-friendly VAD, and waveform normalization for aligned segments.
- ✅ Speech detection plus Whisper transcription via local or remote servers.
- ✅ Timeline UI with transcript-synced playback, jump controls, and search overlays.
- ✅ Modular resource-based backend for pluggable processors, storage, or prompts.
- ✅ MCP + CLI automation for remote operations and scripting.
- ✅ OAuth2 flows with `.well-known` metadata, JWT login, and token issuance.
- ✅ LLM summarizations and conversation extraction across the stack.
- ✅ MongoDB full-text search alongside GridFS-backed storage.
- ✅ Structured logging and observability for ingestion, STT, and LLM jobs.
- ✅ First-run setup wizard with automatic API key creation and inference provider configuration.

**In Progress**

- 🚧 Chat with your memory via the Friend-Lite companion app + advanced backend (`friend/`) that is wiring semantic memories and wearable capture back into Mycelia.
- 🚧 Streaming ingestion & GPU diarization stack replacing the current batch-only flow (`python/diarization_worker.py`, `diarizator/` Helm charts + WebUI).
- 🚧 Multi-device & multi-modal capture (health, geolocation, photos, sensors) prototyped across `friend/extras/` and `friend/Docs/features.md`.
- 🚧 Semantic search + vector memory integration that connects the Qdrant-backed pipelines in `friend/backends/advanced/` and the OpenMemory MCP bridges into the main timeline.

**Planned / Up Next**

- 🧭 Unified dockerized stack with auto-initialization scripts so `docker compose up` brings up backend, frontend, and Python services (Phase 0 in `docs/DX_ROADMAP.md` & `docs/TASK_BREAKDOWN.md`).
- 🧭 Invite flow and sample data path outlined in `docs/ONBOARDING_FLOW.md` (Phase 1).
- 🧭 Remote GPU support and connection testing UI (Phase 2 in `docs/DX_ROADMAP.md`/`docs/TASK_BREAKDOWN.md`).
- 🧭 LLM provider + model management, aliasing, quotas, and a model selection wiki (Phase 3 plus `docs/PROCESSING_AND_ARTIFACTS.md` + `docs/DX_ROADMAP.md`).
- 🧭 Privacy + usage dashboards, token metering, and formal privacy policy with export/acceptance flows (Phase 4 roadmap).
- 🧭 Processing/artifact templates, batch operations, sharing, and backup/export automation (Phases 5–6; see `docs/PROCESSING_AND_ARTIFACTS.md`).


## 🚀 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

### Setup & Run

```bash
git clone https://github.com/mycelia-tech/mycelia.git
cd mycelia

cp .env.example .env
docker compose pull
docker compose up -d
```

Open [https://localhost:4433](https://localhost:4433) in your browser.

> **Note**: For local development, Mycelia uses a self-signed certificate. You may need to click "Advanced" and "Proceed" in your browser. See [NETWORKING.md](docs/NETWORKING.md) for more details on port configuration and SSL.

### Configuration

When you first open the frontend, you'll be guided through a setup wizard:

1. **Server Connection** (`/setup`) - Connects to the backend and automatically creates your first API key.

2. **Inference Provider** (`/setup/inference`) - Configure your AI inference backend:
   - Managed service at `https://inference.mycelia.tech`
   - Your own local GPU stack (see [GPU README](gpu/README.md))
   - Any OpenAI-compatible API endpoint

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
- Project structure and contributing guidelines

## Contributing

You're welcome to fork, build plugins, suggest features, or break things
(metaphorically, c'mon, it's open source).

- Join the [Discord](https://discord.gg/hPfYbpp2am)
- PRs are welcome

## License

[MIT](./LICENSE)
