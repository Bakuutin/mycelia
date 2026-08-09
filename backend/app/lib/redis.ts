import { Redis } from "ioredis";
import Redlock from "redlock";
import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { env } from "#/env.ts";

export const redis = new Redis({
  maxRetriesPerRequest: null,
  password: env.REDIS_PASSWORD,
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  lazyConnect: true,
});

// Redis restores an RDB snapshot on restart, so anything written since its last
// save is gone. Callers that read an absence as meaningful (for example the
// orphaned-job reaper) need to know how long the current connection has been up
// before trusting what they see.
let connectedSince: number | null = null;

redis.on("ready", () => {
  connectedSince = Date.now();
});
for (const event of ["close", "end", "reconnecting"]) {
  redis.on(event, () => {
    connectedSince = null;
  });
}

/**
 * Milliseconds the Redis connection has been continuously established, or null
 * when it is not currently up.
 */
export function getRedisConnectedForMs(): number | null {
  if (connectedSince === null || redis.status !== "ready") return null;
  return Date.now() - connectedSince;
}

export const redlock = new Redlock([redis as any], {
  driftFactor: 0.01,
  retryCount: 10,
  retryDelay: 200,
  retryJitter: 200,
  automaticExtensionThreshold: 500,
});

const setSchema = z.object({
  action: z.literal("set"),
  key: z.string(),
  value: z.string(),
  ttlSeconds: z.number().default(86400), // 1 day default
});

const getSchema = z.object({
  action: z.literal("get"),
  key: z.string(),
});

const delSchema = z.object({
  action: z.literal("del"),
  keys: z.array(z.string()),
});

const hsetSchema = z.object({
  action: z.literal("hset"),
  key: z.string(),
  field: z.string(),
  value: z.string(),
  ttlSeconds: z.number().default(86400), // 1 day default
});

const hgetSchema = z.object({
  action: z.literal("hget"),
  key: z.string(),
  field: z.string(),
});

const hgetallSchema = z.object({
  action: z.literal("hgetall"),
  key: z.string(),
});

const xaddSchema = z.object({
  action: z.literal("xadd"),
  key: z.string(),
  id: z.string().optional(),
  fields: z.record(z.string(), z.string()),
});

const xreadSchema = z.object({
  action: z.literal("xread"),
  streams: z.array(z.string()),
  ids: z.array(z.string()),
  count: z.number().optional(),
  block: z.number().optional(),
});

const xreadgroupSchema = z.object({
  action: z.literal("xreadgroup"),
  group: z.string(),
  consumer: z.string(),
  streams: z.array(z.string()),
  ids: z.array(z.string()),
  count: z.number().optional(),
  block: z.number().optional(),
  noack: z.boolean().optional(),
});

const xgroupSchema = z.object({
  action: z.literal("xgroup"),
  operation: z.enum([
    "CREATE",
    "CREATECONSUMER",
    "DELCONSUMER",
    "DESTROY",
    "SETID",
  ]),
  key: z.string(),
  group: z.string(),
  id: z.string().optional(),
  consumer: z.string().optional(),
  mkstream: z.boolean().optional(),
});

const xackSchema = z.object({
  action: z.literal("xack"),
  key: z.string(),
  group: z.string(),
  ids: z.array(z.string()),
});

const xdelSchema = z.object({
  action: z.literal("xdel"),
  key: z.string(),
  ids: z.array(z.string()),
});

const xrangeSchema = z.object({
  action: z.enum(["xrange", "xrevrange"]),
  key: z.string(),
  count: z.number().optional(),
  start: z.number(),
  end: z.number(),
});

const xlenSchema = z.object({
  action: z.literal("xlen"),
  key: z.string(),
});

const xtrimSchema = z.object({
  action: z.literal("xtrim"),
  key: z.string(),
  strategy: z.enum(["MAXLEN", "MINID"]),
  threshold: z.string(),
  approximate: z.boolean().optional(),
  limit: z.number().optional(),
});

const singleOperationSchema = z.discriminatedUnion("action", [
  setSchema,
  getSchema,
  delSchema,
  hsetSchema,
  hgetSchema,
  hgetallSchema,
  xaddSchema,
  xreadSchema,
  xreadgroupSchema,
  xgroupSchema,
  xackSchema,
  xdelSchema,
  xrangeSchema,
  xlenSchema,
  xtrimSchema,
]);

const pipelineSchema = z.object({
  action: z.literal("pipeline"),
  operations: z.array(singleOperationSchema),
});

const redisRequestSchema = z.discriminatedUnion("action", [
  setSchema,
  getSchema,
  delSchema,
  hsetSchema,
  hgetSchema,
  hgetallSchema,
  xaddSchema,
  xreadSchema,
  xreadgroupSchema,
  xgroupSchema,
  xackSchema,
  xdelSchema,
  xrangeSchema,
  xlenSchema,
  xtrimSchema,
  pipelineSchema,
]);

type RedisRequest = z.infer<typeof redisRequestSchema>;
type RedisResponse = any;

export class RedisResource implements Resource<RedisRequest, RedisResponse> {
  code = "redis";
  description = "Redis operations";
  schemas: {
    request: z.ZodType<RedisRequest>;
    response: z.ZodType<RedisResponse>;
  } = {
    request: redisRequestSchema as z.ZodType<RedisRequest>,
    response: z.any() as z.ZodType<RedisResponse>,
  };

