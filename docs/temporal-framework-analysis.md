# Temporal.io Framework Analysis for Mycelia

## Executive Summary

This document analyzes the suitability of [Temporal.io](https://temporal.io/) as a replacement for the current BullMQ + Redis job orchestration system in Mycelia. The analysis covers the current architecture, how Temporal would map to existing concepts, benefits, drawbacks, and implementation steps.

**Recommendation: Don't switch to Temporal at this stage.** The current BullMQ-based system is well-suited for Mycelia's primarily linear, batch-oriented audio processing pipeline. The main pain points (lack of end-to-end visibility, single-attempt retries) can be solved incrementally without the infrastructure and complexity overhead of Temporal.

---

## Current Architecture

### Technology Stack
- **Job Queue**: BullMQ (^5.47.1) backed by Redis
- **Persistent Storage**: MongoDB (jobs, job_logs, workers collections)
- **Worker Execution**: Deno subprocesses with JWT-scoped access, 15-minute timeout
- **Event System**: Redis pub/sub for triggers + WebSocket to frontend
- **Trigger System**: Event-driven (Redis pub/sub) + interval-based polling (30s-300s)

### Job Lifecycle
```
[waiting] → [active] → [completed]
                     → [failed]
         → [cancelled]
```

Jobs are dual-stored in BullMQ (execution) and MongoDB (persistence/history). State transitions emit Redis pub/sub events that reach the frontend via WebSocket.

### Key Files
| File | Purpose |
|------|---------|
| `backend/app/lib/jobs/queue.ts` | BullMQ queue setup, job enqueueing |
| `backend/app/lib/jobs/workers.ts` | Worker creation, state transitions, hasMore chaining |
| `backend/app/lib/jobs/processor.ts` | Deno subprocess spawning, 15-min timeout |
| `backend/app/lib/jobs/trigger-manager.ts` | Event-driven + interval triggers |
| `backend/app/lib/jobs/maintenance-manager.ts` | Timeout detection, orphan recovery |
| `backend/app/lib/jobs/job-registry.ts` | Auto-discovery and registration of workers |
| `backend/app/lib/resources/worker.ts` | REST API for jobs (enqueue, cancel, list, etc.) |

### "Batches" (Implicit)
No explicit Batch entity exists. Batching is handled through job parameters (`limit`, `batchSize`). Each worker processes N items per invocation.

### "Bundles" (Implicit via `hasMore`)
No explicit Bundle entity exists. When a job returns `hasMore: true`, the system auto-enqueues another job of the same type (workers.ts:119-124), creating a self-continuing chain until all work is drained.

### Audio Processing Pipeline
```
Audio Upload → Audio Chunks
                   ↓ (Redis event trigger, debounce 1000ms)
                 [VAD]
                   ↓ (hasMore chaining if needed)
           Transcription Sequences
                   ↓ (Redis event trigger, debounce 1000ms)
             [Transcription]
                   ↓ (hasMore chaining)
              Transcriptions
                   ↓ (Redis event trigger, debounce 2000ms)
        [Conversation Chunk Creator]
                   ↓ (hasMore chaining)
           Conversation Chunks
                   ↓ (Redis event trigger, debounce 5000ms)
        [Conversation Extractor]
                   ↓
        Conversations + Entities
```

### Current Strengths
1. **Simplicity** — Entire job system is ~800 lines of core code
2. **Loose coupling** — Each pipeline stage is independent
3. **Subprocess isolation** — Workers run in sandboxed Deno processes
4. **Self-healing** — Maintenance manager recovers orphaned jobs every 60s
5. **Low infrastructure** — Only Redis needed on top of existing MongoDB

### Current Weaknesses
1. **No end-to-end visibility** — Cannot easily answer "what happened to audio file X?"
2. **No compensation/rollback** — Failed steps leave orphaned data
3. **Fragile chaining** — `hasMore` is a simple boolean; no complex branching
4. **No cross-job correlation** — No pipelineRunId or parent-child relationships
5. **Single retry attempt** — `attempts: 1` with no backoff
6. **No priority system** — FIFO only
7. **Hard 15-minute timeout** — No checkpointing for long jobs

---

## How Temporal Would Map to Mycelia

### Concept Mapping
| Temporal Concept | Mycelia Equivalent | What Changes |
|---|---|---|
| **Workflow** | Implicit pipeline (event triggers + hasMore) | Explicit code-defined orchestration |
| **Activity** | Worker processor (Deno subprocess) | Same work, Temporal activity interface |
| **Task Queue** | BullMQ queue (`jobs-{type}`) | Temporal task queues |
| **Worker** | BullMQ worker + processor.ts | Temporal worker process |
| **Event History** | MongoDB jobs + job_logs | Automatic event sourcing |
| **Signal** | Redis pub/sub events | Temporal signals |
| **Query** | MongoDB job state queries | Temporal queries |
| **Timer** | Interval triggers + debounce | Native workflow timers |
| **Child Workflow** | hasMore self-re-enqueue | Child workflows or continueAsNew |

### Pipeline as Temporal Workflow (Conceptual)
```typescript
async function processAudioWorkflow(input: { audioFileId: string }) {
  // Step 1: Voice Activity Detection
  const vadResult = await executeActivity('vad', {
    audioFileId: input.audioFileId,
  }, { startToCloseTimeout: '15m', retry: { maximumAttempts: 3 } });

  // Step 2: Create transcription sequences
  const sequences = await executeActivity('transcriptionSequenceCreator', {
    audioFileId: input.audioFileId,
  });

  // Step 3: Fan out to parallel transcription
  const transcriptionPromises = sequences.map(seq =>
    executeChildWorkflow('transcribeSequence', { sequenceId: seq.id })
  );
  const transcriptions = await Promise.all(transcriptionPromises);

  // Step 4: Create conversation chunks
  const chunks = await executeActivity('conversationChunkCreator', {
    transcriptionIds: transcriptions.map(t => t.id),
  });

  // Step 5: Extract conversations
  await executeActivity('conversationExtractor', {
    chunkIds: chunks.map(c => c.id),
  });
}
```

### Batches in Temporal
```typescript
// Replace hasMore with explicit loop + continueAsNew
async function batchProcessWorkflow(input) {
  let cursor = undefined;
  let eventsProcessed = 0;
  do {
    const result = await executeActivity('processBatch', {
      ...input, cursor, batchSize: 100,
    });
    cursor = result.nextCursor;
    eventsProcessed += result.processed;
    if (eventsProcessed > 5000) {
      await continueAsNew({ ...input, cursor });
    }
  } while (cursor);
}
```

---

## Benefits of Temporal

1. **End-to-end workflow visibility** — Each audio file gets a workflow ID; query its exact state at any point
2. **Automatic retries with backoff** — Configurable per activity (initialInterval, backoffCoefficient, maximumAttempts)
3. **Durable execution** — Worker crash mid-transcription → resume at that step, not from scratch
4. **Saga pattern for compensation** — If extraction fails, clean up orphaned chunks automatically
5. **Native fan-out/fan-in** — Parallel transcription of sequences (currently sequential via hasMore)
6. **Explicit pipeline definition** — Pipeline is code, not implicit event wiring
7. **Long-running workflows** — Workflows can run for days/months; timeout is per-activity
8. **Built-in observability** — Temporal UI shows all workflow executions, states, and event histories

## Drawbacks of Temporal

1. **Significant infrastructure overhead** — Adds Temporal Server + PostgreSQL + Temporal UI (4+ extra services, 2-4GB extra RAM)
2. **Deno incompatibility** — Temporal TS SDK depends on Node.js internals (worker_threads, vm, async_hooks). Mycelia runs on Deno. Requires a separate Node.js service or backend port.
3. **Determinism constraints** — Workflows must be deterministic (no random, no Date.now(), no direct I/O)
4. **Steep learning curve** — ~1 month to productivity; event sourcing + replay model is non-trivial
5. **Loss of subprocess isolation** — Temporal activities run in the worker process; need alternative isolation strategy
6. **Event trigger rearchitecture** — Redis pub/sub trigger system needs replacement with Temporal workflow starts
7. **Dual persistence** — PostgreSQL for Temporal + MongoDB for application data
8. **Over-engineering risk** — Pipeline is linear and batch-oriented; doesn't need saga patterns or month-long durability

---

## Recommendation

**Don't switch to Temporal at this stage.** Instead, address pain points incrementally:

1. Add a `pipelineRunId` to correlate jobs across the pipeline → end-to-end visibility
2. Add configurable retry policies to BullMQ jobs (BullMQ supports this natively)
3. Add job priority support (BullMQ supports priorities 1-2,097,152)
4. Consider Temporal if workflows become genuinely complex (branching, human-in-the-loop, multi-day)

---

## Implementation Steps (If Proceeding)

### Phase 0: Proof of Concept
1. Add Temporal Server + PostgreSQL + Temporal UI to docker-compose.yml
2. Create a separate Node.js temporal-worker service (due to Deno incompatibility)
3. Implement one workflow (audio processing pipeline) where activities delegate to existing backend APIs

### Phase 1: Bridge Layer
4. Create event bridge (MongoDB change streams → Temporal workflow starts)
5. Keep BullMQ running for non-migrated jobs; run both systems in parallel

### Phase 2: Migrate Workers
6. Convert each worker to a Temporal activity (VAD, transcription, chunk creator, extractor)
7. Replace hasMore logic with workflow-level loops + continueAsNew
8. Remove trigger-manager.ts; replace with Temporal workflow starts

### Phase 3: Frontend Integration
9. Update JobsPage.tsx to query Temporal workflow states (or use Temporal UI)
10. Bridge Temporal workflow state changes to frontend WebSocket events

### Phase 4: Cleanup
11. Remove BullMQ dependency and related code
12. Remove dual MongoDB job storage
13. Evaluate Redis role (still needed for pub/sub, caching, sessions)
