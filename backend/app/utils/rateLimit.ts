import type { Request, Response } from "express";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getRedisResource } from "@/lib/redis.ts";

const RATE_LIMIT_PREFIX = "ratelimit:";

export interface RateLimitOptions {
  /** Function to generate the rate limit key from the request */
  keyGenerator: (req: Request) => string | Promise<string>;
  /** Maximum number of requests allowed */
  limit: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Custom error message (optional) */
  errorMessage?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Internal function to check rate limit
 */
async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  redis: Awaited<ReturnType<typeof getRedisResource>>
): Promise<RateLimitResult> {
  const rateLimitKey = `${RATE_LIMIT_PREFIX}${key}`;

  const current = await redis({
    action: "get",
    key: rateLimitKey,
  });

  const count = current ? parseInt(current as string, 10) : 0;

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  await redis({
    action: "set",
    key: rateLimitKey,
    value: String(count + 1),
    ttlSeconds: windowSeconds,
  });

  return { allowed: true, remaining: limit - count - 1 };
}

/**
 * Decorator function that wraps an Express request handler with rate limiting
 * 
 * @example
 * ```ts
 * export const oauthAuthorizeHandler = withRateLimit(
 *   {
 *     keyGenerator: (req) => `authorize:${req.query.client_id}`,
 *     limit: 10,
 *     windowSeconds: 60,
 *   },
 *   async (req, res) => {
 *     // handler logic
 *   }
 * );
 * ```
 */
export function withRateLimit(
  options: RateLimitOptions,
  handler: (req: Request, res: Response) => Promise<void> | void
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    try {
      const auth = await getServerAuth();
      const redis = await getRedisResource(auth);

      const key = await Promise.resolve(options.keyGenerator(req));
      const rateLimitCheck = await checkRateLimit(
        key,
        options.limit,
        options.windowSeconds,
        redis
      );

      if (!rateLimitCheck.allowed) {
        res.status(429).json({
          error: "too_many_requests",
          error_description: options.errorMessage || "Rate limit exceeded. Please try again later.",
        });
        return;
      }

      await handler(req, res);
    } catch (error) {
      console.error("Rate limit error:", error);
      // Fail closed: if rate limiting is unavailable, reject rather than allow through
      res.status(503).json({
        error: "service_unavailable",
        error_description: "Rate limiting service unavailable. Please try again later.",
      });
    }
  };
}

