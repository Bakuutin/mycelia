import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.15";
import {
  buildGoogleMediaEventRequest,
  validateMediaEventUnderstanding,
  validateNormalizedMediaEventAnalysis,
} from "./provider.server.ts";

const profile = {
  id: "google-event",
  name: "Google event test",
  providerType: "google-cloud" as const,
  enabled: true,
  concurrency: 1,
  projectId: "mycelia-event-test",
  location: "eu" as const,
  vertexModel: "gemini-3.5-flash-lite" as const,
  embeddingModel: "gemini-embedding-001" as const,
  embeddingLocation: "europe-west4" as const,
  documentAiProcessorVersion: "pretrained-ocr-v2.1-2024-08-07" as const,
  allowGlobalPhotoAnalysis: false,
};

const previews = ["m01", "m02"].map((ref, index) => ({
  ref,
  bytes: new Uint8Array([index + 1, 2, 3]),
  mimeType: "image/webp" as const,
  width: 256,
  height: 192,
  offsetSeconds: index * 60,
}));

const understanding = {
  schemaVersion: "mycelia.media-event-output.v1" as const,
  title: "Прогулка в парке",
  eventType: "walk" as const,
  description: "Несколько кадров одной прогулки.",
  temporalLabel: "дневная прогулка",
  place: {
    kind: "park" as const,
    visualSummary: "Зелёный городской парк",
    confidence: 0.9,
    evidenceRefs: ["m01"],
  },
  participants: {
    visiblePeopleRange: { min: 1, max: 2 },
    groups: [{
      role: "participants" as const,
      visibleCountRange: { min: 1, max: 2 },
      evidenceRefs: ["m02"],
      confidence: 0.7,
    }],
  },
  keyActions: [{
    text: "прогулка",
    evidenceRefs: ["m01", "m02"],
    confidence: 0.9,
  }],
  highlights: [{
    ref: "m02",
    rank: 1,
    reason: "Самый выразительный кадр",
    confidence: 0.9,
  }],
  keywords: ["парк", "прогулка"],
  confidence: 0.85,
  warnings: [],
};

Deno.test("event provider payload contains previews but no source identifiers", () => {
  const request = buildGoogleMediaEventRequest({
    profile,
    requestId: "event-request",
    previews,
    totalAssetCount: 2,
    durationSeconds: 60,
  });
  const serialized = JSON.stringify(request);
  assertEquals(
    request.contents[0].parts.filter((part) => "inlineData" in part).length,
    2,
  );
  for (
    const forbidden of [
      "/Users/example",
      "photo.jpg",
      "a".repeat(64),
      "GPSLatitude",
      "secret transcript sentence",
      "person-object-id",
    ]
  ) {
    assertEquals(serialized.includes(forbidden), false);
  }
  assertEquals(serialized.includes("identityResolution"), true);
  assertEquals(serialized.includes("forbidden"), true);
});

Deno.test("event provider rejects evidence outside ephemeral preview refs", () => {
  assertEquals(
    validateMediaEventUnderstanding(understanding, ["m01", "m02"]).title,
    "Прогулка в парке",
  );
  assertThrows(
    () =>
      validateMediaEventUnderstanding({
        ...understanding,
        highlights: [{
          ...understanding.highlights[0],
          ref: "asset-real-id",
        }],
      }, ["m01", "m02"]),
    Error,
    "unknown evidence ref",
  );
});

Deno.test("event provider rejects malformed provenance and usage envelopes", () => {
  const valid = {
    understanding,
    provenance: {
      providerType: "self-hosted" as const,
      providerProfileId: "self-hosted-event",
      service: "event-model",
      location: "self-hosted",
      processedAt: "2026-08-22T00:00:00.000Z",
      promptVersion: "media-event-v1",
      privacyVersion: "preview-only-no-identity-v1",
    },
    usage: {
      service: "self-hosted" as const,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      grossListPriceUsd: 0,
    },
  };
  assertEquals(
    validateNormalizedMediaEventAnalysis(valid).usage.inputTokens,
    0,
  );
  assertThrows(() =>
    validateNormalizedMediaEventAnalysis({
      ...valid,
      usage: { ...valid.usage, inputTokens: Number.NaN },
    })
  );
  assertThrows(() =>
    validateNormalizedMediaEventAnalysis({
      ...valid,
      provenance: { ...valid.provenance, processedAt: "not-a-date" },
    })
  );
});
