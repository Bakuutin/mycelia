export const TIMELINE_OBJECT_LIMIT = 5_000;
export const TIMELINE_OBJECT_MAX_TIME_MS = 5_000;

const TIMELINE_OBJECT_PROJECTION = {
  _id: 1,
  name: 1,
  icon: 1,
  details: 1,
  summary: 1,
  timeRanges: 1,
  relationship: 1,
  isEvent: 1,
  isPerson: 1,
  isRelationship: 1,
  isPromise: 1,
  isPlace: 1,
  isOrganization: 1,
  isProduct: 1,
  isProject: 1,
  isAnimal: 1,
  isConcept: 1,
  isMedia: 1,
} as const;

function compactRelationshipLookup(
  localField: "relationship.subject" | "relationship.object",
  as: "subjectObject" | "objectObject",
) {
  return {
    $lookup: {
      from: "objects",
      localField,
      foreignField: "_id",
      pipeline: [{ $project: { _id: 1, name: 1, icon: 1 } }],
      as,
    },
  };
}

export function resolveTimelineObjectLimit(requestedLimit?: number): number {
  if (!Number.isFinite(requestedLimit)) return TIMELINE_OBJECT_LIMIT;
  return Math.min(
    Math.max(1, Math.trunc(requestedLimit as number)),
    TIMELINE_OBJECT_LIMIT,
  );
}

export function buildTimelineObjectsPipeline(
  query: Record<string, unknown>,
  sort: Record<string, number> = { earliestStart: -1, duration: -1 },
  requestedLimit = TIMELINE_OBJECT_LIMIT,
): Record<string, any>[] {
  const limit = resolveTimelineObjectLimit(requestedLimit);

  return [
    { $match: query },
    {
      $addFields: {
        earliestStart: {
          $min: {
            $map: {
              input: "$timeRanges",
              as: "r",
              in: "$$r.start",
            },
          },
        },
        latestEnd: {
          $max: {
            $map: {
              input: "$timeRanges",
              as: "r",
              in: { $ifNull: ["$$r.end", "$$r.start"] },
            },
          },
        },
      },
    },
    {
      $addFields: {
        duration: { $subtract: ["$latestEnd", "$earliestStart"] },
      },
    },
    { $sort: sort },
    { $limit: limit + 1 },
    { $project: TIMELINE_OBJECT_PROJECTION },
    compactRelationshipLookup("relationship.subject", "subjectObject"),
    compactRelationshipLookup("relationship.object", "objectObject"),
    {
      $unwind: {
        path: "$subjectObject",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$objectObject",
        preserveNullAndEmptyArrays: true,
      },
    },
  ];
}
