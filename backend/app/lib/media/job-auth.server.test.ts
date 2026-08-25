import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.15";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { loadTrustedMediaRecognitionJob } from "./job-auth.server.ts";

Deno.test(
  "media processing trusts only the signed principal and persisted job snapshot",
  withFixtures(["Mongo"], async ({ db }) => {
    const jobId = new ObjectId();
    const assetId = new ObjectId().toString();
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
