export const TIMELINE_SPEAKER_SEGMENT_PROJECTION = {
  _id: 1,
  start: 1,
  end: 1,
  original_id: 1,
  original: 1,
  speakerIdentity: 1,
} as const;

export function buildDiarizationCoveragePipeline(
  start: Date,
  end: Date,
  bucketMs: number,
): Record<string, unknown>[] {
  return [
    {
      $match: {
        "vad.has_speech": true,
        start: { $gte: start, $lt: end },
      },
    },
    {
      $project: {
        _id: 0,
        bucket: {
          $multiply: [{
            $floor: {
              $divide: [{ $toLong: "$start" }, bucketMs],
            },
          }, bucketMs],
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
    },
    {
      $group: {
        _id: { bucket: "$bucket", state: "$state" },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.bucket": 1 } },
  ];
}
