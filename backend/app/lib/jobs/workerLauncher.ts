import { verifyToken } from "@/lib/auth/core.server.ts";
import { readAll } from "@std/io/read-all";
import { EJSON } from "bson";
import { setupResources } from "@/lib/resources/registry.ts";

/**
 * Worker Launcher - Entry point for isolated job processes
 * 
 * 1. Validates the short-lived JWT from environment
 * 2. Loads the target worker capability directly from path
 * 3. Executes the job with limited permissions
 */

async function main() {
  await setupResources();
  const jwt = Deno.env.get("MYCELIA_JWT");
  const workerPath = Deno.env.get("MYCELIA_WORKER_PATH");
  const jobDataRaw = await readAll(Deno.stdin);
  const jobData = EJSON.parse(new TextDecoder().decode(jobDataRaw));

  if (!jwt) {
    console.error("Missing MYCELIA_JWT environment variable");
    Deno.exit(1);
  }

  if (!workerPath) {
    console.error("Missing MYCELIA_WORKER_PATH environment variable");
    Deno.exit(1);
  }
  // Verify the short-lived token
  const auth = await verifyToken(jwt);
  if (!auth) {
    console.error("Invalid or expired MYCELIA_JWT");
    Deno.exit(1);
  }

  // Load the capability implementation directly
  let capability: any;
  try {
    const mod = await import(workerPath);
    capability = (mod.default && typeof mod.default === "object") ? mod.default : mod;
  } catch (err) {
    console.error(`Failed to load worker at ${workerPath}: ${err}`);
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
    console.error(`Job failed: ${err instanceof Error ? err.message : String(err)}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}

