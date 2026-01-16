import { redis } from "@/lib/redis.ts";
import { debounce } from "@std/async/debounce";
import { jobRegistry, JobCapability, JobTriggerSource, JobRegistryEntry } from "./job-registry.ts";
import { TriggerSource } from "@/utils/registries.ts";
import { enqueueJob } from "./queue.ts";
import { EnqueueJobOptions } from "./types.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource, sift } from "@/lib/mongo/core.server.ts";

export class TriggerManager {
  private isRunning = false;
  private subscribers = new Map<string, any>();
  private debouncers = new Map<string, any>();
  private intervals = new Map<string, number>();

  constructor(private registry: typeof jobRegistry) {}

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log("[TriggerManager] Starting trigger manager...");

    const capabilities = this.registry.list() ;
    for (const cap of capabilities) {
      if (cap.manifest.triggers) {
        await this.setupTriggers(cap);
      }
    }
  }

  private async setupTriggers(cap: JobRegistryEntry) {
    const triggers = cap.manifest.triggers;
    const { name } = cap.manifest;
    if (!triggers) return;

    console.log(`[TriggerManager] Setting up triggers for ${name}...`);

    const isTest = Deno.env.get("DENO_ENV") === "test";
    const debounceMs = isTest ? 10 : (triggers.debounceMs || 5000);

    const handleTrigger = debounce(async (reason: string) => {
      await this.checkAndTrigger(cap, reason);
    }, debounceMs);

    this.debouncers.set(name, handleTrigger);

    for (const source of triggers.sources) {
      await this.setupRedisTrigger(cap, source, (_payload) => 
        handleTrigger(source.name));
    }

    if (!isTest && triggers.interval && triggers.interval > 0) {
      if (!this.intervals.has(name)) {
        const intervalMs = triggers.interval * 1000;
        const intervalId = setInterval(() => {
          this.checkAndTrigger(
            cap,
            `interval:${triggers.interval}s`,
            { requireIdle: true },
          );
        }, intervalMs);
        this.intervals.set(name, intervalId);
      }
    }
    
    // Initial check on startup (skipped in tests to avoid interference)
    if (!isTest) {
      await this.checkAndTrigger(cap, "TriggerManager startup check");
    }
  }

  private async setupRedisTrigger(cap: JobRegistryEntry, source: TriggerSource, onTrigger: (payload: any) => void) {
    const channel = source.channel;
    if (!channel) {
      console.warn(`[TriggerManager] Missing channel for trigger in ${cap.manifest.name}`);
      return;
    }

    let subscriber = this.subscribers.get(channel);
    if (!subscriber) {
      subscriber = redis.duplicate();
      await subscriber.connect();
      this.subscribers.set(channel, subscriber);
      
      console.log(`[TriggerManager] Subscribing to Redis channel: ${channel}`);
      await subscriber.subscribe(channel);
    }

    subscriber.on("message", (chan: string, message: string) => {
      if (chan !== channel) return;
      try {
        const payload = JSON.parse(message);
        // Use sift to evaluate the filter if it exists
        const matches = !source.filter || sift(source.filter)(payload);
        if (matches) {
          console.log(`[TriggerManager] Redis event on ${channel} for ${cap.manifest.name} (trigger: ${source.name})`);
          onTrigger(payload);
        }
      } catch (error) {
        console.error(`[TriggerManager] Error in Redis trigger for ${cap.manifest.name}:`, error);
      }
    });
  }

  private async checkAndTrigger(
    cap: JobRegistryEntry,
    reason: string,
    triggerOptions: { requireIdle?: boolean } | undefined = undefined,
  ) {
    try {
      const auth = await getServerAuth();
      const mongo = await getMongoResource(auth);

      if (triggerOptions && triggerOptions.requireIdle) {
        const activeJobs = await mongo({
          action: "count",
          collection: "jobs",
          query: {
            type: cap.manifest.name,
            state: { $in: ["waiting", "active"] },
          },
        }) as number;

        if (activeJobs > 0) {
          console.log(`[TriggerManager] ${cap.manifest.name} already running, skipping interval trigger.`);
          return;
        }
      }

      // 1. Check maxConcurrency if defined
      if (cap.manifest.maxConcurrency !== undefined) {
        const activeJobs = await mongo({
          action: "count",
          collection: "jobs",
          query: {
            type: cap.manifest.name,
            state: { $in: ["waiting", "active"] },
          },
        }) as number;

        if (activeJobs >= cap.manifest.maxConcurrency) {
          console.log(`[TriggerManager] Max concurrency (${cap.manifest.maxConcurrency}) reached for ${cap.manifest.name}, skipping trigger.`);
          return;
        }
      }

      // 2. Enqueue job
      console.log(`[TriggerManager] Triggering ${cap.manifest.name} job (reason: ${reason})...`);
      const enqueueOptions: EnqueueJobOptions = {
        trigger: {
          type: "auto",
          reason,
        }
      };
      await enqueueJob({
        type: cap.manifest.name,
      } as any, enqueueOptions);
    } catch (error) {
      console.error(`[TriggerManager] Error triggering ${cap.manifest.name}:`, error);
    }
  }

  async stop() {
    console.log("[TriggerManager] Stopping trigger manager...");
    this.isRunning = false;
    
    for (const [_, debouncer] of this.debouncers) {
      debouncer.clear();
    }
    this.debouncers.clear();

    for (const [_, intervalId] of this.intervals) {
      clearInterval(intervalId);
    }
    this.intervals.clear();

    for (const [_, subscriber] of this.subscribers) {
      try {
        await subscriber.unsubscribe();
        await subscriber.quit();
      } catch (err) {
        console.error("[TriggerManager] Error closing Redis subscriber:", err);
      }
    }
    this.subscribers.clear();
  }
}

export const triggerManager = new TriggerManager(jobRegistry);

