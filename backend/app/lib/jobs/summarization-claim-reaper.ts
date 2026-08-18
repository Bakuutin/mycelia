const COMPLETED_CLAIM_BATCH_SIZE = 100;
const SUMMARIZATION_CLAIM_INDEX = "summarizationClaim_startedAt_1";

type MongoOperation = (input: any) => Promise<any>;

export async function releaseCompletedSummarizationClaims(
  mongo: MongoOperation,
): Promise<{ scanned: number; modified: number; hasMore: boolean }> {
  const candidates = await mongo({
    action: "find",
    collection: "objects",
    query: {
      "_summarizationClaim.startedAt": { $exists: true },
      "summaries.0": { $exists: true },
    },
    options: {
      projection: { _id: 1 },
      hint: SUMMARIZATION_CLAIM_INDEX,
      limit: COMPLETED_CLAIM_BATCH_SIZE,
      maxTimeMS: 2_000,
    },
  }) as Array<{ _id?: unknown }>;
  const ids = candidates.flatMap((candidate) =>
    candidate._id == null ? [] : [candidate._id]
  );
  if (ids.length === 0) {
    return { scanned: 0, modified: 0, hasMore: false };
  }

  const result = await mongo({
    action: "updateMany",
    collection: "objects",
    query: {
      _id: { $in: ids },
      "_summarizationClaim.startedAt": { $exists: true },
      "summaries.0": { $exists: true },
    },
    update: { $unset: { _summarizationClaim: "" } },
  });

  return {
    scanned: ids.length,
    modified: Number(result.modifiedCount ?? 0),
    hasMore: ids.length === COMPLETED_CLAIM_BATCH_SIZE,
  };
}
