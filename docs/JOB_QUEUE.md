# Job Queue System

Mycelia uses a distributed job queue system with TypeScript workers that can execute tasks locally or delegate to Python workers.

## Architecture

```
Client → Deno Server (BullMQ) → TypeScript Worker ──┐
                ↓                     │             │
            Redis Queue               ▼             ▼
                                Python FastAPI   Internal Task (TypeScript)
                                      │             │
                                      ▼             ▼
                                   MongoDB/Redis/Storage
```

### Components

1. **BullMQ (Redis)** - Job queue and state management
2. **TypeScript Workers** - Job orchestration. Can execute:
   - **Internal Tasks**: Pure TypeScript logic (e.g., database maintenance, histograms)
   - **Python Tasks**: Heavy computation delegation (VAD, STT, diarization)
3. **Python FastAPI** - Heavy AI/ML computation
4. **Redis Streams** - Real-time progress updates
5. **Resources** - MongoDB access via authenticated API

## Quick Start

### 1. Start Deno Server

```bash
cd backend
deno task dev
```

This starts:
- Express API server on port 5173
- BullMQ TypeScript workers
- WebSocket handlers

### 2. Start Python Worker Server (Optional)
Required only for AI/ML tasks (VAD, Transcription, etc.).

```bash
cd python
uv run worker_server.py
```

This starts:
- FastAPI server on port 8000
- VAD, STT, diarization processors

### 3. Enqueue a Job

```bash
curl -X POST http://localhost:5173/api/jobs \
  -H "Authorization: Bearer $MYCELIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "vad",
    "limit": 100
  }'
```

Response:
```json
{
  "success": true,
  "jobId": "67a1b2c3d4e5f6789abcdef0",
  "jobType": "vad"
}
```

### 4. Monitor Progress (SSE)

```bash
curl -N "http://localhost:5173/api/jobs/67a1b2c3d4e5f6789abcdef0/progress?type=vad"
```

Output:
```
data: {"processed":"10","total":"100","hasSpeech":"5","timestamp":"2024-01-15T12:34:56Z"}
data: {"processed":"20","total":"100","hasSpeech":"12","timestamp":"2024-01-15T12:34:57Z"}
...
```

### 5. Check Job Status

```bash
curl "http://localhost:5173/api/jobs/67a1b2c3d4e5f6789abcdef0?type=vad"
```

Response:
```json
{
  "id": "67a1b2c3d4e5f6789abcdef0",
  "type": "vad",
  "state": "completed",
  "progress": {
    "processed": 100,
    "total": 100,
    "hasSpeech": 56
  },
  "result": {
    "processed": 100,
    "hasSpeech": 56,
    "duration": 12.5
  }
}
```

## Job Lifecycle

```
1. WAITING    → Job enqueued in Redis
2. ACTIVE     → TypeScript worker picks up job
3. PROCESSING → IF Python Task: Calls Python FastAPI
                IF Internal Task: Executes TypeScript logic
4. COMPLETED  → Result returned
               → TypeScript updates BullMQ
5. REMOVED    → After retention period
```

## Job Types

All jobs are enqueued via `POST /api/jobs` with `type` field in the request body.

| Type | Backend | Description | Example Body |
|------|---------|-------------|--------------|
| `vad` | Python | Voice Activity Detection | `{"type": "vad", "limit": 1000}` |
| `transcription` | Python | Speech-to-text | `{"type": "transcription", "audioChunkIds": [...]}` |
| `diarization` | Python | Speaker identification | `{"type": "diarization", "start": "...", "end": "..."}` |
| `ingestion` | Python | Audio file processing | `{"type": "ingestion", "sourceId": "..."}` |
| `histRecalculation` | TypeScript | Recalculate timeline histograms | `{"type": "histRecalculation", "start": "...", "end": "..."}` |

## Timeline Histogram Recalculation

Timeline histograms aggregate audio data for visualization. They need recalculation when:
- New audio is imported
- Transcriptions are added
- Data is modified or deleted

### When Histograms Update

**Automatic**: Histograms are NOT automatically recalculated. After importing audio or running STT, you must trigger recalculation.

**Manual**: Use the timeline resource or frontend UI.

### Recalculate via API

Using the `timeline` resource (synchronous):

```bash
# Recalculate last 7 days
curl -X POST http://localhost:5173/api/resource/timeline \
  -H "Authorization: Bearer $MYCELIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "recalculate", "start": "7d", "end": "0d"}'

# Recalculate specific date range
curl -X POST http://localhost:5173/api/resource/timeline \
  -H "Authorization: Bearer $MYCELIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "recalculate", "start": "2024-01-01", "end": "2024-01-31"}'

# Recalculate all data
curl -X POST http://localhost:5173/api/resource/timeline \
  -H "Authorization: Bearer $MYCELIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "recalculate", "all": true}'
```

### Recalculate via Job Queue (async)

For large date ranges, use the job queue:

```bash
curl -X POST http://localhost:5173/api/jobs \
  -H "Authorization: Bearer $MYCELIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "histRecalculation",
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-12-31T23:59:59Z"
  }'
```

### Recalculate via Frontend

1. Select a time range on the timeline
2. Click the **Recalculate** button (refresh icon)

### Invalidate Stale Data

Mark bins as stale (pink) without recalculating:

```bash
curl -X POST http://localhost:5173/api/resource/timeline \
  -H "Authorization: Bearer $MYCELIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "invalidate", "start": "7d", "resolution": "5min"}'
```

## Configuration

### Environment Variables

