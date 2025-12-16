import { z } from "zod";
import type { Resolution } from "@/types/resolution.ts";

export const JobTypeSchema = z.enum([
  "vad",
  "transcription",
  "diarization",
  "ingestion",
  "histRecalculation",
  "summarization",
]);

export type JobType = z.infer<typeof JobTypeSchema>;

export const VadJobDataSchema = z.object({
  type: z.literal("vad"),
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
  originalId: z.string().optional(),
  limit: z.number().default(1000),
  batchSize: z.number().default(100),
});

export type VadJobData = z.infer<typeof VadJobDataSchema>;

export const PipelineRecalculationJobDataSchema = z.object({
  type: z.literal("histRecalculation"),
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
  all: z.boolean().default(false),
});

export type PipelineRecalculationJobData = z.infer<
  typeof PipelineRecalculationJobDataSchema
>;


export const SummarizationJobDataSchema = z.object({
  type: z.literal("summarization"),
  start: z.coerce.date(),
  end: z.coerce.date(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  objectId: z.string().optional(),
});

export type SummarizationJobData = z.infer<typeof SummarizationJobDataSchema>;

export const JobDataSchema = z.discriminatedUnion("type", [
  VadJobDataSchema,
  PipelineRecalculationJobDataSchema,
  SummarizationJobDataSchema,
]);

export type JobData = z.infer<typeof JobDataSchema>;

export interface JobProgress {
  processed: number;
  total: number;
  [key: string]: any;
}

export interface JobResult {
  [key: string]: any;
}
