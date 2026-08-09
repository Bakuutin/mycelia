import { expect } from "@std/expect";
import diarization, { schema } from "./diarization.ts";

Deno.test("diarization job can read its feature flag and speaker profiles", () => {
  expect(diarization.policies).toEqual([
    { resource: "config/read", action: "read", effect: "allow" },
    { resource: "db/configs", action: "read", effect: "allow" },
    { resource: "db/audio_chunks", action: "*", effect: "allow" },
    { resource: "db/diarizations", action: "write", effect: "allow" },
    { resource: "db/diarizations", action: "update", effect: "allow" },
    { resource: "db/diarization_runs", action: "*", effect: "allow" },
    { resource: "db/speaker_profiles", action: "read", effect: "allow" },
  ]);
});

Deno.test("diarization jobs are bounded and preserve the requested run", () => {
  expect(schema.parse({ type: "diarization" })).toMatchObject({
    type: "diarization",
    limit: 4,
    mode: "missing",
  });
  expect(schema.parse({
    type: "diarization",
    limit: 8,
    mode: "build_generation",
    runId: "run-1",
  })).toMatchObject({
    limit: 8,
    mode: "build_generation",
    runId: "run-1",
  });
});
