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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:72',message:'message parse failed',data:{messageId,error:errorMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:95',message:'MongoDB insert failed',data:{documentCount:documents.length,error:errorMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:120',message:'failed messages saved',data:{failedCount:failedMessages.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
    } catch (error) {
      console.error(`[AccessLog] Failed to save failed messages:`, error);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:125',message:'failed to save failed messages',data:{error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
    }
  }

  if (messageIds.length > 0) {
    await redis.xack(STREAM_NAME, CONSUMER_GROUP, ...messageIds);
    console.log(`[AccessLog] Acknowledged ${messageIds.length} messages (${documents.length} successful, ${failedMessages.length} failed)`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:135',message:'messages acknowledged',data:{totalAcked:messageIds.length,successful:documents.length,failed:failedMessages.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
  }

  const duration = Date.now() - startTime;
  console.log(
    `[AccessLog] Processed batch in ${duration}ms: ${documents.length} successful, ${failedMessages.length} failed`,
  );
}

async function workerLoop(): Promise<void> {
  let iterationCount = 0;
  let lastIterationTime = Date.now();
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:111',message:'workerLoop started',data:{workerRunning},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  while (workerRunning) {
    try {
      iterationCount++;
      const iterationStartTime = Date.now();
      const timeSinceLastIteration = iterationStartTime - lastIterationTime;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:115',message:'loop iteration start',data:{iterationCount,workerRunning,timeSinceLastIteration},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:130',message:'XREADGROUP completed',data:{iterationCount,result:result?result.length:null,isEmpty:!result||result.length===0,xreadDuration},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      if (!workerRunning) {
        break;
      }

      if (!result || result.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:137',message:'empty result, yielding to event loop',data:{iterationCount,timeSinceLastIteration},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:154',message:'workerLoop error',data:{iterationCount,errorMessage:error?.message,isNOGROUP:error?.message?.includes('NOGROUP')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:163',message:'workerLoop exited',data:{iterationCount,workerRunning},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
}

export async function startAccessLogWorker(): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:166',message:'startAccessLogWorker called',data:{hasExistingWorker:!!accessLogWorker,workerRunning},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  if (accessLogWorker) {
    console.log("[AccessLog] Worker already started");
    return;
  }

  console.log("[AccessLog] Starting access log worker...");

  try {
    await ensureConsumerGroup();

    workerRunning = true;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:177',message:'starting workerLoop promise',data:{workerRunning},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion

    workerLoopPromise = workerLoop().catch((error) => {
      console.error("[AccessLog] Worker loop error:", error);
      workerRunning = false;
      accessLogWorker = null;
      workerLoopPromise = null;
    });

    accessLogWorker = {
      stop: async () => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:187',message:'stop called',data:{workerRunning,hasPromise:!!workerLoopPromise},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        console.log("[AccessLog] Stopping access log worker...");
        workerRunning = false;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:190',message:'workerRunning set to false, awaiting promise',data:{workerRunning},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        if (workerLoopPromise) {
          await workerLoopPromise;
          workerLoopPromise = null;
        }
        accessLogWorker = null;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'accessLog.worker.ts:195',message:'stop completed',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
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

