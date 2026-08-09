import { expect } from "@std/expect";
import {
  AUDIO_CLAIM_STALE_AFTER_MS,
  releaseStaleAudioChunkClaims,
} from "./audio-claim-reaper.ts";

Deno.test("releases only stale claimed audio chunks", async () => {
  const requests: unknown[] = [];
  const now = new Date("2026-08-09T12:00:00.000Z");
  const mongo = (request: unknown) => {
    requests.push(request);
    return Promise.resolve({ modifiedCount: 7 });
  };

  const released = await releaseStaleAudioChunkClaims(mongo, now);

  expect(released).toBe(7);
  expect(requests).toEqual([{
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
  }]);
});
