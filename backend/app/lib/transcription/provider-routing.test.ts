import { expect } from "@std/expect";
import { zTranscriptionProfilesConfig } from "@myceliasdk/config.ts";
import {
  getTranscriptionProviderCapacity,
  selectTranscriptionProvider,
  type TranscriptionProviderProfile,
} from "./provider-routing.ts";

const profiles: TranscriptionProviderProfile[] = [
  {
    id: "local",
    name: "Local Whisper",
    baseUrl: "http://localhost:8001",
    apiKey: "local-key",
    model: "large-v3",
    enabled: true,
    concurrency: 1,
  },
  {
    id: "cloud",
    name: "Cloud STT",
    baseUrl: "https://stt.example.com",
    apiKey: "cloud-key",
    model: "whisper-1",
    enabled: true,
    concurrency: 2,
  },
];

Deno.test("STT provider capacity sums enabled profile slots", () => {
  expect(getTranscriptionProviderCapacity(profiles)).toBe(3);
  expect(getTranscriptionProviderCapacity([
    profiles[0],
    { ...profiles[1], enabled: false },
  ])).toBe(1);
});

Deno.test("STT provider selection reserves waiting jobs against profile slots", () => {
  expect(selectTranscriptionProvider(profiles, {})?.id).toBe("cloud");
  expect(selectTranscriptionProvider(profiles, { cloud: 1 })?.id).toBe(
    "local",
  );
  expect(selectTranscriptionProvider(profiles, { cloud: 1, local: 1 })?.id)
    .toBe("cloud");
  expect(selectTranscriptionProvider(profiles, { cloud: 2, local: 1 })).toBe(
    null,
  );
});

Deno.test("STT profile config requires an enabled route and at most eight slots", () => {
  expect(() =>
    zTranscriptionProfilesConfig.parse({
      profiles: profiles.map((profile) => ({ ...profile, enabled: false })),
    })
  ).toThrow(/At least one STT provider profile/);
  expect(() =>
    zTranscriptionProfilesConfig.parse({
      profiles: profiles.map((profile) => ({ ...profile, concurrency: 8 })),
    })
  ).toThrow(/cannot exceed 8/);
  expect(zTranscriptionProfilesConfig.parse({ profiles }).profiles)
    .toHaveLength(
      2,
    );
});
