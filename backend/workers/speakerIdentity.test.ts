import { expect } from "@std/expect";
import speakerIdentity, { schema } from "./speakerIdentity.ts";

const evidenceSnapshotHash = "sha256:evidence-v5";
const baselineFinishedAt = new Date("2026-08-24T12:00:00Z");

const profile = {
  _id: "698349a50dadb6125cb83312",
  name: "Sky",
  is_primary: true,
  revision: 5,
  embeddingSpaceId: "space-v5",
  embedding: [1, 0],
  enrollmentStatus: "ready",
  activeCalibrationIds: { full: "calibration-v5" },
  calibrationHeadsInitialized: true,
};

const calibration = {
  calibrationId: "calibration-v5",
  profileId: String(profile._id),
  profileRevision: 5,
  embeddingSpaceId: "space-v5",
  status: "validated",
  lifecycleStatus: "active",
  serverComputed: true,
  contractVersion: "server-computed-v1",
  computedBy: "speaker-segments",
  targetPrecision: 0.98,
  classificationPolicy: "full",
  validationMetrics: {
    positivePrecision: 1,
    negativePrecision: 1,
    identified: 20,
    rejected: 20,
    positives: 20,
    negatives: 20,
  },
  calibrationRecordingIds: ["fit"],
  validationRecordingIds: ["check"],
  positiveThreshold: 0.7,
  negativeThreshold: -1,
  negativeDecisionMode: "uncertain_only",
  evidenceSnapshotHash,
};

function createAutomaticMongo(
  { newerAnnotation = null, profileOverride = profile }: {
    newerAnnotation?: any;
    profileOverride?: Record<string, any>;
  } = {},
) {
  const requests: Record<string, any>[] = [];
  let insertedCampaign: Record<string, any> | null = null;
  const newerUnheadedCalibration = {
    ...calibration,
    calibrationId: "calibration-unheaded",
    evidenceSnapshotHash: "sha256:unheaded",
  };
  const mongo = (request: Record<string, any>) => {
    requests.push(request);
    if (request.collection === "speaker_profiles") return profileOverride;
    if (request.collection === "speaker_calibrations") {
      return [newerUnheadedCalibration, calibration];
    }
    if (
      request.collection === "speaker_identity_campaigns" &&
      request.query?.mode === "classify_all_compatible"
    ) {
      return { _id: "baseline", finishedAt: baselineFinishedAt };
    }
    if (request.collection === "speaker_annotations") return newerAnnotation;
    if (
      request.collection === "speaker_identity_campaigns" &&
      request.action === "insertOne"
    ) {
      insertedCampaign = request.doc;
      return { insertedId: "automatic-campaign" };
    }
    if (request.collection === "speaker_identity_campaigns") return null;
    if (request.collection === "diarizations" && request.action === "find") {
      return [{ _id: "pending" }];
    }
    if (
      request.collection === "diarizations" &&
      request.action === "aggregate"
    ) {
      return request.pipeline?.[0]?.$match?.$nor
        ? [{
          _id: { runId: "legacy-v0", embeddingSpaceId: "space-v5" },
          eligibleSegments: 2,
          start: new Date("2026-08-24T00:00:00Z"),
          end: new Date("2026-08-24T00:00:10Z"),
        }]
        : [{
          _id: { runId: "legacy-v0", embeddingSpaceId: "space-v5" },
          sourceSegments: 20,
          start: new Date("2026-08-24T00:00:00Z"),
          end: new Date("2026-08-24T00:00:10Z"),
        }];
    }
    throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
  };
  return {
    mongo,
    requests,
    insertedCampaign: () => insertedCampaign,
  };
}

Deno.test("automatic identity waits for a completed baseline then snapshots new segments", async () => {
  const fixture = createAutomaticMongo();
  expect(
    await speakerIdentity.hasPendingWork?.({
      mongo: fixture.mongo,
      reason: "test",
    }),
  ).toBe(1);

  const data = await speakerIdentity.getTriggerJobData?.(
    undefined,
    "test",
    { mongo: fixture.mongo },
  );
  expect(schema.safeParse(data).success).toBe(true);
  const { evidenceSnapshotHash: _omitted, ...withoutEvidenceHash } = data ?? {};
  expect(schema.safeParse(withoutEvidenceHash).success).toBe(false);
  expect(data?.type).toBe("speakerIdentity");
  expect(data?.campaignMode).toBe("classify_automatic");
  expect(data?.campaignTotalSegments).toBe(2);
  expect(data?.runId).toBe("legacy-v0");
  expect(data?.calibrationId).toBe(calibration.calibrationId);
  expect(data?.evidenceSnapshotHash).toBe(evidenceSnapshotHash);
  expect((data?.partitions as any[])?.[0]?.sourceSegments).toBe(20);
  expect(fixture.insertedCampaign()?.evidenceSnapshotHash).toBe(
    evidenceSnapshotHash,
  );

  const baselineRequest = fixture.requests.find((request) =>
    request.collection === "speaker_identity_campaigns" &&
    request.query?.mode === "classify_all_compatible"
  );
  expect(baselineRequest?.query?.classificationPolicy).toBe("full");
  expect(baselineRequest?.query?.evidenceSnapshotHash).toBe(
    evidenceSnapshotHash,
  );

  const profileRequest = fixture.requests.find((request) =>
    request.collection === "speaker_profiles"
  );
  expect(profileRequest?.options?.projection?.activeCalibrationIds).toBe(1);
  expect(profileRequest?.options?.projection?.calibrationHeadsInitialized).toBe(
    1,
  );

  const annotationRequest = fixture.requests.find((request) =>
    request.collection === "speaker_annotations"
  );
  expect(
    String(annotationRequest?.query?.$and?.[0]?.$or?.[0]?.profileId),
  ).toBe(String(profile._id));
  expect(
    annotationRequest?.query?.$and?.[1]?.$or?.[0]?.updatedAt?.$gt,
  ).toEqual(baselineFinishedAt);
});

Deno.test("automatic identity waits when profile evidence changed after baseline", async () => {
  const fixture = createAutomaticMongo({
    newerAnnotation: { _id: "newer-manual-evidence" },
  });
  expect(
    await speakerIdentity.hasPendingWork?.({
      mongo: fixture.mongo,
      reason: "test",
    }),
  ).toBe(false);
});

Deno.test("automatic identity supports a legacy head but never bypasses initialized heads", async () => {
  const legacyFixture = createAutomaticMongo({
    profileOverride: {
      ...profile,
      activeCalibrationIds: undefined,
      calibrationHeadsInitialized: undefined,
      activeCalibrationId: calibration.calibrationId,
    },
  });
  expect(
    await speakerIdentity.hasPendingWork?.({
      mongo: legacyFixture.mongo,
      reason: "test",
    }),
  ).toBe(1);

  const initializedWithoutFull = createAutomaticMongo({
    profileOverride: {
      ...profile,
      activeCalibrationIds: { pilot: "calibration-pilot" },
      calibrationHeadsInitialized: true,
    },
  });
  expect(
    await speakerIdentity.hasPendingWork?.({
      mongo: initializedWithoutFull.mongo,
      reason: "test",
    }),
  ).toBe(false);
});
