import { z } from "zod";
import { NetworkJobCapability } from "./python.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { getTriggerTiming } from "@/lib/jobs/trigger-config.ts";

/** Schema for VAD job data */
export const schema = z.object({
  type: z.literal("vad"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  originalId: z.string().optional(),
  limit: z.number().default(100),
  batchSize: z.number().default(100),
});

const PYTHON_WORKER_URL = Deno.env.get("PYTHON_WORKER_URL") || "http://localhost:8000";

export default new NetworkJobCapability({
  name: "vad",
  schema,
  url: `${PYTHON_WORKER_URL}/jobs/vad`,
  policies: [
    { resource: "db/audio_chunks", action: "read", effect: "allow" },
    { resource: "db/audio_chunks", action: "update", effect: "allow" },
  ],
  maxConcurrency: 1,
  triggers: {
    sources: [
      {
        channel: "mycelia:mongo:audio_chunks",
        name: "auto_new_chunks",
        filter: {
          event: "mongo.change",
          "data.operationType": "insert",
          "data.document": { $exists: true },
          "data.document.vad": { $exists: false },
        },
      },
    ],
    ...getTriggerTiming("vad"),
  },
});
