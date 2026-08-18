import { expect } from "@std/expect";
import {
  acquireTriggerRun,
  buildTriggeredJobData,
  getTriggerFreeSlots,
  isCapacityBlockedEnqueueError,
  isHealthBlockedEnqueueError,
} from "./trigger-manager.ts";

Deno.test("overlapping triggers cannot reserve the same worker slots", () => {
  const inFlight = new Set<string>();
  expect(acquireTriggerRun(inFlight, "diarization")).toBe(true);
  expect(acquireTriggerRun(inFlight, "diarization")).toBe(false);
  expect(acquireTriggerRun(inFlight, "transcription")).toBe(true);
});

Deno.test("scheduled triggers fill remaining concurrency while work is active", () => {
  expect(getTriggerFreeSlots(3, 1)).toBe(2);
  expect(getTriggerFreeSlots(6, 0, true)).toBe(6);
  expect(getTriggerFreeSlots(3, 1, 1)).toBe(1);
  expect(getTriggerFreeSlots(3, 3)).toBe(0);
});

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

Deno.test("only provider health failures receive the short trigger retry", () => {
  expect(isHealthBlockedEnqueueError(
    "No healthy STT provider profiles are available",
  )).toBe(true);
  expect(isHealthBlockedEnqueueError("provider health check failed")).toBe(
    true,
  );
  expect(isHealthBlockedEnqueueError(
    "All enabled STT provider concurrency slots are reserved",
  )).toBe(false);
  expect(isHealthBlockedEnqueueError(
    "STT provider local has no free concurrency slots",
  )).toBe(false);
  expect(isHealthBlockedEnqueueError(
    "All healthy diarizator provider concurrency slots are reserved",
  )).toBe(false);
  expect(isHealthBlockedEnqueueError(
    "No healthy diarizator route is available. GPU is still loading",
  )).toBe(true);
  expect(isHealthBlockedEnqueueError(
    "Diarizator route reservation is temporarily busy",
  )).toBe(false);
  expect(isHealthBlockedEnqueueError(
    "Transcription job is missing its provider routing snapshot",
  )).toBe(false);
});

Deno.test("provider capacity is a normal bounded trigger stop", () => {
  expect(isCapacityBlockedEnqueueError(
    "All enabled STT provider concurrency slots are reserved",
  )).toBe(true);
  expect(isCapacityBlockedEnqueueError(
    "STT provider local has no free concurrency slots",
  )).toBe(true);
  expect(isCapacityBlockedEnqueueError(
    "All healthy diarizator provider concurrency slots are reserved",
  )).toBe(true);
  expect(isCapacityBlockedEnqueueError(
    "Diarizator route reservation is temporarily busy",
  )).toBe(true);
  expect(isCapacityBlockedEnqueueError("provider health check failed")).toBe(
    false,
  );
});
