# Simplified Worker Configuration System

## Overview

This document describes the **simplified** worker configuration system for Mycelia. Unlike the original complex design with separate settings schemas, this approach uses the worker's existing `inputSchema` as the source of truth and adds a simple override mechanism.

## Core Principles

1. **Workers already define schemas** - Use the existing `inputSchema` from `JobCapability`
2. **Schema defines reasonable defaults** - Add default values directly to the schema
3. **Runtime overrides** - Allow per-worker default overrides that are applied when a job doesn't specify a field
4. **Worker discovery tracking** - Track which workers are discovered and available

## Design

### 1. Workers Collection

A new `workers` collection tracks discovered workers and their default overrides:

```typescript
interface WorkerEntry {
  _id: ObjectId;
  name: string;                        // Worker type (e.g., "summarization")
  discovered: boolean;                 // Currently available?
  inputSchema: Record<string, any>;    // JSON Schema for input
  outputSchema: Record<string, any>;   // JSON Schema for output  
  defaultOverrides?: Record<string, any>; // Runtime overrides for defaults
  lastSeen: Date;                      // Last discovery time
  createdAt: Date;
  updatedAt: Date;
}
```

### 2. Worker Discovery System

**On Startup:**
- System discovers all registered workers
- Registers each worker in the `workers` collection
- Marks workers in DB but not discovered as `discovered: false`

**Purpose:**
- Track which workers are available
- Persist configuration across restarts
- Allow UI to show all workers (even if not currently running)

### 3. Default Override Mechanism

**How it works:**

1. **Schema defaults** - Worker defines defaults in `inputSchema`:
   ```typescript
   // Example: summarization worker
   inputSchema: {
     type: "object",
     properties: {
       model: { type: "string", default: "small" },
       temperature: { type: "number", default: 0.7 },
       prompt: { type: "string", default: "You are helpful..." }
     }
   }
   ```

2. **Runtime overrides** - Stored in `workers.defaultOverrides`:
   ```javascript
   {
     name: "summarization",
     defaultOverrides: {
       model: "gpt-4o",      // Override schema default
       temperature: 0.5      // Override schema default
       // prompt not specified, uses schema default
     }
   }
   ```

3. **Job execution** - When job is processed:
   ```typescript
   // Job data provided
   const jobData = { type: "summarization", temperature: 1.0 };
   
   // Get default overrides from workers collection
   const overrides = { model: "gpt-4o", temperature: 0.5 };
   
   // Merge with priority: job data > overrides > schema defaults
   const finalData = {
     type: "summarization",
     model: "gpt-4o",      // From override (not in job data)
     temperature: 1.0,     // From job data (highest priority)
     prompt: "You are..."  // From schema default (not in overrides or job data)
   };
   ```

