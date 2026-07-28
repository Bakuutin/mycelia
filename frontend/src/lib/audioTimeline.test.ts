import { describe, expect, it } from "vitest";
import { AUDIO_FOCUS_WINDOW_MS, getAudioFocusRange } from "./audioTimeline";

describe("getAudioFocusRange", () => {
  it("creates a ten-minute window centered on the playback position", () => {
    const date = new Date("2026-07-28T03:15:00.000Z");
    const range = getAudioFocusRange(date);

    expect(range.end.getTime() - range.start.getTime()).toBe(
      AUDIO_FOCUS_WINDOW_MS,
    );
    expect((range.start.getTime() + range.end.getTime()) / 2).toBe(
      date.getTime(),
    );
  });
});
