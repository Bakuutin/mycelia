import { getRootDB } from "@/lib/mongo/core.server.ts";
import { redis } from "@/lib/redis.ts";

let accessLogWorker: { stop: () => Promise<void> } | null = null;
let workerRunning = false;
let workerLoopPromise: Promise<void> | null = null;

const STREAM_NAME = "access_logs";
const CONSUMER_GROUP = "access_logs_group";
const CONSUMER_NAME = "worker-1";
const BATCH_SIZE = 100;
const BLOCK_TIMEOUT_MS = 5000;

interface AccessLogMessage {
  principal: string;
  resource: string;
  actions: Array<{
    path: string[];
    actions: string[];
  }>;
  timestamp: string;
}

async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.call("XGROUP", "CREATE", STREAM_NAME, CONSUMER_GROUP, "0", "MKSTREAM");
    console.log(`[AccessLog] Created consumer group ${CONSUMER_GROUP} on stream ${STREAM_NAME}`);
  } catch (error: any) {
    if (error.message && (error.message.includes("BUSYGROUP") || error.message.includes("already exists"))) {
      console.log(`[AccessLog] Consumer group ${CONSUMER_GROUP} already exists`);
    } else {
      throw error;
    }
  }
}

async function processBatch(messages: Array<[string, string[]]>): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  const startTime = Date.now();
  console.log(`[AccessLog] Processing batch of ${messages.length} messages`);

  const documents: AccessLogMessage[] = [];
  const failedMessages: Array<{ messageId: string; rawData: Record<string, string>; error: string }> = [];
  const messageIds: string[] = [];

  for (const messageEntry of messages) {
    if (!Array.isArray(messageEntry) || messageEntry.length < 2) {
      continue;
    }

    const messageId = typeof messageEntry[0] === "string" ? messageEntry[0] : new TextDecoder().decode(messageEntry[0] as Uint8Array);
    const fields = messageEntry[1] as any[];
    messageIds.push(messageId);

    const messageData: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      const key = typeof fields[i] === "string" ? fields[i] : new TextDecoder().decode(fields[i] as Uint8Array);
      const value = typeof fields[i + 1] === "string" ? fields[i + 1] : new TextDecoder().decode(fields[i + 1] as Uint8Array);
      messageData[key] = value;
    }

    try {
      const actions = JSON.parse(messageData.actions);
      documents.push({
        principal: messageData.principal,
        resource: messageData.resource,
        actions,
        timestamp: messageData.timestamp,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[AccessLog] Failed to parse message ${messageId}:`, error);
      failedMessages.push({
        messageId,
        rawData: messageData,
        error: errorMessage,
      });
    }
  }

  const db = await getRootDB();

  try {
    if (documents.length > 0) {
      const collection = db.collection("access_logs");
      const insertDocs = documents.map((doc) => ({
        principal: doc.principal,
        resource: doc.resource,
        actions: doc.actions,
        timestamp: new Date(doc.timestamp),
      }));

      await collection.insertMany(insertDocs);
      console.log(`[AccessLog] Successfully inserted ${documents.length} documents`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[AccessLog] Failed to insert batch to MongoDB:`, error);
    
    for (let i = 0; i < documents.length; i++) {
      failedMessages.push({
        messageId: messageIds[i],
        rawData: {
          principal: documents[i].principal,
          resource: documents[i].resource,
          actions: JSON.stringify(documents[i].actions),
          timestamp: documents[i].timestamp,
        },
        error: errorMessage,
      });
    }
  }

  if (failedMessages.length > 0) {
    try {
      const failedCollection = db.collection("access_logs_failed");
      const failedDocs = failedMessages.map((failed) => ({
        messageId: failed.messageId,
        principal: failed.rawData.principal || null,
        resource: failed.rawData.resource || null,
        actions: failed.rawData.actions || null,
        timestamp: failed.rawData.timestamp ? new Date(failed.rawData.timestamp) : new Date(),
        error: failed.error,
        failedAt: new Date(),
        rawMessage: failed.rawData,
      }));

      await failedCollection.insertMany(failedDocs);
      console.log(`[AccessLog] Saved ${failedMessages.length} failed messages to access_logs_failed`);
    } catch (error) {
      console.error(`[AccessLog] Failed to save failed messages:`, error);
    }
  }

  if (messageIds.length > 0) {
    await redis.xack(STREAM_NAME, CONSUMER_GROUP, ...messageIds);
    console.log(`[AccessLog] Acknowledged ${messageIds.length} messages (${documents.length} successful, ${failedMessages.length} failed)`);
  }

  const duration = Date.now() - startTime;
  console.log(
    `[AccessLog] Processed batch in ${duration}ms: ${documents.length} successful, ${failedMessages.length} failed`,
  );
}

async function workerLoop(): Promise<void> {
  let iterationCount = 0;
  let lastIterationTime = Date.now();
  while (workerRunning) {
    try {
      iterationCount++;
      const iterationStartTime = Date.now();
      const timeSinceLastIteration = iterationStartTime - lastIterationTime;
      if (!workerRunning) {
        break;
      }

      const xreadStartTime = Date.now();
      const result = await redis.call(
        "XREADGROUP",
        "GROUP",
        CONSUMER_GROUP,
        CONSUMER_NAME,
        "COUNT",
        BATCH_SIZE,
        "BLOCK",
        BLOCK_TIMEOUT_MS,
        "STREAMS",
        STREAM_NAME,
        ">",
      ) as any;
      const xreadDuration = Date.now() - xreadStartTime;

      if (!workerRunning) {
        break;
      }

      if (!result || result.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        lastIterationTime = Date.now();
        continue;
      }

      for (const streamData of result) {
        if (Array.isArray(streamData) && streamData.length >= 2) {
          const stream = typeof streamData[0] === "string" ? streamData[0] : new TextDecoder().decode(streamData[0] as Uint8Array);
          const messages = streamData[1];

          if (stream === STREAM_NAME && Array.isArray(messages)) {
            try {
              await processBatch(messages);
            } catch (error) {
              console.error(`[AccessLog] Error processing batch:`, error);
            }
          }
        }
      }
      lastIterationTime = Date.now();
    } catch (error: any) {
      if (error.message && error.message.includes("NOGROUP")) {
        console.log(`[AccessLog] Consumer group ${CONSUMER_GROUP} not found, recreating...`);
        await ensureConsumerGroup();
      } else {
        console.error(`[AccessLog] Error reading from stream:`, error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      lastIterationTime = Date.now();
    }
  }
}

export async function startAccessLogWorker(): Promise<void> {
  if (accessLogWorker) {
    console.log("[AccessLog] Worker already started");
    return;
  }

  console.log("[AccessLog] Starting access log worker...");

  try {
    await ensureConsumerGroup();

    workerRunning = true;

    workerLoopPromise = workerLoop().catch((error) => {
      console.error("[AccessLog] Worker loop error:", error);
      workerRunning = false;
      accessLogWorker = null;
      workerLoopPromise = null;
    });

    accessLogWorker = {
      stop: async () => {
        console.log("[AccessLog] Stopping access log worker...");
        workerRunning = false;
        if (workerLoopPromise) {
          await workerLoopPromise;
          workerLoopPromise = null;
        }
        accessLogWorker = null;
        console.log("[AccessLog] Access log worker stopped");
      },
    };

    console.log("[AccessLog] Access log worker started");
  } catch (error) {
    console.error("[AccessLog] Failed to start worker:", error);
    throw error;
  }
}

export async function stopAccessLogWorker(): Promise<void> {
  if (accessLogWorker) {
    await accessLogWorker.stop();
  }
}

