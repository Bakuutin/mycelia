import { z } from "zod";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { NetworkJobCapability } from "./python.ts";

export const schema = z.object({
  type: z.literal("speakerIdentity"),
  runId: z.string().min(1),
  profileId: z.string().min(1),
  profileRevision: z.number().int().positive(),
  calibrationId: z.string().min(1),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  limit: z.number().int().min(1).max(10000).default(1000),
  cursor: z.string().optional(),
  campaignId: z.string().min(1).optional(),
});

const PYTHON_WORKER_URL = Deno.env.get("PYTHON_WORKER_URL") ||
  "http://localhost:8000";

export default new NetworkJobCapability({
  name: "speakerIdentity",
  schema,
  url: `${PYTHON_WORKER_URL}/jobs/speakerIdentity`,
  policies: [
    { resource: "db/speaker_profiles", action: "read", effect: "allow" },
    { resource: "db/speaker_calibrations", action: "read", effect: "allow" },
    { resource: "db/speaker_identity_campaigns", action: "*", effect: "allow" },
    { resource: "db/diarizations", action: "*", effect: "allow" },
  ],
});
