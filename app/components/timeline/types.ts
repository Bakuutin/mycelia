import { z } from "zod";

export const zTimelineItem = z.object({
    id: z.string(),
    start: z.date(),
    end: z.date(),
});

export const zTranscript = z.object({
    text: z.string(),
    words: z.array(z.object({
        word: z.string(),
        start: z.number(),
        end: z.number(),
        t_dtw: z.number(),
        probability: z.number(),
    })),
    id: z.number(),
    start: z.date(),
    end: z.date(),
    transcriptID: z.string(),
});

export type Transcript = z.infer<typeof zTranscript>;
export type TimelineItem = z.infer<typeof zTimelineItem>;

export interface StartEnd {
    start: Date;
    end: Date;
}

export interface OptimizedTimelineItem {
    start: Date;
    end: Date;
    layer: number;
    duration: number;
    original: TimelineItem;
}

export const day = 1000 * 60 * 60 * 24;
export const year = day * 365;

export function getDaysAgo(n: number) {
    const today = new Date(new Date().toISOString().split('T')[0])
    const monthAgo = new Date(today.getTime() - n * 24 * 60 * 60 * 1000)
    return monthAgo
}

export const QuerySchema = z.object({
    start: z.coerce.date(),
    end: z.coerce.date(),
});

export const zLoaderData = z.object({
    items: z.array(zTimelineItem),
    voices: z.array(z.object({
        start: z.date(),
        end: z.date(),
        _id: z.string(),
    })),
    transcripts: z.array(zTranscript),
    start: z.date(),
    end: z.date(),
    gap: z.number(),
});

export type LoaderData = z.infer<typeof zLoaderData>; 