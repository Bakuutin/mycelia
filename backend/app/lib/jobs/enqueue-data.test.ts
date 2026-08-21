import { expect } from "@std/expect";
import { sanitizeEnqueueData } from "./enqueue-data.ts";

Deno.test("chunk creator accepts but does not persist legacy inference fields", () => {
  expect(sanitizeEnqueueData({
    type: "conversation_chunk_creator",
    model: "old-model",
    fallbackModel: "old-fallback",
    providerProfileId: "old-provider",
    routingContext: { providerProfileId: "old-provider" },
    maxChunks: 10,
  })).toEqual({
    type: "conversation_chunk_creator",
    maxChunks: 10,
  });
});

Deno.test("routed worker enqueue data is unchanged", () => {
  const input = {
    type: "conversation_extractor_merged",
    model: "medium",
    routingContext: { providerProfileId: "provider" },
  };
  expect(sanitizeEnqueueData(input)).toBe(input);
});
