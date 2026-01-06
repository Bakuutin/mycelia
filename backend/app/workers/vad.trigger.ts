import { redis } from "@/lib/redis.ts";
import { getQueue, enqueueJob } from "@/lib/jobs/queue.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { QueueEvents } from "bullmq";
import { ObjectId } from "mongodb";
import { debounce } from "@std/async/debounce";

let isRunning = false;
let subscriber: any = null;
let queueEvents: QueueEvents | null = null;

const DEBOUNCE_MS = Deno.env.get("DENO_ENV") === "test" ? 100 : 5000;

async function checkAndTriggerVad(trigger: "auto_new_chunks" | "auto_sequential") {
  try {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);

    // 1. Check for existing active or waiting VAD jobs
    const existingJob = await mongo({
      action: "findOne",
      collection: "jobs",
      query: {
        type: "vad",
        state: { $in: ["waiting", "active"] },
      },
    }) as any;

    if (existingJob) {
      console.log(`[VAD Trigger] Job already ${existingJob.state}, skipping trigger.`);
      return;
    }

    // 2. Count pending chunks
    const pendingChunk = await mongo({
      action: "findOne",
      collection: "audio_chunks",
      query: { vad: null },
    }) as any;

    if (pendingChunk) {
      console.log(`[VAD Trigger] Found pending chunks. Triggering VAD job (${trigger})...`);
      await enqueueJob({
        type: "vad",
        trigger,
        limit: 1000,
        batchSize: 100,
      } as any);
    } else {
      console.log(`[VAD Trigger] No pending chunks found (${trigger}).`);
    }
  } catch (error) {
    console.error("[VAD Trigger] Error in checkAndTriggerVad:", error);
  }
}

const handleNewChunk = debounce(() => {
  console.log("[VAD Trigger] Debounce finished, checking and triggering VAD...");
  checkAndTriggerVad("auto_new_chunks");
}, DEBOUNCE_MS);

export async function startVadTriggerWorker() {
  if (isRunning) return;
  isRunning = true;

  console.log("[VAD Trigger] Starting VAD trigger worker...");

  // 1. Subscribe to MongoDB change events for audio_chunks
  subscriber = redis.duplicate();
  await subscriber.connect();

  const channel = "mycelia:mongo:audio_chunks";
  console.log(`[VAD Trigger] Subscribing to Redis channel: ${channel}`);
  
  subscriber.on("message", (chan: string, message: string) => {
    if (chan !== channel) return;
    try {
      const payload = JSON.parse(message);
      console.log(`[VAD Trigger] Received message from ${channel}: ${payload.event} ${payload.data?.operationType}`);
      // We only care about inserts where 'vad' is missing
      if (payload.event === "mongo.change" && payload.data.operationType === "insert") {
        const doc = payload.data.document;
        if (doc && doc.vad === undefined) {
          handleNewChunk();
        } else {
          console.log("[VAD Trigger] Inserted chunk already has VAD or document is missing.");
        }
      }
    } catch (error) {
      console.error("[VAD Trigger] Error processing Redis message:", error);
    }
  });

  await subscriber.subscribe(channel);

  // 2. Listen for VAD job completions to trigger sequential jobs
  queueEvents = new QueueEvents("jobs-vad", { connection: redis });
  queueEvents.on("completed", ({ jobId }) => {
    console.log(`[VAD Trigger] VAD job ${jobId} completed. Checking for more work...`);
    checkAndTriggerVad("auto_sequential");
  });

  queueEvents.on("error", (error) => {
    console.error("[VAD Trigger] QueueEvents error:", error);
  });

  console.log("[VAD Trigger] VAD trigger worker started and listening.");
}

export async function stopVadTriggerWorker() {
  if (!isRunning) return;
  isRunning = false;

  console.log("[VAD Trigger] Stopping VAD trigger worker...");

  handleNewChunk.clear();

  if (subscriber) {
    await subscriber.unsubscribe();
    await subscriber.quit();
    subscriber = null;
  }

  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }

  console.log("[VAD Trigger] VAD trigger worker stopped.");
}

