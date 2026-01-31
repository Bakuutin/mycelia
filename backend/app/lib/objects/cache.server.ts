import { Db } from "mongodb";

export interface TypeCounts {
  person: number;
  event: number;
  relationship: number;
  promise: number;
  conversation: number;
  tag: number;
  other: number;
  total: number;
}

export interface CachedCounts extends TypeCounts {
  orphaned: number;
  updatedAt: Date | null;
  stale?: boolean;
  orphanedLoading?: boolean;
}

// Calculate type counts (fast aggregation)
export async function refreshTypeCounts(db: Db): Promise<TypeCounts> {
  const objectsCollection = db.collection("objects");

  const countsPipeline = [
    {
      $group: {
        _id: null,
        person: { $sum: { $cond: [{ $eq: ["$isPerson", true] }, 1, 0] } },
        event: { $sum: { $cond: [{ $eq: ["$isEvent", true] }, 1, 0] } },
        promise: { $sum: { $cond: [{ $eq: ["$isPromise", true] }, 1, 0] } },
        tag: { $sum: { $cond: [{ $eq: ["$isTag", true] }, 1, 0] } },
        relationship: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$isRelationship", true] },
                  { $ne: ["$isPromise", true] },
                  { $ne: ["$isTag", true] },
                ],
              },
              1,
              0,
            ],
          },
        },
        conversation: { $sum: { $cond: [{ $eq: ["$isConversation", true] }, 1, 0] } },
        other: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$isPerson", true] },
                  { $ne: ["$isEvent", true] },
                  { $ne: ["$isRelationship", true] },
                  { $ne: ["$isPromise", true] },
                  { $ne: ["$isConversation", true] },
                ],
              },
              1,
              0,
            ],
          },
        },
        total: { $sum: 1 },
      },
    },
  ];

  const countsResult = await objectsCollection.aggregate(countsPipeline).toArray();
  const result = countsResult[0] as TypeCounts | undefined;
  
  return result || {
    person: 0,
    event: 0,
    relationship: 0,
    promise: 0,
    conversation: 0,
    tag: 0,
    other: 0,
    total: 0,
  };
}

// Calculate orphaned count (slow - uses $lookup)
export async function refreshOrphanedCount(db: Db): Promise<number> {
  const objectsCollection = db.collection("objects");

  const orphanedPipeline = [
    {
      $match: {
        isRelationship: { $ne: true },
      },
    },
    {
      $lookup: {
        from: "objects",
        let: { objectId: "$_id" },
        pipeline: [
          {
            $match: {
              isRelationship: true,
              $expr: {
                $or: [
                  { $eq: ["$relationship.subject", "$$objectId"] },
                  { $eq: ["$relationship.object", "$$objectId"] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "references",
      },
    },
    {
      $match: {
        references: { $size: 0 },
      },
    },
    { $count: "total" },
  ];

  const orphanedResult = await objectsCollection.aggregate(orphanedPipeline).toArray();
  return orphanedResult[0]?.total ?? 0;
}

// Calculate and cache all counts (type counts + orphaned)
export async function refreshCounts(db: Db): Promise<CachedCounts> {
  // Calculate type counts first (fast)
  const typeCounts = await refreshTypeCounts(db);
  
  // Calculate orphaned count (slow)
  const orphanedCount = await refreshOrphanedCount(db);

  const stats: CachedCounts = {
    person: typeCounts.person,
    event: typeCounts.event,
    relationship: typeCounts.relationship,
    promise: typeCounts.promise,
    conversation: typeCounts.conversation,
    tag: typeCounts.tag,
    other: typeCounts.other,
    orphaned: orphanedCount,
    total: typeCounts.total,
    updatedAt: new Date(),
  };

  // Store in cache collection
  await db.collection("object_stats").updateOne(
    { _id: "counts" },
    { $set: stats },
    { upsert: true }
  );

  return stats;
}

// Quick refresh - only type counts, keep existing orphaned from cache
export async function refreshTypeCountsOnly(db: Db): Promise<CachedCounts> {
  // Get existing orphaned count from cache
  const cached = await db.collection("object_stats").findOne({ _id: "counts" });
  const existingOrphaned = cached?.orphaned ?? null;
  
  // Calculate type counts (fast)
  const typeCounts = await refreshTypeCounts(db);

  const stats: CachedCounts = {
    person: typeCounts.person,
    event: typeCounts.event,
    relationship: typeCounts.relationship,
    promise: typeCounts.promise,
    conversation: typeCounts.conversation,
    tag: typeCounts.tag,
    other: typeCounts.other,
    orphaned: existingOrphaned ?? 0,
    total: typeCounts.total,
    updatedAt: new Date(),
    orphanedLoading: existingOrphaned === null,
  };

  // Update cache with type counts, preserve orphaned if exists
  await db.collection("object_stats").updateOne(
    { _id: "counts" },
    { 
      $set: {
        person: stats.person,
        event: stats.event,
        relationship: stats.relationship,
        promise: stats.promise,
        conversation: stats.conversation,
        tag: stats.tag,
        other: stats.other,
        total: stats.total,
        updatedAt: stats.updatedAt,
        stale: false,
      }
    },
    { upsert: true }
  );

  // Calculate orphaned count in background (don't await)
  refreshOrphanedCount(db).then(async (orphaned) => {
    await db.collection("object_stats").updateOne(
      { _id: "counts" },
      { $set: { orphaned } }
    );
  }).catch(err => console.error("Failed to refresh orphaned count:", err));

  return stats;
}

// Get cached counts
export async function getCachedCounts(db: Db): Promise<CachedCounts | null> {
  const cached = await db.collection("object_stats").findOne({ _id: "counts" });
  if (!cached) return null;
  return {
    person: cached.person,
    event: cached.event,
    relationship: cached.relationship,
    promise: cached.promise,
    conversation: cached.conversation,
    tag: cached.tag || 0,
    other: cached.other,
    orphaned: cached.orphaned,
    total: cached.total,
    updatedAt: cached.updatedAt,
    stale: cached.stale,
  };
}

// Invalidate counts cache (mark as stale)
export async function invalidateCountsCache(db: Db): Promise<void> {
  await db.collection("object_stats").updateOne(
    { _id: "counts" },
    { $set: { stale: true } },
    { upsert: true }
  );
}
