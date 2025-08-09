import { z } from "zod";
import { ObjectId } from "mongodb";

export type Timestamp = number & { readonly __brand: unique symbol };

export const zTimestamp = z.coerce.number().transform((val) =>
  val as Timestamp
);

export const zTimelineItem = z.object({
  start: z.date(),
  end: z.date(),
  totals: z.any(),
  id: z.string(),
  stale: z.boolean().optional(),
});

export const zQueryParams = z.object({
  start: zTimestamp,
  end: zTimestamp,
});

export const zLoaderData = z.object({
  start: z.date(),
  end: z.date(),
  items: z.array(zTimelineItem),
  transcripts: z.array(z.any()),
});

export type TimelineItem = z.infer<typeof zTimelineItem>;
// export type Transcript = z.infer<typeof zTranscript>;
export type QueryParams = z.infer<typeof zQueryParams>;
export type LoaderData = z.infer<typeof zLoaderData>;

export interface StartEnd {
  start: Date;
  end: Date;
  _id: ObjectId;
}

export interface TimelineDimensions {
  width: number;
  height: number;
}
