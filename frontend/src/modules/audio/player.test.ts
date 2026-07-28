import { beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { type Chunk, useAudioPlayer } from "./player";

function chunk(id: string, start: Date): Chunk {
  return { _id: id, start, buffer: {} as AudioBuffer };
}

describe("audio player playback state", () => {
  beforeEach(() => {
    useAudioPlayer.setState({
      isPlaying: false,
      currentDate: null,
      startDate: null,
      seekTarget: null,
      seekGeneration: 0,
      chunks: [],
      currentChunk: null,
      sourceNode: null,
      baselineStartDate: null,
      baselineStartCtxTime: null,
    });
  });

  it("preserves the current chunk and exact position when paused", () => {
    const currentDate = new Date("2026-07-28T03:15:12.500Z");
    const activeChunk = chunk(
      "active",
      new Date("2026-07-28T03:15:10.000Z"),
    );
    const nextChunk = chunk("next", new Date("2026-07-28T03:15:20.000Z"));

    useAudioPlayer.setState({
      isPlaying: true,
      currentDate,
      currentChunk: activeChunk,
      chunks: [nextChunk],
      baselineStartDate: currentDate,
      baselineStartCtxTime: 10,
    });

    act(() => useAudioPlayer.getState().setIsPlaying(false));

    const state = useAudioPlayer.getState();
    expect(state.isPlaying).toBe(false);
    expect(state.seekTarget).toEqual(currentDate);
    expect(state.currentChunk).toBeNull();
    expect(state.chunks.map((item) => item._id)).toEqual(["active", "next"]);
    expect(state.baselineStartDate).toBeNull();
    expect(state.baselineStartCtxTime).toBeNull();
  });

  it("resumes without discarding the saved playback position", () => {
    const currentDate = new Date("2026-07-28T03:15:12.500Z");
    useAudioPlayer.setState({
      isPlaying: false,
      currentDate,
      seekTarget: currentDate,
    });

    act(() => useAudioPlayer.getState().toggleIsPlaying());

    expect(useAudioPlayer.getState().isPlaying).toBe(true);
    expect(useAudioPlayer.getState().seekTarget).toEqual(currentDate);
  });
});
