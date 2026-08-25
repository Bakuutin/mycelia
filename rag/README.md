# Mycelia RAG

Independent, testable Qdrant projection of Mycelia's MongoDB data. The service
reads MongoDB, writes vectors and payloads to Qdrant, and keeps its own lifecycle,
ledger, checkpoints, and operation history in SQLite. It does not import Mycelia's
backend and never writes to MongoDB.

This module does not use MongoDB Search or `mongot`. Mem0, graph retrieval, and
end-user/database authorization are deliberately separate later integrations.

## Retrieval baseline

- dense: local multilingual
  `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (384 dimensions);
- sparse: local `Qdrant/bm25` with Qdrant IDF modifier;
- hybrid: Qdrant prefetch for both named vectors plus reciprocal-rank fusion (RRF);
- hard payload filters: source kind and overlapping start/end time range;
- sources: `transcriptions`, `messages`, `objects`, and active
  `media_visual_descriptions`.

Model files are cached in `RAG_MODEL_CACHE`. The first rebuild/search that needs a
model may download it; startup and status inspection do not download models.

## Data ownership and lifecycle

MongoDB is the read-only source of truth. Each rebuild creates a new
generation-specific Qdrant collection. It never clears or overwrites the active
collection in place:

1. capture a database-wide change-stream post-batch resume token;
2. `building`: scan the configured source projection and populate a new collection;
3. `catching_up`: run a second full comparison and replay changes from the captured
   token to cover writes that happened during the initial scan;
4. update the `<RAG_COLLECTION_PREFIX>_active` Qdrant alias and drain its call window;
5. atomically persist the resume token and switch the active pointer in SQLite;
6. mark the previous projection `superseded`.

If any build, catch-up, or alias step fails, the old active projection remains the
search target. Superseded and failed Qdrant collections are not deleted
automatically; this makes failures inspectable and cleanup an explicit operation.

After activation, a single database-level MongoDB change stream watches the four
tracked collections with `fullDocument=updateLookup`. Its resume token advances only
after Qdrant and the SQLite ledger have both been updated. A periodic full reconcile
repairs missed updates and deletes. If MongoDB reports lost change-stream history,
the service exposes a degraded state, clears the unusable token, and schedules a
reconcile instead of silently skipping data.

The source Mongo deployment must be a replica set for change streams. Search remains
available from the active Qdrant projection if MongoDB is temporarily unavailable.

At startup, queued/running operations left by a stopped process are marked failed,
non-active `building`/`catching_up` generations are marked error, and the Qdrant
active alias is restored from SQLite's authoritative active pointer. An existing
active projection stays searchable and the lifecycle reports `degraded` until the
interrupted build is inspected or rebuilt.

The active generation fingerprint must match the configured adapter schema,
chunker, dense/sparse models, and dimensions. A mismatch blocks search, reconcile,
and incremental mutation until rebuild activates a compatible generation. MongoDB
drop/rename/invalidate events durably mark reconciliation required before their
resume boundary advances.

## Ports

The container listens on port `8091`. The isolated development mapping is:

| Endpoint | Host port | Container port |
| --- | ---: | ---: |
| RAG API | `48091` | `8091` |
| Qdrant REST and dashboard | `46333` | `6333` |
| Qdrant gRPC | `46334` | `6334` |

These ports are intentionally outside the main Mycelia Docker stack's normal port
set. Do not point commands below at the already-running primary worktree stack.

## Local development

From this directory:

```sh
cp .env.example .env
uv sync --frozen
uv run uvicorn mycelia_rag.app:app --host 127.0.0.1 --port 48091
```

Run checks without Docker or model downloads:

```sh
uv run pytest
uv run ruff check src tests
uv run ruff format --check src tests
```

Build the standalone image from the repository root:

```sh
docker build -t mycelia-rag ./rag
```

The root-level isolated Compose profile supplies Qdrant and the network route to
MongoDB. This module's Dockerfile is self-contained and starts
`mycelia_rag.app:app` on `0.0.0.0:8091`.

## Configuration

See [`.env.example`](.env.example) for all operational defaults. Core settings:

| Variable | Purpose |
| --- | --- |
| `RAG_MONGO_URL` | MongoDB read connection; use a replica-set URI for change streams |
| `RAG_MONGO_DATABASE` | Mycelia database name |
| `RAG_REQUIRE_READONLY_MONGO` | Fail readiness unless Mongo reports only approved read roles |
| `RAG_QDRANT_URL` | Qdrant REST endpoint |
| `RAG_STATE_PATH` | Durable SQLite lifecycle, ledger, and checkpoint file |
| `RAG_MODEL_CACHE` | Durable FastEmbed model cache |
| `RAG_DENSE_MODEL` | Local dense model name |
| `RAG_SPARSE_MODEL` | Local sparse model name |
| `RAG_COLLECTION_PREFIX` | Generation collection and active-alias prefix |
| `RAG_AUTH_MODE` | `none` now, or `internal_token` for bearer-token service auth |
| `RAG_INTERNAL_TOKEN` | Token required by `internal_token` mode |

`RAG_REQUIRE_READONLY_MONGO=false` is the transitional default because the current
deployment does not yet have dedicated database users. The planned migration is:

1. create a MongoDB principal restricted to `read` on the Mycelia database plus the
   minimum change-stream capability;
2. move the RAG service to that URI and set `RAG_REQUIRE_READONLY_MONGO=true`;
3. verify rebuild, incremental update/delete, reconcile, and search contracts using
   the restricted principal;
4. only then make the read-only requirement the deployment default.

No end-user identity is inferred from `RAG_INTERNAL_TOKEN`. End-user authorization
and per-user projections require a separate data-model migration and remain outside
this module.

## HTTP interface

`/health` confirms only that the API process is serving. `/ready` confirms that the
SQLite active pointer refers to an existing compatible Qdrant collection, repairs
its alias, and enforces the optional read-only-principal gate. With that gate off,
MongoDB/change-stream failures degrade freshness but do not make an already-built
search projection unavailable.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | process liveness |
| `GET` | `/ready` | active projection readiness |
| `GET` | `/v1/status` | lifecycle, fingerprints, operation progress, source/checkpoint lag, Qdrant stats |
| `POST` | `/v1/search` | hybrid, semantic, or lexical retrieval |
| `GET` | `/v1/chunks` | inspect active projection payloads (limit 1–200, offset 0–10000) |
| `POST` | `/v1/index/rebuild` | enqueue blue/green rebuild |
| `POST` | `/v1/index/reconcile` | enqueue correctness comparison of active projection |
| `POST` | `/v1/index/pause` | pause index mutations; search continues |
| `POST` | `/v1/index/resume` | resume indexing |

All `/v1/*` routes require `Authorization: Bearer <RAG_INTERNAL_TOKEN>` only when
`RAG_AUTH_MODE=internal_token`. Probe routes are intentionally unauthenticated.

Example rebuild and status:

```sh
curl -s -X POST http://127.0.0.1:48091/v1/index/rebuild \
  -H 'content-type: application/json' \
  -d '{"reason":"initial Qdrant projection"}'
curl -s http://127.0.0.1:48091/v1/status
```

Example hybrid search:

```sh
curl -s -X POST http://127.0.0.1:48091/v1/search \
  -H 'content-type: application/json' \
  -d '{
    "query":"где обсуждали срок проекта",
    "mode":"hybrid",
    "kinds":["transcription","message"],
    "start":"2026-01-01T00:00:00Z",
    "limit":10
  }'
```

Every search response includes `freshness` with lifecycle state, pause flag,
`checkpointState`, last durable database checkpoint time, and observed
change-stream lag. With `RAG_ENABLE_BACKGROUND=false`, checkpoint state is
`disabled`, lag is null, and retrieval is explicitly degraded as a manual snapshot.
The global resume token and all per-source checkpoint positions are committed
together only after Qdrant and the SQLite source/chunk ledger have accepted the
event.

Canonical source links point back into the Mycelia UI:

- transcription: `/transcript?start=<ISO>&end=<ISO>`;
- Mycelia/other message: `/chat/<chatId>` or `/messaging/<chatId>`;
- object: `/objects/<id>`;
- media description: `/media?assetId=<assetId>`.

Errors use one envelope:

```json
{
  "error": {
    "code": "projection_not_ready",
    "message": "no active projection; run rebuild first",
    "details": null
  }
}
```

The generated OpenAPI document at `/openapi.json` is the exact request/response
contract, including nullable status fields and lifecycle enums.

## Operational interpretation

- `empty`: no projection has ever been activated;
- `building` / `catching_up`: a blue/green candidate is being prepared while the
  prior active projection, if any, still serves search;
- `ready`: active vector projection exists and normal freshness mechanisms run;
- `reconciling`: active projection is being compared with MongoDB;
- `paused`: an orthogonal status overlay; indexing/cutover waits at safe gates,
  but search continues;
- `degraded`: search may work, while freshness or a dependency needs attention;
- `error`: no valid active projection is available.

The status response includes stable source-schema, chunker, and model fingerprints,
the generation/build/activation timestamps, high-watermarks, change-stream resume
state, last reconcile time, lag/errors, and Qdrant point/index counts. Together these
show which Mycelia projection is active and how current it is.

## Current limits and future gates

- The catch-up phase combines a pre-build resume boundary, a second bounded full
  comparison, and change replay; it is not a multi-document MongoDB snapshot
  transaction. Events after the final post-batch token are applied to the newly
  active projection by the same durable stream, and periodic reconcile remains the
  correctness backstop.
- BM25 term statistics are maintained by Qdrant's sparse IDF modifier. Changing the
  sparse or dense model creates a different projection fingerprint and requires a
  rebuild.
- Quality acceptance against a representative 150–300 query multilingual dataset is
  a later deployment gate. Unit tests use deterministic fakes and never download
  models or require Docker.
- Mem0, graph RAG, rerankers, ACL filtering, read-only database-user migration, and
  per-user authorization are separate follow-up integrations.
