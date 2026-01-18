import _ from "lodash";
import { type LoaderData, type Timestamp } from "../types/timeline.ts";

import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { Auth } from "@/lib/auth/core.server.ts";

import type { Resolution } from "@/types/resolution.ts";
import {
  LOWEST_RESOLUTION,
  RESOLUTION_ORDER,
  RESOLUTION_TO_MS,
} from "@/types/resolution.ts";

export type { Resolution };




export function getDaysAgo(n: number, since: Date | null = null) {
  const today = since || new Date(new Date().toISOString().split("T")[0]);
  return new Date(today.getTime() - n * 24 * 60 * 60 * 1000);
}

export async function fetchTimelineData(
  auth: Auth,
  start: Timestamp,
  end: Timestamp,
  resolution: Resolution,
): Promise<LoaderData> {
  const startDate = new Date(Number(start));
  const endDate = new Date(Number(end));
  const duration = endDate.getTime() - startDate.getTime();
  const originalStart = startDate;
  const originalEnd = endDate;

  const binSize = RESOLUTION_TO_MS[resolution];
  const queryStart = new Date(startDate.getTime() - duration - binSize);
  const queryEnd = new Date(endDate.getTime() + duration + binSize);

  const mongo = auth.getResource("mongo");

  const histogramData = await mongo({
    action: "find",
    collection: `histogram_${resolution}`,
    query: {
      start: { $gte: queryStart, $lt: queryEnd },
    },
    options: { sort: { start: 1 } },
  }) as any[];

  const items = histogramData.map((doc: any) => ({
    id: doc._id.toHexString(),
    start: doc.start,
    end: new Date(doc.start.getTime() + RESOLUTION_TO_MS[resolution]),
    stale: doc.stale || false,
    topics: doc.topics as string[] | undefined,
    totals: {
      seconds: binSize,
      ...doc.totals,
    },
  }));

  return {
    items,
    start: originalStart,
    end: originalEnd,
  };
}

export async function getStaleRanges(
  auth: Auth,
  resolution: Resolution,
  start?: Date,
  end?: Date,
): Promise<Array<{ start: Date; end: Date }>> {
  const mongo = await getMongoResource(auth);
  const binSize = RESOLUTION_TO_MS[resolution];

  const query: any = { stale: true };
  if (start && end) {
    query.start = { $gte: start, $lt: end };
  }

  const staleBuckets = await mongo({
    action: "find",
    collection: `histogram_${resolution}`,
    query,
    options: { sort: { start: 1 } },
  });

  if (staleBuckets.length === 0) {
    return [];
  }

  const ranges: Array<{ start: Date; end: Date }> = [];
  let currentRangeStart: Date = staleBuckets[0].start;
  let currentRangeEnd: Date = new Date(staleBuckets[0].start.getTime() + binSize);

  for (let i = 1; i < staleBuckets.length; i++) {
    const bucket = staleBuckets[i];
    const bucketStart = bucket.start;

    if (bucketStart.getTime() === currentRangeEnd.getTime()) {
      currentRangeEnd = new Date(bucketStart.getTime() + binSize);
    } else {
      ranges.push({ start: currentRangeStart, end: currentRangeEnd });
      currentRangeStart = bucketStart;
      currentRangeEnd = new Date(bucketStart.getTime() + binSize);
    }
  }

  ranges.push({ start: currentRangeStart, end: currentRangeEnd });

  return ranges;
}

export function splitRangeIntoChunks(
  start: Date,
  end: Date,
  resolution: Resolution,
): Array<{ start: Date; end: Date }> {
  const chunkSize = (resolution === "5min" || resolution === "1hour")
    ? 7 * 24 * 60 * 60 * 1000
    : 28 * 24 * 60 * 60 * 1000;

  const duration = end.getTime() - start.getTime();

  if (duration <= chunkSize) {
    return [{ start, end }];
  }

  const chunks: Array<{ start: Date; end: Date }> = [];
  let currentStart = start;

  while (currentStart.getTime() < end.getTime()) {
    const currentEnd = new Date(
      Math.min(currentStart.getTime() + chunkSize, end.getTime()),
    );
    chunks.push({ start: currentStart, end: currentEnd });
    currentStart = currentEnd;
  }

  return chunks;
}


export async function ensureHistogramIndex(auth: Auth): Promise<void> {
  const mongo = await getMongoResource(auth);

  for (const resolution of RESOLUTION_ORDER) {
    const indexes = await mongo({
      action: "listIndexes",
      collection: `histogram_${resolution}`,
    });

    const hasStartIndex = indexes.some((index: any) =>
      index.key && index.key.start === 1
    );

    if (!hasStartIndex) {
      console.log(`Creating index on start field for histogram_${resolution}`);
      await mongo({
        action: "createIndex",
        collection: `histogram_${resolution}`,
        index: { start: 1 },
      });
    }
  }
}

export async function invalidateHistogram(
  auth: Auth,
  start?: Date,
  end?: Date,
  resolution?: Resolution,
): Promise<void> {
  const mongo = await getMongoResource(auth);
  const resolutions = resolution ? [resolution] : RESOLUTION_ORDER;

  for (const res of resolutions) {
    const query: Record<string, any> = {};

    if (start || end) {
      query.start = {};
      if (start) query.start.$gte = start;
      if (end) query.start.$lt = end;
    }

    console.log(`Invalidating histogram_${res}`, query);

    const result = await mongo({
      action: "updateMany",
      collection: `histogram_${res}`,
      query,
      update: { $set: { stale: true } },
    });

    console.log(
      `Marked ${result.modifiedCount} documents as stale in histogram_${res}`,
    );
  }
}
