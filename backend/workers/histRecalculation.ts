import type { Job } from "bullmq";
import { z } from "zod";
import type { JobData, JobResult } from "@/lib/jobs/types.ts";
import { env } from "#/env.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import type { Auth } from "@/lib/auth/core.server.ts";
import type { Resolution } from "@/types/resolution.ts";
import {
  LOWEST_RESOLUTION,
  RESOLUTION_ORDER,
  RESOLUTION_TO_MS,
} from "@/types/resolution.ts";

import type { JobCapability } from "@/lib/jobs/job-registry.ts";

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

const day = 1000 * 60 * 60 * 24;

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

  // Create empty buckets for time slots that have no data
  const emptyBucketOps = [];
  for (let t = start.getTime(); t < end.getTime(); t += binSize) {
    emptyBucketOps.push({
      updateOne: {
        filter: { start: new Date(t) },
        update: {
          $setOnInsert: {
            start: new Date(t),
            totals: {},
            stale: false,
            updated_at: new Date(),
          },
        },
        upsert: true,
      },
    });
  }

  for (let i = 0; i < emptyBucketOps.length; i += 500) {
    await mongo({
      action: "bulkWrite",
      collection: `histogram_${resolution}`,
      operations: emptyBucketOps.slice(i, i + 500),
      options: { ordered: false },
    });
  }
}

async function updateHistogramOptimized(
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
  const lowerBinSize = RESOLUTION_TO_MS[lowerResolution];

  // Batch to stay under 1000 lower-resolution bins per query
  // e.g., for 1hour: 1000 * 5min = 5000 min = ~83 hours per batch
  const MAX_LOWER_BINS = 900; // Stay safely under 1000 limit
  const BATCH_SIZE = MAX_LOWER_BINS * lowerBinSize;

  if (end.getTime() - start.getTime() > BATCH_SIZE) {
    const steps = Math.ceil((end.getTime() - start.getTime()) / BATCH_SIZE);
    console.log(`   ├─ Splitting into ${steps} batches (max ${MAX_LOWER_BINS} source bins each)...`);
    for (let i = 0; i < steps; i++) {
      const batchStart = new Date(start.getTime() + i * BATCH_SIZE);
      const batchEnd = new Date(Math.min(start.getTime() + (i + 1) * BATCH_SIZE, end.getTime()));
      console.log(`   ├─ Batch ${i + 1}/${steps}: ${batchStart.toISOString()} to ${batchEnd.toISOString()}`);
      await updateHistogramOptimizedBatch(auth, batchStart, batchEnd, resolution);
    }
    return;
  }

  await updateHistogramOptimizedBatch(auth, start, end, resolution);
}

async function updateHistogramOptimizedBatch(
  auth: Auth,
  start: Date,
  end: Date,
  resolution: Resolution,
): Promise<void> {
  const mongo = await getMongoResource(auth);
  const binSize = RESOLUTION_TO_MS[resolution];

  const totalBins = Math.ceil((end.getTime() - start.getTime()) / binSize);

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
    `   │  Processing ${lowerData.length} source bins into ${totalBins} target bins...`,
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

  // Create empty buckets for time slots that have no data
  const emptyBucketOps = [];
  for (let t = start.getTime(); t < end.getTime(); t += binSize) {
    const binKey = new Date(t).toISOString();
    if (!aggregatedData.has(binKey)) {
      emptyBucketOps.push({
        updateOne: {
          filter: { start: new Date(t) },
          update: {
            $setOnInsert: {
              start: new Date(t),
              totals: {},
              stale: false,
              updated_at: new Date(),
            },
          },
          upsert: true,
        },
      });
    }
  }

  if (emptyBucketOps.length > 0) {
    console.log(`   ├─ Creating ${emptyBucketOps.length} empty buckets...`);
    for (let i = 0; i < emptyBucketOps.length; i += batchSize) {
      await mongo({
        action: "bulkWrite",
        collection: `histogram_${resolution}`,
        operations: emptyBucketOps.slice(i, i + batchSize),
      });
    }
  }

  console.log(`   └─ ✓ Completed writing ${ops.length + emptyBucketOps.length} bins`);
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

/** Job type name */
export const name = "histRecalculation";

/** Schema for histogram recalculation job data */
export const schema = z.object({
  type: z.literal("histRecalculation"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  all: z.boolean().default(false),
});

export type HistRecalculationJobData = z.infer<typeof schema>;

/** Process the histogram recalculation job */
export async function use(job: Job<JobData>): Promise<JobResult> {
  const jobData = job.data as HistRecalculationJobData;

  const start = jobData.start ? new Date(jobData.start) : undefined;
  const end = jobData.end ? new Date(jobData.end) : undefined;

  console.log(`[histRecalculation] Job ${job.id}: processing time range ${start?.toISOString() ?? 'N/A'} to ${end?.toISOString() ?? 'N/A'}`);

  if (!start || !end) {
    console.log(`[histRecalculation] Job ${job.id}: missing start or end date`);
    return { success: false, message: "Start or end date is required" };
  }

  const jwt = Deno.env.get("MYCELIA_JWT")!;
  const myceliaUrl = env.MYCELIA_URL;

  const auth = {
    getResource: (code: string) => (input: any) => callResource(code, input, { jwt, myceliaUrl })
  } as any;

  await updateAllHistogram(auth, start, end);

  return { success: true };
}

const capability: JobCapability = {
  name,
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({
    success: z.boolean(),
  })),
  policies: [
    { resource: "db/audio_chunks", action: "*", effect: "allow" },
    { resource: "db/diarizations", action: "*", effect: "allow" },
    { resource: "db/transcriptions", action: "*", effect: "allow" },
    { resource: "db/histogram_*", action: "*", effect: "allow" },
    { resource: "db/configs", action: "read", effect: "allow" },
  ],
  use,
};

export default capability;
