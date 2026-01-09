import { z } from "zod";
import { createPythonJobCapability } from "./python.ts";
import { zDateOrString } from "@/lib/zod-json-schema.ts";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";

/** Schema for VAD job data */
export const schema = z.object({
  type: z.literal("vad"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  originalId: z.string().optional(),
  limit: z.number().default(1000),
  batchSize: z.number().default(100),
});

const pythonCap = createPythonJobCapability("vad", schema, [
  { resource: "db/audio_chunks", action: "read", effect: "allow" },
  { resource: "db/audio_chunks", action: "update", effect: "allow" },
]);

const capability: JobCapability = {
  ...pythonCap,
  schema, // Ensure schema is explicitly included
  policies: pythonCap.policies,
  maxConcurrency: 1,
  trigger: {
    sources: [
      {
        channel: "mycelia:mongo:audio_chunks",
        name: "auto_new_chunks",
        filter: (payload: any) => 
          payload.event === "mongo.change" && 
          payload.data.operationType === "insert" &&
          payload.data.document && 
          payload.data.document.vad === undefined,
      },
    ],
    debounceMs: 1000,
  }
};

export default capability;
