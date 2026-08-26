import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.15";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { loadTrustedMediaRecognitionJob } from "./job-auth.server.ts";
import { beginRecognitionBatchProviderCall } from "./resource.server.ts";

Deno.test(
  "media processing trusts only the signed principal and persisted job snapshot",
  withFixtures(["Mongo"], async ({ db }) => {
    const jobId = new ObjectId();
    const assetId = new ObjectId().toString();
    const recognitionBatchId = new ObjectId().toString();
    await db.collection("jobs").insertOne({
      _id: jobId,
      type: "mediaRecognition",
      trigger: { type: "manual", principal: "photo-owner" },
      data: {
        type: "mediaRecognition",
        assetId,
        profileSnapshot: {
          id: "trusted-profile",
          providerType: "self-hosted",
        },
        requestedTasks: ["visual-understanding"],
        consentReceiptId: "trusted-consent",
        recognitionBatchId,
      },
    });

    const trusted = await loadTrustedMediaRecognitionJob(
      db,
      `job:${jobId}`,
      jobId.toString(),
      assetId,
    );
    assertEquals(trusted.owner, "photo-owner");
    assertEquals(trusted.consentReceiptId, "trusted-consent");
    assertEquals(trusted.profileSnapshot.id, "trusted-profile");
    assertEquals(trusted.recognitionBatchId, recognitionBatchId);

    await assertRejects(
      () =>
        loadTrustedMediaRecognitionJob(
          db,
          "browser-owner",
          jobId.toString(),
          assetId,
        ),
      Error,
      "signed worker job",
    );
    await assertRejects(
      () =>
        loadTrustedMediaRecognitionJob(
          db,
          `job:${jobId}`,
          jobId.toString(),
          new ObjectId().toString(),
        ),
      Error,
      "does not match",
    );
  }),
);

Deno.test(
  "media processing atomically fences cancellation against provider start",
  withFixtures(["Mongo"], async ({ db }) => {
    const activeBatchId = new ObjectId();
    const firstJobId = new ObjectId();
    const blockedJobId = new ObjectId();
    const now = new Date();
    await db.collection("media_recognition_batches").insertOne({
      _id: activeBatchId,
      status: "running",
      createdAt: now,
      updatedAt: now,
    });

    assertEquals(
      await beginRecognitionBatchProviderCall(
        db,
        String(activeBatchId),
        String(firstJobId),
      ),
      true,
    );
    const started = await db.collection("media_recognition_batches").findOne({
      _id: activeBatchId,
    });
    assertEquals(started?.lastProviderStartFence?.jobId, firstJobId);

    await db.collection("media_recognition_batches").updateOne(
      { _id: activeBatchId },
      { $set: { cancelRequestedAt: new Date(), updatedAt: new Date() } },
    );
    assertEquals(
      await beginRecognitionBatchProviderCall(
        db,
        String(activeBatchId),
        String(blockedJobId),
      ),
      false,
    );
    assertEquals(
      await beginRecognitionBatchProviderCall(
        db,
        undefined,
        String(blockedJobId),
      ),
      true,
    );
    assertEquals(
      await beginRecognitionBatchProviderCall(
        db,
        String(new ObjectId()),
        String(blockedJobId),
      ),
      false,
    );
    await assertRejects(
      () =>
        beginRecognitionBatchProviderCall(
          db,
          "not-an-object-id",
          String(blockedJobId),
        ),
      Error,
      "Trusted recognition batch id is invalid",
    );
  }),
);
