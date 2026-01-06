# VAD Auto-Triggering System

## Overview

The VAD (Voice Activity Detection) auto-triggering system automatically enqueues VAD jobs when new audio chunks are detected or when existing VAD jobs complete, ensuring continuous processing of audio data without manual intervention.

## Architecture

The system consists of:

1. **VAD Trigger Worker** (`backend/app/workers/vad.trigger.ts`) - Background service that monitors for events
2. **Enhanced VAD Job Schema** (`backend/app/workers/vad.ts`) - Tracks trigger source
3. **Server Integration** (`backend/server.ts`) - Lifecycle management

### Component Diagram

```
Audio Chunks Created
       ↓
MongoDB Change Stream → Redis Pub/Sub → VAD Trigger Worker
                                                ↓
                                         (Debounced 5s)
                                                ↓
                                    Check for existing jobs
                                                ↓
                                    Count pending chunks
                                                ↓
                                    Enqueue VAD job
                                                ↓
                                    BullMQ Queue → VAD Worker
                                                ↓
                                    Job Completion Event
                                                ↓
                                    VAD Trigger Worker
                                                ↓
                                    Check for more chunks
                                                ↓
                                    Enqueue next job (if needed)
```

## Trigger Modes

The system supports three trigger modes, tracked in the `trigger` field:

| Mode | Description | Use Case |
|------|-------------|----------|
| `manual` | User-initiated via API | On-demand processing, testing |
| `auto_new_chunks` | Triggered by new chunk insertions | Real-time processing as audio arrives |
| `auto_sequential` | Triggered by job completion | Batch processing continuation |

### Trigger Field Schema

```typescript
trigger: z.enum(["manual", "auto_new_chunks", "auto_sequential"]).default("manual")
```

## How It Works

### 1. New Chunk Detection (auto_new_chunks)

When audio chunks are inserted into MongoDB:

1. **MongoDB Change Stream** publishes to Redis channel `mycelia:mongo:audio_chunks`
2. **VAD Trigger Worker** subscribes to this channel
3. On receiving an `insert` event for a chunk with `vad: undefined`:
   - Triggers `handleNewChunk()`
   - Debounces for 5 seconds (batches rapid insertions)
   - Calls `checkAndTriggerVad("auto_new_chunks")`

**Implementation** (`backend/app/workers/vad.trigger.ts:76-93`):

```typescript
const channel = "mycelia:mongo:audio_chunks";
await subscriber.subscribe(channel, (message: string) => {
  try {
    const payload = JSON.parse(message);
    if (payload.event === "mongo.change" && payload.data.operationType === "insert") {
      const doc = payload.data.document;
      if (doc && doc.vad === undefined) {
        handleNewChunk();
      }
    }
  } catch (error) {
    console.error("[VAD Trigger] Error processing Redis message:", error);
  }
});
```

### 2. Sequential Processing (auto_sequential)

When a VAD job completes:

1. **BullMQ QueueEvents** emits `completed` event
2. **VAD Trigger Worker** listens on `jobs-vad` queue
3. On completion:
   - Logs completion
   - Calls `checkAndTriggerVad("auto_sequential")`
   - Continues processing remaining chunks

**Implementation** (`backend/app/workers/vad.trigger.ts:96-100`):

```typescript
queueEvents = new QueueEvents("jobs-vad", { connection: redis });
queueEvents.on("completed", ({ jobId }) => {
  console.log(`[VAD Trigger] VAD job ${jobId} completed. Checking for more work...`);
  checkAndTriggerVad("auto_sequential");
});
```

### 3. Duplicate Job Prevention

Before enqueuing, the system checks for existing jobs:

**Implementation** (`backend/app/workers/vad.trigger.ts:21-33`):

```typescript
const existingJob = await mongo({
  action: "findOne",
  collection: "jobs",
  query: {
    type: "vad",
    state: { $in: ["waiting", "active"] },
  },
}) as any;

if (existingJob) {
  console.log(`[VAD Trigger] Job already ${existingJob.state}, skipping trigger.`);
  return;
}
```

This ensures:
- No duplicate jobs in queue
- Efficient resource usage
- Clean job tracking

### 4. Pending Chunk Detection

Counts chunks without VAD results:

**Implementation** (`backend/app/workers/vad.trigger.ts:36-40`):

```typescript
const pendingCount = await mongo({
  action: "countDocuments",
  collection: "audio_chunks",
  query: { vad: null },
}) as number;
```

If `pendingCount > 0`, enqueues a VAD job with the specified trigger mode.

## Debouncing

To handle rapid chunk insertions efficiently, the system uses a **5-second debounce** from `@std/async`:

```typescript
import { debounce } from "@std/async/debounce";

const DEBOUNCE_MS = 5000;

const handleNewChunk = debounce(() => {
  checkAndTriggerVad("auto_new_chunks");
}, DEBOUNCE_MS);
```

**Benefits**:
- Batches multiple chunk insertions into a single job
- Reduces job queue overhead
- Prevents job thrashing during bulk imports

**Example**: If 100 chunks arrive within 5 seconds, only ONE job is triggered after the last chunk.

## Server Lifecycle Integration

The VAD trigger worker is managed alongside other background workers:

### Startup (`backend/server.ts:117`)

```typescript
await startWorkers();
await startChangeStreamWorker();
await startAccessLogWorker();
await startVadTriggerWorker();  // NEW
```

### Shutdown (`backend/server.ts:189`)

```typescript
await stopWorkers();
await stopAccessLogWorker();
await stopChangeStreamWorker();
await stopVadTriggerWorker();  // NEW
await shutdownTelemetry();
```

