import { expect } from "@std/expect";
import diarization from "./diarization.ts";

Deno.test("diarization job can read its feature flag and speaker profiles", () => {
  expect(diarization.policies).toEqual([
    { resource: "config/read", action: "read", effect: "allow" },
    { resource: "db/configs", action: "read", effect: "allow" },
    { resource: "db/audio_chunks", action: "*", effect: "allow" },
    { resource: "db/diarizations", action: "write", effect: "allow" },
    { resource: "db/speaker_profiles", action: "read", effect: "allow" },
  ]);
});
