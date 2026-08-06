import { redis } from "@/lib/redis.ts";
import { debounce } from "@std/async/debounce";
import {
  JobCapability,
  jobRegistry,
  JobRegistryEntry,
  JobTriggerSource,
} from "./job-registry.ts";
import { TriggerSource } from "@/utils/registries.ts";
import { enqueueJob } from "./queue.ts";
import { EnqueueJobOptions } from "./types.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource, sift } from "@/lib/mongo/core.server.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { normalizeWorkerConcurrency } from "./worker-concurrency.ts";

// Logging helper for consistent format
const log = (level: string, msg: string, data?: Record<string, unknown>) => {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[TRIGGER-MGR] ${timestamp} ${level}: ${msg}${dataStr}`);
};

export class TriggerManager {
  private isRunning = false;
  private subscribers = new Map<string, any>();
  private debouncers = new Map<string, any>();
  private intervals = new Map<string, ReturnType<typeof setInterval>>();
  private healthRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private registry: typeof jobRegistry) {}

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    log("INFO", `Starting trigger manager`);

    const capabilities = this.registry.list();
    const triggeredCapabilities = capabilities.filter((cap) =>
      cap.manifest.triggers
    );
    log("INFO", `Found capabilities with triggers`, {
      total: capabilities.length,
      withTriggers: triggeredCapabilities.length,
      names: triggeredCapabilities.map((c) => c.manifest.name),
    });

    for (const cap of triggeredCapabilities) {
      await this.setupTriggers(cap);
    }
  }

  private async setupTriggers(cap: JobRegistryEntry) {
    const triggers = cap.manifest.triggers;
    const { name } = cap.manifest;
    if (!triggers) return;

    const isTest = Deno.env.get("DENO_ENV") === "test";
    const debounceMs = isTest ? 10 : (triggers.debounceMs || 5000);

    log("INFO", `Setting up triggers`, {
      jobName: name,
      sourceCount: triggers.sources?.length || 0,
      debounceMs,
      intervalSeconds: triggers.interval,
      sources: triggers.sources?.map((s) => s.name),
    });

    const handleTrigger = debounce(async (reason: string) => {
      log("DEBUG", `Debounced trigger fired`, { jobName: name, reason });
      await this.checkAndTrigger(cap, reason);
    }, debounceMs);

    this.debouncers.set(name, handleTrigger);

    for (const source of triggers.sources) {
      await this.setupRedisTrigger(
        cap,
        source,
        (_payload) => handleTrigger(source.name),
      );
    }

    if (!isTest && triggers.interval && triggers.interval > 0) {
      if (!this.intervals.has(name)) {
        const defaultSeconds = triggers.interval;
        log("INFO", `Setting up interval trigger`, {
          jobName: name,
          intervalSeconds: defaultSeconds,
        });
        // A self-rescheduling timeout reads the operator-configured interval
        // before every cycle, so changes in worker config apply without a
        // restart. A configured 0 disables scheduled runs (event triggers
        // still fire); the timer then re-checks the config every 5 minutes.
        const scheduleNext = async () => {
          let seconds = defaultSeconds;
          try {
            const config = await getServerConfig();
            const configured = config?.workers?.[name]?.triggerIntervalSeconds;
            if (typeof configured === "number" && configured >= 0) {
              seconds = configured;
            }
          } catch {
            // Keep the capability default when config storage is unavailable.
          }
          if (seconds <= 0) {
            this.intervals.set(name, setTimeout(scheduleNext, 300_000));
            return;
          }
          const timerId = setTimeout(() => {
            log("DEBUG", `Interval trigger fired`, {
              jobName: name,
              intervalSeconds: seconds,
            });
            this.checkAndTrigger(
              cap,
              `interval:${seconds}s`,
              { requireIdle: true },
            );
            void scheduleNext();
          }, seconds * 1000);
          this.intervals.set(name, timerId);
        };
        void scheduleNext();
      }
    }

    // Initial check on startup (skipped in tests to avoid interference)
    if (!isTest) {
      log("INFO", `Running startup check`, { jobName: name });
      await this.checkAndTrigger(cap, "TriggerManager startup check");
    }
  }

  private async setupRedisTrigger(
    cap: JobRegistryEntry,
    source: TriggerSource,
    onTrigger: (payload: any) => void,
  ) {
    const channel = source.channel;
    if (!channel) {
      log("WARN", `Missing channel for trigger`, {
        jobName: cap.manifest.name,
      });
      return;
    }

    let subscriber = this.subscribers.get(channel);
    if (!subscriber) {
      subscriber = redis.duplicate();
      await subscriber.connect();
      this.subscribers.set(channel, subscriber);

      log("INFO", `Subscribing to Redis channel`, {
        channel,
        jobName: cap.manifest.name,
      });
      await subscriber.subscribe(channel);
    }

    subscriber.on("message", (chan: string, message: string) => {
      if (chan !== channel) return;
      try {
        const payload = JSON.parse(message);
        // Use sift to evaluate the filter if it exists
        const matches = !source.filter || sift(source.filter)(payload);
        if (matches) {
          log("INFO", `Redis event received`, {
            channel,
            jobName: cap.manifest.name,
            triggerName: source.name,
            eventType: payload?.event,
            documentState: payload?.data?.document?.state,
          });
          onTrigger(payload);
        } else {
          log("DEBUG", `Redis event filtered out`, {
            channel,
            jobName: cap.manifest.name,
            triggerName: source.name,
            eventType: payload?.event,
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log("ERROR", `Error in Redis trigger`, {
          jobName: cap.manifest.name,
          channel,
          error: errorMsg,
        });
      }
    });
  }

  private async checkAndTrigger(
    cap: JobRegistryEntry,
    reason: string,
    triggerOptions: { requireIdle?: boolean } | undefined = undefined,
  ) {
    const jobName = cap.manifest.name;
    try {
      const auth = await getServerAuth();
      const mongo = await getMongoResource(auth);

      if (triggerOptions && triggerOptions.requireIdle) {
        const activeJobs = await mongo({
          action: "count",
          collection: "jobs",
          query: {
            type: jobName,
            state: { $in: ["waiting", "active"] },
          },
        }) as number;

        if (activeJobs > 0) {
          log("DEBUG", `Skipping trigger - job already running`, {
            jobName,
            reason,
            activeJobs,
          });
          return;
        }
      }

      // Runtime concurrency is operator-configurable. The manifest value is a
      // legacy discovery hint and must not silently pin every trigger to one
      // job while the BullMQ worker is configured for more.
      const config = await getServerConfig();
      const maxConcurrency = normalizeWorkerConcurrency(
        jobName,
        config?.workers?.[jobName]?.concurrency,
      );
      const activeJobs = await mongo({
        action: "count",
        collection: "jobs",
        query: {
          type: jobName,
          state: { $in: ["waiting", "active"] },
        },
      }) as number;

      if (activeJobs >= maxConcurrency) {
        log("DEBUG", `Skipping trigger - max concurrency reached`, {
          jobName,
          reason,
          activeJobs,
          maxConcurrency,
        });
        return;
      }

      const implementation = await this.registry.loadImplementation(jobName);
      if (
        implementation.hasPendingWork &&
        !await implementation.hasPendingWork({ mongo, reason })
      ) {
        log("DEBUG", `Skipping trigger - no pending work`, {
          jobName,
          reason,
        });
        return;
      }

      // Fill every free runtime slot. Discovery workers use atomic source
      // claims, while STT additionally reserves a provider-profile slot for
      // each queued job.
      const freeSlots = maxConcurrency - activeJobs;
      log("INFO", `Enqueuing jobs`, { jobName, reason, freeSlots });
      const enqueueOptions: EnqueueJobOptions = {
        trigger: {
          type: "auto",
          reason,
        },
      };
      let enqueued = 0;
      for (let index = 0; index < freeSlots; index += 1) {
        await enqueueJob({
          type: jobName,
        } as any, enqueueOptions);
        enqueued += 1;
      }
      log("INFO", `Jobs enqueued successfully`, {
        jobName,
        reason,
        enqueued,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log("ERROR", `Error triggering job`, {
        jobName,
        reason,
        error: errorMsg,
      });
      // A health-blocked enqueue retries on a short timer instead of waiting
      // out the full trigger interval, so work resumes shortly after the
      // provider recovers. One pending retry per job.
      if (
        errorMsg.includes("health check") && this.isRunning &&
        !this.healthRetryTimers.has(jobName)
      ) {
        const timer = setTimeout(() => {
          this.healthRetryTimers.delete(jobName);
          if (!this.isRunning) return;
          this.checkAndTrigger(cap, `${reason} (health retry)`).catch(() => {});
        }, 60_000);
        this.healthRetryTimers.set(jobName, timer);
      }
    }
  }

  async stop() {
    log("INFO", `Stopping trigger manager`, {
      debouncers: this.debouncers.size,
      intervals: this.intervals.size,
      subscribers: this.subscribers.size,
    });
    this.isRunning = false;

    for (const [name, debouncer] of this.debouncers) {
      debouncer.clear();
    }
    this.debouncers.clear();

    for (const [name, intervalId] of this.intervals) {
      clearInterval(intervalId);
    }
    this.intervals.clear();

    for (const [, timer] of this.healthRetryTimers) {
      clearTimeout(timer);
    }
    this.healthRetryTimers.clear();

    for (const [channel, subscriber] of this.subscribers) {
      try {
        await subscriber.unsubscribe();
        await subscriber.quit();
        log("DEBUG", `Closed Redis subscriber`, { channel });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log("ERROR", `Error closing Redis subscriber`, {
          channel,
          error: errorMsg,
        });
      }
    }
    this.subscribers.clear();
    log("INFO", `Trigger manager stopped`);
  }
}

export const triggerManager = new TriggerManager(jobRegistry);
