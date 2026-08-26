import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.15";
import type { MediaRecognitionProfile } from "@myceliasdk/media.ts";
import {
  assertDocumentAiProcessorId,
  assertGcpProjectId,
  googleDocumentAiProcessUrl,
  googleMediaLocationSummary,
  googleMediaServiceSummary,
  googleVertexEmbeddingUrl,
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
  embeddingLocation: "europe-west4",
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
    googleVertexEmbeddingUrl(
      profile.projectId,
      profile.embeddingModel,
      profile.embeddingLocation,
    ),
    "https://europe-west4-aiplatform.googleapis.com/v1/projects/mycelia-media-260821/locations/europe-west4/publishers/google/models/gemini-embedding-001:predict",
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

Deno.test("Google provenance lists only locations used by selected tasks", () => {
  assertEquals(
    googleMediaLocationSummary(profile, ["visual-understanding"]),
    "eu+europe-west4",
  );
  assertEquals(googleMediaLocationSummary(profile, ["ocr"]), "eu");
  assertEquals(
    googleMediaLocationSummary(profile, ["labels"]),
    "global_opt_in",
  );
  assertEquals(
    googleMediaLocationSummary(profile, ["ocr", "objects"]),
    "eu+global_opt_in",
  );
});

Deno.test("Google provenance lists every service used by selected tasks", () => {
  assertEquals(
    googleMediaServiceSummary(["visual-understanding"]),
    "vertex-ai-gemini-visual-understanding+vertex-ai-gemini-embedding",
  );
  assertEquals(
    googleMediaServiceSummary(["visual-understanding", "ocr", "objects"]),
    "vertex-ai-gemini-visual-understanding+vertex-ai-gemini-embedding+cloud-vision-document-text-detection+cloud-vision-object-localization",
  );
});
