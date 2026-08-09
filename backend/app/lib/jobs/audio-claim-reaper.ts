import { DEFAULT_JOB_TIMEOUT_MS } from "./job-timeouts.ts";

export const AUDIO_CLAIM_STALE_AFTER_MS = DEFAULT_JOB_TIMEOUT_MS +
  5 * 60 * 1000;

type MongoResource = (input: any) => Promise<any>;

export async function releaseStaleAudioChunkClaims(
  mongo: MongoResource,
  now = new Date(),
): Promise<number> {
  const result = await mongo({
    action: "updateMany",
    collection: "audio_chunks",
    query: {
      processing_by: { $ne: null },
      claimed_at: {
        $lte: new Date(now.getTime() - AUDIO_CLAIM_STALE_AFTER_MS),
      },
    },
    update: {
      $set: { processing_by: null },
      $unset: { claimed_at: "" },
    },
  });
  return result.modifiedCount ?? 0;
}
