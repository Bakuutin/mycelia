/**
 * Helper to iterate over MongoDB results using server-side cursors.
 */
export async function* mongoCursor(
  mongo: (request: any) => Promise<any>,
  collection: string,
  query: any,
  options: any = {},
  batchSize: number = 200,
): AsyncIterableIterator<any> {
  let result = await mongo({
    action: "getFirstBatch",
    collection,
    query,
    options,
    batchSize,
  });

  const cursorId = result.cursorId;

  while (result.data && result.data.length > 0) {
    for (const doc of result.data) {
      yield doc;
    }

    if (!result.hasMore) {
      return;
    }

    result = await mongo({
      action: "getMore",
      collection,
      cursorId,
      batchSize,
    });
  }
}

