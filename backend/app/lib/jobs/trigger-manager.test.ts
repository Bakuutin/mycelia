import { expect } from "@std/expect";
import {
  buildTriggeredJobData,
  isHealthBlockedEnqueueError,
} from "./trigger-manager.ts";

Deno.test("trigger payload can scope an automatic job", async () => {
  const capability = {
    manifest: { name: "diarization" },
    getTriggerJobData: (payload: any) => ({
      type: "diarization",
      originalId: payload.data.document.original_id,
    }),
  } as any;

  expect(
    await buildTriggeredJobData(
      capability,
      { data: { document: { original_id: "recording-1" } } },
      "new speech",
      async () => null,
    ),
  ).toEqual({ type: "diarization", originalId: "recording-1" });
});

Deno.test("workers without trigger data builders keep the legacy payload", async () => {
  const capability = { manifest: { name: "vad" } } as any;
  expect(
    await buildTriggeredJobData(capability, {}, "interval", async () => null),
  ).toEqual({
    type: "vad",
  });
});

Deno.test("STT provider health failures receive the short trigger retry", () => {
  expect(isHealthBlockedEnqueueError(
    "No healthy STT provider profiles are available",
  )).toBe(true);
  expect(isHealthBlockedEnqueueError("provider health check failed")).toBe(
    true,
  );
  expect(isHealthBlockedEnqueueError(
    "All enabled STT provider concurrency slots are reserved",
  )).toBe(true);
  expect(isHealthBlockedEnqueueError(
    "STT provider local has no free concurrency slots",
  )).toBe(true);
  expect(isHealthBlockedEnqueueError(
    "Transcription job is missing its provider routing snapshot",
  )).toBe(false);
});
