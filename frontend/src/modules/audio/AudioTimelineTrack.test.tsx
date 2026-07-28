import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import * as d3 from "d3";
import { useAudioPlayer } from "./player";
import { AudioTimelineTrack } from "./AudioTimelineTrack";

const start = new Date("2026-07-28T03:10:00.000Z");
const end = new Date("2026-07-28T03:20:00.000Z");
const scale = d3.scaleTime().domain([start, end]).range([0, 1000]);

function renderTrack() {
  return render(
    <AudioTimelineTrack
      scale={scale}
      transform={d3.zoomIdentity}
      width={1000}
    />,
  );
}

describe("AudioTimelineTrack", () => {
  beforeEach(() => {
    useAudioPlayer.setState({
      chunks: [],
      currentDate: null,
      isCreatingSource: false,
      isPlaying: false,
    });
  });

  it("labels the audio track and shows the current playhead", () => {
    const currentDate = new Date("2026-07-28T03:15:00.000Z");
    useAudioPlayer.setState({
      chunks: [{
        _id: "chunk-1",
        start: new Date("2026-07-28T03:14:00.000Z"),
        buffer: {} as AudioBuffer,
      }],
      currentDate,
      isPlaying: true,
    });

    renderTrack();

    expect(screen.getByText("Audio playback")).not.toBeNull();
    expect(screen.getAllByText("Playing").length).toBeGreaterThan(0);
    expect(screen.getByTestId("audio-playhead")).not.toBeNull();
    expect(screen.getByTestId("audio-playhead-label").textContent).toContain(
      currentDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    );
  });

  it("clears playback on right-click", () => {
    useAudioPlayer.setState({
      currentDate: new Date("2026-07-28T03:15:00.000Z"),
      isPlaying: true,
    });
    renderTrack();

    fireEvent.contextMenu(
      screen.getByLabelText(
        "Audio playback track. Click to play from a position.",
      ),
    );

    expect(useAudioPlayer.getState().currentDate).toBeNull();
    expect(useAudioPlayer.getState().isPlaying).toBe(false);
  });
});
