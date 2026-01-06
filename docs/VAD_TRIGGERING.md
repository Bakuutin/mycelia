# VAD Auto-Triggering System

## Overview

The VAD (Voice Activity Detection) auto-triggering system automatically enqueues VAD jobs when new audio chunks are detected, ensuring continuous processing of audio data without manual intervention.

## Architecture

The system consists of:

1. **Trigger Manager** (`backend/app/lib/jobs/trigger-manager.ts`) - Unified background service that monitors events and enqueues jobs based on capability configurations
2. **Job Capability Config** (`backend/app/workers/vad.ts`) - Defines trigger sources for each job type
3. **Server Integration** (`backend/server.ts`) - Lifecycle management via `triggerManager`

### Component Diagram

```
Audio Chunks Created
       ↓
MongoDB Change Stream → Redis Pub/Sub → Trigger Manager
                                                ↓
                                            (Debounce)
                                                ↓
                                    Check for existing jobs
                                                ↓
                                    Enqueue VAD job (auto-injected principal)
                                                ↓
                                    BullMQ Queue → VAD Worker
```

## Trigger Configuration

Triggering is configured directly in the job capability:

```typescript
// backend/app/workers/vad.ts
export const capability: JobCapability = {
  // ...
  trigger: {
    sources: [
      {
        channel: "mycelia:mongo:audio_chunks",
        name: "auto_new_chunks",
        filter: (payload: any) => 
          payload.event === "mongo.change" && 
          payload.data.operationType === "insert" &&
          payload.data.document && 
          payload.data.document.vad === undefined
      }
    ],
    debounceMs: 5000,
  }
};
```

## Trigger Modes

Jobs track how they were triggered via the `trigger` object:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"manual"` \| `"auto"` | Whether triggered by user or system |
| `reason` | `string` | The reason for the trigger (e.g., `auto_new_chunks`) |
| `principal` | `string` | The ID of the user or system component that initiated the job |

## How It Works

### 1. New Chunk Detection (auto_new_chunks)

When audio chunks are inserted into MongoDB:

1. **MongoDB Change Stream** publishes to Redis channel `mycelia:mongo:audio_chunks`
2. **Trigger Manager** subscribes to this channel as defined in `vad.ts`
3. On receiving an `insert` event for a chunk with `vad: undefined`:
   - Matches the filter in `JobTriggerSource`
   - Debounces (default 5s) to batch rapid insertions
   - Calls `checkAndTrigger(cap, "auto_new_chunks")`

### 2. Duplicate Job Prevention

Before enqueuing, the Trigger Manager checks for existing jobs:

**Implementation** (`backend/app/lib/jobs/trigger-manager.ts`):

```typescript
const activeJobs = await mongo({
  action: "count",
  collection: "jobs",
  query: {
    type: cap.name,
    state: { $in: ["waiting", "active"] },
  },
}) as number;

if (activeJobs >= cap.maxConcurrency) {
  console.log(`[TriggerManager] Max concurrency reached, skipping trigger.`);
  return;
}
```

### 3. Principal Injection

When a job is enqueued, the `principal` is automatically captured:

- **System triggers**: Injected by `TriggerManager` as `server`
- **Manual triggers**: Injected by `JobsResource` using the authenticated user's ID

**Implementation** (`backend/app/lib/jobs/queue.ts`):

```typescript
const triggerWithPrincipal = {
  ...trigger,
  principal: auth.principal,
};

await mongo({
  action: "insertOne",
  collection: "jobs",
  doc: {
    // ...
    trigger: triggerWithPrincipal,
  },
});
```

## Debouncing

To handle rapid chunk insertions efficiently, the system uses a configurable debounce:

```typescript
import { debounce } from "@std/async/debounce";

const DEBOUNCE_MS = trigger.debounceMs || 5000;

const handleTrigger = debounce(async (reason: string) => {
  await this.checkAndTrigger(cap, reason);
}, debounceMs);
```

**Benefits**:
- Batches multiple chunk insertions into a single job
- Reduces job queue overhead
- Prevents job thrashing during bulk imports

## Server Lifecycle Integration

The trigger manager is managed alongside other background services:

### Startup (`backend/server.ts`)

```typescript
await triggerManager.start();
```

### Shutdown (`backend/server.ts`)

```typescript
await triggerManager.stop();
```

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
  limit: 1000,          // Process up to 1000 chunks
  batchSize: 100,       // Process in batches of 100
} as any);
```

## Monitoring

### Logs

The Trigger Manager provides detailed logging:

```
[TriggerManager] Starting trigger manager...
[TriggerManager] Setting up triggers for vad...
[TriggerManager] Subscribing to Redis channel: mycelia:mongo:audio_chunks
[TriggerManager] Redis event on mycelia:mongo:audio_chunks for vad (trigger: auto_new_chunks)
[TriggerManager] Triggering vad job (reason: auto_new_chunks)...
[TriggerManager] Max concurrency (1) reached for vad, skipping trigger.
```

### Key Metrics to Monitor

1. **Job Trigger Frequency** - How often auto-triggers occur
2. **Debounce Effectiveness** - Are batches being created effectively?
3. **Job Queue Depth** - Are jobs processing fast enough?

### Debugging

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
- **Real-time processing**: Reduce `debounceMs` to 2000ms
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
      "limit": 1000
    },
    "trigger": {
      "type": "manual",
      "reason": "web_ui_request"
    }
  }'
```

## Error Handling

The system is designed to be resilient:

- **Redis Failures**: Trigger Manager duplicates connections and handles reconnection logic.
- **Concurrency Control**: Prevents duplicate jobs by checking MongoDB state before enqueuing.
- **Job Errors**: Handled by BullMQ retries and error tracking.

## Related Documentation

- [JOB_QUEUE.md](./JOB_QUEUE.md) - Job queue system architecture
- `backend/app/lib/jobs/trigger-manager.ts` - Implementation
- `backend/app/workers/vad.ts` - VAD job config
- `backend/server.ts` - Server integration

## Changelog

### 2026-01-06 - Unified Trigger System
- Replaced standalone VAD trigger worker with `TriggerManager`
- Implemented `JobTriggerSource` configuration in capabilities
- Added automatic `principal` injection for all jobs
- Simplified trigger schema to `{ type, reason, principal }`
- Standardized debouncing and concurrency control
- Updated documentation and tests
