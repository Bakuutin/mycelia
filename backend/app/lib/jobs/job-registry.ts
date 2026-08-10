import type { Job } from "bullmq";
import { fromJSONSchema } from "zod";
import type { JobData, JobResult } from "./types.ts";
import {
  CapabilityManifest,
  discoverCapabilities,
  Registry,
  RegistryEntry,
  Triggers,
  TriggerSource,
} from "@/utils/registries.ts";
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
export interface JobCapability<T = Job<JobData>>
  extends Omit<CapabilityManifest, "inputSchema" | "outputSchema"> {
  inputSchema: any; // Should be serializable JSON Schema
  outputSchema: any; // Should be serializable JSON Schema
  use: (job: T) => Promise<JobResult>;
  policies: Policy[];
  triggers?: Omit<Triggers, "sources"> & {
    sources: JobTriggerSource[];
  };
  /**
   * Optional cheap guard for automatic triggers. Returning false (or 0) skips
   * job creation while keeping the trigger itself active for future work.
   * Returning a number additionally caps the fan-out: it is the count of jobs
   * worth starting right now (e.g. ceil(backlog / batchSize)), so a trigger
   * never fills every free concurrency slot with jobs that will find nothing.
   * Returning true keeps the legacy fill-all-free-slots behavior.
   */
  hasPendingWork?: (context: {
    mongo: (input: any) => Promise<any>;
    reason: string;
  }) => Promise<boolean | number>;
  /** Build job data from a trigger payload (for example, scope work to one source). */
  getTriggerJobData?: (
    payload: unknown,
    reason: string,
    context: { mongo: (input: any) => Promise<any> },
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  maxConcurrency?: number;
  /** Extra `host:port` entries appended to the job subprocess --allow-net. */
  allowedHosts?: string[];
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
   * Get JSON schemas and policies for all registered jobs.
   * Returns { workerName: { input: inputSchema, output: outputSchema, policies: Policy[] } }
   */
  getJobSchemas(): Record<
    string,
    { input: any; output: any; policies: any[] }
  > {
    const schemas: Record<
      string,
      { input: any; output: any; policies: any[] }
    > = {};
    for (const capability of this.list()) {
      try {
        schemas[capability.manifest.name] = {
          input: capability.manifest.inputSchema,
          output: capability.manifest.outputSchema,
          policies: capability.manifest.policies || [],
        };
      } catch (err: any) {
        console.error(
          `Failed to convert schema for job type ${capability.manifest.name}:`,
          err.message,
        );
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

    const routingContext = (data as JobData).routingContext;
    data = JSON.parse(JSON.stringify(data)); // serialize native json types
    const capabilityData = { ...(data as JobData) };
    delete capabilityData.routingContext;

    const properties = (capability.manifest.inputSchema as {
      properties?: Record<string, unknown>;
    })?.properties;
    if (properties) {
      // Manifests are generated with io:"input", which omits
      // additionalProperties:false — reject unknown fields here so typos and
      // unsupported options still fail loudly instead of being stripped.
      const unknown = Object.keys(capabilityData).filter(
        (key) => !(key in properties),
      );
      if (unknown.length > 0) {
        throw new Error(
          `Unknown field(s) for job type ${jobType}: ${unknown.join(", ")}`,
        );
      }

      // Workers cast job.data without re-parsing, so every schema default
      // must be materialized here. fromJSONSchema applies property defaults
      // for plain types but not for enums, so fill absent defaulted
      // properties from the JSON Schema before parsing.
      for (const [key, property] of Object.entries(properties)) {
        if (
          capabilityData[key] === undefined &&
          property && typeof property === "object" && "default" in property
        ) {
          capabilityData[key] = structuredClone(
            (property as { default: unknown }).default,
          );
        }
      }
    }

    const parsed = fromJSONSchema(capability.manifest.inputSchema).parse(
      capabilityData,
    ) as JobData;
    return routingContext ? { ...parsed, routingContext } : parsed;
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
    const capability = (mod.default && typeof mod.default === "object")
      ? mod.default
      : mod;

    // Merge implementation into the entry
    Object.assign(entry, capability);
    return entry;
  }

  /**
   * Load all implementations for all registered capabilities.
   */
  async loadAllImplementations(): Promise<void> {
    await Promise.all(
      this.list().map((c) => this.loadImplementation(c.manifest.name)),
    );
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

  console.log(
    `Discovered ${jobRegistry.list().length} job worker(s): ${
      jobRegistry.getJobTypes().join(", ")
    }`,
  );
}
