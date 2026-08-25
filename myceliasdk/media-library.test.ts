import { assertEquals, assertThrows } from "@std/assert";
import {
  zMediaBatchCounts,
  zMediaFolderCampaign,
  zMediaRecognitionBatch,
  zMediaSourceFolderListing,
} from "./media-library.ts";

Deno.test("media batch counts preserve changed and unplaced-scale totals", () => {
  const counts = zMediaBatchCounts.parse({
    total: 900,
    imported: 875,
    changed: 2,
  });
  assertEquals(counts.total, 900);
  assertEquals(counts.imported, 875);
  assertEquals(counts.changed, 2);
});

Deno.test("folder and recognition campaign schemas reject unbounded invalid state", () => {
  const base = {
    _id: "68a000000000000000000001",
    owner: "admin",
    counts: {},
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
  assertEquals(
    zMediaFolderCampaign.parse({
      ...base,
      relativePath: "900-photos",
      status: "scanning",
      progress: {
        stage: "metadata_scan",
        processed: 200,
        total: 801,
        remaining: 601,
        percent: 24.968789,
        filesPerSecond: 1.6,
        etaSeconds: 376,
        chunkSize: 25,
        message: "Reading metadata and hashes locally",
        nextStep: "Review and confirm the local import",
      },
    }).relativePath,
    "900-photos",
  );
  assertThrows(() =>
    zMediaRecognitionBatch.parse({
      ...base,
      status: "running",
      profileId: "google-cloud-media",
      profileName: "Google",
      requestedTasks: ["labels"],
      authorizedGrossUsd: -1,
    })
  );
  assertEquals(
    zMediaSourceFolderListing.parse({
      currentPath: ".",
      folders: [{ name: "Trips", relativePath: "Trips" }],
    }).folders[0]?.relativePath,
    "Trips",
  );
});
