import { z } from "zod";
import { NetworkJobCapability } from "./python.ts";

/**
 * Retroactive speaker matching job - matches existing diarizations to enrolled profiles.
 * 
 * This job processes diarization segments that don't have a matched_speaker,
 * computes cosine similarity against all enrolled speaker profiles, and
 * updates segments with the best match if above the similarity threshold.
 * 
 * This is useful for:
 * - Matching historical data after enrolling a new speaker
 * - Re-running matching with a different threshold
 */

/** Schema for speaker matching job data */
export const schema = z.object({
  type: z.literal("speakerMatching"),
  /** Maximum number of segments to process */
  limit: z.number().int().positive().default(10000),
  /** Batch size for MongoDB queries */
  batch_size: z.number().int().positive().default(500),
  /** Override default similarity threshold (0.35) */
  threshold: z.number().min(0).max(1).optional(),
  /** Only match for specific profile ID (for re-matching) */
  profile_id: z.string().optional(),
});

const PYTHON_WORKER_URL = Deno.env.get("PYTHON_WORKER_URL") || "http://localhost:8000";

export default new NetworkJobCapability({
  name: "speakerMatching",
  schema,
  url: `${PYTHON_WORKER_URL}/jobs/speakerMatching`,
  policies: [
    { resource: "db/speaker_profiles", action: "read", effect: "allow" },
    { resource: "db/diarizations", action: "*", effect: "allow" },
  ],
});
