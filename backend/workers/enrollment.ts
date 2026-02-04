import { z } from "zod";
import { NetworkJobCapability } from "./python.ts";

/**
 * Voice enrollment job - enrolls a speaker from audio file.
 * 
 * This job extracts a speaker embedding from audio and creates/updates
 * a speaker profile in the speaker_profiles collection.
 */

/** Schema for enrollment job data */
export const schema = z.object({
  type: z.literal("enrollment"),
  /** Speaker name (e.g., "Me", "Wife", "Bob") */
  name: z.string().min(1),
  /** True if this is the user's primary voice ("my voice") */
  is_primary: z.boolean().default(false),
  /** ID of an existing audio chunk to enroll from */
  audio_chunk_id: z.string().optional(),
  /** Base64-encoded audio data (for uploaded files) */
  audio_data_base64: z.string().optional(),
  /** Start time for segment extraction (optional) */
  start: z.number().optional(),
  /** End time for segment extraction (optional) */
  end: z.number().optional(),
}).refine(
  (data) => data.audio_chunk_id || data.audio_data_base64,
  { message: "Either audio_chunk_id or audio_data_base64 must be provided" }
);

const PYTHON_WORKER_URL = Deno.env.get("PYTHON_WORKER_URL") || "http://localhost:8000";

export default new NetworkJobCapability({
  name: "enrollment",
  schema,
  url: `${PYTHON_WORKER_URL}/jobs/enrollment`,
  policies: [
    { resource: "db/speaker_profiles", action: "*", effect: "allow" },
    { resource: "db/audio_chunks", action: "read", effect: "allow" },
  ],
});
