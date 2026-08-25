import { assertEquals } from "jsr:@std/assert@^1.0.15";
import {
  buildDiarizationCoveragePipeline,
  buildSpeakerTimelinePipeline,
  TIMELINE_SPEAKER_SEGMENT_PROJECTION,
} from "./timeline-queries.ts";

Deno.test("coverage query excludes document ids so the coverage index can cover it", () => {
  const pipeline = buildDiarizationCoveragePipeline(
    new Date("2026-08-01T00:00:00.000Z"),
    new Date("2026-08-02T00:00:00.000Z"),
    3_600_000,
  );

  assertEquals(pipeline[1], {
    $project: {
      _id: 0,
      bucket: {
        $multiply: [{
          $floor: {
            $divide: [{ $toLong: "$start" }, 3_600_000],
          },
        }, 3_600_000],
      },
      state: {
        $switch: {
          branches: [
            {
              case: {
                $eq: [
                  "$diarizationFailure.status",
                  "needs_attention",
                ],
              },
              then: "needs_attention",
            },
            {
              case: {
                $ne: [{ $ifNull: ["$processing_by", null] }, null],
              },
              then: "processing",
            },
            {
              case: {
                $ne: [{ $ifNull: ["$diarized_at", null] }, null],
              },
              then: "diarized",
            },
          ],
          default: "pending",
        },
      },
    },
  });
});

Deno.test("speaker timeline pins automatic identity to the current calibration and keeps manual override first", () => {
  const pipeline = buildSpeakerTimelinePipeline({
    start: new Date("2026-08-01T00:00:00Z"),
    end: new Date("2026-08-02T00:00:00Z"),
    detail: "buckets",
    bucketMs: 60_000,
    targetProfileId: "sky-object-id",
    snapshot: {
      profileRevision: 5,
      embeddingSpaceId: "space-current",
      calibrationId: "cal-r5",
      validity: "verified",
    },
  });
  assertEquals(pipeline[0], {
    $match: {
      lifecycleStatus: "active",
      start: { $lt: new Date("2026-08-02T00:00:00Z") },
      end: { $gt: new Date("2026-08-01T00:00:00Z") },
    },
  });
  assertEquals(pipeline.some((stage) => "$lookup" in stage), true);
  const projection = pipeline.find((stage) => "$project" in stage) as any;
  assertEquals(projection.$project.state.$switch.branches[0].then, "matched");
  assertEquals(pipeline.at(-1), { $sort: { _id: 1 } });
});

Deno.test("speaker timeline keeps manual profile decisions without a calibration snapshot", () => {
  const pipeline = buildSpeakerTimelinePipeline({
    start: new Date("2026-08-01T00:00:00Z"),
    end: new Date("2026-08-02T00:00:00Z"),
    detail: "intervals",
    targetProfileId: "manual-profile-id",
    snapshot: null,
  });

  const projection = pipeline.find((stage) => "$project" in stage) as any;
  const stateBranches = projection.$project.state.$switch.branches;
  assertEquals(stateBranches[0], {
    case: { $eq: ["$_manual.profileId", "manual-profile-id"] },
    then: "matched",
  });
  assertEquals(stateBranches[1], {
    case: {
      $in: ["manual-profile-id", {
        $ifNull: ["$_manual.excludedProfileIds", []],
      }],
    },
    then: "rejected",
  });
  assertEquals(stateBranches[2].case, { $eq: [1, 0] });
  assertEquals(
    projection.$project.validity.$switch.branches[0].then,
    "manual",
  );
});

Deno.test("Timeline speaker projection omits embeddings and keeps render fields", () => {
  assertEquals(TIMELINE_SPEAKER_SEGMENT_PROJECTION, {
    _id: 1,
    start: 1,
    end: 1,
    original_id: 1,
    original: 1,
    speakerIdentity: 1,
  });
});
