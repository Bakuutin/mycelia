import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth, getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource, getRootDB } from "@/lib/mongo/core.server.ts";
import { redlock } from "@/lib/redis.ts";
import { ObjectId } from "mongodb";

const acknowledgeBatchSchema = z.object({
  action: z.literal("acknowledge"),
  collection: z.string(),
  processorName: z.string(),
  statuses: z.array(
    z.discriminatedUnion(
      "status",
      [
        z.object({
          id: z.instanceof(ObjectId),
          status: z.literal("done"),
        }).passthrough(),
        z.object({
          id: z.instanceof(ObjectId),
          status: z.literal("failed"),
          error: z.any(),
        }),
      ],
    ),
  ),
});

const claimBatchSchema = z.object({
  action: z.literal("claim"),
  collection: z.string(),
  processorName: z.string(),
  workerId: z.string(),
  query: z.record(z.string(), z.any()).optional(),
  batchSize: z.number().default(1).optional(),
  includePendingOlderThanSeconds: z.number().optional(),
  noIndex: z.boolean().optional(),
});

const processorRequestSchema = z.discriminatedUnion("action", [
  acknowledgeBatchSchema,
  claimBatchSchema,
]);

export type ProcessorRequest = z.infer<typeof processorRequestSchema>;
export type ProcessorResponse = any;

export class ProcessorResource
  implements Resource<ProcessorRequest, ProcessorResponse> {
  code = "tech.mycelia.processors";
  description =
    "Change stream-based processor management for inline document processing";
  schemas = {
    request: processorRequestSchema as z.ZodType<ProcessorRequest>,
    response: z.any(),
  };

  async getRootDB() {
    return getRootDB();
  }

  async use(input: ProcessorRequest, auth: Auth): Promise<ProcessorResponse> {
    switch (input.action) {
      case "acknowledge":
        return this.acknowledgeBatch(input, auth);
      case "claim":
        return this.claimBatch(input, auth);
    }
  }

  getCoreQuery(input: z.infer<typeof claimBatchSchema>) {
    return {
      $or: [
        { [input.processorName]: { $exists: false } },
        {
          [`${input.processorName}.status`]: "pending",
          [`${input.processorName}.startedAt`]: {
            $lt: new Date(
              Date.now() -
                (input.includePendingOlderThanSeconds ?? 3600) * 1000,
            ),
          },
        },
      ],
    };
  }

  async claimBatch(
    input: z.infer<typeof claimBatchSchema>,
    auth: Auth,
  ): Promise<ProcessorResponse> {
    const db = await getMongoResource(auth);

    let query: any = this.getCoreQuery(input);

    if (input.query) {
      query = {
        $and: [
          query,
          input.query,
        ],
      };
    }

    if (!input.noIndex) {
      // TODO: Ensure index by core query
    }

    const lock = await redlock.acquire([
      "processor",
      input.processorName,
      input.collection,
    ], 5000);

    try {
      const docs = await db({
        action: "find",
        collection: input.collection,
        query,
        options: {
          limit: input.batchSize,
          sort: { _id: -1 },
        },
      });

      if (docs.length === 0) {
        return [];
      }

      const docIds = docs.map((doc: any) => doc._id);
      await db({
        action: "updateMany",
        collection: input.collection,
        query: { _id: { $in: docIds } },
        update: {
          $set: Object.fromEntries(
            Object.entries({
              status: "in-progress",
              worker: {
                id: input.workerId,
                principal: auth.principal,
              },
              startedAt: new Date(),
            }).map(([key, doc]) => [`${input.processorName}.${key}`, doc]),
          ),
        },
      });

      return docs;
    } finally {
      await lock.release();
    }
  }

  extractActions(input: ProcessorRequest) {
    return [
      {
        path: ["processors", input.processorName],
        actions: [input.action],
      },
    ];
  }

  async acknowledgeBatch(
    input: z.infer<typeof acknowledgeBatchSchema>,
    auth: Auth,
  ): Promise<ProcessorResponse> {
    const db = await getMongoResource(auth);
    await db({
      action: "bulkWrite",
      collection: input.collection,
      operations: input.statuses.map((item) => ({
        updateOne: {
          filter: { _id: item.id },
          update: {
            $set: Object.fromEntries(
              Object.entries({
                ...item,
                startedAt: new Date(),
              }).map(([key, doc]) => [`${input.processorName}.${key}`, doc]),
            ),
          },
        },
      })),
    });
  }
}

export async function getProcessorResource(
  auth: Auth,
): Promise<(input: ProcessorRequest) => Promise<ProcessorResponse>> {
  return auth.getResource("tech.mycelia.processors");
}

export class Processor {
}
