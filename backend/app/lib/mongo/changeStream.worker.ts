import { getRootDB } from "./core.server.ts";
import { publishEvent } from "@/lib/events/publisher.ts";
import type { ChangeStreamDocument } from "mongodb";
import { debounce } from "@std/async/debounce";

let changeStreamWorker: { stop: () => Promise<void> } | null = null;

function getDocumentId(doc: any): string {
  if (doc._id) {
    return typeof doc._id === "string" ? doc._id : doc._id.toString();
  }
  return "unknown";
}

const debouncedFrequentChanges = debounce(async (collectionName: string) => {
  await publishEvent(`mongo:${collectionName}`, "mongo.change", {
    collection: collectionName,
  });
}, 1000);


async function publishMongoChange(
  collectionName: string,
  operationType: string,
  documentId: string,
  document?: any,
): Promise<void> {
  const eventData = {
    collection: collectionName,
    operationType,
    documentId,
    document,
    timestamp: new Date().toISOString(),
  };

  
  if (collectionName in [
    "histogram_5min",
    "histogram_1hour",
    "histogram_1day",
    "histogram_1week",
    "access_logs",
  ]) {
    debouncedFrequentChanges(collectionName);
    return;
  }

  if (collectionName === "job_logs" && operationType === "insert" && document?.jobId) {
    await publishEvent(`jobs:${document.jobId}:logs`, "job.log", {
      logId: documentId,
      jobId: document.jobId,
      stream: document.stream,
      text: document.text,
      timestamp: document.timestamp ?? new Date().toISOString(),
    });
  }

  await publishEvent(`mongo:${collectionName}:${documentId}`, "mongo.change", eventData);
  await publishEvent(`mongo:${collectionName}`, "mongo.change", eventData);
}

export async function startChangeStreamWorker(): Promise<void> {
  if (changeStreamWorker) {
    console.log("[ChangeStream] Worker already started");
    return;
  }

  console.log("[ChangeStream] Starting MongoDB change stream worker...");

  try {
    const db = await getRootDB();
    const collections = await db.listCollections().toArray();

    const changeStreams: Array<{ stop: () => Promise<void> }> = [];

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;

      if (collectionName.startsWith("system.")) {
        continue;
      }

      try {
        const collection = db.collection(collectionName);
        const changeStream = collection.watch([], { fullDocument: "updateLookup" });

        changeStream.on("change", async (change: ChangeStreamDocument) => {
          try {
            const operationType = change.operationType;
            let documentId: string;
            let document: any = null;

            switch (operationType) {
              case "insert":
                documentId = getDocumentId(change.fullDocument);
                document = change.fullDocument;
                break;
              case "update":
              case "replace":
                documentId = getDocumentId(change.documentKey);
                document = change.fullDocument;
                break;
              case "delete":
                documentId = getDocumentId(change.documentKey);
                break;
              case "invalidate":
                console.warn(`[ChangeStream] Invalid change stream for ${collectionName}`);
                return;
              default:
                return;
            }

            await publishMongoChange(collectionName, operationType, documentId, document);
          } catch (error) {
            console.error(`[ChangeStream] Error processing change for ${collectionName}:`, error);
          }
        });

        changeStream.on("error", (error: Error) => {
          console.error(`[ChangeStream] Error watching ${collectionName}:`, error);
        });

        changeStreams.push({
          stop: async () => {
            await changeStream.close();
          },
        });

      } catch (error) {
        console.error(`[ChangeStream] Failed to watch ${collectionName}:`, error);
      }
    }

    changeStreamWorker = {
      stop: async () => {
        console.log("[ChangeStream] Stopping change stream worker...");
        await Promise.all(changeStreams.map((cs) => cs.stop()));
        changeStreamWorker = null;
        console.log("[ChangeStream] Change stream worker stopped");
      },
    };

    console.log(`[ChangeStream] Started watching ${changeStreams.length} collection(s)`);
  } catch (error) {
    console.error("[ChangeStream] Failed to start worker:", error);
    throw error;
  }
}

export async function stopChangeStreamWorker(): Promise<void> {
  if (changeStreamWorker) {
    await changeStreamWorker.stop();
  }
}

