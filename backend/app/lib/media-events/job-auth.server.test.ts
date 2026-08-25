import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.15";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { loadTrustedMediaEventJob } from "./job-auth.server.ts";

Deno.test(
  "media event processing trusts only its persisted signed worker job",
  withFixtures(["Mongo"], async ({ db }) => {
    const jobId = new ObjectId();
    const eventId = new ObjectId().toString();
    await db.collection("jobs").insertOne({
      _id: jobId,
      type: "mediaEventAggregation",
      trigger: { type: "manual", principal: "photo-owner" },
      data: {
        type: "mediaEventAggregation",
        eventId,
        profileSnapshot: { id: "trusted-event-profile" },
        consentReceiptId: "event-consent",
      },
    });

    const trusted = await loadTrustedMediaEventJob(
      db,
      `job:${jobId}`,
      jobId.toString(),
      eventId,
    );
    assertEquals(trusted.owner, "photo-owner");
    assertEquals(trusted.profileSnapshot.id, "trusted-event-profile");

    await assertRejects(
      () =>
        loadTrustedMediaEventJob(
          db,
          "browser-owner",
          jobId.toString(),
          eventId,
        ),
      Error,
      "signed worker job",
    );
  }),
);
