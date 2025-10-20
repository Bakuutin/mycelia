import _, { chunk } from "lodash";
import { type LoaderData, type Timestamp } from "../types/timeline.ts";

import ms from "ms";

import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { defaultResourceManager } from "../lib/auth/resources.ts";

import type { Resolution } from "@/types/resolution.ts";
import {
  LOWEST_RESOLUTION,
  RESOLUTION_ORDER,
  RESOLUTION_TO_MS,
} from "@/types/resolution.ts";

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
      {
        key: "has_speech",
        operation: {
          $sum: { $cond: [{ $eq: ["$vad.has_speech", true] }, 1, 0] },
        },
      },
    ],
  },
  diarizations: {
    count: true,
  },
  transcriptions: {
    count: true,
  },
};

export async function updateHistogram(
  auth: Auth,
  start: Date,
  end: Date,
  resolution: Resolution,
): Promise<void> {
  const mongo = await getMongoResource(auth);
  const binSize = RESOLUTION_TO_MS[resolution];

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
        auth,
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

    const results = await mongo({
      action: "aggregate",
      collection: sourceCollectionName,
      pipeline,
    });

    const ops = results.map(({ _id: binStart, ...aggr }: any) => ({
      updateOne: {
        filter: { start: binStart },
        update: {
          $set: {
            updated_at: new Date(),
            stale: false,
            ...(Object.keys(aggr).length > 0 && {
              [`totals.${sourceCollectionName}`]: aggr,
            }),
          },
        },
        upsert: true,
      },
    }));

    for (let i = 0; i < ops.length; i += 500) {
      await mongo({
        action: "bulkWrite",
        collection: `histogram_${resolution}`,
        operations: ops.slice(i, i + 500),
        options: { ordered: false },
      });
    }
  }
}

export async function updateHistogramOptimized(
  auth: Auth,
  start: Date,
  end: Date,
  resolution: Resolution,
): Promise<void> {
  if (resolution === LOWEST_RESOLUTION) {
    return updateHistogram(auth, start, end, resolution);
  }

  const mongo = await getMongoResource(auth);
  const binSize = RESOLUTION_TO_MS[resolution];

  // Floor start and ceil end to nearest resolution point
  start = new Date(Math.floor(start.getTime() / binSize) * binSize);
  end = new Date(Math.ceil(end.getTime() / binSize) * binSize);

  const totalBins = Math.ceil((end.getTime() - start.getTime()) / binSize);
  console.log(
    `   ├─ Querying lower resolution data (expected ~${totalBins} bins)...`,
  );

  // Get the next lower resolution
  const currentIndex = RESOLUTION_ORDER.indexOf(resolution);
  const lowerResolution = RESOLUTION_ORDER[currentIndex - 1];

  // Query the lower resolution data
  const lowerData = await mongo({
    action: "find",
    collection: `histogram_${lowerResolution}`,
    query: { start: { $gte: start, $lt: end } },
  });

  console.log(
    `   ├─ Processing ${lowerData.length} source bins into ${totalBins} target bins...`,
  );

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
            stale: false,
            updated_at: new Date(),
            totals,
          },
        },
        upsert: true,
      },
    };
  });

  const batchSize = 1000;
  const totalBatches = Math.ceil(ops.length / batchSize);
  console.log(`   ├─ Writing ${ops.length} bins in ${totalBatches} batches...`);

  for (let i = 0; i < ops.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    await mongo({
      action: "bulkWrite",
      collection: `histogram_${resolution}`,
      operations: ops.slice(i, i + batchSize),
    });
    if (totalBatches > 1) {
      console.log(
        `   │  └─ Batch ${batchNum}/${totalBatches} written (${
          Math.round(batchNum / totalBatches * 100)
        }%)`,
      );
    }
  }
  console.log(`   └─ ✓ Completed writing ${ops.length} bins`);
}