  private executeOperation(
    executor: any,
    operation: z.infer<typeof singleOperationSchema>,
    isPipeline: boolean,
  ): any {
    switch (operation.action) {
      case "set":
        return executor.set(operation.key, operation.value, "EX", operation.ttlSeconds);
      case "get":
        return executor.get(operation.key);
      case "del":
        return executor.del(...operation.keys);
      case "hset":
        executor.hset(operation.key, operation.field, operation.value);
        return executor.expire(operation.key, operation.ttlSeconds);
      case "hget":
        return executor.hget(operation.key, operation.field);
      case "hgetall":
        return executor.hgetall(operation.key);
      case "xadd": {
        const fieldsArray: string[] = [];
        for (const [key, value] of Object.entries(operation.fields)) {
          fieldsArray.push(key, value);
        }
        const args = operation.id
          ? [operation.key, operation.id, ...fieldsArray]
          : [operation.key, "*", ...fieldsArray];
        return executor.xadd(...(args as [string, string, ...string[]]));
      }
      case "xack":
        return executor.xack(
          operation.key,
          operation.group,
          ...(operation.ids as [string, ...string[]]),
        );
      case "xdel":
        return executor.xdel(operation.key, ...(operation.ids as [string, ...string[]]));
      case "xlen":
        return executor.xlen(operation.key);
      case "xread": {
        if (isPipeline) {
          throw new Error("xread is not supported in pipeline");
        }
        const args: any[] = [];
        if (operation.count !== undefined) {
          args.push("COUNT", operation.count);
        }
        if (operation.block !== undefined) {
          args.push("BLOCK", operation.block);
        }
        args.push("STREAMS", ...operation.streams, ...operation.ids);
        return (executor.xread as any).apply(executor, args);
      }
      case "xreadgroup": {
        if (isPipeline) {
          throw new Error("xreadgroup is not supported in pipeline");
        }
        const args: any[] = ["GROUP", operation.group, operation.consumer];
        if (operation.count !== undefined) {
          args.push("COUNT", operation.count);
        }
        if (operation.block !== undefined) {
          args.push("BLOCK", operation.block);
        }
        if (operation.noack) {
          args.push("NOACK");
        }
        args.push("STREAMS", ...operation.streams, ...operation.ids);
        return (executor.xreadgroup as any).apply(executor, args);
      }
      case "xgroup": {
        if (isPipeline) {
          throw new Error("xgroup is not supported in pipeline");
        }
        const args: any[] = [operation.operation, operation.key, operation.group];
        if (operation.operation === "CREATE" || operation.operation === "SETID") {
          if (operation.id) {
            args.push(operation.id);
          } else if (operation.operation === "CREATE") {
            args.push("$");
          }
          if (operation.mkstream && operation.operation === "CREATE") {
            args.push("MKSTREAM");
          }
        } else if (
          operation.operation === "CREATECONSUMER" ||
          operation.operation === "DELCONSUMER"
        ) {
          if (operation.consumer) {
            args.push(operation.consumer);
          }
        }
        return (executor.xgroup as any).apply(executor, args);
      }
      case "xrange": {
        if (isPipeline) {
          throw new Error("xrange is not supported in pipeline");
        }
        const args: any[] = [];
        if (operation.count !== undefined) {
          args.push("COUNT", operation.count);
        }
        return executor.xrange(operation.key, operation.start, operation.end, ...args);
      }
      case "xrevrange": {
        if (isPipeline) {
          throw new Error("xrevrange is not supported in pipeline");
        }
        const args: any[] = [];
        if (operation.count !== undefined) {
          args.push("COUNT", operation.count);
        }
        return executor.xrevrange(operation.key, operation.start, operation.end, ...args);
      }
      case "xtrim": {
        if (isPipeline) {
          throw new Error("xtrim is not supported in pipeline");
        }
        const args: any[] = [];
        if (operation.approximate) {
          args.push("~");
        }
        args.push(operation.threshold);
        if (operation.limit !== undefined) {
          args.push("LIMIT", operation.limit);
        }
        return executor.xtrim(operation.key, ...args);
      }
      default:
        throw new Error(`Unknown action: ${(operation as any).action}`);
    }
  }

  private addOperationToPipeline(pipeline: any, operation: z.infer<typeof singleOperationSchema>) {
    this.executeOperation(pipeline, operation, true);
  }

  async use(input: RedisRequest): Promise<RedisResponse> {
    if (input.action === "pipeline") {
      const pipeline = redis.pipeline();
      for (const operation of input.operations) {
        this.addOperationToPipeline(pipeline, operation);
      }
      return pipeline.exec();
    }

    // hset requires a pipeline for atomicity (hset + expire)
    if (input.action === "hset") {
      return await redis.pipeline()
        .hset(input.key, input.field, input.value)
        .expire(input.key, input.ttlSeconds)
        .exec();
    }

    return this.executeOperation(redis, input, false);
  }

  extractActions(input: RedisRequest): { path: string[]; actions: string[] }[] {
    if (input.action === "pipeline") {
      return input.operations.flatMap((operation: RedisRequest) => this.extractActions(operation));
    }

    let keys: string[];

    if (input.action === "del") {
      keys = input.keys;
    } else if (input.action === "xread" || input.action === "xreadgroup") {
      keys = input.streams;
    } else if ("key" in input) {
      keys = [input.key];
    } else {
      keys = [];
    }

    return keys.map((key) => ({
      path: [key],
      actions: [input.action],
    }));
  }
}

export async function getRedisResource(
  auth: Auth,
): Promise<(input: RedisRequest) => Promise<RedisResponse>> {
  return auth.getResource("redis");
}
