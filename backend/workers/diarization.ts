import { z } from "zod";
import { NetworkJobCapability } from "./python.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";

/** Schema for diarization job data */
export const schema = z.object({
  type: z.literal("diarization"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  limit: z.number().int().positive().max(100).default(4),
  mode: z.enum(["missing", "build_generation"]).default("missing"),
  runId: z.string().min(1).optional(),
  cursor: zDateOrString().optional(),
  diarizationServerUrl: z.string().url().optional(),
});

const PYTHON_WORKER_URL = Deno.env.get("PYTHON_WORKER_URL") ||
  "http://localhost:8000";

export default new NetworkJobCapability({
  name: "diarization",
  schema,
  url: `${PYTHON_WORKER_URL}/jobs/diarization`,
  policies: [
    { resource: "config/read", action: "read", effect: "allow" },
    { resource: "db/configs", action: "read", effect: "allow" },
    { resource: "db/audio_chunks", action: "*", effect: "allow" },
    { resource: "db/diarizations", action: "write", effect: "allow" },
    { resource: "db/diarizations", action: "update", effect: "allow" },
    { resource: "db/diarization_runs", action: "*", effect: "allow" },
    { resource: "db/speaker_profiles", action: "read", effect: "allow" },
  ],
});
