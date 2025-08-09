import { z } from "zod";
import ms from "ms";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import {
  ensureHistogramIndex,
  updateAllHistogram,
} from "@/services/timeline.server.ts";

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

const dateOrRelativeTimeSchema = z
  .union([z.date(), z.string()])
  .transform((val) => parseDateOrRelativeTime(val));

const recalculateSchema = z.object({
  action: z.literal("recalculate"),
  start: dateOrRelativeTimeSchema.optional(),
  end: dateOrRelativeTimeSchema.optional(),
  all: z.boolean().optional(),
});

const ensureIndexSchema = z.object({
  action: z.literal("ensureIndex"),
});

const timelineRequestSchema = z.discriminatedUnion("action", [
  recalculateSchema,
  ensureIndexSchema,
]);

type TimelineRequest = z.input<typeof timelineRequestSchema>;
type TimelineResponse = any;

export class TimelineResource
  implements Resource<TimelineRequest, TimelineResponse> {
  code = "tech.mycelia.timeline";
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

        if (input.all) {
          await updateAllHistogram(auth);
        } else {
          await updateAllHistogram(auth, parsedStart, parsedEnd);
        }
        return { success: true };
      }
      case "ensureIndex":
        await ensureHistogramIndex(auth);
        return { success: true };
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
): Promise<(input: TimelineRequest) => Promise<TimelineResponse>> {
  return auth.getResource("tech.mycelia.timeline");
}
