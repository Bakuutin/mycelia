import { expect } from "@std/expect";
import vad from "./vad.ts";

Deno.test("VAD preflight uses the indexed worker predicate", async () => {
  const calls: any[] = [];
  const pending = await vad.hasPendingWork?.({
    mongo: async (input) => {
      calls.push(input);
      return [{ _id: "audio-chunk" }];
    },
    reason: "interval",
  });

  expect(pending).toBe(1);
  expect(calls).toEqual([{
    action: "find",
    collection: "audio_chunks",
    query: { vad: null },
    options: {
      projection: { _id: 1 },
      limit: 1,
      hint: "audio_chunks_vad_pending_work",
    },
  }]);
});
