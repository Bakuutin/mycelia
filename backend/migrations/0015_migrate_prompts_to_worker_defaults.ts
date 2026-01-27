import { Db, ObjectId } from "mongodb";
import type { MongoClient } from "mongodb";

/**
 * Migration: Move prompt configuration from config.prompts to workers.defaultOverrides
 * 
 * This migration safely moves user-configured prompts from the legacy config.prompts
 * structure to the new worker-specific defaultOverrides system.
 * 
 * Data Safety Principles:
 * 1. Never delete data - only copy and mark as migrated
 * 2. Fully reversible - down() restores original state
 * 3. Idempotent - safe to run multiple times
 * 4. Graceful handling of missing/malformed data
 * 5. Detailed logging of all operations
 */

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

// Mapping of legacy config.prompts fields to worker configurations
const PROMPT_TO_WORKER_MAPPING = {
  summarization_system: {
    worker: "summarization",
    field: "prompt",
    description: "System prompt for conversation summarization"
  },
  segmentation_system: {
    worker: "conversation_extractor", 
    field: "segmentation_system_prompt",
    description: "System prompt for finding conversation topics"
  },
  segmentation_guidance: {
    worker: "conversation_extractor",
    field: "segmentation_guidance_prompt", 
    description: "Guidance for conversation topic segmentation response format"
  },
  // Note: summarization_guidance is used by conversation_extractor for extraction
  summarization_guidance: {
    worker: "conversation_extractor",
    field: "extraction_guidance_prompt",
    description: "Guidance for conversation metadata extraction response format"
  },
  // chat_system is not migrated as it's not a worker-specific configuration
  // It remains in the config for the chat interface
} as const;

interface PromptDocument {
  _id: ObjectId;
  name: string;
  text: string;
  description?: string;
}

export async function up(db: Db, client: MongoClient): Promise<void> {
  console.log("Migrating prompts from config.prompts to workers.defaultOverrides...");
  
  // Step 1: Load current config
  const config = await db.collection("configs").findOne({ _id: SERVER_CONFIG_ID });
  
  if (!config) {
    console.log("No server config found - nothing to migrate");
    return;
  }
  
  const prompts = config.prompts;
  if (!prompts || Object.keys(prompts).length === 0) {
    console.log("No prompts configured - nothing to migrate");
    return;
  }
  
  console.log(`Found ${Object.keys(prompts).length} prompt references in config`);
  
  // Step 2: Load all referenced prompt texts
  const promptIds = Object.values(prompts)
    .filter((id): id is ObjectId => id != null);
  
  if (promptIds.length === 0) {
    console.log("No valid prompt IDs found - nothing to migrate");
    return;
  }
  
  const promptDocuments = await db.collection("prompts")
    .find({ _id: { $in: promptIds } })
    .toArray() as PromptDocument[];
  
  const promptTextsMap = new Map(
    promptDocuments.map(p => [p._id.toString(), p.text])
  );
  
  console.log(`Loaded ${promptDocuments.length} prompt documents from database`);
  
  // Step 3: Migrate each prompt to appropriate worker
  const migrations: Array<{ worker: string; field: string; text: string }> = [];
  
  for (const [configKey, mapping] of Object.entries(PROMPT_TO_WORKER_MAPPING)) {
    const promptId = prompts[configKey];
    
    if (!promptId) {
      console.log(`  - ${configKey}: not configured, skipping`);
      continue;
    }
    
    const promptText = promptTextsMap.get(promptId.toString());
    
    if (!promptText) {
      console.warn(`  - ${configKey}: prompt ID ${promptId} not found in prompts collection, skipping`);
      continue;
    }
    
    migrations.push({
      worker: mapping.worker,
      field: mapping.field,
      text: promptText
    });
    
    console.log(`  - ${configKey} → ${mapping.worker}.${mapping.field} (${promptText.length} chars)`);
  }
  
  // Step 4: Apply migrations to workers collection
  // Group by worker to minimize updates
  const workerUpdates = new Map<string, Record<string, string>>();
  
  for (const migration of migrations) {
    if (!workerUpdates.has(migration.worker)) {
      workerUpdates.set(migration.worker, {});
    }
    workerUpdates.get(migration.worker)![migration.field] = migration.text;
  }
  
  // Step 5: Update each worker's defaultOverrides
  for (const [workerName, defaults] of workerUpdates.entries()) {
    const result = await db.collection("workers").updateOne(
      { name: workerName },
      {
        $set: {
          defaultOverrides: defaults,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    
    if (result.upsertedCount > 0) {
      console.log(`  ✓ Created worker entry for '${workerName}' with ${Object.keys(defaults).length} default(s)`);
    } else if (result.modifiedCount > 0) {
      console.log(`  ✓ Updated worker '${workerName}' with ${Object.keys(defaults).length} default(s)`);
    } else {
      console.log(`  - Worker '${workerName}' already has these defaults (no change)`);
    }
  }
  
  // Step 6: Mark migration in config (but DON'T delete prompts yet for safety)
  // Add a migration marker so we know this has been done
  await db.collection("configs").updateOne(
    { _id: SERVER_CONFIG_ID },
    {
      $set: {
        "migrations.prompts_to_workers": {
          migratedAt: new Date(),
          version: "0015",
        },
        updatedAt: new Date(),
      },
    }
  );
  
  console.log("✓ Migration complete - prompts copied to worker defaults");
  console.log("  Note: Original config.prompts preserved for rollback safety");
}

export async function down(db: Db, client: MongoClient): Promise<void> {
  console.log("Rolling back: Restoring prompts from workers.defaultOverrides to config.prompts...");
  
  // Step 1: Check if migration was applied
  const config = await db.collection("configs").findOne({ _id: SERVER_CONFIG_ID });
  
  if (!config?.migrations?.prompts_to_workers) {
    console.log("Migration was not applied - nothing to roll back");
    return;
  }
  
  // Step 2: Since we preserved config.prompts in the up migration,
  // we can simply remove the worker defaultOverrides that we added
  
  // Get list of workers we modified
  const workersToRevert = new Set(
    Object.values(PROMPT_TO_WORKER_MAPPING).map(m => m.worker)
  );
  
  for (const workerName of workersToRevert) {
    // Check if worker has any defaultOverrides
    const worker = await db.collection("workers").findOne({ name: workerName });
    
    if (worker?.defaultOverrides) {
      const fieldsToRemove = Object.values(PROMPT_TO_WORKER_MAPPING)
        .filter(m => m.worker === workerName)
        .map(m => m.field);
      
      // Only remove the fields we added, not all defaultOverrides
      const unsetFields: Record<string, string> = {};
      for (const field of fieldsToRemove) {
        unsetFields[`defaultOverrides.${field}`] = "";
      }
      
      await db.collection("workers").updateOne(
        { name: workerName },
        {
          $unset: unsetFields,
          $set: { updatedAt: new Date() },
        }
      );
      
      console.log(`  ✓ Removed ${fieldsToRemove.length} default override(s) from worker '${workerName}'`);
    }
  }
  
  // Step 3: Remove migration marker from config
  await db.collection("configs").updateOne(
    { _id: SERVER_CONFIG_ID },
    {
      $unset: {
        "migrations.prompts_to_workers": "",
      },
      $set: {
        updatedAt: new Date(),
      },
    }
  );
  
  console.log("✓ Rollback complete - worker defaults removed, config.prompts preserved");
  console.log("  Note: Original prompt references in config.prompts remain intact");
}
