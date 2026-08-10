import { expect } from "@std/expect";
import { normalizeChangedFields } from "./changeStream.worker.ts";

Deno.test("Mongo update metadata exposes every changed field name once", () => {
  expect(normalizeChangedFields({
    updatedFields: {
      "vad.has_speech": true,
      processing_by: "worker-1",
    },
    removedFields: ["claimed_at", "processing_by"],
    truncatedArrays: [{ field: "samples", newSize: 2 }],
  })).toEqual([
    "vad.has_speech",
    "processing_by",
    "claimed_at",
    "samples",
  ]);
});
