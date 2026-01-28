# Worker Configuration System - Implementation Summary

## What Was Implemented

A simplified worker configuration system that:
1. Uses existing worker schemas as the source of truth
2. Adds a worker discovery/registration system
3. Provides runtime default overrides without code changes
4. Tracks which workers are available

## Key Components

### 1. Workers Collection (`myceliasdk/config.ts`)

```typescript
interface WorkerEntry {
  _id: ObjectId;
  name: string;                        // Worker type
  discovered: boolean;                 // Currently available?
  inputSchema: Record<string, any>;    // JSON Schema
  outputSchema: Record<string, any>;   // JSON Schema
  defaultOverrides?: Record<string, any>; // Runtime overrides
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### 2. Migration (`migrations/0014_add_workers_collection.ts`)

- Creates `workers` collection
- Adds unique index on `name`
- Adds index on `discovered` + `lastSeen`

### 3. Worker Discovery Manager (`app/lib/jobs/worker-discovery.ts`)

```typescript
class WorkerDiscoveryManager {
  registerWorker(name, inputSchema, outputSchema)
  markNotDiscovered(name)
  getDefaultOverrides(name)
  updateDefaultOverrides(name, overrides)
  syncDiscoveredWorkers()  // Called on startup
  getAllWorkers()
}
```

### 4. Startup Integration (`app/lib/jobs/workers.ts`)

```typescript
async function startWorkers() {
  await discoverJobWorkers();
  await workerDiscovery.syncDiscoveredWorkers(); // NEW
  // ... rest of startup
}
```

### 5. Runtime Override Application (`app/lib/jobs/processor.ts`)

```typescript
async function processJob(job) {
  // Get default overrides from workers collection
  const defaultOverrides = await workerDiscovery.getDefaultOverrides(jobType);
  
  // Merge: job data > overrides > schema defaults
  const mergedJobData = { ...job.data };
  if (defaultOverrides) {
    for (const [key, value] of Object.entries(defaultOverrides)) {
      if (!(key in mergedJobData)) {
        mergedJobData[key] = value;
      }
    }
  }
  
  // Pass merged data to worker
  await capability.use({ data: mergedJobData });
}
```

### 6. API Actions (`app/lib/resources/worker.ts`)

Added three new actions to the `jobs` resource:

```typescript
// List all workers with discovery status
{ action: "list_workers" }

// Get default overrides for a worker
{ action: "get_worker_defaults", workerType: "summarization" }

// Update default overrides
{ 
  action: "update_worker_defaults",
  workerType: "summarization",
  defaults: { model: "gpt-4o", temperature: 0.5 }
}
```

## How It Works

### Priority Order

When a job is executed, values are resolved in this order (highest to lowest priority):

1. **Job Data** - Explicit values in the job payload
2. **Default Overrides** - Values from `workers.defaultOverrides` in database
3. **Schema Defaults** - Default values defined in worker's `inputSchema`

### Example Flow

```typescript
// 1. Worker defines schema with defaults
const schema = z.object({
  model: z.string().default("small"),
  temperature: z.number().default(0.7),
  prompt: z.string().default("You are helpful...")
});

// 2. Admin sets override in database
await updateWorkerDefaults("summarization", {
  model: "gpt-4o",
  temperature: 0.5
});

// 3. Job is enqueued with partial data
await enqueueJob({
  type: "summarization",
  temperature: 1.0  // Only temperature specified
});

// 4. Processor merges values
const finalData = {
  type: "summarization",
  model: "gpt-4o",      // From override (not in job data)
  temperature: 1.0,     // From job data (highest priority)
  prompt: "You are..."  // From schema default (not in override or job data)
};

// 5. Worker receives merged data
await worker.use({ data: finalData });
```

## Worker Discovery on Startup

```
1. System starts
2. discoverJobWorkers() finds all workers
3. syncDiscoveredWorkers() runs:
   - Registers each discovered worker in DB
   - Updates inputSchema/outputSchema
   - Sets discovered=true, lastSeen=now
   - Marks workers in DB but not found as discovered=false
