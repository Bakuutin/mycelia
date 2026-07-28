export const AUDIO_FOCUS_WINDOW_MS = 10 * 60 * 1000;

export function getAudioFocusRange(date: Date): { start: Date; end: Date } {
  const halfWindowMs = AUDIO_FOCUS_WINDOW_MS / 2;
  return {
    start: new Date(date.getTime() - halfWindowMs),
    end: new Date(date.getTime() + halfWindowMs),
  };
}
