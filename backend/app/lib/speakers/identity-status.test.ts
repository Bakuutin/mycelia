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
          positiveThreshold: 0.7,
          negativeThreshold: 0.35,
          targetPrecision: 0.98,
          validationMetrics: {
            positivePrecision: 0.99,
            identified: 20,
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
    expect(current.canClassify).toBe(true);
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
  }),
);
