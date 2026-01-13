import { z } from "zod";
import { ObjectId } from "bson";
import ms from "ms";

function withJsonSchema<T extends z.ZodType>(
  schema: T,
  jsonSchema: Record<string, unknown>
): T {
  (schema as any)._zod.toJSONSchema = () => jsonSchema;
  return schema;
}

export const zObjectId = () =>
  withJsonSchema(
    z.union([
      z.instanceof(ObjectId),
      z.string().transform((val) => new ObjectId(val)),
    ]),
    { type: "string", description: "MongoDB ObjectId as a 24-character hex string" }
  );

export const zDateOrString = () =>
  withJsonSchema(
    z.union([
      z.date(),
      z.string().transform((val) => new Date(val)),
    ]),
    { type: "string", format: "date-time", description: "ISO 8601 date string or Date object" }
  );

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

export const zDateOrRelativeTime = (description?: string) =>
  withJsonSchema(
    z.union([z.date(), z.string()]).transform((val) => parseDateOrRelativeTime(val)),
    { 
      type: "string", 
      description: description ?? "Date as ISO 8601 string or relative time like '5d', '10m', '1h'" 
    }
  );

