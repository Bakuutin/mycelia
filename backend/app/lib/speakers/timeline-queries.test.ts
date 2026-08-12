import { assertEquals } from "jsr:@std/assert";
import {
  buildDiarizationCoveragePipeline,
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