This ensures:
- Worker starts after all dependencies are ready
- Clean shutdown on SIGTERM/SIGINT
- Proper resource cleanup (Redis connections, timers)

## Configuration

### Environment Variables

No additional environment variables required. The system uses existing configuration:

- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` - For Redis pub/sub
- MongoDB connection - Via `getMongoResource()`

### Job Parameters

When auto-triggered, jobs use default parameters:

```typescript
await enqueueJob({
  type: "vad",
  trigger,              // "auto_new_chunks" or "auto_sequential"
  limit: 1000,          // Process up to 1000 chunks
  batchSize: 100,       // Process in batches of 100
} as any);
```

## Monitoring

### Logs

The VAD trigger worker provides detailed logging:

```
[VAD Trigger] Starting VAD trigger worker...
[VAD Trigger] VAD trigger worker started and listening.
[VAD Trigger] Found 450 pending chunks. Triggering VAD job (auto_new_chunks)...
[VAD Trigger] VAD job 67a1b2c3d4e5f6789abcdef0 completed. Checking for more work...
[VAD Trigger] No pending chunks found.
[VAD Trigger] Job already active, skipping trigger.
[VAD Trigger] Stopping VAD trigger worker...
[VAD Trigger] VAD trigger worker stopped.
```

### Key Metrics to Monitor

1. **Pending Chunk Count** - How many chunks are waiting
2. **Job Trigger Frequency** - How often auto-triggers occur
3. **Debounce Effectiveness** - Are batches being created effectively?
4. **Job Queue Depth** - Are jobs processing fast enough?

### Debugging

Enable verbose logging in the worker:

```typescript
// In vad.trigger.ts
console.log(`[VAD Trigger] Chunk inserted:`, doc._id);
console.log(`[VAD Trigger] Debounce timer reset`);
```

Check Redis pub/sub manually:

```bash
redis-cli
SUBSCRIBE mycelia:mongo:audio_chunks
```

## Best Practices

### 1. Monitor Pending Chunk Backlog

If pending chunks grow too large:
- Increase VAD worker concurrency
- Add more VAD workers (horizontal scaling)
- Adjust `limit` and `batchSize` parameters

### 2. Adjust Debounce Timing

For different use cases:
- **Real-time processing**: Reduce `DEBOUNCE_MS` to 2000ms
- **Batch imports**: Increase to 10000ms to create larger batches

### 3. Manual Intervention

To bypass auto-triggering and process specific chunks:

```bash
curl -X POST http://localhost:3000/api/resource/jobs \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "enqueue",
    "data": {
      "type": "vad",
      "trigger": "manual",
      "start": {"$date": "2024-01-01T00:00:00Z"},
      "end": {"$date": "2024-01-01T23:59:59Z"}
    }
  }'
```

### 4. Disable Auto-Triggering

To temporarily disable (e.g., during maintenance):

```typescript
// In server.ts, comment out:
// await startVadTriggerWorker();
```

Or implement a feature flag:

```typescript
const VAD_AUTO_TRIGGER_ENABLED = process.env.VAD_AUTO_TRIGGER !== "false";

if (VAD_AUTO_TRIGGER_ENABLED) {
  await startVadTriggerWorker();
}
```

## Error Handling

The system is designed to be resilient:

### Redis Connection Failures

```typescript
try {
  subscriber = redis.duplicate();
  await subscriber.connect();
} catch (error) {
  console.error("[VAD Trigger] Failed to connect to Redis:", error);
  // Worker won't start, but server continues
}
```

### MongoDB Query Failures

```typescript
try {
  const pendingCount = await mongo({...});
} catch (error) {
  console.error("[VAD Trigger] Error in checkAndTriggerVad:", error);
  // Logs error, but doesn't crash worker
}
```

### BullMQ Event Errors

```typescript
queueEvents.on("error", (error) => {
  console.error("[VAD Trigger] QueueEvents error:", error);
  // Logs but continues listening
});
```

## Performance Considerations

### Resource Usage

- **Redis Connections**: 2 additional connections (subscriber + QueueEvents)
- **Memory**: Minimal (~1-2MB for worker state)
- **CPU**: Negligible (event-driven, no polling)

### Scaling

The trigger worker is **singleton by design**:
- Only one instance should run per deployment
- Running multiple instances will cause duplicate job enqueuing
- Use `isRunning` flag to prevent multiple starts

For multi-instance deployments:
- Run trigger worker on a dedicated "scheduler" instance
- Or use distributed locking (Redis SETNX) to elect a leader

## Future Enhancements

Potential improvements:

1. **Configurable Parameters**
   - Make `limit`, `batchSize`, `DEBOUNCE_MS` configurable via environment or settings

2. **Priority-Based Triggering**
   - High-priority chunks (e.g., from live audio) trigger immediately
   - Low-priority chunks (e.g., bulk imports) batch longer

3. **Intelligent Scheduling**
   - Trigger during off-peak hours for non-urgent chunks
   - Rate-limit job creation during peak usage

4. **Metrics Dashboard**
   - Track trigger frequency, pending chunk trends
   - Alert on backlog growth

5. **Conditional Triggering**
   - Only trigger if pending chunks exceed threshold (e.g., 100+)
   - Skip triggering if system load is high

## Related Documentation

- [JOB_QUEUE.md](./JOB_QUEUE.md) - Job queue system architecture
- `backend/app/workers/vad.trigger.ts` - Implementation
- `backend/app/workers/vad.ts` - VAD job schema
- `backend/server.ts` - Server integration

## Changelog

### 2026-01-06 - Initial Implementation
- Created VAD trigger worker
- Added `trigger` field to VAD job schema
- Integrated with server lifecycle
- Implemented debouncing for new chunks
- Added sequential job triggering
- Documented system architecture and usage
