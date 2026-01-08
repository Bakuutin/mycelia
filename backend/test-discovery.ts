import { discoverJobWorkers } from "./app/lib/jobs/job-registry.ts";

try {
  await discoverJobWorkers();
  console.log("Discovery successful");
} catch (err) {
  console.error("Discovery failed:", err);
  Deno.exit(1);
}

