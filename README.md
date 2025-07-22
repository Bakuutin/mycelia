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

**In Progress**

🫥 MCP

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
deno run -A --env cmd.ts serve
```

## CLI Commands

```bash
# Start the server
deno run -A --env cmd.ts serve

# Import data
deno run -A --env cmd.ts importers run

# Recalculate timeline
deno run -A --env cmd.ts timeline recalculate

# Generate auth tokens
deno run -A --env cmd.ts token create
```

## Contributing

You’re welcome to fork, build plugins, suggest features, or break things
(metaphorically, c'mon, it's open source).

- Join the [Discord](https://discord.gg/hPfYbpp2am)
- PRs are welcome

## License

[MIT](./LICENSE)