const day = 1000 * 60 * 60 * 24;

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

  // return {
  //   items: Array.from({ length: 100 }).map((_, i) => ({
  //     id: `${resolution}-${i}`,
  //     start: new Date(binSize * i),
  //     end: new Date(binSize * (i + 1)),
  //     totals: {
  //       audio_chunks: { count: binSize / 1000 / 60 * i, has_speech: binSize / 1000 / 60 * i },
  //       seconds: binSize,
  //     },
  //   })),
  //   start: originalStart,
  //   end: originalEnd,
  // };

  const mongo = await auth.getResource("tech.mycelia.mongo");

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

export async function updateAllHistogram(
  auth: Auth,
  start?: Date,
  end?: Date,
): Promise<void> {
  const mongo = await getMongoResource(auth);

  let earliestStart: Date | null = null;
  let latestStart: Date | null = null;

  if (!start || !end) {
    console.log("[Timeline] Scanning collections for data range...");
    for (const collectionName of Object.keys(TARGET_COLLECTIONS)) {
      const firstDoc = await mongo({
        action: "find",
        collection: collectionName,
        query: {},
        options: { sort: { start: 1 }, limit: 1 },
      });
      if (
        firstDoc.length > 0 &&
        (!earliestStart || firstDoc[0].start < earliestStart)
      ) {
        earliestStart = firstDoc[0].start;
      }

      const lastDoc = await mongo({
        action: "find",
        collection: collectionName,
        query: {},
        options: { sort: { start: -1 }, limit: 1 },
      });
      if (
        lastDoc.length > 0 && (!latestStart || lastDoc[0].start > latestStart)
      ) {
        latestStart = lastDoc[0].start;
      }
    }

    if (!earliestStart || !latestStart) {
      throw new Error("No data found in target collections");
    }

    if (!start) {
      start = earliestStart;
    }
    if (!end) {
      end = latestStart;
    }
  }

  const totalDays = Math.ceil((end.getTime() - start.getTime()) / day);
  console.log(
    `[Timeline] Recalculating histograms from ${start.toISOString()} to ${end.toISOString()} (~${totalDays} days)`,
  );
  console.log(
    `[Timeline] Processing ${RESOLUTION_ORDER.length} resolutions: ${
      RESOLUTION_ORDER.join(", ")
    }`,
  );
  console.log(`[Timeline] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const startTime = Date.now();
  const resolutionTimes: number[] = [];

  for (let i = 0; i < RESOLUTION_ORDER.length; i++) {
    const resolution = RESOLUTION_ORDER[i];
    const progress = Math.round((i / RESOLUTION_ORDER.length) * 100);

    console.log(
      `\n[Timeline] [${
        i + 1
      }/${RESOLUTION_ORDER.length}] ${resolution.toUpperCase()} (${progress}% complete)`,
    );
    console.log(
      `[Timeline] ┌─────────────────────────────────────────────────────`,
    );

    const resStart = Date.now();
    await updateHistogramOptimized(auth, start, end, resolution);
    const resDuration = (Date.now() - resStart) / 1000;
    resolutionTimes.push(resDuration);

    const elapsed = (Date.now() - startTime) / 1000;
    const avgTimePerResolution = resolutionTimes.reduce((a, b) => a + b, 0) /
      resolutionTimes.length;
    const remainingResolutions = RESOLUTION_ORDER.length - (i + 1);
    const etaSeconds = avgTimePerResolution * remainingResolutions;

    let etaStr = "";
    if (etaSeconds < 60) {
      etaStr = `~${Math.round(etaSeconds)}s remaining`;
    } else if (etaSeconds < 3600) {
      etaStr = `~${Math.round(etaSeconds / 60)}m remaining`;
    } else {
      const hours = Math.floor(etaSeconds / 3600);
      const mins = Math.round((etaSeconds % 3600) / 60);
      etaStr = `~${hours}h ${mins}m remaining`;
    }

    const completePct = Math.round(((i + 1) / RESOLUTION_ORDER.length) * 100);
    console.log(
      `[Timeline] └─────────────────────────────────────────────────────`,
    );
    console.log(
      `[Timeline] ✓ ${resolution} completed in ${
        resDuration.toFixed(1)
      }s | ${completePct}% complete | ${etaStr}`,
    );
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `\n[Timeline] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  );
  console.log(
    `[Timeline] ✅ All histograms updated successfully in ${totalTime}s`,
  );
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
