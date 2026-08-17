# Development Guide

This guide is for developers who want to contribute to Mycelia or run it in
development mode with hot reload.

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

| Variable        | Default | Dev Value | Effect                                                |
| --------------- | ------- | --------- | ----------------------------------------------------- |
| `FRONTEND_MODE` | `prod`  | `dev`     | Enables Vite hot reload instead of nginx static build |
| `BACKEND_TASK`  | `start` | `dev`     | Enables file watcher for auto-restart on code changes |

Both variables are optional and default to production mode if not set. In dev
mode, frontend changes are handled by Vite HMR and backend changes restart the
Deno process through `deno --watch`.

Note: If you've made changes to the `Dockerfile` or `package.json`/`deno.json`
dependencies, you might still need to run `docker compose build` again

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

The dependency watchdog uses its own one-connection MongoDB pool. Long-running
imports and worker rebuilds may make ordinary queries slower, but they must not
starve the watchdog or cause `[SELF-HEAL]` restarts from an application-pool
`connection checkout` timeout.

When a change is not visible:

1. Run `git status --short` and preserve unrelated work from parallel agents.
2. Verify the live bind mounts point at this checkout:

   ```bash
   docker inspect mycelia-backend-1 \
     --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
   docker inspect mycelia-frontend-1 \
     --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
   ```

3. Confirm the effective commands with `docker compose config`: backend must use
   `deno task dev`, while frontend must use `Dockerfile.dev`.
4. Source changes should reload automatically. Changes to Dockerfiles,
   dependencies, Compose configuration, or `.env` require rebuilding or
   recreating the affected service.
5. After recreating frontend or backend, restart nginx because the container IP
   may have changed: `docker compose restart nginx`.
6. Do not restart MongoDB or Redis for an application-code reload.

#### Objects browse and Timeline density rollout

The Objects page does not run MongoDB aggregation pipelines in the browser. Each
section uses the bounded `objects.listCards` action: 9 cards on the first page,
cursor-based pages of up to 30 afterwards, at most two section requests at once,
and a 3-second database deadline. Sections are loaded as they approach the
viewport. Cached type counts refresh separately from the more expensive orphan
count; a failed orphan refresh keeps the last value instead of replacing it with
zero.

Two manual-only Jobs tasks prepare the indexed projections used by this path:

- `objectListCatalogBackfill` fills `_listCategories` in batches of 1000 and
  enables the catalog only after missing/mismatch and legacy-count parity checks
  pass.
- `objectTimelineDensityRebuild` builds the isolated `object_timeline_density`
  projection in 31-day source windows. At a far zoom, the Timeline reads only
  this projection and makes no raw object-list request.

For an existing database, use a controlled rollout:

1. In **Jobs**, pause the `diarization` worker and wait for its active job to
   finish. Pausing prevents new work; it does not kill an active job.
2. Recreate only the changed backend/frontend application services, restart
   nginx, and wait for backend `[READY]`, `/readiness = 200`, and healthy app
   containers. Migrations `0051`, `0052`, and `0053` create the indexes, empty
   projection collections, and durable density queue. `0053` idempotently
   repairs installations that recorded an earlier `0052` before the queue and
   state fields existed. Do not restart MongoDB or Redis.
3. Run one `objectListCatalogBackfill` job. Its `hasMore` continuations drain
   the catalog automatically; verify `object_list_state` has
   `schemaVersion: 1, ready: true` before treating indexed section reads as
   active.
4. Run one `objectTimelineDensityRebuild` job. Enable/accept the far-zoom bars
   only after `object_timeline_density_state._id = "current"` reports
   `ready: true` and `building: false`.
5. Recheck MongoDB load and application readiness, then resume diarization.

Both rebuilds preserve canonical object timestamps. A failed catalog parity
check leaves `ready: false` and `listCards` on its bounded legacy predicate. A
density rebuild never writes the shared Timeline histogram collections.

#### Location import recovery

Location imports use a two-phase `analyze → confirm` contract. Analysis may
stage an original in the `location_files` GridFS bucket, but it does not change
the canonical timeline. Confirmation writes an import in `committing` state,
uses idempotent point upserts, publishes newly-owned points, and only then sets
the import to `parsed`. The location worker also listens for this status update.

Migration `0050_location_import_review.ts` backfills `importIds[]` on legacy
points and marks points whose scalar `importId` has no `location_imports`
document as `visible: false, recoveryState: "orphaned"`. Before repairing a
failed legacy upload:

1. identify the exact import id, GridFS id, point count/hash and time range;
2. create and validate local dumps of `location_points`, `location_imports`,
   `location_files.files` and `location_files.chunks`;
3. re-analyze the original file and confirm it so identical hidden points are
   safely re-owned instead of inserted twice;
4. verify the receipt/counts, processing status and canonical point range;
5. delete only the verified superseded GridFS object. Never infer an orphan or
   delete points by filename/date range alone.

Ports can be customized via environment variables (in `.env` or inline):

