import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.15";
import {
  type MediaRecognitionProfile,
  zMediaKnowledgeConfig,
} from "@myceliasdk/media.ts";
import { assertMediaPerImportBudget, estimateMediaGrossUsd } from "./costs.ts";

const googleProfile: MediaRecognitionProfile = {
  id: "google-media",
  name: "Google Cloud",
  providerType: "google-cloud",
  enabled: true,
  concurrency: 1,
  projectId: "mycelia-photo-project",
  location: "eu",
  vertexModel: "gemini-3.5-flash-lite",
  embeddingModel: "gemini-embedding-001",
  documentAiProcessorVersion: "pretrained-ocr-v2.1-2024-08-07",
  allowGlobalPhotoAnalysis: true,
};

Deno.test("visual understanding stays below the default per-import guard", () => {
  const config = zMediaKnowledgeConfig.parse({});
  const estimate = estimateMediaGrossUsd(
    "image",
    1,
    ["visual-understanding"],
    googleProfile,
  );

  assertEquals(estimate, 0.006);
  assertMediaPerImportBudget(config, estimate);
});

Deno.test("retry cannot bypass the per-import guard with extra tasks", () => {
  const config = zMediaKnowledgeConfig.parse({});
  const estimate = estimateMediaGrossUsd(
    "image",
    1,
    ["visual-understanding", "ocr", "labels", "objects"],
    googleProfile,
  );

  assertEquals(estimate, 0.01125);
  assertThrows(
    () => assertMediaPerImportBudget(config, estimate),
    Error,
    "exceeds the per-import limit",
  );
});

Deno.test("self-hosted analysis does not reserve Google spend", () => {
  const profile: MediaRecognitionProfile = {
    id: "selfhost",
    name: "Self-hosted",
    providerType: "self-hosted",
    enabled: true,
    concurrency: 1,
    baseUrl: "http://media-provider:8789",
  };

  assertEquals(
    estimateMediaGrossUsd(
      "image",
      1,
      ["visual-understanding", "ocr"],
      profile,
    ),
    0,
  );
});
