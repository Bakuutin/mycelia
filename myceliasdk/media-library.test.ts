import { assertEquals, assertThrows } from "@std/assert";
import {
  zMediaBatchCounts,
  zMediaFolderCampaign,
  zMediaRecognitionBatch,
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
});
