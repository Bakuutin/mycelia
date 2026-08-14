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
    priority: 10,
    concurrency: 1,
  },
  {
    id: "cloud",
    name: "Cloud STT",
    baseUrl: "https://stt.example.com",
    apiKey: "cloud-key",
    model: "whisper-1",
    enabled: true,
    priority: 20,
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
  expect(selectTranscriptionProvider(profiles, {})?.id).toBe("local");
  expect(selectTranscriptionProvider(profiles, { local: 1 })?.id).toBe(
    "cloud",
  );
  expect(selectTranscriptionProvider(profiles, { cloud: 1, local: 1 })?.id)
    .toBe("cloud");
  expect(selectTranscriptionProvider(profiles, { cloud: 2, local: 1 })).toBe(
    null,
  );
});

Deno.test("STT providers with equal priority balance by reserved-slot load", () => {
  const equalPriority = profiles.map((profile) => ({
    ...profile,
    priority: 10,
  }));
  expect(selectTranscriptionProvider(equalPriority, {})?.id).toBe("cloud");
  expect(selectTranscriptionProvider(equalPriority, { cloud: 1 })?.id).toBe(
    "local",
  );
});

Deno.test("STT profile config permits all routes off and caps enabled slots", () => {
  expect(
    zTranscriptionProfilesConfig.parse({
      profiles: profiles.map((profile) => ({ ...profile, enabled: false })),
    }).profiles.every((profile) => !profile.enabled),
  ).toBe(true);
  expect(() =>
    zTranscriptionProfilesConfig.parse({
      profiles: profiles.map((profile) => ({ ...profile, concurrency: 8 })),
    })
  ).toThrow(/cannot exceed 8/);
  expect(zTranscriptionProfilesConfig.parse({ profiles }).profiles)
    .toHaveLength(
      2,
    );
  expect(
    zTranscriptionProfilesConfig.parse({
      profiles: profiles.map((profile) => ({ ...profile, enabled: false })),
      includeEnvironment: true,
    }).includeEnvironment,
  ).toBe(true);
  expect(() =>
    zTranscriptionProfilesConfig.parse({
      profiles: [{ ...profiles[0], concurrency: 8 }],
      includeEnvironment: true,
    })
  ).toThrow(/cannot exceed 8/);
});

Deno.test("STT priority defaults safely for existing configurations", () => {
  const legacyProfile = { ...profiles[0] } as Record<string, unknown>;
  delete legacyProfile.priority;
  const parsed = zTranscriptionProfilesConfig.parse({
    profiles: [legacyProfile],
  });
  expect(parsed.profiles[0].priority).toBe(50);
  expect(parsed.environmentPriority).toBe(50);
  expect(() =>
    zTranscriptionProfilesConfig.parse({
      profiles: [{ ...profiles[0], priority: 0 }],
    })
  ).toThrow();
  expect(() =>
    zTranscriptionProfilesConfig.parse({
      profiles: [{ ...profiles[0], priority: 101 }],
    })
  ).toThrow();
});
