import type { Job } from "bullmq";
import type { JobData, JobResult } from "./types.ts";
import { jobRegistry } from "./job-registry.ts";
import { signJWT } from "@/lib/auth/tokens.ts";
import { env } from "#/env.ts";

export async function processJob(job: Job<JobData>): Promise<JobResult> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ef9fc8e4-41f8-4f5d-a482-3ca76d45a827',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'processor.ts:processJob',message:'processJob entry',data:{jobId:job.id,jobType:job.data.type},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  const jobType = job.data.type;
  const capability = jobRegistry.getOrThrow(jobType);

  // 1. Generate short-lived token scoped to the job's required policies
  const token = await signJWT(
    "job-system",
    `job:${job.id}`,
    capability.policies || [],
    "15m",
  );

  // 2. Prepare environment and command
  const sdkPath = Deno.cwd();
  const myceliaUrl = env.MYCELIA_URL || "http://localhost:5173";

  // Grant the child process access to essential environment variables
  const jobEnv: Record<string, string> = {
      MYCELIA_JWT: token,
      MYCELIA_URL: myceliaUrl,
  };

  const launcherPath = `${sdkPath}/app/lib/jobs/workerLauncher.ts`;

  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-E", // allow env
      "--config",
      `${sdkPath}/deno.json`,
      `--allow-read=${sdkPath}`,
      `--allow-read=${sdkPath}/../interfaces`,
      `--allow-net`, // Allow net for MongoDB, Redis, and Mycelia API
      launcherPath,
    ],
    env: jobEnv,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });

  const child = cmd.spawn();

  // 3. Send job data via stdin
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify({
    ...job.data,
    id: job.id,
  })));
  await writer.close();

  // 4. Handle stdout and stderr streams
  let stdoutContent = "";
  let stderrContent = "";

  const stdoutReader = child.stdout.getReader();
  const stderrReader = child.stderr.getReader();

  const readStdout = async () => {
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      stdoutContent += new TextDecoder().decode(value);
    }
  };

  const readStderr = async () => {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      stderrContent += chunk;

      // Check for progress messages in real-time
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("__PROGRESS__:")) {
          try {
            const progress = JSON.parse(line.slice("__PROGRESS__:".length));
            job.updateProgress(progress).catch((err) =>
              console.error(`[Processor] Failed to update progress for job ${job.id}:`, err)
            );
          } catch (e) {
            // Ignore parse errors for progress
          }
        }
      }
    }
  };

  await Promise.all([readStdout(), readStderr()]);

  const { code } = await child.status;

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
}
