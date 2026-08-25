import type { Db } from "mongodb";

const DEFAULT_OWNER_BATCH_SIZE = 100;

export type MediaEventRunReconcileResult = {
  released: number;
  outcomeUnknown: number;
  settlementReconciled?: number;
  settlementPending: number;
};

export type MediaEventRunReconcileSummary = MediaEventRunReconcileResult & {
  ownersScanned: number;
  ownerFailures: number;
  hasMore: boolean;
};

type ReconcileOwner = (
  db: Db,
  owner: string,
  now: Date,
) => Promise<MediaEventRunReconcileResult>;

/**
 * Discover expired media-event execution claims without relying on a user
 * request, then delegate each owner's CAS-protected settlement to the media
 * event domain. The owner list is bounded so startup maintenance cannot hold
 * readiness or let one failed owner prevent every other owner from settling.
 */
export async function reconcileExpiredMediaEventRunsGlobally(
  db: Db,
  reconcileOwner: ReconcileOwner,
  now = new Date(),
  ownerBatchSize = DEFAULT_OWNER_BATCH_SIZE,
): Promise<MediaEventRunReconcileSummary> {
  const boundedOwnerBatchSize = Math.max(1, Math.min(ownerBatchSize, 1_000));
  const ownerRows = await db.collection("media_event_runs").aggregate<{
    _id: string;
    earliestLeaseExpiresAt: Date;
  }>([
    {
      $match: {
        owner: { $type: "string" },
        $or: [
          {
            state: "building",
            "executionClaim.phase": { $in: ["claimed", "started"] },
            "executionClaim.leaseExpiresAt": { $lte: now },
          },
          { "settlementPending.target": { $exists: true } },
        ],
      },
    },
    {
      $group: {
        _id: "$owner",
        earliestLeaseExpiresAt: {
          $min: "$executionClaim.leaseExpiresAt",
        },
      },
    },
    { $sort: { earliestLeaseExpiresAt: 1, _id: 1 } },
    { $limit: boundedOwnerBatchSize },
  ], { maxTimeMS: 5_000 }).toArray();

  const summary: MediaEventRunReconcileSummary = {
    ownersScanned: 0,
    released: 0,
    outcomeUnknown: 0,
    settlementPending: 0,
    ownerFailures: 0,
    hasMore: ownerRows.length === boundedOwnerBatchSize,
  };

  for (const row of ownerRows) {
    if (typeof row._id !== "string" || row._id.length === 0) continue;
    summary.ownersScanned++;
    try {
      const result = await reconcileOwner(db, row._id, now);
      summary.released += result.released;
      summary.outcomeUnknown += result.outcomeUnknown;
      if (result.settlementReconciled) {
        summary.settlementReconciled =
          Number(summary.settlementReconciled ?? 0) +
          result.settlementReconciled;
      }
      summary.settlementPending += result.settlementPending;
      // The owner-level reconciler is intentionally bounded to 100 runs.
      // A full batch means the next maintenance tick should revisit the set.
      if (
        result.released + result.outcomeUnknown + result.settlementPending >=
          100
      ) {
        summary.hasMore = true;
      }
    } catch (error) {
      summary.ownerFailures++;
      summary.settlementPending++;
      summary.hasMore = true;
      console.warn(
        `[MaintenanceManager] Media event run reconciliation failed for owner ${row._id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return summary;
}
