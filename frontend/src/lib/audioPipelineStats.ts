export const MAX_AUDIO_CHUNK_SECONDS = 10;

export interface AudioSourceFileStats {
  total: number;
  ingested: number;
  pending: number;
  blocked: number;
  errors: number;
  byKind: Array<{ kind: string; count: number }>;
}

export function normalizeAudioSourceFileStats(
  sourceFiles: AudioSourceFileStats | undefined,
  totalSessions = 0,
): AudioSourceFileStats {
  return sourceFiles ?? {
    total: totalSessions,
    ingested: 0,
    pending: 0,
    blocked: 0,
    errors: 0,
    byKind: [],
  };
}

export function getMaximumAudioHours(
  chunkCount: number,
  chunkSeconds = MAX_AUDIO_CHUNK_SECONDS,
): number {
  if (!Number.isFinite(chunkCount) || !Number.isFinite(chunkSeconds)) return 0;

  return Math.max(chunkCount, 0) * Math.max(chunkSeconds, 0) / 3600;
}
