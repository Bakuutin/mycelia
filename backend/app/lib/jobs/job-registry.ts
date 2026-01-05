import type { Job } from "bullmq";
import { z } from "zod";
import { dirname, fromFileUrl } from "@std/path";
import type { JobData, JobResult } from "./types.ts";
import { Capability, Registry, discoverCapabilities } from "@/utils/registries.ts";

/**
 * A job capability represents a worker that can process a specific job type.
 * Each capability defines its own name, processor, and data schema.
 */
export interface JobCapability extends Capability<Job<JobData>, JobResult> {
  /** The job type name (used as registry key) */
  name: string;
  /** Process the job and return a result */
  use: (job: Job<JobData>) => Promise<JobResult>;
  /** Zod schema to validate job data for this type */
  schema: z.ZodType<JobData>;
}

/**
 * Registry for job workers. Each worker is registered by its job type name.
 */
export class JobRegistry extends Registry<Job<JobData>, JobResult, JobCapability> {
  /**
   * Get a worker for a specific job type, throwing if not found.
   */
  getOrThrow(jobType: string): JobCapability {
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
    return this.list().map((c) => c.name);
  }

  /**
   * Get JSON schemas for all registered jobs.
   */
  getJobSchemas(): Record<string, any> {
    const schemas: Record<string, any> = {};
    for (const capability of this.list()) {
      try {
        schemas[capability.name] = (z as any).toJSONSchema(capability.schema);
      } catch (err: any) {
        console.error(`Failed to convert schema for job type ${capability.name}:`, err.message);
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
    
    return capability.schema.parse(data);
  }

  /**
   * Process a job using the registered worker for its type.
   */
  async process(job: Job<JobData>): Promise<JobResult> {
    const jobType = job.data.type;
    const worker = this.getOrThrow(jobType);
    return worker.use(job);
  }
}

/** Global job registry instance */
export const jobRegistry = new JobRegistry();

/**
 * Auto-discover and register all job workers from the workers directory.
 * Workers should export `name`, `use` (processor function), and `schema`.
 */
export async function discoverJobWorkers(): Promise<void> {
  const workersDir = Deno.cwd() + "/app/workers";

  const capabilities = await discoverCapabilities<Job<JobData>, JobResult>(
    "*.ts",
    workersDir,
    ["python.ts", "*.test.ts"],
  );

  for (const capability of capabilities) {
    const cap = capability as JobCapability;
    
    // Validate that the capability has a schema
    if (!cap.schema) {
      console.warn(`Job capability '${cap.name}' missing schema, skipping`);
      continue;
    }
    
    jobRegistry.register(cap);
  }

  console.log(`Discovered ${jobRegistry.list().length} job worker(s): ${jobRegistry.getJobTypes().join(", ")}`);
}
