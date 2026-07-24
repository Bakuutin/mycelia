type ObjectIdLike = {
  toHexString?: () => string;
  $oid?: string;
};

export interface TimedDiarization {
  original?: unknown;
  original_id?: unknown;
  start: Date;
  end: Date;
}

export interface TimedTranscriptSegment {
  original_id: unknown;
  time: Date;
  endTime: Date;
}

export function normalizeObjectId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;

  if (typeof value === "object") {
    const objectId = value as ObjectIdLike;
    if (typeof objectId.toHexString === "function") {
      return objectId.toHexString();
    }
    if (typeof objectId.$oid === "string") {
      return objectId.$oid;
    }
  }

  const normalized = String(value);
  return normalized === "[object Object]" ? null : normalized;
}

export function diarizationOverlapsTranscript(
  diarization: TimedDiarization,
  segment: TimedTranscriptSegment,
): boolean {
  const diarizationOriginal = normalizeObjectId(
    diarization.original_id ?? diarization.original,
  );
  const transcriptOriginal = normalizeObjectId(segment.original_id);

  return diarizationOriginal !== null &&
    diarizationOriginal === transcriptOriginal &&
    diarization.start.getTime() < segment.endTime.getTime() &&
    diarization.end.getTime() > segment.time.getTime();
}
