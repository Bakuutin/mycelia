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

export interface SpeakerTimelineSnapshot {
  profileRevision: number;
  embeddingSpaceId: string;
  calibrationId: string;
  validity: "verified" | "provisional";
}

export function buildSpeakerTimelinePipeline(input: {
  start: Date;
  end: Date;
  detail: "intervals" | "buckets";
  bucketMs?: number;
  targetProfileId: unknown;
  snapshot?: SpeakerTimelineSnapshot | null;
  states?: Array<"matched" | "rejected" | "uncertain" | "unclassified">;
  validities?: Array<"verified" | "provisional" | "manual">;
}): Record<string, unknown>[] {
  if (input.detail === "buckets" && !input.bucketMs) {
    throw new Error("Far Timeline summary requires bucketMs");
  }
  const target = input.targetProfileId;
  const currentAutomatic = input.snapshot
    ? {
      $and: [
        {
          $eq: ["$speakerIdentity.calibrationId", input.snapshot.calibrationId],
        },
        {
          $eq: [
            "$speakerIdentity.profileRevision",
            input.snapshot.profileRevision,
          ],
        },
        {
          $eq: [
            "$speakerIdentity.embeddingSpaceId",
            input.snapshot.embeddingSpaceId,
          ],
        },
        { $eq: ["$speakerIdentity.source", "automatic"] },
        { $eq: ["$speakerIdentity.validity", input.snapshot.validity] },
      ],
    }
    : { $eq: [1, 0] };
  const pipeline: Record<string, unknown>[] = [
    {
      $match: {
        lifecycleStatus: "active",
        start: { $lt: input.end },
        end: { $gt: input.start },
      },
    },
    {
      $lookup: {
        from: "speaker_annotations",
        let: {
          segmentId: "$_id",
          originalId: { $ifNull: ["$original_id", "$original"] },
          segmentStart: "$start",
          segmentEnd: "$end",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$segmentId", "$$segmentId"] },
                  {
                    $and: [
                      { $eq: ["$originalId", "$$originalId"] },
                      { $lt: ["$start", "$$segmentEnd"] },
                      { $gt: ["$end", "$$segmentStart"] },
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { updatedAt: -1, createdAt: -1 } },
          { $limit: 1 },
          { $project: { profileId: 1, excludedProfileIds: 1 } },
        ],
        as: "_manualAnnotations",
      },
    },
    { $set: { _manual: { $first: "$_manualAnnotations" } } },
    {
      $project: {
        _id: 1,
        start: 1,
        end: 1,
        originalId: { $ifNull: ["$original_id", "$original"] },
        state: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$_manual.profileId", target] },
                then: "matched",
              },
              {
                case: {
                  $in: [target, {
                    $ifNull: ["$_manual.excludedProfileIds", []],
                  }],
                },
                then: "rejected",
              },
              {
                case: currentAutomatic,
                then: { $ifNull: ["$speakerIdentity.state", "unclassified"] },
              },
            ],
            default: "unclassified",
          },
        },
        validity: {
          $switch: {
            branches: [
              {
                case: {
                  $or: [
                    { $eq: ["$_manual.profileId", target] },
                    {
                      $in: [target, {
                        $ifNull: ["$_manual.excludedProfileIds", []],
                      }],
                    },
                  ],
                },
                then: "manual",
              },
              { case: currentAutomatic, then: "$speakerIdentity.validity" },
            ],
            default: null,
          },
        },
        profileId: {
          $cond: [
            { $eq: ["$_manual.profileId", target] },
            target,
            {
              $cond: [
                currentAutomatic,
                "$speakerIdentity.profileId",
                null,
              ],
            },
          ],
        },
        score: {
          $cond: [currentAutomatic, "$speakerIdentity.primaryScore", null],
        },
      },
    },
  ];
  const filtered: Record<string, unknown> = {};
  if (input.states?.length) filtered.state = { $in: input.states };
  if (input.validities?.length) filtered.validity = { $in: input.validities };
  if (Object.keys(filtered).length > 0) pipeline.push({ $match: filtered });

  if (input.detail === "intervals") {
    pipeline.push({ $sort: { start: 1, _id: 1 } }, { $limit: 10_001 });
    return pipeline;
  }
  pipeline.push(
    {
      $set: {
        bucket: {
          $multiply: [{
            $floor: {
              $divide: [{ $toLong: "$start" }, input.bucketMs],
            },
          }, input.bucketMs],
        },
      },
    },
    {
      $group: {
        _id: "$bucket",
        segments: { $sum: 1 },
        matched: { $sum: { $cond: [{ $eq: ["$state", "matched"] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ["$state", "rejected"] }, 1, 0] } },
        uncertain: {
          $sum: { $cond: [{ $eq: ["$state", "uncertain"] }, 1, 0] },
        },
        unclassified: {
          $sum: { $cond: [{ $eq: ["$state", "unclassified"] }, 1, 0] },
        },
        verified: {
          $sum: { $cond: [{ $eq: ["$validity", "verified"] }, 1, 0] },
        },
        provisional: {
          $sum: { $cond: [{ $eq: ["$validity", "provisional"] }, 1, 0] },
        },
        manual: { $sum: { $cond: [{ $eq: ["$validity", "manual"] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  );
  return pipeline;
}
