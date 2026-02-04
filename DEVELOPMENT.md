# Development Guide

This guide is for developers who want to contribute to Mycelia or run it in development mode with hot reload.

## Development Setup

### Option A: Docker with Hot Reload

The fastest way to get a development environment with hot reload:

```bash
# Enable dev mode for both frontend and backend
echo "FRONTEND_MODE=dev" >> .env
echo "BACKEND_TASK=dev" >> .env
docker compose build frontend
docker compose up -d
```

#### Development Mode Variables

| Variable | Default | Dev Value | Effect |
|----------|---------|-----------|--------|
| `FRONTEND_MODE` | `prod` | `dev` | Enables Vite hot reload instead of nginx static build |
| `BACKEND_TASK` | `start` | `dev` | Enables file watcher for auto-restart on code changes |

Both variables are optional and default to production mode if not set.

Note: If you've made changes to the `Dockerfile` or `package.json`/`deno.json` dependencies, you might still need to run `docker compose build` again

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

For local GPU inference:

```bash
cd gpu
docker compose up -d --build
```

See [docs/LLM_DEVELOPER_GUIDE.md](docs/LLM_DEVELOPER_GUIDE.md) for hardware recommendations and model setup.

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
├── gpu/                # GPU inference stack
├── myceliasdk/         # Shared TypeScript myceliasdk
└── docs/               # Additional documentation
```

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes with tests
4. Run linting and type checks
5. Submit a PR

Join the [Discord](https://discord.gg/hPfYbpp2am) for discussions.

