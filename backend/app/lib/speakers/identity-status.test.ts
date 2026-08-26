import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { SpeakerSegmentsResource } from "./resource.server.ts";

Deno.test(
  "identity status exposes only a calibration bound to the current profile",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const inserted = await mongo({
      action: "insertOne",
      collection: "speaker_profiles",
      doc: {
        name: "Sky",
        is_primary: true,
        revision: 2,
        embeddingSpaceId: "pyannote-v2",
        embedding: [1, 0],
        sample_count: 3,
      },
    }) as { insertedId: { toString(): string } };
    const profileId = inserted.insertedId.toString();
    await mongo({
      action: "insertMany",
      collection: "speaker_calibrations",
      docs: [
        {
          calibrationId: "old-revision",
          profileId,
          profileRevision: 1,
          embeddingSpaceId: "pyannote-v2",
          status: "validated",
          createdAt: new Date("2026-08-20T00:00:00Z"),
        },
        {
          calibrationId: "current",
          profileId,
          profileRevision: 2,
          embeddingSpaceId: "pyannote-v2",
          status: "validated",
          serverComputed: true,
          contractVersion: "server-computed-v1",
          computedBy: "speaker-segments",
          evidenceSnapshotHash: "current-evidence",
          evidenceRevision: 0,
          positiveThreshold: 0.7,
          negativeThreshold: 0.35,
          targetPrecision: 0.98,
          validationMetrics: {
            positivePrecision: 0.99,
            negativePrecision: 0.99,
            identified: 20,
            rejected: 20,
            positives: 20,
            negatives: 20,
          },
          calibrationRecordingIds: ["recording-fit"],
          validationRecordingIds: ["recording-check"],
          createdAt: new Date("2026-08-21T00:00:00Z"),
        },
      ],
    });
    await mongo({
      action: "insertMany",
      collection: "jobs",
      docs: [
        {
          type: "speakerIdentity",
          data: { profileId: "000000000000000000000001" },
          state: "failed",
          updatedAt: new Date("2026-08-21T02:00:00Z"),
        },
        {
          type: "speakerIdentity",
          data: { profileId },
          state: "completed",
          updatedAt: new Date("2026-08-21T01:00:00Z"),
        },
      ],
    });

    const resource = new SpeakerSegmentsResource();
    const current = await resource.use(
      { action: "identity-status", profileId },
      auth,
    ) as any;
    expect(current.usableCalibration.calibrationId).toBe("current");
    expect(current.usableCalibration.classificationPolicy).toBe("full");
    expect(current.canClassify).toBe(true);
    expect(current.canRunFullClassification).toBe(true);
    expect(current.blockers).toEqual([]);
    expect(current.latestJob.state).toBe("completed");
    expect(
      current.calibrations.find((item: any) =>
        item.calibrationId === "old-revision"
      ).validity,
    ).toBe("stale");

    await mongo({
      action: "updateOne",
      collection: "speaker_profiles",
      query: { _id: inserted.insertedId },
      update: { $set: { revision: 3 } },
    });
    const changed = await resource.use(
      { action: "identity-status", profileId },
      auth,
    ) as any;
    expect(changed.usableCalibration).toBeNull();
    expect(changed.canClassify).toBe(false);
    expect(changed.blockers.join(" ")).toContain("profile revision changed");

    await mongo({
      action: "insertOne",
      collection: "speaker_calibrations",
      doc: {
        calibrationId: "rev3-pilot",
        profileId,
        profileRevision: 3,
        embeddingSpaceId: "pyannote-v2",
        status: "validated",
        serverComputed: true,
        contractVersion: "server-computed-v1",
        computedBy: "speaker-segments",
        evidenceSnapshotHash: "pilot-evidence",
        evidenceRevision: 0,
        positiveThreshold: 0.75,
        negativeThreshold: 0.4,
        targetPrecision: 0.95,
        validationMetrics: {
          positivePrecision: 0.96,
          negativePrecision: 0.96,
          identified: 20,
          rejected: 20,
          positives: 20,
          negatives: 20,
        },
        calibrationRecordingIds: ["pilot-fit"],
        validationRecordingIds: ["pilot-check"],
        classificationPolicy: "pilot",
        operatorAcceptedLowerPrecision: true,
        maxRangeHours: 24,
        createdAt: new Date("2026-08-22T00:00:00Z"),
      },
    });
    const pilot = await resource.use(
      { action: "identity-status", profileId },
      auth,
    ) as any;
    expect(pilot.usableCalibration.calibrationId).toBe("rev3-pilot");
    expect(pilot.usableCalibration.classificationPolicy).toBe("pilot");
    expect(pilot.usableCalibration.maxRangeHours).toBe(24);
    expect(pilot.canClassify).toBe(true);
    expect(pilot.canRunFullClassification).toBe(false);

    await mongo({
      action: "insertOne",
      collection: "speaker_calibrations",
      doc: {
        calibrationId: "rev3-full",
        profileId,
        profileRevision: 3,
        embeddingSpaceId: "pyannote-v2",
        status: "validated",
        serverComputed: true,
        contractVersion: "server-computed-v1",
        computedBy: "speaker-segments",
        evidenceSnapshotHash: "full-evidence",
        evidenceRevision: 0,
        positiveThreshold: 0.8,
        negativeThreshold: 0.4,
        targetPrecision: 0.98,
        validationMetrics: {
          positivePrecision: 0.99,
          negativePrecision: 0.99,
          identified: 20,
          rejected: 20,
          positives: 20,
          negatives: 20,
        },
        calibrationRecordingIds: ["full-fit"],
        validationRecordingIds: ["full-check"],
        createdAt: new Date("2026-08-21T12:00:00Z"),
      },
    });
    const fullPreferred = await resource.use(
      { action: "identity-status", profileId },
      auth,
    ) as any;
    expect(fullPreferred.usableCalibration.calibrationId).toBe("rev3-full");
    expect(fullPreferred.usableCalibration.classificationPolicy).toBe("full");
    expect(fullPreferred.usablePilotCalibration.calibrationId).toBe(
      "rev3-pilot",
    );
    expect(fullPreferred.canClassify).toBe(true);
    expect(fullPreferred.canRunFullClassification).toBe(true);
  }),
);

