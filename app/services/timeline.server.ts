import _ from "lodash";
import {
  type LoaderData,
  type Timestamp,
} from "../types/timeline.ts";

import ms from "ms";

import { getRootDB } from "@/lib/mongo/core.server.ts";


type Resolution = "5min" | "1hour" | "1day" | "1week";

const RESOLUTION_TO_MS: Record<Resolution, number> = {
  "5min": ms("5m"),
  "1hour": ms("1h"),
  "1day": ms("1d"),
  "1week": ms("1w"),
};

const RESOLUTION_ORDER: Resolution[] = Object.keys(
  RESOLUTION_TO_MS,
) as Resolution[];

const LOWEST_RESOLUTION: Resolution = RESOLUTION_ORDER[0];

type AggregationOperation = {
  $sum?: any;
  $avg?: any;
  $min?: any;
  $max?: any;
};

type AggregationConfig = {
  count: boolean;
  aggregations?: Array<{
    key: string;
    operation: AggregationOperation;
  }>;
};

const TARGET_COLLECTIONS: Record<string, AggregationConfig> = {
  audio_chunks: {
    count: true,
    aggregations: [
      { key: "speech_probability_max", operation: { $max: "$vad.prob" } },
      { key: "speech_probability_avg", operation: { $avg: "$vad.prob" } },
      { key: "has_speech", operation: { $sum: { $cond: [{ $eq: ["$vad.has_speech", true] }, 1, 0] } } },
    ],
  },
  diarizations: {
    count: true,
  },
};

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

  console.log("Updating histogram", start, end, resolution);

  const BATCH_SIZE = day * 1;
  if (end.getTime() - start.getTime() > BATCH_SIZE) {
    const steps = Math.ceil(
      (end.getTime() - start.getTime() + 0.0) / Number(BATCH_SIZE),
    );
    for (let i = 0; i < steps; i++) {
      await updateHistogramOptimized(
        new Date(start.getTime() + i * BATCH_SIZE),
        new Date(start.getTime() + (i + 1) * BATCH_SIZE),
        resolution,
      );
    }
    return;
  }

  for (
    const [sourceCollectionName, collectionConfig] of Object.entries(
      TARGET_COLLECTIONS,
    )
  ) {
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
          ...(collectionConfig.count && { count: { $sum: 1 } }),
          ...(collectionConfig.aggregations &&
            collectionConfig.aggregations.reduce((acc, { key, operation }) => ({
              ...acc,
              [key]: operation,
            }), {})),
        },
      },
    ];

    const results = await sourceCollection.aggregate(pipeline).toArray();


    const ops = results.map(({ _id: binStart, ...aggr }) => ({
      updateOne: {
        filter: { start: binStart },
        update: {
          $set: {
            updated_at: new Date(),
            ...(Object.keys(aggr).length > 0 && {
              [`totals.${sourceCollectionName}`]: aggr,
            }),
          },
        },
        upsert: true,
      },
    }));

    for (let i = 0; i < ops.length; i += 500) {
      await histogramCollection.bulkWrite(ops.slice(i, i + 500), {
        ordered: false,
      });
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

  console.log("Updating histogram", start, end, resolution);

  // Get the next lower resolution
  const currentIndex = RESOLUTION_ORDER.indexOf(resolution);
  const lowerResolution = RESOLUTION_ORDER[currentIndex - 1];
  const lowerHistogramCollection = db.collection(
    `histogram_${lowerResolution}`,
  );

  // Query the lower resolution data
  const lowerData = await lowerHistogramCollection
    .find({
      start: { $gte: start, $lt: end },
    })
    .toArray();

  // Aggregate the lower resolution data into the current resolution
  const aggregatedData = new Map<
    string,
    Record<string, Record<string, number>>
  >();

  for (const doc of lowerData) {
    const binStart = new Date(
      Math.floor(doc.start.getTime() / binSize) * binSize,
    );
    const binKey = binStart.toISOString();

    if (!aggregatedData.has(binKey)) {
      aggregatedData.set(binKey, {});
    }

    const totals = aggregatedData.get(binKey)!;
    for (
      const [collection, data] of Object.entries(doc.totals || {}) as [
        string,
        Record<string, number>,
      ][]
    ) {
      if (!totals[collection]) {
        totals[collection] = {};
      }

      const collectionConfig = TARGET_COLLECTIONS[collection];
      if (!collectionConfig) continue;

      if (collectionConfig.count && data.count) {
        totals[collection].count = (totals[collection].count || 0) + data.count;
      }

      if (collectionConfig.aggregations) {
        for (const { key, operation } of collectionConfig.aggregations) {
          if (!(key in data)) continue;

          if (operation.$sum) {
            totals[collection][key] = (totals[collection][key] || 0) +
              data[key];
          } else if (operation.$max) {
            totals[collection][key] = Math.max(
              totals[collection][key] || -Infinity,
              data[key],
            );
          } else if (operation.$min) {
            totals[collection][key] = Math.min(
              totals[collection][key] || Infinity,
              data[key],
            );
          } else if (operation.$avg) {
            // For averages, we need to track both sum and count
            const sumKey = `${key}_sum`;
            const countKey = `${key}_count`;
            if (!totals[collection][sumKey]) {
              totals[collection][sumKey] = 0;
              totals[collection][countKey] = 0;
            }
            totals[collection][sumKey] += data[key] * data.count;
            totals[collection][countKey] += data.count;
          }
        }
      }
    }
  }

  // Calculate final averages and prepare update operations
  const ops = Array.from(aggregatedData.entries()).map(([binKey, totals]) => {
    // Calculate final averages
    for (const [collection, data] of Object.entries(totals)) {
      const collectionConfig = TARGET_COLLECTIONS[collection];
      if (!collectionConfig?.aggregations) continue;

      for (const { key, operation } of collectionConfig.aggregations) {
        if (operation.$avg) {
          const sumKey = `${key}_sum`;
          const countKey = `${key}_count`;
          if (sumKey in data && countKey in data) {
            const count = data[countKey];
            if (count > 0) {
              data[key] = data[sumKey] / count;
            }
            // Clean up temporary fields
            delete data[sumKey];
            delete data[countKey];
          }
        }
      }
    }

    return {
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
    };
  });

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

  // Determine appropriate resolution based on duration
  let resolution: Resolution;
  if (duration > 300 * day) {
    resolution = "1week";
  } else if (duration > 50 * day) {
    resolution = "1day";
  } else if (duration > day) {
    resolution = "1hour";
  } else {
    resolution = "5min";
  }

  const binSeconds = RESOLUTION_TO_MS[resolution] / 1000;
  const queryStart = new Date(startDate.getTime() - duration - binSeconds);
  const queryEnd = new Date(endDate.getTime() + duration + binSeconds);

  // Fetch histogram data
  const histogramCollection = db.collection(`histogram_${resolution}`);
  const histogramData = await histogramCollection
    .find({
      start: { $gte: queryStart, $lt: queryEnd },
    }, { sort: { start: 1 } });

  const items = histogramData.map((doc: any) => ({
    start: doc.start,
    end: new Date(doc.start.getTime() + RESOLUTION_TO_MS[resolution]),
    totals: {
      seconds: binSeconds,
      ...doc.totals,
    },
  }));

  const transcriptions = (
    await db.collection("transcriptions").find({
      start: { $lte: queryEnd },
      end: { $gte: queryStart },
      segments: {
        $exists: true, 
        $type: "array", 
        $not: { $size: 0 } 
      }
    }, { sort: { start: 1 }, limit: 30 })
  )

  const transcripts = [];

  for (const t of transcriptions) {
    for (const s of t.segments) {
      transcripts.push({
        start: new Date(t.start.getTime() + s.start * 1000),
        end: new Date(t.start.getTime() + s.end * 1000),
        text: s.text,
        id: t._id.toHexString() + "-" + s.start.toFixed(3),
        no_speech_prob: s.no_speech_prob,
        top_language_probs: t.top_language_probs,
      });
    }
  }

  transcripts.sort((a: any, b: any) => a.start.getTime() - b.start.getTime());

  return {
    voices: [],
    items,
    start: originalStart,
    end: originalEnd,
    transcripts,
  };
}

