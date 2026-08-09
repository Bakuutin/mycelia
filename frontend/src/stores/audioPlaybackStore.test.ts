import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioPlaybackStore } from "./audioPlaybackStore";

describe("audio playback coordination", () => {
  beforeEach(() => {
    useAudioPlaybackStore.getState().stopActive();
  });

  it("stops the previous clip before acquiring a new one", () => {
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();

    useAudioPlaybackStore.getState().acquire("first", stopFirst);
    useAudioPlaybackStore.getState().acquire("second", stopSecond);

    expect(stopFirst).toHaveBeenCalledOnce();
    expect(stopSecond).not.toHaveBeenCalled();
    expect(useAudioPlaybackStore.getState().activeId).toBe("second");
  });

  it("only releases the clip that owns the coordinator", () => {
    useAudioPlaybackStore.getState().acquire("first", vi.fn());

    useAudioPlaybackStore.getState().release("other");
    expect(useAudioPlaybackStore.getState().activeId).toBe("first");

    useAudioPlaybackStore.getState().release("first");
    expect(useAudioPlaybackStore.getState().activeId).toBeNull();
  });
});
