import { z } from "zod";
import ms from "ms";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import {
  ensureHistogramIndex,
  invalidateHistogram,
  type Resolution,
} from "@/services/timeline.server.ts";
import { zDateOrRelativeTime } from "@myceliasdk/zod-json-schema.ts";
import { getJobsResource } from "@/lib/resources/worker.ts";

function parseDateOrRelativeTime(expr: string | Date): Date {
  if (expr instanceof Date) {
    return expr;
  }

  try {
    const relativeMs = ms(expr);
    if (relativeMs) {
      return new Date(Date.now() - relativeMs);
    }
    return new Date(expr);
  } catch {
    throw new Error(
      `Invalid time expression: ${expr}. Use format like "5d" or "10m" or an ISO date`,
    );
  }
}

const dateOrRelativeTimeSchema = zDateOrRelativeTime();

const recalculateSchema = z.object({
  action: z.literal("recalculate"),
  start: dateOrRelativeTimeSchema.optional(),
  end: dateOrRelativeTimeSchema.optional(),
  all: z.boolean().optional(),
});

const ensureIndexSchema = z.object({
  action: z.literal("ensureIndex"),
});

const invalidateSchema = z.object({
  action: z.literal("invalidate"),
  start: dateOrRelativeTimeSchema.optional(),
  end: dateOrRelativeTimeSchema.optional(),
  resolution: z.enum(["5min", "1hour", "1day", "1week"]).optional(),
});

const timelineRequestSchema = z.discriminatedUnion("action", [
  recalculateSchema,
  ensureIndexSchema,
  invalidateSchema,
]);

type TimelineRequest = z.input<typeof timelineRequestSchema>;
type TimelineResponse = any;

export class TimelineResource
  implements Resource<TimelineRequest, TimelineResponse> {
  code = "timeline";
  description = "Timeline management";
  schemas = {
    request: timelineRequestSchema,
    response: z.any(),
  };

  async use(input: TimelineRequest, auth: Auth): Promise<TimelineResponse> {
    switch (input.action) {
      case "recalculate": {
        const parsedStart = input.start !== undefined
          ? parseDateOrRelativeTime(input.start)
          : undefined;
        const parsedEnd = input.end !== undefined
          ? parseDateOrRelativeTime(input.end)
          : undefined;

        const jobsResource = await getJobsResource(auth);

        const jobData = {
          type: "histRecalculation" as const,
          start: parsedStart?.toISOString(),
          end: parsedEnd?.toISOString(),
          all: input.all || false,
        };

        const jobResult = await jobsResource({
          action: "enqueue",
          data: jobData,
          trigger: {
            type: "manual",
            reason: "Timeline recalculation requested via API",
          },
        });

        return {
          success: true,
          jobId: jobResult.jobId,
          message: `Timeline histogram recalculation job enqueued successfully`,
        };
      }
      case "ensureIndex":
        await ensureHistogramIndex(auth);
        return { success: true };
      case "invalidate": {
        const parsedStart = input.start !== undefined
          ? parseDateOrRelativeTime(input.start)
          : undefined;
        const parsedEnd = input.end !== undefined
          ? parseDateOrRelativeTime(input.end)
          : undefined;

        await invalidateHistogram(
          auth,
          parsedStart,
          parsedEnd,
          input.resolution,
        );
        return { success: true };
      }
      default:
        throw new Error("Unknown timeline action");
    }
  }

  extractActions(input: TimelineRequest) {
    return [
      {
        path: ["timeline"],
        actions: [input.action],
      },
    ];
  }
}

export function getTimelineResource(
  auth: Auth,
): (input: TimelineRequest) => Promise<TimelineResponse> {
  return auth.getResource<TimelineRequest, TimelineResponse>("timeline") 
}
