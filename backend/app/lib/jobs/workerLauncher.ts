import { verifyToken } from "@/lib/auth/core.server.ts";
import { jobRegistry, discoverJobWorkers } from "@/lib/jobs/job-registry.ts";
import { readAll } from "@std/io/read-all";

/**
 * Worker Launcher - Entry point for isolated job processes
 * 
 * 1. Validates the short-lived JWT from environment
 * 2. Loads the target worker capability
 * 3. Executes the job with limited permissions
 */

async function main() {
  const jwt = Deno.env.get("MYCELIA_JWT");
  const jobDataRaw = await readAll(Deno.stdin);
  const jobData = JSON.parse(new TextDecoder().decode(jobDataRaw));

  if (!jwt) {
    console.error("Missing MYCELIA_JWT environment variable");
    Deno.exit(1);
  }

  // Verify the short-lived token
  const auth = await verifyToken(jwt);
  if (!auth) {
    console.error("Invalid or expired MYCELIA_JWT");
    Deno.exit(1);
  }

  // Discover workers and find the one for this job
  await discoverJobWorkers();
  const capability = jobRegistry.get(jobData.type);

  if (!capability) {
    console.error(`No capability found for job type: ${jobData.type}`);
    Deno.exit(1);
  }

  try {
    // Execute job. The worker's internal calls (e.g. getMongoResource) 
    // will use the permissions from the JWT via updated getServerAuth()
    // In child process, we don't have the full BullMQ Job object, 
    // but we can pass a mock that has the data and progress reporting.
    const result = await capability.use({
      id: jobData.id,
      data: jobData,
      updateProgress: async (progress: any) => {
        // Report progress back to the host via stderr to avoid mixing with JSON result in stdout
        console.error(`__PROGRESS__:${JSON.stringify(progress)}`);
      },
    } as any);
    
    console.log(JSON.stringify(result));
    Deno.exit(0);
  } catch (err) {
    console.error(`Job failed: ${err.message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}

