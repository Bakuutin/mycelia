import { ObjectId } from "bson";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { jobRegistry } from "./job-registry.ts";
import type { WorkerEntry } from "@myceliasdk/config.ts";

/**
 * Worker Discovery System
 * 
 * Tracks which workers are currently available and maintains a registry
 * of their schemas and default overrides.
 */

export class WorkerDiscoveryManager {
  /**
   * Register/update a worker in the workers collection
   */
  async registerWorker(
    name: string,
    inputSchema: any,
    outputSchema: any,
    policies: any[] = [],
  ): Promise<void> {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    
    const now = new Date();
    
    await mongo({
      action: "updateOne",
      collection: "workers",
      query: { name },
      update: {
        $set: {
          discovered: true,
          inputSchema,
          outputSchema,
          policies,
          lastSeen: now,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: new ObjectId(),
          createdAt: now,
        },
      },
      options: { upsert: true },
    });
    
    console.log(`[worker-discovery] Registered worker: ${name}`);
  }
  
  /**
   * Mark a worker as not discovered
   */
  async markNotDiscovered(name: string): Promise<void> {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    
    await mongo({
      action: "updateOne",
      collection: "workers",
      query: { name },
      update: {
        $set: {
          discovered: false,
          updatedAt: new Date(),
        },
      },
    });
    
    console.log(`[worker-discovery] Marked worker as not discovered: ${name}`);
  }
  
  /**
   * Get default overrides for a worker
   */
  async getDefaultOverrides(name: string): Promise<Record<string, any> | undefined> {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    
    const worker = await mongo({
      action: "findOne",
      collection: "workers",
      query: { name },
    });
    
    return worker?.defaultOverrides;
  }
  
  /**
   * Update default overrides for a worker
   */
  async updateDefaultOverrides(
    name: string,
    overrides: Record<string, any>,
  ): Promise<void> {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    
    await mongo({
      action: "updateOne",
      collection: "workers",
      query: { name },
      update: {
        $set: {
          defaultOverrides: overrides,
          updatedAt: new Date(),
        },
      },
    });
    
    console.log(`[worker-discovery] Updated default overrides for worker: ${name}`);
  }
  
  /**
   * Sync all currently registered workers with the database
   * Marks workers in DB but not registered as "not discovered"
   */
  async syncDiscoveredWorkers(): Promise<void> {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    
    // Get all currently registered workers
    const registeredWorkers = jobRegistry.getJobTypes();
    const registeredSchemas = jobRegistry.getJobSchemas();
    
    console.log(`[worker-discovery] Syncing ${registeredWorkers.length} discovered workers`);
    console.log(`[worker-discovery] Schema keys:`, Object.keys(registeredSchemas));
    
    // Register all currently discovered workers
    for (const workerName of registeredWorkers) {
      const schema = registeredSchemas[workerName];
      console.log(`[worker-discovery] Worker ${workerName} schema:`, JSON.stringify(schema).slice(0, 200));
      if (schema) {
        const inputSchema = schema.input || {};
        console.log(`[worker-discovery] Worker ${workerName} inputSchema properties:`, Object.keys(inputSchema.properties || {}));
        await this.registerWorker(
          workerName,
          inputSchema,
          schema.output || {},
          schema.policies || [],
        );
      }
    }
    
    // Find workers in DB that are not currently registered
    const allWorkersInDB = await mongo({
      action: "find",
      collection: "workers",
      query: {},
    });
    
    for (const workerDoc of allWorkersInDB) {
      if (!registeredWorkers.includes(workerDoc.name) && workerDoc.discovered) {
        await this.markNotDiscovered(workerDoc.name);
      }
    }
    
    console.log(`[worker-discovery] Worker sync complete`);
  }
  
  /**
   * Get all workers with their discovery status
   */
  async getAllWorkers(): Promise<WorkerEntry[]> {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    
    return await mongo({
      action: "find",
      collection: "workers",
      query: {},
      options: { sort: { name: 1 } },
    });
  }
}

export const workerDiscovery = new WorkerDiscoveryManager();
