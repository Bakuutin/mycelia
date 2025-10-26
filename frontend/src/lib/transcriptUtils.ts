import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Check if a time range is shorter than the configured transcript threshold
 */
export function isTimeRangeShorterThanTranscriptThreshold(start: Date, end?: Date): boolean {
  if (!end) return false;
  
  const thresholdHours = useSettingsStore.getState().transcriptThresholdHours;
  const durationMs = end.getTime() - start.getTime();
  const thresholdMs = thresholdHours * 60 * 60 * 1000; // Convert hours to milliseconds
  
  return durationMs < thresholdMs;
}

/**
 * Get the current transcript threshold in hours
 */
export function getTranscriptThresholdHours(): number {
  return useSettingsStore.getState().transcriptThresholdHours;
}
