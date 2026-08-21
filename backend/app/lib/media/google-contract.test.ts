import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.15";
import type { MediaRecognitionProfile } from "@myceliasdk/media.ts";
import {
  assertDocumentAiProcessorId,
  assertGcpProjectId,
  googleDocumentAiProcessUrl,
  googleVertexModelUrl,
  googleVisionEuAnnotateUrl,
} from "./google-contract.ts";

const profile: Extract<
  MediaRecognitionProfile,
  { providerType: "google-cloud" }
> = {
  id: "google-media",
  name: "Google Cloud",
  providerType: "google-cloud",
  enabled: true,
  concurrency: 1,
  projectId: "mycelia-media-260821",
  location: "eu",
  vertexModel: "gemini-3.5-flash-lite",
  embeddingModel: "gemini-embedding-001",
  documentAiProcessorId: "abc123def456",
  documentAiProcessorVersion: "pretrained-ocr-v2.1-2024-08-07",
  allowGlobalPhotoAnalysis: false,
};

Deno.test("Google media endpoints are pinned to the intended EU surfaces", () => {
  assertEquals(
    googleVertexModelUrl(
      profile.projectId,
      profile.vertexModel,
      "generateContent",
    ),
    "https://aiplatform.eu.rep.googleapis.com/v1/projects/mycelia-media-260821/locations/eu/publishers/google/models/gemini-3.5-flash-lite:generateContent",
  );
  assertEquals(
    googleVertexModelUrl(
      profile.projectId,
      profile.embeddingModel,
      "predict",
    ),
    "https://aiplatform.eu.rep.googleapis.com/v1/projects/mycelia-media-260821/locations/eu/publishers/google/models/gemini-embedding-001:predict",
  );
  assertEquals(
    googleVisionEuAnnotateUrl(profile.projectId),
    "https://eu-vision.googleapis.com/v1/projects/mycelia-media-260821/locations/eu/images:annotate",
  );
  assertEquals(
    googleDocumentAiProcessUrl(profile),
    "https://eu-documentai.googleapis.com/v1/projects/mycelia-media-260821/locations/eu/processors/abc123def456/processorVersions/pretrained-ocr-v2.1-2024-08-07:process",
  );
});

Deno.test("Google endpoint builders reject path-like identifiers", () => {
  assertThrows(() => assertGcpProjectId("../other-project"));
  assertThrows(() => assertGcpProjectId("UPPERCASE-project"));
  assertThrows(() => assertDocumentAiProcessorId("processor/other"));
});
