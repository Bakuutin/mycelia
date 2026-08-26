import { expect } from "@std/expect";
import {
  buildIdentityCampaignRecoveryJob,
  reconcileIdentityCampaignReservations,
} from "./identity-campaign-recovery.ts";

Deno.test("identity reservation recovery reuses the persisted job id and snapshot", async () => {
  const campaignId = "speaker-identity-campaign";
  const jobId = "6a8d00000000000000000001";
  const campaign = {
    _id: "campaign-row",
    campaignId,
    mode: "classify_all_compatible",
    active: true,
    status: "queued",
    currentJobId: jobId,
    profileId: "6a8d00000000000000000002",
    profileRevision: 5,
    calibrationId: "calibration-5",
    evidenceSnapshotHash: "evidence-5",
    snapshotCutoff: new Date("2026-08-25T00:00:00Z"),
    totalSegments: 42,
    partitionIndex: 0,
    partitions: [{
      runId: "legacy-v0",
      embeddingSpaceId: "space-v1",
      start: new Date("2025-01-01T00:00:00Z"),
      end: new Date("2026-08-25T00:00:00Z"),
      eligibleSegments: 42,
      sourceSegments: 42,
    }],
    updatedAt: new Date("2026-08-24T23:00:00Z"),
  };
  const requests: Array<Record<string, any>> = [];
  const enqueued: Array<{ data: any; options: any }> = [];
  const mongo = async (request: Record<string, any>) => {
    requests.push(request);
    if (request.action === "find") return [campaign];
    if (request.action === "findOne") return null;
    if (request.action === "updateOne") {
      return { matchedCount: 1, modifiedCount: 1 };
    }
    throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
  };

  const result = await reconcileIdentityCampaignReservations({
    mongo,
    now: new Date("2026-08-25T00:05:00Z"),
    enqueue: ((data: any, options: any) => {
      enqueued.push({ data, options });
      return Promise.resolve({ id: options.jobId, data } as any);
    }) as any,
  });

  expect(result).toEqual({ recovered: 1, retained: 0, retriedLater: 0 });
  expect(enqueued[0].options.jobId).toBe(jobId);
  expect(enqueued[0].data).toEqual(buildIdentityCampaignRecoveryJob(campaign));
  expect(enqueued[0].data.runId).toBe("legacy-v0");
  expect(enqueued[0].data.snapshotCutoff).toEqual(campaign.snapshotCutoff);
  expect(
    requests.some((request) =>
      request.update?.$set?.reservationRecoveredAt != null
    ),
  ).toBe(true);
});
