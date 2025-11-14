import { Redis } from "ioredis";
import Redlock from "redlock";
import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";

export const redis = new Redis({
  maxRetriesPerRequest: null,
  password: Deno.env.get("REDIS_PASSWORD"),
  host: Deno.env.get("REDIS_HOST") || "localhost",
  port: parseInt(Deno.env.get("REDIS_PORT") || "6379"),
  lazyConnect: true,
});

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
]);

type RedisRequest = z.infer<typeof redisRequestSchema>;
type RedisResponse = any;

export class RedisResource implements Resource<RedisRequest, RedisResponse> {
  code = "tech.mycelia.redis";
  description = "Redis caching operations";
  schemas: {
    request: z.ZodType<RedisRequest>;
    response: z.ZodType<RedisResponse>;
  } = {
    request: redisRequestSchema as z.ZodType<RedisRequest>,
    response: z.any() as z.ZodType<RedisResponse>,
  };

  async use(input: RedisRequest): Promise<RedisResponse> {
    switch (input.action) {
      case "set":
        return redis.set(input.key, input.value, "EX", input.ttlSeconds);
      case "get":
        return redis.get(input.key);
      case "del":
        return redis.del(...input.keys);
      case "hset":
        return await redis.pipeline()
          .hset(input.key, input.field, input.value)
          .expire(input.key, input.ttlSeconds)
          .exec();
      case "hget":
        return redis.hget(input.key, input.field);
      case "hgetall":
        return redis.hgetall(input.key);
      case "xadd": {
        const fieldsArray: string[] = [];
        for (const [key, value] of Object.entries(input.fields)) {
          fieldsArray.push(key, value);
        }
        const args = input.id
          ? [input.key, input.id, ...fieldsArray]
          : [input.key, "*", ...fieldsArray];
        return redis.xadd(...(args as [string, string, ...string[]]));
      }
      case "xread": {
        const args: any[] = [];
        if (input.count !== undefined) {
          args.push("COUNT", input.count);
        }
        if (input.block !== undefined) {
          args.push("BLOCK", input.block);
        }
        args.push("STREAMS", ...input.streams, ...input.ids);
        return (redis.xread as any).apply(redis, args);
      }
      case "xreadgroup": {
        const args: any[] = ["GROUP", input.group, input.consumer];
        if (input.count !== undefined) {
          args.push("COUNT", input.count);
        }
        if (input.block !== undefined) {
          args.push("BLOCK", input.block);
        }
        if (input.noack) {
          args.push("NOACK");
        }
        args.push("STREAMS", ...input.streams, ...input.ids);
        return (redis.xreadgroup as any).apply(redis, args);
      }
      case "xgroup": {
        const args: any[] = [input.operation, input.key, input.group];
        if (input.operation === "CREATE" || input.operation === "SETID") {
          if (input.id) {
            args.push(input.id);
          } else if (input.operation === "CREATE") {
            args.push("$");
          }
          if (input.mkstream && input.operation === "CREATE") {
            args.push("MKSTREAM");
          }
        } else if (
          input.operation === "CREATECONSUMER" ||
          input.operation === "DELCONSUMER"
        ) {
          if (input.consumer) {
            args.push(input.consumer);
          }
        }
        return (redis.xgroup as any).apply(redis, args);
      }
      case "xack":
        return redis.xack(
          input.key,
          input.group,
          ...(input.ids as [string, ...string[]]),
        );
      case "xdel":
        return redis.xdel(input.key, ...(input.ids as [string, ...string[]]));
      case "xrange": {
        const args: any[] = [];
        if (input.count !== undefined) {
          args.push("COUNT", input.count);
        }
        return redis.xrange(input.key, input.start, input.end, ...args);
      }
      case "xrevrange": {
        const args: any[] = [];
        if (input.count !== undefined) {
          args.push("COUNT", input.count);
        }
        return redis.xrevrange(input.key, input.start, input.end, ...args);
      }
      case "xlen":
        return redis.xlen(input.key);
      case "xtrim": {
        const args: any[] = [];
        if (input.approximate) {
          args.push("~");
        }
        args.push(input.threshold);
        if (input.limit !== undefined) {
          args.push("LIMIT", input.limit);
        }
        // @ts-expect-error - spread argument with dynamic args array
        return redis.xtrim(input.key, ...args);
      }
      default:
        throw new Error("Unknown action");
    }
  }

  extractActions(input: RedisRequest) {
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
  return auth.getResource("tech.mycelia.redis");
}