**TypeScript (Deno):**
```bash
PYTHON_WORKER_URL=http://localhost:8000  # Python FastAPI URL (Optional if using only TS jobs)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

**Python:**
```bash
MYCELIA_URL=http://localhost:5173        # TypeScript API URL
MYCELIA_API_KEY=your_api_key            # For progress callbacks
PORT=8000
```

### Job Options

When enqueuing jobs:

```typescript
await enqueueJob(data, {
  priority: 1,        // Higher = more priority
  jobId: "custom",    // Optional, defaults to ObjectId
});
```

### Worker Concurrency

Edit `backend/app/lib/jobs/queue.ts`:

```typescript
export function createWorker(type: JobType, processor) {
  return new Worker(getQueueName(type), processor, {
    connection: redis,
    concurrency: 4,  // Change this
  });
}
```

## TypeScript-only Jobs

Some jobs are executed entirely within the TypeScript environment and do not require the Python worker. These are useful for:
- Database maintenance
- Data aggregation (e.g., histograms)
- File management cleanup
- Lightweight processing

Example Implementation (`backend/app/lib/jobs/processor.ts`):

```typescript
export async function processJob(job: Job<JobData>): Promise<JobResult> {
  const jobType = job.data.type;

  if (jobType === "histRecalculation") {
    // Execute pure TypeScript logic
    const auth = await getServerAuth();
    await updateAllHistogram(auth, job.data.start, job.data.end);
    return { success: true };
  }

  // Fallback to Python worker
  // ...
}
```

## Progress Callbacks

Python workers send progress updates:

```python
progress_callback({
    "processed": 50,
    "total": 100,
    "currentItem": "chunk_abc123",
    "customField": "anything",
})
```

This triggers:
1. `POST /api/resource/worker_progress` (authenticated)
2. Updates BullMQ job progress
3. Publishes to Redis Stream: `progress:{type}:{jobId}`
4. Clients receive via SSE

## Error Handling

### Retries

Jobs automatically retry on failure:
- 3 attempts max
- Exponential backoff (2s, 4s, 8s)

### Failed Jobs

Query failed jobs:

```bash
curl "http://localhost:5173/api/jobs/{jobId}?type=vad"
```

Response for failed job:
```json
{
  "state": "failed",
  "failedReason": "Python worker failed (500): Division by zero",
  "attemptsMade": 3,
  "timestamp": 1705320896000,
  "failedOn": 1705320920000
}
```

### Manual Retry

Failed jobs can be retried:

```typescript
const queue = getQueue("vad");
const job = await queue.getJob(jobId);
await job.retry();
```

## Monitoring

### Redis CLI

```bash
redis-cli

# List waiting jobs
LRANGE bull:jobs:vad:wait 0 -1

# List active jobs
LRANGE bull:jobs:vad:active 0 -1

# Get job details
HGETALL bull:jobs:vad:67a1b2c3d4e5f6789abcdef0

# View progress stream
XREAD STREAMS progress:vad:67a1b2c3d4e5f6789abcdef0 0
```

### BullMQ Dashboard

Install Bull Board (optional):

```bash
npm install @bull-board/express bullmq
```

Add to server:

```typescript
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [new BullMQAdapter(vadQueue)],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());
```

Visit: `http://localhost:5173/admin/queues`

## Best Practices

### 1. Keep Jobs Idempotent

Jobs should be safely retryable:

```python
# Bad - not idempotent
def process_job(data):
    count = get_count()
    set_count(count + 1)

# Good - idempotent
def process_job(data):
    mark_as_processed(data.item_id)
```

### 2. Send Progress Regularly

Update progress every ~30 items or 5 seconds:

```python
for i, item in enumerate(items):
    process_item(item)

    if i % 30 == 0:
        progress_callback({"processed": i})
```

### 3. Use Batch Operations

MongoDB bulk operations are faster:

```python
# Good
apply_updates([
    (id1, update1),
    (id2, update2),
])

# Bad
for id, update in updates:
    mongo.updateOne(id, update)
```

### 4. Set Appropriate Limits

Don't process unlimited data in one job:

```python
# Request with limit
{
  "limit": 1000,
  "batchSize": 100
}
```

### 5. Clean Up Resources

```python
try:
    model = load_model()
    result = process(model, data)
finally:
    cleanup_model(model)
```

## Scaling

### Horizontal - More Workers

TypeScript (in server process):
```typescript
// Edit backend/app/lib/jobs/workers.ts
const JOB_TYPES = ["vad", "transcription", "diarization", "histRecalculation"];

// Each type gets its own worker
// Run multiple Deno server instances
```

Python (separate processes):
```bash
# Terminal 1
PORT=8000 python3 worker_server.py

# Terminal 2
PORT=8001 python3 worker_server.py

# Use load balancer
export PYTHON_WORKER_URL=http://lb:80
```

### Vertical - More Resources

```bash
# TypeScript: More concurrent jobs per worker
concurrency: 8

# Python: GPU acceleration
export CUDA_VISIBLE_DEVICES=0,1
```

## Debugging

### Enable Debug Logs

TypeScript:
```typescript
worker.on("active", (job) => {
  console.log(`[DEBUG] Processing ${job.id}`);
});
```

Python:
```python
logging.basicConfig(level=logging.DEBUG)
```

### Test Jobs Manually

Python without TypeScript:
```bash
curl -X POST http://localhost:8000/jobs/vad \
  -H "Content-Type: application/json" \
  -d '{"jobId": "test", "data": {"limit": 5}}'
```

TypeScript without Python:
```typescript
const result = await processJob(job);
// Mock Python response
```

## See Also

- [WORKER_SERVER.md](../python/WORKER_SERVER.md) - Python FastAPI details
- [BullMQ Docs](https://docs.bullmq.io/) - Queue documentation
- [FastAPI Docs](https://fastapi.tiangolo.com/) - Python framework