**Priority order (highest to lowest):**
1. Job data (explicit values in job payload)
2. Default overrides (from `workers.defaultOverrides`)
3. Schema defaults (from worker's `inputSchema`)

### 4. API Actions

Added to `jobs` resource:

#### List Workers
```typescript
{
  action: "list_workers"
}
// Returns: { workers: WorkerEntry[] }
```

#### Get Worker Defaults
```typescript
{
  action: "get_worker_defaults",
  workerType: "summarization"
}
// Returns: { workerType: string, defaults: Record<string, any> }
```

#### Update Worker Defaults  
```typescript
{
  action: "update_worker_defaults",
  workerType: "summarization",
  defaults: {
    model: "gpt-4o",
    temperature: 0.5
  }
}
// Returns: { success: true, workerType: string, defaults: Record<string, any> }
```

## Implementation Details

### Files Created/Modified

1. **myceliasdk/config.ts** - Added `zWorkerEntry` schema
2. **migrations/0014_add_workers_collection.ts** - Creates workers collection
3. **app/lib/jobs/worker-discovery.ts** - Worker discovery manager (NEW)
4. **app/lib/jobs/workers.ts** - Calls `syncDiscoveredWorkers()` on startup
5. **app/lib/jobs/processor.ts** - Applies default overrides before job execution
6. **app/lib/resources/worker.ts** - Added API actions for managing defaults

### Worker Discovery Manager

```typescript
class WorkerDiscoveryManager {
  // Register a worker when discovered
  async registerWorker(name, inputSchema, outputSchema): Promise<void>
  
  // Mark worker as not discovered (in DB but not running)
  async markNotDiscovered(name): Promise<void>
  
  // Get default overrides for a worker
  async getDefaultOverrides(name): Promise<Record<string, any> | undefined>
  
  // Update default overrides
  async updateDefaultOverrides(name, overrides): Promise<void>
  
  // Sync all discovered workers (called on startup)
  async syncDiscoveredWorkers(): Promise<void>
  
  // Get all workers with discovery status
  async getAllWorkers(): Promise<WorkerEntry[]>
}
```

### Job Processing Flow

```typescript
// In processor.ts
async function processJob(job) {
  // 1. Get default overrides from workers collection
  const defaultOverrides = await workerDiscovery.getDefaultOverrides(job.data.type);
  
  // 2. Merge: only apply overrides if field not in job data
  const mergedJobData = { ...job.data };
  if (defaultOverrides) {
    for (const [key, value] of Object.entries(defaultOverrides)) {
      if (!(key in mergedJobData)) {
        mergedJobData[key] = value;
      }
    }
  }
  
  // 3. Pass merged data to worker
  // Worker's schema defaults are applied by the schema itself
  await capability.use({ data: mergedJobData });
}
```

## Benefits of Simplified Approach

1. **Simpler** - No separate settings schema, uses existing `inputSchema`
2. **Flexible** - Override defaults without changing code
3. **Predictable** - Clear priority: job data > overrides > schema defaults
4. **Discoverable** - Track which workers are available
5. **Minimal changes** - Workers already have schemas, just add defaults
6. **No migration pain** - No complex prompt/settings migration needed

## Example Worker Update

### Before (no defaults):
```typescript
const capability = {
  name: "summarization",
  inputSchema: {
    type: "object",
    properties: {
      model: { type: "string" },
      temperature: { type: "number" }
    }
  },
  use: async (job) => {
    const model = job.data.model || "small"; // Hardcoded fallback
    const temperature = job.data.temperature || 0.7; // Hardcoded fallback
  }
}
```

### After (with defaults):
```typescript
const capability = {
  name: "summarization",
  inputSchema: {
    type: "object",
    properties: {
      model: { 
        type: "string", 
        default: "small"  // Default in schema
      },
      temperature: { 
        type: "number", 
        default: 0.7  // Default in schema
      }
    }
  },
  use: async (job) => {
    // Defaults already applied by processor + schema
    const model = job.data.model;  
    const temperature = job.data.temperature;
  }
}
```

## UI Integration

### Worker Configuration Page

```
Settings → Workers
├── [Worker selector: summarization ▼]
├── Schema fields:
│   ├── model (string) = "gpt-4o" [override] | Default: "small" | Reset
│   ├── temperature (number) = 0.5 [override] | Default: 0.7 | Reset
│   └── prompt (string) = [using default] | Default: "You are..." | Edit
└── [Reset All to Schema Defaults]
```

- Shows all fields from `inputSchema`
- Indicates which fields have overrides
- Shows schema defaults
- Allows resetting individual fields or all fields

## Migration Path

1. ✅ Add workers collection (migration 0014)
2. ✅ Add worker discovery system
3. ✅ Add default override mechanism to processor
4. ✅ Add API actions to jobs resource
5. ⏳ Add defaults to worker schemas (per-worker task)
6. ⏳ Create UI for worker configuration
7. ⏳ (Future) Deprecate legacy `prompts` mapping in config

## Open Questions

**Q: What about complex nested defaults?**  
A: Default overrides support any JSON structure. Use dot notation or nested objects.

**Q: How to handle prompt references (ObjectId vs inline text)?**  
A: Workers can accept either. Schema can define `oneOf: [{ type: "string" }, { $ref: "#/definitions/ObjectId" }]`. Override can be either format.

**Q: Can we reset a single override?**  
A: Yes, set that field to `undefined` or remove it from `defaultOverrides` object.

**Q: What if schema changes after overrides are set?**  
A: Overrides are validated against current schema on update. Invalid overrides are rejected.
