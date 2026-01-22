import type { Job } from "bullmq";
import type { JobData, JobResult } from "./types.ts";
import { jobRegistry } from "./job-registry.ts";
import { signJWT } from "@/lib/auth/tokens.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { EJSON } from "bson";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

const JOB_TIMEOUT_MS = 15 * 60 * 1000;

export async function processJob(job: Job<JobData>): Promise<JobResult> {
  const jobType = job.data.type;
  const capability = jobRegistry.getOrThrow(jobType);

  const policies = [
    ...(capability.manifest.policies || []),
    { resource: `jobs/${job.id}`, action: "progressUpdate", effect: "allow" },
  ]

  const token = await signJWT(
    jobType,
    `job:${job.id}`,
      policies,
    "15m",
  );

  const sdkPath = Deno.cwd();

  const tmpDir = await Deno.makeTempDir({
    prefix: `mycelia-${job.id}-`,
  });

  const jobEnv: Record<string, string> = {
      MYCELIA_JWT: token,
      MYCELIA_URL: 'http://backend:5173',
      MYCELIA_WORKER_PATH: capability.path.href,
      MYCELIA_JOB_ID: job.id || "",
      TMPDIR: tmpDir,
  };

  const launcherPath = `${sdkPath}/app/lib/jobs/workerLauncher.ts`;


  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-E",
      "--config",
      `${sdkPath}/deno.json`,
      `--allow-read=${sdkPath},${sdkPath}/../myceliasdk,${tmpDir}`,
      `--allow-write=${tmpDir}`,
      `--allow-net=backend:5173,python-worker:8000`, // TODO: allow extra hosts in manifest
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
  let timeoutId: number | null = null;

  const mongo = await getMongoResource(await getServerAuth());
  let logQueue = Promise.resolve();

  const enqueueLog = (stream: "stdout" | "stderr", text: string) => {
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

  const splitLines = (buffer: string, chunk: string): { lines: string[]; rest: string } => {
    const combined = buffer + chunk;
    const parts = combined.split(/\r?\n/);
    const rest = parts.pop() ?? "";
    const lines = parts.filter((line) => line.length > 0);
    return { lines, rest };
  };

  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(EJSON.stringify({
    ...job.data,
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
              console.error(`[Processor] Failed to update progress for job ${job.id}:`, err)
            );
          } catch {
            // Ignore parse errors for progress
          }
        } else {
          // Print worker stderr to server stderr (except progress updates)
          console.error(`[${jobType}:${job.id}] ${line}`);
        }
        enqueueLog("stderr", line);
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
      console.error(`[Worker Error] Job ${job.id} failed with code ${code}:`, stderrContent);
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
    return await Promise.race([
      runChild(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Ignore kill errors; we still fail the job on timeout.
          }
          reject(new Error("Job timed out after 15 minutes"));
        }, JOB_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
