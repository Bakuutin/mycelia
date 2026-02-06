---
# No paths = applies globally (always)
---

# Dev Environment (Docker)

- **Frontend and backend run in Docker** with hot reload (frontend and backend dirs are volume-mounted).
- **Assume they are already running.** You can check the app in the browser or hit APIs without starting anything.
- **Only if services are not running:** run `docker compose up -d`. Do not start frontend/backend manually outside Docker for normal dev.

## Path Conventions

- **Always use generic paths in examples and documentation** - use `~` (tilde) for home directory instead of user-specific absolute paths like `/Users/pk`.
- Examples: `~/.mycelia/data/mongo` instead of `/Users/pk/.mycelia/data/mongo`
- This applies to `.env.example`, documentation, comments, and any example code.

## Server Endpoints & Ports

### Development Server Types

| Server Type | Endpoint | Use Case |
|-------------|----------|----------|
| **Docker (default)** | `https://localhost:4433` | Standard development with Docker Compose |
| **Deno (local dev)** | `http://localhost:5173` | Running backend directly with `deno task dev` |

### Port Reference

| Port | Service | Notes |
|------|---------|-------|
| `4433` | Caddy (HTTPS proxy) | Main entry point for Docker dev, serves frontend + proxies API |
| `5173` | Backend (Deno) | Direct backend access when running `deno task dev` |
| `5180` | Frontend (Vite) | Direct frontend dev server (if running outside Docker) |
| `27017` | MongoDB | Database |

### Hot Reload

Both frontend and backend support hot reload in Docker:
- **Frontend**: Vite HMR - changes reflect instantly in browser
- **Backend**: Deno watch mode - server restarts on file changes

### Testing Server Connectivity

The Setup page (`/setup`) includes a **Test Server** button that:
- Auto-tests connectivity when the endpoint is changed
- Shows green wifi icon + "Server is reachable" on success
- Shows red wifi icon + error message on failure
- Detects 502 errors as "Backend server is not running"

### First-Time Setup

When clicking "First-time setup", the app sends browser info in the token name (e.g., `Chrome-2026-02-05`) for identifying which browser/session created the credentials.

To generate credentials via CLI:
```bash
# Docker
docker compose exec backend deno run -A server.ts token-create --name <your-name>

# Local Deno
cd backend && deno run -A server.ts token-create --name <your-name>
```
