import { assertEquals } from "jsr:@std/assert";
import {
  zMediaKnowledgeConfig,
  zMediaRecognitionProfile,
  zMediaVisualUnderstanding,
} from "./media.ts";

Deno.test("media defaults keep Google spend guard deliberately tiny", () => {
  const parsed = zMediaKnowledgeConfig.parse({});
  assertEquals(parsed.promoGuard.monthlyGrossLimitUsd, 1);
  assertEquals(parsed.promoGuard.dailyGrossLimitUsd, 0.1);
  assertEquals(parsed.promoGuard.perImportGrossLimitUsd, 0.01);
});

Deno.test("legacy Google media profile gains pinned Vertex models", () => {
  const parsed = zMediaRecognitionProfile.parse({
    id: "google-media",
    name: "Google Media",
    providerType: "google-cloud",
    enabled: false,
    concurrency: 1,
    projectId: "mycelia-photo-project",
    location: "eu",
    documentAiProcessorId: "optional-ocr",
    documentAiProcessorVersion: "pretrained-ocr-v2.1-2024-08-07",
    allowGlobalPhotoAnalysis: false,
  });
  assertEquals(parsed.providerType, "google-cloud");
  if (parsed.providerType !== "google-cloud") return;
  assertEquals(parsed.vertexModel, "gemini-3.5-flash-lite");
  assertEquals(parsed.embeddingModel, "gemini-embedding-001");
});

Deno.test("visual understanding accepts Russian provider-neutral structure", () => {
  const parsed = zMediaVisualUnderstanding.parse({
    shortCaption: "Люди у моря",
    description: "Два человека стоят на берегу рядом с водой.",
    scene: {
      summary: "Побережье",
      environment: "outdoor",
      placeType: "пляж",
      timeOfDay: "day",
      confidence: 0.9,
    },
    objects: [{
      name: "море",
      attributes: ["спокойное"],
      confidence: 0.95,
    }],
    activities: [{ description: "прогулка", confidence: 0.7 }],
    peopleCount: 2,
    keywords: ["море", "люди"],
    possibleEvent: null,
    confidence: 0.85,
    warnings: [],
  });
  assertEquals(parsed.peopleCount, 2);
  assertEquals(parsed.scene.environment, "outdoor");
});
