import { z } from "zod";
import ms from "ms";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import {
  ensureHistogramIndex,
  invalidateHistogram,
  type Resolution,
} from "@/services/timeline.server.ts";
import { zDateOrRelativeTime, parseDateOrRelativeTime } from "@myceliasdk/zod-json-schema.ts";
import { getJobsResource } from "@/lib/resources/worker.ts";


const recalculateSchema = z.object({
  action: z.literal("recalculate"),
  start: zDateOrRelativeTime().optional(),
  end: zDateOrRelativeTime().optional(),
});

const ensureIndexSchema = z.object({
  action: z.literal("ensureIndex"),
});

const invalidateSchema = z.object({
  action: z.literal("invalidate"),
  start: zDateOrRelativeTime().optional(),
  end: zDateOrRelativeTime().optional(),
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
    const validatedInput = timelineRequestSchema.parse(input);  
    switch (validatedInput.action) {
      case "recalculate": {
        const jobsResource = await getJobsResource(auth);

        const jobData = {
          type: "histRecalculation" as const,
          start: validatedInput.start?.toISOString(),
          end: validatedInput.end?.toISOString(),
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
        await invalidateHistogram(
          auth,
          validatedInput.start,
          validatedInput.end,
          validatedInput.resolution,
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