Deno.test(
  "speaker list suppresses orphan and stale-evidence automatic identities",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const headCalibrationId = "current-head";
    const inserted = await mongo({
      action: "insertOne",
      collection: "speaker_profiles",
      doc: {
        name: "Sky",
        is_primary: true,
        revision: 2,
        embeddingSpaceId: "pyannote-v2",
        embedding: [1, 0],
        activeCalibrationIds: { full: headCalibrationId },
        calibrationHeadsInitialized: true,
        calibrationEvidenceRevision: 4,
      },
    }) as { insertedId: { toString(): string } };
    const profileId = inserted.insertedId.toString();
    const calibration = {
      calibrationId: headCalibrationId,
      profileId,
      profileRevision: 2,
      embeddingSpaceId: "pyannote-v2",
      status: "validated",
      lifecycleStatus: "active",
      serverComputed: true,
      contractVersion: "server-computed-v1",
      computedBy: "speaker-segments",
      classificationPolicy: "full",
      evidenceSnapshotHash: "head-evidence",
      evidenceRevision: 4,
      positiveThreshold: 0.7,
      negativeThreshold: 0.35,
      targetPrecision: 0.98,
      validationMetrics: {
        positivePrecision: 0.99,
        negativePrecision: 0.99,
        identified: 20,
        rejected: 20,
        positives: 20,
        negatives: 20,
      },
      calibrationRecordingIds: ["learn"],
      validationRecordingIds: ["check"],
    };
    await mongo({
      action: "insertMany",
      collection: "speaker_calibrations",
      docs: [
        calibration,
        {
          ...calibration,
          calibrationId: "lifecycle-active-orphan",
          evidenceSnapshotHash: "orphan-evidence",
        },
      ],
    });
    const start = new Date("2026-08-25T08:00:00Z");
    const end = new Date("2026-08-25T08:00:10Z");
    const identity = (
      calibrationId: string,
      evidenceSnapshotHash: string,
    ) => ({
      source: "automatic",
      state: "matched",
      identityState: "identified",
      validity: "verified",
      classificationPolicy: "full",
      calibrationId,
      profileId: inserted.insertedId,
      profileRevision: 2,
      embeddingSpaceId: "pyannote-v2",
      thresholds: { evidenceSnapshotHash },
    });
    await mongo({
      action: "insertMany",
      collection: "diarizations",
      docs: [
        {
          speaker: "current",
          lifecycleStatus: "active",
          embeddingSpaceId: "pyannote-v2",
          start,
          end,
          speakerIdentity: identity(headCalibrationId, "head-evidence"),
        },
        {
          speaker: "wrong-hash",
          lifecycleStatus: "active",
          embeddingSpaceId: "pyannote-v2",
          start,
          end,
          speakerIdentity: identity(headCalibrationId, "old-evidence"),
        },
        {
          speaker: "orphan",
          lifecycleStatus: "active",
          embeddingSpaceId: "pyannote-v2",
          start,
          end,
          speakerIdentity: identity(
            "lifecycle-active-orphan",
            "orphan-evidence",
          ),
        },
      ],
    });

    const resource = new SpeakerSegmentsResource();
    const listed = await resource.use(
      { action: "list", start, end, limit: 10 },
      auth,
    ) as any;
    const bySpeaker = new Map<string, any>(
      listed.segments.map((segment: any) =>
        [String(segment.speaker), segment] as const
      ),
    );
    expect(bySpeaker.get("current").speakerIdentity.validity).toBe("verified");
    expect(bySpeaker.get("current").speakerIdentity.state).toBe("matched");
    expect(bySpeaker.get("wrong-hash").speakerIdentity.validity).toBe("stale");
    expect(bySpeaker.get("wrong-hash").speakerIdentity.identityState).toBe(
      "unclassified",
    );
    expect(bySpeaker.get("orphan").speakerIdentity.validity).toBe("stale");

    await mongo({
      action: "updateOne",
      collection: "speaker_profiles",
      query: { _id: inserted.insertedId },
      update: { $set: { calibrationEvidenceRevision: 5 } },
    });
    const afterEvidenceChange = await resource.use(
      { action: "list", start, end, limit: 10 },
      auth,
    ) as any;
    const formerlyCurrent = afterEvidenceChange.segments.find(
      (segment: any) => segment.speaker === "current",
    );
    expect(formerlyCurrent.speakerIdentity.validity).toBe("stale");
    expect(formerlyCurrent.speakerIdentity.identityState).toBe("unclassified");
  }),
);
