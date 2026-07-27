export const MAX_AUDIO_CHUNK_SECONDS = 10;

export function getMaximumAudioHours(
  chunkCount: number,
  chunkSeconds = MAX_AUDIO_CHUNK_SECONDS,
): number {
  if (!Number.isFinite(chunkCount) || !Number.isFinite(chunkSeconds)) return 0;

  return Math.max(chunkCount, 0) * Math.max(chunkSeconds, 0) / 3600;
}
