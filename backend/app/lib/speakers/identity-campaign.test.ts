import { expect } from "@std/expect";
import { ObjectId } from "bson";
import {
  buildIdentityEligibleMatch,
  buildIdentityPartitionPipeline,
  normalizeIdentityScope,
} from "./identity-campaign.ts";

const snapshot = {
  calibrationId: "calibration-r5",
  profileId: "698349a50dadb6125cb83312",
  profileRevision: 5,
  embeddingSpaceId: "space-current",
  classificationPolicy: "full" as const,
  evidenceSnapshotHash: "evidence-r5",
};

Deno.test("all-history identity preflight groups real active segment partitions", () => {
  const cutoff = new Date("2026-08-25T12:00:00Z");
  const pipeline = buildIdentityPartitionPipeline(
    snapshot,
    { mode: "all_compatible" },
    cutoff,
  );
  expect(pipeline[0]).toEqual({
    $match: {
      lifecycleStatus: "active",
      embeddingSpaceId: "space-current",
      embedding: { $exists: true },
      start: { $lt: cutoff },
      $nor: [{
        "speakerIdentity.calibrationId": "calibration-r5",
        "speakerIdentity.profileRevision": 5,
        "speakerIdentity.embeddingSpaceId": "space-current",
        "speakerIdentity.source": "automatic",
        "speakerIdentity.validity": "verified",
        $or: [
          {
            "speakerIdentity.profileId": new ObjectId(
              "698349a50dadb6125cb83312",
            ),
          },
          {
            "speakerIdentity.topCandidate.profileId": new ObjectId(
              "698349a50dadb6125cb83312",
            ),
          },
        ],
      }],
    },
  });
  expect(pipeline[2]).toEqual({ $match: { eligibleSegments: { $gt: 0 } } });
});

Deno.test("custom identity scope is fixed and rejects reversed ranges", () => {
  const scope = normalizeIdentityScope({
    mode: "range",
    start: "2026-08-01T00:00:00Z",
    end: "2026-08-02T00:00:00Z",
  });
  const query = buildIdentityEligibleMatch(
    snapshot,
    scope,
    new Date("2026-08-25T00:00:00Z"),
  );
  expect(query.start).toEqual({
    $gte: new Date("2026-08-01T00:00:00Z"),
    $lt: new Date("2026-08-02T00:00:00Z"),
  });
  expect(() =>
    normalizeIdentityScope({
      mode: "range",
      start: "2026-08-02T00:00:00Z",
      end: "2026-08-01T00:00:00Z",
    })
  ).toThrow();
});
