import { expect } from "@std/expect";
import diarization, { schema } from "./diarization.ts";

Deno.test("diarization job can read its feature flag and speaker profiles", () => {
  expect(diarization.policies).toEqual([
    { resource: "config/read", action: "read", effect: "allow" },
    { resource: "db/configs", action: "read", effect: "allow" },
    { resource: "db/audio_chunks", action: "*", effect: "allow" },
    { resource: "db/diarizations", action: "read", effect: "allow" },
    { resource: "db/diarizations", action: "write", effect: "allow" },
    { resource: "db/diarizations", action: "update", effect: "allow" },
    { resource: "db/diarization_runs", action: "*", effect: "allow" },
    { resource: "db/diarization_campaigns", action: "*", effect: "allow" },
    { resource: "db/speaker_profiles", action: "read", effect: "allow" },
  ]);
});

Deno.test("diarization polls the historical backlog without live event sources", async () => {
  expect(diarization.triggers).toMatchObject({
    interval: 300,
    sources: [],
  });
  expect(typeof diarization.hasPendingWork).toBe("function");
  const data = await diarization.getTriggerJobData?.(
    {},
    "interval",
    { mongo: async () => [] },
  );
  expect(data).toMatchObject({
    type: "diarization",
    mode: "missing",
  });
  expect(data?.campaignId).toMatch(/^diarization-historical-/);
});

Deno.test("historical watchdog resumes an interrupted campaign", async () => {
  const data = await diarization.getTriggerJobData?.({}, "interval", {
    mongo: async (request) =>
      request.collection === "diarization_campaigns"
        ? [{
          campaignId: "campaign-existing",
          status: "interrupted",
          range: { start: new Date("2026-08-01"), end: new Date("2026-08-08") },
        }]
        : [],
  });

  expect(data).toMatchObject({
    campaignId: "campaign-existing",
    start: new Date("2026-08-01"),
    end: new Date("2026-08-08"),
  });
});

Deno.test("diarization jobs are bounded and preserve the requested run", () => {
  expect(schema.parse({ type: "diarization" })).toMatchObject({
    type: "diarization",
    limit: 4,
    batchSize: 4,
    mode: "missing",
  });
  expect(schema.parse({
    type: "diarization",
    limit: 8,
    mode: "build_generation",
    runId: "run-1",
    campaignId: "campaign-1",
    originalId: "507f1f77bcf86cd799439011",
  })).toMatchObject({
    limit: 8,
    mode: "build_generation",
    runId: "run-1",
    campaignId: "campaign-1",
    originalId: "507f1f77bcf86cd799439011",
  });
});