| Service           | Variable             | Default |
| ----------------- | -------------------- | ------- |
| **Nginx (Proxy)** | `NGINX_PORT`         | `4433`  |
| **Nginx (HTTP)**  | `NGINX_HTTP_PORT`    | `80`    |
| **Nginx (HTTPS)** | `NGINX_HTTPS_PORT`   | `443`   |
| **Frontend**      | `FRONTEND_PORT`      | `8080`  |
| **Backend**       | `BACKEND_PORT`       | `5173`  |
| **Worker**        | `PYTHON_WORKER_PORT` | `8000`  |
| **Database**      | `MONGO_PORT`         | `27017` |

Example:

```bash
NGINX_PORT=5000 FRONTEND_PORT=3000 BACKEND_PORT=4000 docker compose up -d
```

For more details on networking and SSL setup, see
**[NETWORKING.md](docs/NETWORKING.md)**.

## Parallel Development (Two Branches at Once)

You can work on two branches simultaneously — one instance keeps running
untouched while the other rebuilds. There are two setups, from cheapest to most
isolated.

### Option 1: Second frontend against the shared backend

Best when the second branch only changes frontend code. The Docker stack keeps
serving branch A; branch B runs as a plain local Vite dev server from a git
worktree:

```bash
git worktree add ../mycelia-b my-feature-branch
cd ../mycelia-b/frontend
deno task dev
```

This works without any extra configuration:

- The local Vite server listens on `5180`, which the backend already allows in
  its CORS whitelist (`backend/server.ts`).
- Point the app at the running backend on the `/setup` page — use
  `http://localhost:3210` (the non-HTTPS nginx port).

Limitation: the backend is shared, so backend changes in branch B cannot be
tested this way.

### Option 2: Second full stack (frontend + backend)

Best when the second branch changes backend code. Bind mounts in
`docker-compose.yml` are relative (`./frontend`, `./backend`), so a git worktree
plus a separate Compose project name gives a fully independent stack:

```bash
git worktree add ../mycelia-b my-feature-branch
cd ../mycelia-b
cp ../mycelia/.env .env
```

Create an (uncommitted) `docker-compose.override.yml` in the worktree to remap
the published ports and image tags — both are fixed in `docker-compose.yml` and
would otherwise collide with the first stack:

```yaml
services:
  nginx:
    ports: !override
      - "4434:4433"
      - "3211:80"
  mongo:
    ports: !override
      - "27018:27017"
  frontend:
    image: bakuutin/mycelia-frontend:dev-b
  backend:
    image: bakuutin/mycelia-backend:dev-b
  python-worker:
    image: bakuutin/mycelia-python:dev-b
```

The `!override` tag is required: without it Compose _merges_ the port lists and
the duplicated host ports conflict. The image overrides prevent a rebuild in
stack B from overwriting the `:dev` tags that stack A's next `--force-recreate`
would pick up.

Start the second stack under its own project name:

```bash
docker compose -p mycelia-b up -d --build
```

Stack B is served at `https://localhost:4434` with its own containers, network,
and volumes (`mycelia-b_mongo_data`, `mycelia-b_redis_data`), i.e. a fresh
database — run first-time setup on it. To work with the same data, clone the
primary database into the second stack's volume with `mongodump`/`mongorestore`
rather than sharing the live one.

### Do not share one database between two backends

Running two backends from different branches against the same MongoDB database
(same `DATABASE_NAME`) is unsafe:

- Both run BullMQ workers and periodic triggers (extraction and summarization
  every 5 minutes) and will race to process the same jobs with different branch
  code.
- With separate Redis instances, each backend's watchdog cancels the other's
  Mongo job records as `queue_record_missing`.
- Branches may be at different migration levels, so one backend writes schema
  the other does not know about.

If the stacks must share one `mongod` instance, give each backend its own
`DATABASE_NAME` (e.g. `mycelia_b`). Sharing the Redis instance is not supported
at all — the second stack should always run its own.

### Resource note

Each backend, mongo, and python-worker container is limited to 2 CPUs / 4 GB, so
two full stacks are a significant memory load. If the second branch only touches
frontend code, prefer Option 1.

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

for mycelia url during development use: `http://localhost:3210` (non-https nginx
port)

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
import { Component } from "@/components/Component";
import { useTimeline } from "@/hooks/useTimeline";
import type { TimelineItem } from "@/types/timeline";
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

For diarization, voice enrollment, speaker recognition, and historical backfill:

1. Start Mycelia and apply migrations.
2. Run diarization locally on CPU or remotely on an NVIDIA GPU.
3. Configure and verify the route in Settings → Diarization.
4. Complete missing diarization coverage.
5. Enroll Sky, label validation audio, and calibrate identity matching.
6. Run a bounded identity pilot before historical backfill.

See
[the complete diarization and voice identity runbook](docs/SPEAKER_IDENTIFICATION.md)
for exact commands, UI workflow, safety gates, and troubleshooting.

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

