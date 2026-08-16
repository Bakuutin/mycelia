export type PendingWorkMongo = (input: any) => Promise<any>;

export interface PendingWorkLookup {
  collection: string;
  query: Record<string, unknown>;
  hint?: string;
}

/**
 * Cheap existence check for automatic trigger preflights.
 *
 * Keep this aligned with the worker's real selection predicate and back it
 * with an index. Automatic triggers must not count or scan the whole backlog
 * merely to decide whether a single job is worth starting.
 */
export async function hasIndexedPendingWork(
  mongo: PendingWorkMongo,
  lookup: PendingWorkLookup,
): Promise<boolean> {
  const pending = await mongo({
    action: "find",
    collection: lookup.collection,
    query: lookup.query,
    options: {
      projection: { _id: 1 },
      limit: 1,
      ...(lookup.hint ? { hint: lookup.hint } : {}),
    },
  }) as unknown[];

  return pending.length > 0;
}
