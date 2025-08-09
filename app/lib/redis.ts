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

const redisRequestSchema = z.discriminatedUnion("action", [
  setSchema,
  getSchema,
  delSchema,
  hsetSchema,
  hgetSchema,
  hgetallSchema,
]);

type RedisRequest = z.infer<typeof redisRequestSchema>;
type RedisResponse = any;

export class RedisResource implements Resource<RedisRequest, RedisResponse> {
  code = "tech.mycelia.redis";
  description = "Redis caching operations including key-value storage, hash operations, and TTL management with automatic expiration";
  schemas: {
    request: z.ZodType<RedisRequest>,
    response: z.ZodType<RedisResponse>,
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
      default:
        throw new Error("Unknown action");
    }
  }

  extractActions(input: RedisRequest) {
    const keys = input.action === "del" ? input.keys : [input.key];

    return keys.map(key => ({
      path: [key],
      actions: [input.action]
    }));
  }
}

export async function getRedisResource(
  auth: Auth,
): Promise<(input: RedisRequest) => Promise<RedisResponse>> {
  return auth.getResource("tech.mycelia.redis");
}
