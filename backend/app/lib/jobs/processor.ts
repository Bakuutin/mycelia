import type { Job } from "bullmq";
import type { JobData, JobResult } from "./types.ts";
import { jobRegistry } from "./job-registry.ts";
import { signJWT } from "@/lib/auth/tokens.ts";
import { env } from "#/env.ts";
import { EJSON } from "bson";

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
  const myceliaUrl = env.MYCELIA_URL || "http://localhost:5173";

  const jobEnv: Record<string, string> = {
      MYCELIA_JWT: token,
      MYCELIA_URL: myceliaUrl,
      MYCELIA_WORKER_PATH: capability.path.href,
  };

  const launcherPath = `${sdkPath}/app/lib/jobs/workerLauncher.ts`;

  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-E",
      "--config",
      `${sdkPath}/deno.json`,
      `--allow-read=${sdkPath}`,
      `--allow-read=${sdkPath}/../interfaces`,
      `--allow-net`, // TODO: limit to specific hosts
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
  await writer.write(new TextEncoder().encode(EJSON.stringify({
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
