import {
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "jsr:@std/assert@^1.0.15";
import { ObjectId } from "mongodb";
import { estimateMediaGrossUsd } from "@/lib/media/costs.ts";
import {
  assertRecognitionTasks,
  FOLDER_CHUNK_SIZE,
  geoBoundsQuery,
  mediaLibraryRequestSchema,
  MediaLibraryResource,
  RECOGNITION_WINDOW,
  recognitionEligibilityQuery,
  selectionDigest,
  timelineResolution,
} from "./resource.server.ts";

const googleProfile = {
  id: "google-cloud-media",
  name: "Google Cloud EU Photo Knowledge",
  providerType: "google-cloud" as const,
  enabled: true,
  concurrency: 1,
  projectId: "example-photo-project",
  location: "eu" as const,
  vertexModel: "gemini-3.5-flash-lite" as const,
  embeddingModel: "gemini-embedding-001" as const,
  embeddingLocation: "europe-west4" as const,
  documentAiProcessorVersion: "pretrained-ocr-v2.1-2024-08-07" as const,
  allowGlobalPhotoAnalysis: false,
};

Deno.test("folder and recognition campaigns use bounded work windows", () => {
  assertEquals(FOLDER_CHUNK_SIZE, 25);
  assertEquals(RECOGNITION_WINDOW, 16);
});

Deno.test("bulk Google photo knowledge is fixed to visual understanding and OCR", () => {
  assertRecognitionTasks(googleProfile, ["visual-understanding", "ocr"]);
  assertThrows(
    () => assertRecognitionTasks(googleProfile, ["labels"]),
    Error,
    "intentionally supports visual understanding and OCR only",
  );
  assertEquals(
    estimateMediaGrossUsd(
      "image",
      1,
      ["visual-understanding", "ocr"],
      googleProfile,
    ),
    0.0075,
  );
  assertEquals(Number((928 * 0.0075).toFixed(2)), 6.96);
});

Deno.test("batch selection digest binds owner cutoff profile tasks and every SHA", () => {
  const cutoff = new Date("2026-08-25T12:00:00.000Z");
  const assets = [
    { _id: new ObjectId("68a000000000000000000001"), sha256: "a".repeat(64) },
    { _id: new ObjectId("68a000000000000000000002"), sha256: "b".repeat(64) },
  ];
  const first = selectionDigest(
    "admin",
    cutoff,
    googleProfile,
    ["visual-understanding", "ocr"],
    assets,
  );
  assertEquals(
    first,
    selectionDigest(
      "admin",
      cutoff,
      googleProfile,
      ["ocr", "visual-understanding"],
      assets,
    ),
  );
  assertNotEquals(
    first,
    selectionDigest(
      "admin",
      cutoff,
      googleProfile,
      ["visual-understanding", "ocr"],
      [{ ...assets[0], sha256: "c".repeat(64) }, assets[1]],
    ),
  );
});

Deno.test("recognition eligibility excludes ready and active assets", () => {
  assertEquals(recognitionEligibilityQuery("admin"), {
    owner: "admin",
    kind: "image",
    status: {
      $in: ["staged", "failed", "budget_blocked", "recognition_disabled"],
    },
    $or: [
      {
        storageMode: "managed_original",
        "managedOriginal.fileId": { $exists: true },
      },
      {
        storageMode: "external_reference",
        "source.relativePath": { $type: "string" },
      },
    ],
  });
});

Deno.test("photo Timeline switches from hour to day and month density", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  assertEquals(
    timelineResolution(start, new Date("2026-01-08T00:00:00Z")),
    "hour",
  );
  assertEquals(
    timelineResolution(start, new Date("2026-06-01T00:00:00Z")),
    "day",
  );
  assertEquals(
    timelineResolution(start, new Date("2029-01-01T00:00:00Z")),
    "month",
  );
});

Deno.test("map bounds use GeoJSON and split an antimeridian viewport", () => {
  const normal = geoBoundsQuery({
    west: 40,
    south: 39,
    east: 45,
    north: 42,
  });
  assertEquals((normal as any).geo.$geoWithin.$geometry.type, "Polygon");
  const crossing = geoBoundsQuery({
    west: 170,
    south: -10,
    east: -170,
    north: 10,
  });
  assertEquals((crossing as any).$or.length, 2);
  assertEquals(
    geoBoundsQuery({ west: -180, south: -80, east: 40, north: 80 }),
    { "geo.type": "Point" },
  );
});

Deno.test("worker-only campaign actions require process capability", () => {
  const resource = new MediaLibraryResource();
  const jobId = new ObjectId().toString();
  assertEquals(
    resource.extractActions(
      mediaLibraryRequestSchema.parse({
        action: "processRecognitionBatch",
        jobId,
      }),
    ),
    [{
      path: ["media-library", "processRecognitionBatch"],
      actions: ["process"],
    }],
  );
  assertEquals(
    resource.extractActions(
      mediaLibraryRequestSchema.parse({ action: "summary" }),
    ),
    [{ path: ["media-library", "summary"], actions: ["use"] }],
  );
});
