import { ObjectId } from "mongodb";
import _ from "lodash";
import {
  type LoaderData,
  type StartEnd,
  type Timestamp,
  zLoaderData,
  zQueryParams,
} from "../types/timeline.ts";


import { getRootDB } from "@/lib/mongo/core.server.ts";

type Resolution = "5min" | "1hour" | "1week";

const RESOLUTION_TO_MS: Record<Resolution, number> = {
  "5min": 5 * 60 * 1000,
  "1hour": 60 * 60 * 1000,
  "1week": 7 * 24 * 60 * 60 * 1000,
};

const RESOLUTION_ORDER: Resolution[] = Object.keys(RESOLUTION_TO_MS) as Resolution[];

const LOWEST_RESOLUTION: Resolution = RESOLUTION_ORDER[0];

const TARGET_COLLECTIONS = [
  "audio_chunks",
  "diarizations",
];


export async function updateHistogram(
  start: Date,
  end: Date,
  resolution: Resolution,
): Promise<void> {
  const db = await getRootDB();
  const binSize = RESOLUTION_TO_MS[resolution];
  const histogramCollection = db.collection(`histogram_${resolution}`);

  start = new Date(Math.floor(start.getTime() / binSize) * binSize);
  end = new Date(Math.ceil(end.getTime() / binSize) * binSize);

  for (const sourceCollectionName of TARGET_COLLECTIONS) {
    const sourceCollection = db.collection(sourceCollectionName);

    const pipeline = [
      {
        $match: {
          start: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: {
            $toDate: {
              $subtract: [
                { $toLong: "$start" },
                { $mod: [{ $toLong: "$start" }, binSize] },
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
    ];

    const results = await sourceCollection.aggregate(pipeline).toArray();

    const ops = results.map(({ _id: binStart, count }) => ({
      updateOne: {
        filter: { start: binStart },
        update: {
          $set: {
            updated_at: new Date(),
            [`totals.${sourceCollectionName}`]: count,
          },
        },
        upsert: true,
      },
    }));

    for (let i = 0; i < ops.length; i += 1000) {
      await histogramCollection.bulkWrite(ops.slice(i, i + 1000));
    }
  }
}

export async function updateHistogramOptimized(
  start: Date,
  end: Date,
  resolution: Resolution,
): Promise<void> {
  if (resolution === LOWEST_RESOLUTION) {
    return updateHistogram(start, end, resolution);
  }

  const db = await getRootDB();
  const binSize = RESOLUTION_TO_MS[resolution];
  const histogramCollection = db.collection(`histogram_${resolution}`);

  // Floor start and ceil end to nearest resolution point
  start = new Date(Math.floor(start.getTime() / binSize) * binSize);
  end = new Date(Math.ceil(end.getTime() / binSize) * binSize);

  // Get the next lower resolution
  const currentIndex = RESOLUTION_ORDER.indexOf(resolution);
  const lowerResolution = RESOLUTION_ORDER[currentIndex - 1];
  const lowerHistogramCollection = db.collection(`histogram_${lowerResolution}`);

  // Query the lower resolution data
  const lowerData = await lowerHistogramCollection
    .find({
      start: { $gte: start, $lt: end },
    })
    .toArray();

  // Aggregate the lower resolution data into the current resolution
  const aggregatedData = new Map<string, Record<string, number>>();

  for (const doc of lowerData) {
    const binStart = new Date(Math.floor(doc.start.getTime() / binSize) * binSize);
    const binKey = binStart.toISOString();

    if (!aggregatedData.has(binKey)) {
      aggregatedData.set(binKey, {});
    }

    const totals = aggregatedData.get(binKey)!;
    for (const [collection, count] of Object.entries(doc.totals || {}) as [string, number][]) {
      totals[collection] = (totals[collection] || 0) + count;
    }
  }

  // Update the current resolution histogram
  const ops = Array.from(aggregatedData.entries()).map(([binKey, totals]) => ({
    updateOne: {
      filter: { start: new Date(binKey) },
      update: {
        $set: {
          updated_at: new Date(),
          totals,
        },
      },
      upsert: true,
    },
  }));

  for (let i = 0; i < ops.length; i += 1000) {
    await histogramCollection.bulkWrite(ops.slice(i, i + 1000));
  }
}

const day = 1000 * 60 * 60 * 24;

export function getDaysAgo(n: number) {
  const today = new Date(new Date().toISOString().split("T")[0]);
  const monthAgo = new Date(today.getTime() - n * 24 * 60 * 60 * 1000);
  return monthAgo;
}

export function mergeGap<T extends StartEnd>(
  items: T[],
  gap: number,
  updateKey?: (prev: T, item: T) => T,
): T[] {
  if (gap <= 0 || items.length === 0) {
    return items;
  }
  const result: T[] = [];
  let prev: T | null = null;
  for (const item of items) {
    if (prev) {
      if (prev.end.getTime() > item.start.getTime() - gap) {
        prev.end = _.max([prev.end, item.end]) as Date;
        if (updateKey) {
          prev = updateKey(prev, item);
        }
      } else {
        result.push(prev);
        prev = null;
      }
    } else {
      prev = item;
    }
  }
  if (prev) {
    result.push(prev);
  }
  return result;
}

export async function fetchTimelineData(
  db: any,
  start: Timestamp,
  end: Timestamp,
): Promise<LoaderData> {
  const startDate = new Date(Number(start));
  const endDate = new Date(Number(end));
  const duration = endDate.getTime() - startDate.getTime();
  const originalStart = startDate;
  const originalEnd = endDate;
  const queryStart = new Date(startDate.getTime() - duration / 2);
  const queryEnd = new Date(endDate.getTime() + duration / 2);

  let gap = day / 24 / 60;

  if (duration > day * 300) {
    gap = day * 7;
  } else if (duration > day * 30) {
    gap = day * 1;
  } else if (duration > day * 7) {
    gap = day / 4;
  }

  const step = gap;

  const boundaries = [];
  for (let i = queryStart; i < queryEnd; i = new Date(i.getTime() + step)) {
    boundaries.push(i);
  }

  const transcripts = (
    await db.collection("transcriptions").find({
      start: { $lte: queryEnd },
      end: { $gte: queryStart },
    }, { sort: { start: 1 }, limit: 20 })
  ).map((t: any) => {
    return {
      start: new Date(t.start.getTime() + t.segments[0].start * 1000),
      end: new Date(
        t.start.getTime() + t.segments[t.segments.length - 1].end * 1000,
      ),
      text: t.text,
      id: t._id.toHexString(),
    };
  }).sort((a: any, b: any) => a.start.getTime() - b.start.getTime());

  return {
    voices: [],
    items: [], // TODO: restore this
    start: originalStart,
    end: originalEnd,
    gap,
    transcripts,
  };
}
