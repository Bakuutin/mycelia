import { ObjectId } from "bson";
import { z } from "zod";
import { type Auth } from "@/lib/auth/core.server.ts";
import { type Resource } from "@/lib/auth/resources.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const timeZoneSchema = z.string().min(1).refine(isValidTimeZone, {
  message: "Expected a valid IANA time zone (for example, Europe/Paris)",
});

const locationSchema = z.object({
  name: z.string().trim().min(1).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).refine(
  (value) => (value.latitude === undefined) === (value.longitude === undefined),
  { message: "Latitude and longitude must be provided together" },
);

const optionalLocationSchema = locationSchema.nullish().transform((value) =>
  value ?? undefined
);

const periodInputSchema = z.object({
  start: zDateOrString(),
  end: zDateOrString(),
  timeZone: timeZoneSchema,
  location: optionalLocationSchema,
  source: z.enum(["manual", "import", "metadata"]).default("manual"),
  metadata: z.record(z.string(), z.any()).optional(),
}).refine((value) => value.end.getTime() > value.start.getTime(), {
  message: "Time zone period end must be after its start",
  path: ["end"],
});

const listSchema = z.object({
  action: z.literal("list"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
});

const createSchema = z.object({
  action: z.literal("create"),
  period: periodInputSchema,
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  id: z.string().refine(ObjectId.isValid, "Invalid time zone period id"),
});

export const timelineTimeZonesRequestSchema = z.discriminatedUnion("action", [
  listSchema,
  createSchema,
  deleteSchema,
]);

export type TimelineTimeZonesRequest = z.input<
  typeof timelineTimeZonesRequestSchema
>;
export type TimelineTimeZonesResponse = unknown;

const COLLECTION = "timeline_timezone_periods";

export class TimelineTimeZonesResource
  implements Resource<TimelineTimeZonesRequest, TimelineTimeZonesResponse> {
  code = "timeline-timezones";
  description =
    "Store time zone and optional geographic context for timeline periods";
  schemas = {
    request: timelineTimeZonesRequestSchema,
    response: z.any(),
  };

  extractActions(input: TimelineTimeZonesRequest) {
    return [{
      path: ["timeline-timezones"],
      actions: [input.action],
    }];
  }

  async use(
    rawInput: TimelineTimeZonesRequest,
    auth: Auth,
  ): Promise<TimelineTimeZonesResponse> {
    const input = timelineTimeZonesRequestSchema.parse(rawInput);
    const mongo = await getMongoResource(auth);

    switch (input.action) {
      case "list": {
        const query: Record<string, unknown> = {};
        if (input.start && input.end) {
          query.start = { $lt: input.end };
          query.end = { $gt: input.start };
        } else if (input.start) {
          query.end = { $gt: input.start };
        } else if (input.end) {
          query.start = { $lt: input.end };
        }

        return await mongo({
          action: "find",
          collection: COLLECTION,
          query,
          options: { sort: { start: 1, createdAt: 1 } },
        });
      }

      case "create": {
        const now = new Date();
        const doc = {
          ...input.period,
          createdAt: now,
          updatedAt: now,
          createdBy: auth.principal,
        };
        const result = await mongo({
          action: "insertOne",
          collection: COLLECTION,
          doc,
        });
        return { ...doc, _id: result.insertedId };
      }

      case "delete": {
        await mongo({
          action: "deleteOne",
          collection: COLLECTION,
          query: { _id: new ObjectId(input.id) },
        });
        return { success: true };
      }
    }
  }
}
