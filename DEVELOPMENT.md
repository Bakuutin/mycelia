# Development Guide

This guide is for developers who want to contribute to Mycelia or run it in development mode with hot reload.

## Development Setup

### Option A: Docker with Hot Reload

The fastest way to get a development environment with hot reload:

```bash
# Set exactly one value for each key in .env:
# FRONTEND_MODE=dev
# BACKEND_TASK=dev

FRONTEND_MODE=dev BACKEND_TASK=dev \
  docker compose up -d --build --force-recreate frontend backend
docker compose restart nginx
```

#### Development Mode Variables

| Variable | Default | Dev Value | Effect |
|----------|---------|-----------|--------|
| `FRONTEND_MODE` | `prod` | `dev` | Enables Vite hot reload instead of nginx static build |
| `BACKEND_TASK` | `start` | `dev` | Enables file watcher for auto-restart on code changes |

Both variables are optional and default to production mode if not set. In dev
mode, frontend changes are handled by Vite HMR and backend changes restart the
Deno process through `deno --watch`.

Note: If you've made changes to the `Dockerfile` or `package.json`/`deno.json` dependencies, you might still need to run `docker compose build` again

#### Readiness and reload diagnostics

Container `running` status is not sufficient evidence that the application has
loaded its current source. Follow the readiness logs and Docker health state:

```bash
docker compose ps
docker compose logs -f frontend backend \
  | rg --line-buffered '\[SERVICE\]|\[READY\]|ready in|Restarting'

curl -fsS http://localhost:3210/ >/dev/null
curl -fkSs https://localhost:4433/health >/dev/null
```

Expected readiness records:

```text
[READY] frontend ready mode=development hmr=enabled ...
[READY] backend ready mode=dev workers=true ... readiness=/readiness ...
```

The backend `/readiness` endpoint returns `503` while resources and workers are
starting and `200` only after workers, triggers, and maintenance have started.
An ordinary frontend `src/` edit uses HMR without a full restart. Editing
`vite.config.ts` restarts Vite and can briefly return `502` until the next
frontend `[READY]` record. A backend source edit restarts the Deno process and
may keep `/readiness` unavailable while worker startup checks run.

When a change is not visible:

1. Run `git status --short` and preserve unrelated work from parallel agents.
2. Verify the live bind mounts point at this checkout:

   ```bash
   docker inspect mycelia-backend-1 \
     --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
   docker inspect mycelia-frontend-1 \
     --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
   ```

3. Confirm the effective commands with `docker compose config`: backend must
   use `deno task dev`, while frontend must use `Dockerfile.dev`.
4. Source changes should reload automatically. Changes to Dockerfiles,
   dependencies, Compose configuration, or `.env` require rebuilding or
   recreating the affected service.
5. After recreating frontend or backend, restart nginx because the container IP
   may have changed: `docker compose restart nginx`.
6. Do not restart MongoDB or Redis for an application-code reload.

Ports can be customized via environment variables (in `.env` or inline):

| Service | Variable | Default |
|---------|----------|---------|
| **Nginx (Proxy)** | `NGINX_PORT` | `4433` |
| **Nginx (HTTP)** | `NGINX_HTTP_PORT` | `80` |
| **Nginx (HTTPS)** | `NGINX_HTTPS_PORT` | `443` |
| **Frontend** | `FRONTEND_PORT` | `8080` |
| **Backend** | `BACKEND_PORT` | `5173` |
| **Worker** | `PYTHON_WORKER_PORT` | `8000` |
| **Database** | `MONGO_PORT` | `27017` |

Example:
```bash
NGINX_PORT=5000 FRONTEND_PORT=3000 BACKEND_PORT=4000 docker compose up -d
```



For more details on networking and SSL setup, see **[NETWORKING.md](docs/NETWORKING.md)**.

## Frontend Development

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

# Build for production
deno task build

# Preview production build
deno task preview
```

for mycelia url during development use: `http://localhost:3210` (non-https nginx port)

### Tech Stack
- **Deno** runtime with npm compatibility
- **React 18** + TypeScript
- **Vite** for build tooling
- **Zustand** for state management
- **D3.js** for timeline visualization
- **Tailwind CSS v4** for styling
- **Radix UI** for accessible components

### Import Conventions

Use `@/` alias for all imports (configured in `deno.json`):

```typescript
import { Component } from '@/components/Component'
import { useTimeline } from '@/hooks/useTimeline'
import type { TimelineItem } from '@/types/timeline'
```

## Backend Development

```bash
cd backend

# Start development server
deno task dev

# Create an API token
deno run -A server.ts token-create
```


## Inference Stack (GPU)

For local GPU inference (Whisper, Ollama, Diarization):

```bash
cd gpu

# Create .env with required tokens
echo "HF_TOKEN=your_huggingface_token" >> .env
echo "PROXY_API_KEY=your_api_key" >> .env

# Start all services
docker compose up -d --build
```

See [gpu/README.md](gpu/README.md) for detailed setup and VRAM requirements.

## Speaker Identification

For voice enrollment and speaker recognition:

1. Deploy diarization service on GPU (see above)
2. Run migrations: `docker compose exec backend deno run -A server.ts migrate-up`
3. Enable feature flag in Settings → Feature Flags
4. Enroll voices in Settings → Voice Profiles

See [docs/SPEAKER_IDENTIFICATION.md](docs/SPEAKER_IDENTIFICATION.md) for the full guide.

## Database Migrations

Migrations are in `backend/migrations/`. Apply them with:

```bash
# Check status
docker compose exec backend deno run -A server.ts migrate-status

# Apply all pending
docker compose exec backend deno run -A server.ts migrate-up

# Rollback last migration
docker compose exec backend deno run -A server.ts migrate-down
```

See [docs/MIGRATIONS.md](docs/MIGRATIONS.md) for details.

## Troubleshooting

### FFmpeg Import Errors

1. Check `~/Library/mycelia/logs/daemon.log` for details
2. Common causes:
   - Corrupted audio file
   - Unsupported codec
   - File permission issues (grant Full Disk Access)
3. Failed files auto-retry after 2 hours

### macOS Full Disk Access

Required for accessing Voice Memos:
1. System Settings → Privacy & Security → Full Disk Access
2. Add your terminal app (Terminal, iTerm, VS Code, etc.)
3. Restart the terminal

## Project Structure

```
mycelia/
├── frontend/           # React SPA (Deno + Vite)
│   ├── src/
│   │   ├── components/ # Reusable UI components
│   │   ├── pages/      # Route page components
│   │   ├── hooks/      # Custom React hooks
│   │   ├── stores/     # Zustand state stores
│   │   ├── lib/        # Utilities (API client, auth)
│   │   ├── modules/    # Feature modules
│   │   └── types/      # TypeScript definitions
│   ├── Dockerfile.dev  # Dev server with hot reload
│   └── Dockerfile.prod # Production nginx build
├── backend/            # Deno API server
├── python/             # Audio import, STT, conversation extraction
├── diarizator/         # Speaker diarization service (FastAPI)
├── friend/             # Friend-Lite companion app
├── gpu/                # GPU inference stack
├── myceliasdk/         # Shared TypeScript SDK
├── misc/               # Infrastructure configs (nginx, mongo)
└── docs/               # Additional documentation
```

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes with tests
4. Run linting and type checks
5. Submit a PR

Join the [Discord](https://discord.gg/hPfYbpp2am) for discussions.
