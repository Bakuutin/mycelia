import { z } from "zod";
import { NetworkJobCapability } from "./python.ts";

/** Schema for ingestion job data */
export const schema = z.object({
  type: z.literal("ingestion"),
  source: z.string().optional(),
});

const PYTHON_WORKER_URL = Deno.env.get("PYTHON_WORKER_URL") || "http://localhost:8000";

export default new NetworkJobCapability({
  name: "ingestion",
  schema,
  url: `${PYTHON_WORKER_URL}/jobs/ingestion`,
  policies: [
    { resource: "db/audio_chunks", action: "read", effect: "allow" },
    { resource: "db/audio_chunks", action: "write", effect: "allow" },
  ],
});



