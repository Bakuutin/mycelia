import type { JobInfo } from "@/types/jobs";

/**
 * Determines if a completed job produced no meaningful output.
 * Different job types have different "empty" indicators.
 *
 * Keep the generic branch in sync with the `emptyRuns` aggregation in
 * backend/app/lib/resources/worker.ts so the Empty column and the row badges
 * agree.
 */
export function isEmptyJobResult(job: JobInfo): boolean {
  if (job.state !== "completed") return false;

  const progress = (job.progress || {}) as Record<string, unknown>;
  const result = (job.result || {}) as Record<string, unknown>;

  switch (job.type) {
    case "vad":
      return (
        (progress.hasSpeech === 0 || result.hasSpeech === 0) &&
        (progress.processed === 0 || result.processed === 0)
      );
    case "conversation_chunk_creator":
      return (
        ((result.finalized as number) ?? 0) === 0 &&
        ((result.streamed as number) ?? 0) === 0 &&
        ((result.chunksCreated as number) ?? 0) === 0
      );
    case "conversation_extractor":
      return (
        ((result.conversationsCreated as number) ?? 0) === 0 &&
        ((result.chunksProcessed as number) ?? 0) === 0
      );
    case "transcription_sequence_creator":
      return ((result.processed as number) ?? 0) === 0;
    case "transcription":
      if (result.result === "empty") return true;
      if (result.wordCount != null && result.wordCount === 0) return true;
      // No sequence was processed (processed: 0 with no transcriptionId)
      if (result.processed === 0 && !result.transcriptionId) return true;
      if (result.wordCount != null && (result.wordCount as number) > 0) {
        return false;
      }
      return false;
    default: {
      // A run that touched nothing is empty. Most workers report only
      // `processed`; when they also report a `total`, a run that had work
      // queued but processed none of it is a stalled run, not an empty one.
      const processed = progress.processed ?? result.processed;
      if (processed !== 0) return false;
      const total = progress.total ?? result.total;
      return total == null || total === 0;
    }
  }
}
