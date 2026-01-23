import type { Job } from "bullmq";
import { fromJSONSchema } from "zod";
import type { JobData, JobResult } from "./types.ts";
import { Registry, RegistryEntry, CapabilityManifest, discoverCapabilities, TriggerSource, Triggers } from "@/utils/registries.ts";
import { Policy } from "@/lib/auth/resources.ts";

/**
 * Trigger source for jobs based on Redis events.
 */
export interface JobTriggerSource extends TriggerSource {
  // Use sift syntax for filters so they can be serialized
  filter?: Record<string, any>;
}

/**
 * A job capability represents a worker that can process a specific job type.
 * Each capability defines its own name, processor, and data schema.
 */
export interface JobCapability<T = Job<JobData>> extends Omit<CapabilityManifest, 'inputSchema' | 'outputSchema'> {
  inputSchema: any; // Should be serializable JSON Schema
  outputSchema: any; // Should be serializable JSON Schema
  use: (job: T) => Promise<JobResult>;
  policies: Policy[];
  triggers?: Omit<Triggers, 'sources'> & {
    sources: JobTriggerSource[];
  };
  maxConcurrency?: number;
  
}

/**
 * Registry entry for jobs. Combines the discovered manifest and path
 * with the optional loaded implementation.
 */
export type JobRegistryEntry = RegistryEntry & Partial<JobCapability>;

/**
 * Registry for job workers. Each worker is registered by its job type name.
 */
export class JobRegistry extends Registry<JobRegistryEntry> {
  /**
   * Get a worker for a specific job type, throwing if not found.
   */
  getOrThrow(jobType: string): JobRegistryEntry {
    const worker = this.get(jobType);
    if (!worker) {
      throw new Error(`No worker registered for job type: ${jobType}`);
    }
    return worker;
  }

  /**
   * Get all registered job type names.
   */
  getJobTypes(): string[] {
    return this.list().map((c) => c.manifest.name);
  }

  /**
   * Get JSON schemas for all registered jobs.
   * Returns { workerName: { input: inputSchema, output: outputSchema } }
   */
  getJobSchemas(): Record<string, { input: any; output: any }> {
    const schemas: Record<string, { input: any; output: any }> = {};
    for (const capability of this.list()) {
      try {
        schemas[capability.manifest.name] = {
          input: capability.manifest.inputSchema,
          output: capability.manifest.outputSchema,
        };
      } catch (err: any) {
        console.error(`Failed to convert schema for job type ${capability.manifest.name}:`, err.message);
        throw err;
      }
    }
    return schemas;
  }

  /**
   * Validate job data against the schema for its type.
   * Returns the parsed data or throws if invalid.
   */
  validateJobData(data: unknown): JobData {
    if (!data || typeof data !== "object" || !("type" in data)) {
      throw new Error("Job data must have a 'type' field");
    }
    
    const jobType = (data as { type: string }).type;
    const capability = this.get(jobType);
    
    if (!capability) {
      throw new Error(`Unknown job type: ${jobType}`);
    }
    console.log(JSON.stringify(data));

    data = JSON.parse(JSON.stringify(data)); // serialize native json types

    
    return fromJSONSchema(capability.manifest.inputSchema).parse(data) as JobData;
  }

  /**
   * Process a job using the registered worker for its type.
   * Note: This requires the worker implementation to be loaded.
   */
  async process(job: Job<JobData>): Promise<JobResult> {
    const jobType = job.data.type;
    const worker = await this.loadImplementation(jobType);
    return worker.use!(job);
  }

  /**
   * Load the full implementation for a capability.
   */
  async loadImplementation(name: string): Promise<JobRegistryEntry> {
    const entry = this.getOrThrow(name);
    if (entry.use) return entry;

    const mod = await import(entry.path.href);
    const capability = (mod.default && typeof mod.default === "object") ? mod.default : mod;
    
    // Merge implementation into the entry
    Object.assign(entry, capability);
    return entry;
  }

  /**
   * Load all implementations for all registered capabilities.
   */
  async loadAllImplementations(): Promise<void> {
    await Promise.all(this.list().map((c) => this.loadImplementation(c.manifest.name)));
  }
}

/** Global job registry instance */
export const jobRegistry = new JobRegistry();

/**
 * Auto-discover and register all job workers from the workers directory.
 * Workers should export `name`, `use` (processor function), and `schema`.
 */
export async function discoverJobWorkers(): Promise<void> {
  if (jobRegistry.list().length > 0) {
    return;
  }
  const workersDir = Deno.cwd() + "/workers";

  const capabilities = await discoverCapabilities<Job<JobData>, JobResult>({
    globPattern: "*.ts",
    root: workersDir,
    exclude: ["python.ts", "*.test.ts"],
  });

  for (const discovered of capabilities) {
      jobRegistry.register(discovered);
  }

  console.log(`Discovered ${jobRegistry.list().length} job worker(s): ${jobRegistry.getJobTypes().join(", ")}`);
}
