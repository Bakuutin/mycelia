import { GridFSBucket, ObjectId } from "mongodb";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { Buffer } from "node:buffer";

import { z } from "zod";
import { Queue, Worker } from "bullmq";
import { redis } from "@/lib/redis.ts";
import { Auth } from "@/lib/auth/core.server.ts";

export function getFileExtension(filename: string): string {
  const ext = filename.split(".").pop();
  return (ext && /^[a-zA-Z0-9]+$/.test(ext)) ? ext : "";
}

export async function addToProcessingQueue(
  sourceFileId: string,
): Promise<void> {
  await audioTaskQueue.add("process-audio", {
    originalId: sourceFileId,
  }, {
    jobId: sourceFileId,
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

export const AUDIO_TASK_QUEUE_NAME = "mycelia-tasks-audio";

export const AudioProcessingJobSchema = z.object({
  originalId: z.string(),
});

export type AudioProcessingJob = z.infer<typeof AudioProcessingJobSchema>;

export const audioTaskQueue = new Queue<AudioProcessingJob>(
  AUDIO_TASK_QUEUE_NAME,
  { connection: redis },
);

export const spawnAudioProcessingWorker = async () => {
  const worker = new Worker<AudioProcessingJob>(
    AUDIO_TASK_QUEUE_NAME,
    async (job) => {
      const originalId = new ObjectId(job.data.originalId);
      console.log(`Processing audio for ${originalId} in the background`);
      throw new Error("Not implemented");
    },
    { connection: redis },
  );

  worker.on("completed", (job) => {
    console.log(`Audio processing job ${job.id} has completed!`);
  });

  worker.on("failed", (job, err) => {
    if (job) {
      console.log(
        `Audio processing job ${job.id} has failed with ${err.message}`,
      );
    } else {
      console.log(`Audio processing job has failed with ${err.message}`);
    }
  });
};