4. Workers start processing with their configurations
```

## Example: Adding Defaults to a Worker

### Before

```typescript
export const schema = z.object({
  type: z.literal("summarization"),
  prompt: z.string().optional(),
  model: z.string().optional(),
});

export async function use(job) {
  // Hardcoded fallbacks
  const prompt = job.data.prompt || "You are helpful...";
  const model = job.data.model || "small";
}
```

### After

```typescript
export const schema = z.object({
  type: z.literal("summarization"),
  prompt: z.string()
    .default("You are helpful...")
    .describe("System prompt for summarization"),
  model: z.string()
    .default("small")
    .describe("LLM model alias"),
});

export async function use(job) {
  // Defaults already applied by processor + schema
  const prompt = job.data.prompt;
  const model = job.data.model;
}
```

## Benefits

1. **No Code Changes for Config** - Change defaults via API without redeploying
2. **Clear Priority** - Explicit order: job data > overrides > schema defaults
3. **Discovery Tracking** - Know which workers are available
4. **Schema as Documentation** - Defaults and descriptions in one place
5. **Type Safety** - Zod validates everything
6. **Backward Compatible** - Existing workers continue to work

## Next Steps

### For Each Worker

1. Add `.default()` to schema fields
2. Add `.describe()` for UI documentation
3. Remove hardcoded fallbacks from worker code
4. Test with and without overrides

### For UI

1. Create Worker Settings page
2. Show all workers from `list_workers` action
3. Display schema with current defaults
4. Allow editing `defaultOverrides`
5. Show which fields are overridden vs using schema defaults

### Example UI Flow

```
Settings → Workers → Summarization

Schema Fields:
┌─────────────────────────────────────────────────────┐
│ model (string)                                      │
│ ├─ Schema Default: "small"                          │
│ ├─ Current Override: "gpt-4o" [Reset]              │
│ └─ Description: LLM model alias                     │
│                                                      │
│ temperature (number)                                │
│ ├─ Schema Default: 0.7                              │
│ ├─ Current: 0.7 (using schema default)             │
│ └─ Description: Temperature for generation          │
│                                                      │
│ prompt (string)                                     │
│ ├─ Schema Default: "You are helpful..."            │
│ ├─ Current: "You are helpful..." (using default)   │
│ └─ Description: System prompt                       │
└─────────────────────────────────────────────────────┘

[Reset All to Schema Defaults]
```

## Files Modified/Created

### Created
- `backend/migrations/0014_add_workers_collection.ts`
- `backend/app/lib/jobs/worker-discovery.ts`
- `docs/design/WORKER_CONFIG_SYSTEM_SIMPLIFIED.md`
- `docs/design/WORKER_CONFIG_IMPLEMENTATION_SUMMARY.md` (this file)

### Modified
- `myceliasdk/config.ts` - Added `zWorkerEntry` schema
- `backend/app/lib/jobs/workers.ts` - Added `syncDiscoveredWorkers()` call
- `backend/app/lib/jobs/processor.ts` - Added default override merging
- `backend/app/lib/resources/worker.ts` - Added 3 new API actions
- `backend/workers/summarization.ts` - Added defaults to schema (example)

## Testing

To test the implementation:

```bash
# 1. Run migration
docker compose run --rm backend deno run -A server.ts migrate-up

# 2. Start system
docker compose up

# 3. Check workers were discovered
# Use API or check MongoDB workers collection

# 4. Set an override
curl -X POST http://localhost:5173/api/resources/jobs \
  -H "Authorization: Bearer $MYCELIA_TOKEN" \
  -d '{
    "action": "update_worker_defaults",
    "workerType": "summarization",
    "defaults": { "model": "gpt-4o" }
  }'

# 5. Enqueue a job without model
curl -X POST http://localhost:5173/api/resources/jobs \
  -H "Authorization: Bearer $MYCELIA_TOKEN" \
  -d '{
    "action": "enqueue",
    "data": { "type": "summarization", "start": "...", "end": "..." }
  }'

# 6. Verify job used overridden default (gpt-4o, not "small")
```

## Migration Notes

- Migration 0014 is safe to run multiple times (idempotent)
- Existing jobs continue to work without changes
- Workers without defaults in schema will use empty defaults
- Default overrides are optional - workers work without them
