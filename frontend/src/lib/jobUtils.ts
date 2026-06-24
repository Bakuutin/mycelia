/**
 * Check if a job completed with no meaningful output (empty result)
 */
export function isEmptyJobResult(
  type: string,
  state: string,
  progress?: Record<string, any>,
  result?: Record<string, any>
): boolean {
  if (state !== "completed") return false;

  const prog = progress || {};
  const res = result || {};

  switch (type) {
    case "vad":
      return (
        (prog.hasSpeech === 0 || res.hasSpeech === 0) &&
        (prog.processed === 0 || res.processed === 0)
      );
    case "conversation_chunk_creator":
      return (
        (res.finalized ?? 0) === 0 &&
        (res.streamed ?? 0) === 0 &&
        (res.chunksCreated ?? 0) === 0
      );
    case "conversation_extractor":
      return (
        (res.conversationsCreated ?? 0) === 0 &&
        (res.chunksProcessed ?? 0) === 0
      );
    case "transcription_sequence_creator":
      return (res.processed ?? 0) === 0;
    case "transcription":
      return (
        (res.processed ?? 0) === 0 ||
        (prog.processed === 0 && prog.total === 0)
      );
    default:
      const processed = prog.processed ?? res.processed ?? -1;
      const total = prog.total ?? res.total ?? -1;
      return processed === 0 && total === 0;
  }
}
