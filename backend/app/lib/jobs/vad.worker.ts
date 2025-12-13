import { Job } from "bullmq";
import type { VadJobData, VadJobProgress, VadJobResult } from "./types.ts";
import { redis } from "@/lib/redis.ts";

const PYTHON_PATH = new URL("../../../../python", import.meta.url).pathname;

export async function processVadJob(
  job: Job<VadJobData>,
): Promise<VadJobResult> {
  const startTime = Date.now();
  const { limit, batchSize, originalId, start, end } = job.data;

  await publishProgress(job, {
    processed: 0,
    total: limit,
    hasSpeech: 0,
  });

  const args = [
    "--limit",
    limit.toString(),
    "--batch-size",
    batchSize.toString(),
  ];

  if (originalId) {
    args.push("--original-id", originalId);
  }

  if (start) {
    args.push("--start", start.toISOString());
  }

  if (end) {
    args.push("--end", end.toISOString());
  }

  const command = new Deno.Command("python3", {
    args: [
      `${PYTHON_PATH}/diarization.py`,
      "--job-mode",
      "--job-id",
      job.id!,
      ...args,
    ],
    cwd: PYTHON_PATH,
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();

  const stdoutReader = process.stdout.getReader();
  const stderrReader = process.stderr.getReader();

  const decoder = new TextDecoder();
  let stdoutBuffer = "";
  let stderrBuffer = "";

  const readStdout = async () => {
    try {
      while (true) {
        const { done, value } = await stdoutReader.read();
        if (done) break;

        stdoutBuffer += decoder.decode(value, { stream: true });
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("PROGRESS:")) {
            try {
              const progressData = JSON.parse(line.substring(9));
              await publishProgress(job, progressData);
              await job.updateProgress(progressData);
            } catch (e) {
              console.error("Failed to parse progress:", e);
            }
          } else if (line.startsWith("RESULT:")) {
            console.log("VAD result:", line);
          }
        }
      }
    } finally {
      stdoutReader.releaseLock();
    }
  };

  const readStderr = async () => {
    try {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;

        stderrBuffer += decoder.decode(value, { stream: true });
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            console.error(`VAD stderr: ${line}`);
          }
        }
      }
    } finally {
      stderrReader.releaseLock();
    }
  };

  await Promise.all([readStdout(), readStderr()]);

  const status = await process.status;

  if (!status.success) {
    throw new Error(
      `VAD process failed with code ${status.code}: ${stderrBuffer}`,
    );
  }

  const duration = (Date.now() - startTime) / 1000;

  return {
    processed: limit,
    hasSpeech: 0,
    duration,
  };
}

async function publishProgress(
  job: Job<VadJobData>,
  progress: VadJobProgress,
): Promise<void> {
  const streamKey = `progress:vad:${job.id}`;

  await redis.xadd(
    streamKey,
    "*",
    "processed",
    progress.processed.toString(),
    "total",
    progress.total.toString(),
    "hasSpeech",
    progress.hasSpeech.toString(),
    "timestamp",
    new Date().toISOString(),
    ...(progress.currentTimestamp
      ? ["currentTimestamp", progress.currentTimestamp]
      : []),
    ...(progress.chunksPerSecond
      ? ["chunksPerSecond", progress.chunksPerSecond.toString()]
      : []),
  );

  await redis.expire(streamKey, 3600);
}
