import type { Job } from "bullmq";
import { z } from "zod";
import type { JobData, JobResult } from "../types.ts";
import { env } from "#/env.ts";
import { signJWT } from "@/lib/auth/tokens.ts";

/**
 * Factory to create Python-based job capabilities.
 * Use this to register multiple job types that delegate to the Python worker.
 */
export function createPythonJobCapability(jobType: string, jobSchema: z.ZodType<JobData>) {
  return {
    name: jobType,
    schema: jobSchema,
    use: async (job: Job<JobData>): Promise<JobResult> => {
      const PYTHON_WORKER_URL = env.PYTHON_WORKER_URL;
      const url = `${PYTHON_WORKER_URL}/jobs/${jobType}`;

      // Issue a single-use JWT for this job
      const token = await signJWT(
        "job-worker",
        `job:${job.id}`,
        [{ resource: "**", action: "*", effect: "allow" }],
        "1 hour",
      );

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          jobId: job.id,
          data: job.data,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Python worker failed (${response.status}): ${errorText}`,
        );
      }

      const result = await response.json();
      return result;
    },
  };
}

// Export individual Python job capabilities for auto-discovery
// Each one will be discovered separately

// Note: For Python-based jobs, you can either:
// 1. Create separate files (vad.ts, transcription.ts, etc.) that export name, schema, use
// 2. Or manually register them using jobRegistry.register(createPythonJobCapability(...))
//
// Since auto-discovery expects one capability per file, we export the factory
// and individual job files should use it.
