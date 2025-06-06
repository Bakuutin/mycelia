import { z } from "zod";
import { ObjectId } from "mongodb";

export type Timestamp = bigint & { readonly __brand: unique symbol };

export const zTimestamp = z.coerce.bigint().transform((val) =>
  val as Timestamp
);

export const zTimelineItem = z.object({
  start: z.date(),
  end: z.date(),
  totals: z.any(),
});

export const zQueryParams = z.object({
  start: zTimestamp,
  end: zTimestamp,
});

export const zLoaderData = z.object({
  items: z.array(zTimelineItem),
  voices: z.array(z.object({
    start: z.date(),
    end: z.date(),
  })),
  transcripts: z.array(z.any()),
  start: z.date(),
  end: z.date(),
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
