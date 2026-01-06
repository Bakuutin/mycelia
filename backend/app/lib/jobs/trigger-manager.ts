import { redis } from "@/lib/redis.ts";
import { debounce } from "@std/async/debounce";
import { jobRegistry, JobCapability, JobTriggerSource } from "./job-registry.ts";
import { enqueueJob } from "./queue.ts";
import { EnqueueJobOptions } from "./types.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

export class TriggerManager {
  private isRunning = false;
  private subscribers = new Map<string, any>();
  private debouncers = new Map<string, any>();

  constructor(private registry: typeof jobRegistry) {}

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log("[TriggerManager] Starting trigger manager...");

    const capabilities = this.registry.list();
    for (const cap of capabilities) {
      if (cap.trigger) {
        await this.setupTriggers(cap);
      }
    }
  }

  private async setupTriggers(cap: JobCapability) {
    const { trigger, name } = cap;
    if (!trigger) return;

    console.log(`[TriggerManager] Setting up triggers for ${name}...`);

    const isTest = Deno.env.get("DENO_ENV") === "test";
    const debounceMs = isTest ? 10 : (trigger.debounceMs || 5000);

    const handleTrigger = debounce(async (reason: string) => {
      await this.checkAndTrigger(cap, reason);
    }, debounceMs);

    this.debouncers.set(name, handleTrigger);

    for (const source of trigger.sources) {
      await this.setupRedisTrigger(cap, source, (_payload) => 
        handleTrigger(source.name));
    }
    
    // Initial check on startup (skipped in tests to avoid interference)
    if (!isTest) {
      await this.checkAndTrigger(cap, "TriggerManager startup check");
    }
  }

  private async setupRedisTrigger(cap: JobCapability, source: JobTriggerSource, onTrigger: (payload: any) => void) {
    const channel = source.channel;
    if (!channel) {
      console.warn(`[TriggerManager] Missing channel for trigger in ${cap.name}`);
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
        if (!source.filter || source.filter(payload)) {
          console.log(`[TriggerManager] Redis event on ${channel} for ${cap.name} (trigger: ${source.name})`);
          onTrigger(payload);
        }
      } catch (error) {
        console.error(`[TriggerManager] Error in Redis trigger for ${cap.name}:`, error);
      }
    });
  }

  private async checkAndTrigger(cap: JobCapability, reason: string) {
    try {
      const auth = await getServerAuth();
      const mongo = await getMongoResource(auth);

      // 1. Check maxConcurrency if defined
      if (cap.maxConcurrency !== undefined) {
        const activeJobs = await mongo({
          action: "count",
          collection: "jobs",
          query: {
            type: cap.name,
            state: { $in: ["waiting", "active"] },
          },
        }) as number;

        if (activeJobs >= cap.maxConcurrency) {
          console.log(`[TriggerManager] Max concurrency (${cap.maxConcurrency}) reached for ${cap.name}, skipping trigger.`);
          return;
        }
      }

      // 2. Enqueue job
      console.log(`[TriggerManager] Triggering ${cap.name} job (reason: ${reason})...`);
      const options: EnqueueJobOptions = {
        trigger: {
          type: "auto",
          reason,
        }
      };
      await enqueueJob({
        type: cap.name,
      } as any, options);
    } catch (error) {
      console.error(`[TriggerManager] Error triggering ${cap.name}:`, error);
    }
  }

  async stop() {
    console.log("[TriggerManager] Stopping trigger manager...");
    this.isRunning = false;
    
    for (const [_, debouncer] of this.debouncers) {
      debouncer.clear();
    }
    this.debouncers.clear();

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

