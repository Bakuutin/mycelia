import { expect } from "@std/expect";
import { buildTriggeredJobData } from "./trigger-manager.ts";

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