export async function updateAllHistogram(
  start?: Date,
  end?: Date,
): Promise<void> {
  const db = await getRootDB();

  let earliestStart: Date | null = null;
  let latestStart: Date | null = null;

  if (!start || !end) {
    for (const collectionName of Object.keys(TARGET_COLLECTIONS)) {
      const collection = db.collection(collectionName);

      const firstDoc = await collection.find({}, {
        sort: { start: 1 },
        limit: 1,
      }).toArray();
      if (
        firstDoc.length > 0 &&
        (!earliestStart || firstDoc[0].start < earliestStart)
      ) {
        earliestStart = firstDoc[0].start;
      }

      const lastDoc = await collection.find({}, {
        sort: { start: -1 },
        limit: 1,
      }).toArray();
      if (
        lastDoc.length > 0 && (!latestStart || lastDoc[0].start > latestStart)
      ) {
        latestStart = lastDoc[0].start;
      }
    }

    if (!earliestStart || !latestStart) {
      throw new Error("No data found in target collections");
    }

    start = earliestStart;
    end = latestStart;
  }

  console.log("Updating all histograms", start, end);

  for (const resolution of RESOLUTION_ORDER) {
    await updateHistogramOptimized(start, end, resolution);
  }
}

export async function ensureHistogramIndex(): Promise<void> {
  const db = await getRootDB();
  
  for (const resolution of RESOLUTION_ORDER) {
    const collection = db.collection(`histogram_${resolution}`);
    const indexes = await collection.indexes();
    
    const hasStartIndex = indexes.some(index => 
      index.key && index.key.start === 1
    );
    
    if (!hasStartIndex) {
      console.log(`Creating index on start field for histogram_${resolution}`);
      await collection.createIndex({ start: 1 });
    }
  }
}
