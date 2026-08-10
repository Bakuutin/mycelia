import type { Job } from "bullmq";
import type { JobData, JobResult } from "./types.ts";
import { jobRegistry } from "./job-registry.ts";
import { signJWT } from "@/lib/auth/tokens.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { EJSON, ObjectId } from "bson";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { assertJobServicesHealthy } from "./service-health.ts";
import { getJobTimeoutMinutes, getJobTimeoutMs } from "./job-timeouts.ts";
import { isCancelledJobRecord } from "./job-state.ts";

const activeChildren = new Map<string, Deno.ChildProcess>();

/**
 * True while this process still has a live worker child for the job. The queue
 * can lose its record of a job (a Redis restart drops everything written since
 * the last snapshot) while the work itself is very much still in flight.
 */
export function isJobRunningLocally(jobId: string): boolean {
  return activeChildren.has(jobId);
}

export function cancelRunningJob(jobId: string): boolean {
  const child = activeChildren.get(jobId);
  if (!child) return false;

  try {
    child.kill("SIGKILL");
    return true;
  } catch {
    return false;
  }
}

export async function processJob(job: Job<JobData>): Promise<JobResult> {
  const jobType = job.data.type;
  const jobTimeoutMs = getJobTimeoutMs(jobType, job.data);
  const capability = jobRegistry.getOrThrow(jobType);

  const cancellationMongo = await getMongoResource(await getServerAuth());
  const cancellationRecord = await cancellationMongo({
    action: "findOne",
    collection: "jobs",
    query: { _id: new ObjectId(job.id) },
    options: { projection: { state: 1 } },
  });
  if (isCancelledJobRecord(cancellationRecord)) {
    throw new Error(`Job ${job.id} was cancelled before execution`);
  }

  // Re-check at execution time because a provider may have gone down after the
  // job entered the queue. This prevents expensive worker startup and a doomed
  // external API call. The source sequence/chunk/object remains retryable.
  await assertJobServicesHealthy(jobType);

  // Apply default overrides from workers collection (fallback for legacy jobs)
  // NOTE: Worker defaults are now primarily applied at enqueue time in queue.ts
  // This fallback handles jobs enqueued before that change was deployed
  const { workerDiscovery } = await import("./worker-discovery.ts");
  const defaultOverrides = await workerDiscovery.getDefaultOverrides(jobType);

  const mergedJobData = { ...job.data };
  if (defaultOverrides) {
    // Only apply overrides for fields not already in job data
    for (const [key, value] of Object.entries(defaultOverrides)) {
      if (!(key in mergedJobData)) {
        mergedJobData[key] = value;
      }
    }
  }

  const policies = [
    ...(capability.manifest.policies || []),
    { resource: `jobs/${job.id}`, action: "progressUpdate", effect: "allow" },
  ];

  // Token must outlive the job: long batches (summarization, transcription)
  // run past 15 minutes and still need to write results at the end.
  const jwtMarginMs = 5 * 60 * 1000;
  const token = await signJWT(
    jobType,
    `job:${job.id}`,
    policies,
    `${Math.ceil((jobTimeoutMs + jwtMarginMs) / 60_000)}m`,
  );

  const sdkPath = Deno.cwd();

  const tmpDir = await Deno.makeTempDir({
    prefix: `mycelia-${job.id}-`,
  });

  // Get URLs from env vars
  const backendUrl = Deno.env.get("MYCELIA_BACKEND_INTERNAL_URL") ||
    "http://backend:5173";
  const pythonWorkerUrl = Deno.env.get("PYTHON_WORKER_URL") ||
    "http://python-worker:8000";

  const jobEnv: Record<string, string> = {
    MYCELIA_JWT: token,
    MYCELIA_URL: backendUrl,
    MYCELIA_WORKER_PATH: capability.path.href,
    MYCELIA_JOB_ID: job.id || "",
    TMPDIR: tmpDir,
  };

  // Extract hostnames from URLs for network permissions
  const extractHostname = (url: string) => {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}:${
        parsed.port || (parsed.protocol === "https:" ? "443" : "80")
      }`;
    } catch {
      return url; // Fallback if parsing fails
    }
  };

  const allowedHosts = [
    extractHostname(backendUrl),
    extractHostname(pythonWorkerUrl),
    ...(capability.manifest.allowedHosts ?? []),
  ].join(",");

  const launcherPath = `${sdkPath}/app/lib/jobs/workerLauncher.ts`;

  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-E",
      "--config",
      `${sdkPath}/deno.json`,
      `--allow-read=${sdkPath},${sdkPath}/../myceliasdk,${tmpDir}`,
      `--allow-write=${tmpDir}`,
      `--allow-net=${allowedHosts}`,
      `--allow-run=ffmpeg`,
      `--allow-sys=hostname,osRelease`,
      launcherPath,
    ],
    env: jobEnv,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });

  const child = cmd.spawn();
  if (job.id) activeChildren.set(job.id, child);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const mongo = await getMongoResource(await getServerAuth());
  let logQueue = Promise.resolve();

  const enqueueLog = (
    stream: "stdout" | "stderr" | "progress",
    text: string,
  ) => {
    if (!text) return;
    logQueue = logQueue.then(() =>
      mongo({
        action: "insertOne",
        collection: "job_logs",
        doc: {
          jobId: job.id,
          stream,
          text,
          timestamp: new Date(),
        },
      })
    ).catch((err) => {
      console.error(`[Processor] Failed to write log for job ${job.id}:`, err);
    });
  };

  const splitLines = (
    buffer: string,
    chunk: string,
  ): { lines: string[]; rest: string } => {
    const combined = buffer + chunk;
    const parts = combined.split(/\r?\n/);
    const rest = parts.pop() ?? "";
    const lines = parts.filter((line) => line.length > 0);
    return { lines, rest };
  };

  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(EJSON.stringify({
    ...mergedJobData,
    id: job.id,
  })));
  await writer.close();

  let stdoutContent = "";
  let stderrContent = "";
  let stdoutBuffer = "";
  let stderrBuffer = "";

  const stdoutReader = child.stdout.getReader();
  const stderrReader = child.stderr.getReader();

  const readStdout = async () => {
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      stdoutContent += chunk;
      const { lines, rest } = splitLines(stdoutBuffer, chunk);
      stdoutBuffer = rest;
      for (const line of lines) {
        if (line.startsWith("__PROGRESS__:")) {
          try {
            const progress = JSON.parse(line.slice("__PROGRESS__:".length));
            job.updateProgress(progress).catch((err) =>
              console.error(
                `[Processor] Failed to update progress for job ${job.id}:`,
                err,
              )
            );
          } catch {
            // Ignore malformed progress frames without treating them as worker errors.
          }
          enqueueLog("progress", line);
          continue;
        }
        // Print worker logs to server stdout (skip the final JSON result line)
        if (!line.startsWith("{") || !line.endsWith("}")) {
          console.log(`[${jobType}:${job.id}] ${line}`);
        }
        enqueueLog("stdout", line);
      }
    }
    if (stdoutBuffer.trim().length > 0) {
      enqueueLog("stdout", stdoutBuffer);
      stdoutBuffer = "";
    }
  };

  const readStderr = async () => {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      stderrContent += chunk;
      const { lines, rest } = splitLines(stderrBuffer, chunk);
      stderrBuffer = rest;
      for (const line of lines) {
        if (line.startsWith("__PROGRESS__:")) {
          try {
            const progress = JSON.parse(line.slice("__PROGRESS__:".length));
            job.updateProgress(progress).catch((err) =>
              console.error(
                `[Processor] Failed to update progress for job ${job.id}:`,
                err,
              )
            );
          } catch {
            // Ignore parse errors for progress
          }
          enqueueLog("progress", line);
        } else {
          // Print worker stderr to server stderr (except progress updates)
          console.error(`[${jobType}:${job.id}] ${line}`);
          enqueueLog("stderr", line);
        }
      }
    }
    if (stderrBuffer.trim().length > 0) {
      enqueueLog("stderr", stderrBuffer);
      stderrBuffer = "";
    }
  };

  const runChild = async () => {
    await Promise.all([readStdout(), readStderr()]);

    const { code } = await child.status;

    await logQueue;

    if (code !== 0) {
      console.error(
        `[Worker Error] Job ${job.id} failed with code ${code}:`,
        stderrContent,
      );
      throw new Error(`Worker exited with code ${code}: ${stderrContent}`);
    }

    // Find the last line of output which should be the JSON result
    const lines = stdoutContent.trim().split("\n");
    const lastLine = lines[lines.length - 1];

    try {
      return JSON.parse(lastLine);
    } catch (err) {
      console.error("Failed to parse worker output:", stdoutContent);
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new Error(`Failed to parse worker output: ${message}`);
    }
  };

  try {
    const result = await Promise.race([
      runChild(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Ignore kill errors; we still fail the job on timeout.
          }
          reject(
            new Error(
              `Job timed out after ${
                getJobTimeoutMinutes(jobType, job.data)
              } minutes`,
            ),
          );
        }, jobTimeoutMs);
      }),
    ]);

    // Persist completion here as well as in QueueEvents. An active BullMQ job
    // cannot be force-removed safely: its worker may still finish and commit
    // side effects after the queue record was cancelled/removed. In that case
    // BullMQ may never emit the global completed event, so Mongo would
    // otherwise remain incorrectly marked as cancelled.
    const jobDocs = await mongo({
      action: "find",
      collection: "jobs",
      query: { _id: new ObjectId(job.id) },
      options: { limit: 1 },
    });
    const previousState = jobDocs[0]?.state;
    const finishedAt = new Date();

    if (previousState === "cancelled") {
      console.warn(
        `[Processor] Job ${job.id} produced a result after cancellation; ` +
          "reconciling Mongo state to completed",
      );
    }

    await mongo({
      action: "updateOne",
      collection: "jobs",
      query: { _id: new ObjectId(job.id) },
      update: {
        $set: {
          state: "completed",
          finishedAt,
          result,
          updatedAt: finishedAt,
          ...(previousState === "cancelled"
            ? {
              completionReconciliation: {
                previousState,
                reconciledAt: finishedAt,
                reason: "worker_completed_after_cancellation",
              },
            }
            : {}),
        },
        $unset: {
          failedReason: "",
          cancelReason: "",
        },
      },
    });

    return result;
  } finally {
    if (job.id) activeChildren.delete(job.id);
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