### Queue recovery and process restarts

For unattended local use, prefer the stable runtime (`FRONTEND_MODE=prod` and
`BACKEND_TASK=start`). Use Docker hot reload only while actively editing: Vite
and the Deno watcher consume more memory, and a watcher can keep its container
alive after the child application has failed.

Docker restart policies react to a stopped container, not to an `unhealthy`
status. In `BACKEND_TASK=dev`, Deno's watcher intentionally remains as PID 1
after an application failure and waits for a file change, so Docker cannot
restart it. If unattended recovery matters, use `BACKEND_TASK=start`; after a
source or configuration change, recreate only `backend` and restart `nginx`.

Check the whole stack without changing data:

```bash
docker compose ps
docker compose logs --tail=150 mongo redis backend frontend nginx \
  | rg '\[READY\]|\[WATCHDOG\]|\[SELF-HEAL\]|error|unhealthy|OOM|Killed'
curl -fkSs https://localhost:4433/readiness
```

MongoDB and Redis have Docker health checks, and the backend also waits for the
updates Pub/Sub subscriber to reconcile before becoming ready. Once ready, the
backend checks all three every 30 seconds. After three consecutive failed checks
it logs a `[SELF-HEAL]` record and exits; Docker's `restart: unless-stopped`
policy then starts it again. The backend log also emits `[READY]` only after
workers, periodic triggers, and maintenance are running.

Browser update WebSockets share one process-scoped Redis Pub/Sub connection. The
backend does not become ready until that subscriber passes Redis's ready check.
If Redis reconnects, the hub restores its reference-counted channels and the
frontend invalidates canonical API queries because Pub/Sub cannot replay events
that were emitted during the delivery gap.

Extraction and summarization triggers run every five minutes. Source failures
are retained and retried with bounded exponential backoff:

- conversation extraction: 5 minutes, increasing up to 6 hours;
- summarization content-filter failures: 15 minutes, increasing up to 24 hours;
- completed summarization claims left by an interrupted run are released by
  maintenance once the summary exists.
- active Mongo job records whose BullMQ record disappeared after a process
  restart are cancelled with `queue_record_missing`; summarization claims are
  released and interrupted extraction chunks return to the retry backlog.

Open **Jobs → Pipeline health & recovery** at <https://localhost:4433/jobs>.
`Run now` immediately retries eligible and previously errored source records
(bypassing backoff for that manual run). `Retry one failed` recreates one
historical failed job while preserving the original failure. Resume only the
affected worker if its card says it is paused. Do not use **Reset worker**
merely to retry errors: reset drains live queue state and is reserved for an
explicitly confirmed queue reset.

Restart application code without touching MongoDB or Redis:

```bash
docker compose up -d --build --force-recreate frontend backend
docker compose restart nginx
docker compose ps
docker compose logs --tail=100 backend frontend nginx \
  | rg '\[READY\]|\[WATCHDOG\]|\[SELF-HEAL\]|error'
```

Restart a failed dependency only when its health check or logs identify it:

```bash
docker compose restart redis       # queue unavailable
docker compose restart mongo       # database unavailable
docker compose restart backend     # reconnect workers after dependency recovery
docker compose ps
```

Speech-to-text is a separate external dependency. An unavailable STT provider
blocks transcription but does not block conversation extraction or summarization
when their LLM provider is healthy.

### Automatic pending-work contract

Every worker with a change-event or interval trigger must declare a cheap,
indexed `hasPendingWork` preflight. Its eligibility predicate must be the same
predicate used by batch selection and the final `hasMore` check, including due
retries and stale claims. A scheduled trigger with no eligible source work must
not create a durable job. The registry test enforces this contract for newly
added automatic workers.

Return boolean `true` when the preflight only proves that work exists and every
free concurrency slot may claim independently. Return a number only when it is
an actual estimate of how many jobs are worth starting; returning numeric `1`
deliberately caps each trigger to one new job.

For a historical conversation-chain recovery, use a bounded pilot before opening
the automatic cursor to the full history:

1. Record Mongo pending counts and BullMQ active/waiting state. Do not reset
   MongoDB, Redis, or failed-job history.
2. Enqueue `conversation_chunk_creator` with an explicit `start`/`end` range and
   `force:false`. Confirm that transcriptions gain `chunk_id`, chunks reach
   `completed`/`empty`, and objects plus summaries appear without repeated
   source errors.
3. Preserve the current pause state, pause only the affected conversation
   queues, apply the migration and code, and wait for backend `[READY]`, Docker
   health, `/health=200`, and `/readiness=200`.
4. Resume only queues that were running before the change. Let the automatic
   pending predicate drain the remaining history; do not start a duplicate
   diarization campaign or force-reprocess existing summaries.
5. Finish only when pending work is zero or every remainder is classified as an
   active claim, delayed retry, or terminal failure. Repeating automatic jobs
   with `processed:0` while eligible pending work remains is a contract
   violation, not an idle state.

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
