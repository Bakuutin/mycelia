import { Redis } from "ioredis";
import Redlock from "redlock";

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
