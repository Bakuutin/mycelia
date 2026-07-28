import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobalAudioPlayerPopover } from "./GlobalAudioPlayerPopover";
import { useAudioPlayer } from "@/modules/audio/player";
import { useSettingsStore } from "@/stores/settingsStore";

function renderPlayer() {
  return render(
    <MemoryRouter>
      <GlobalAudioPlayerPopover />
    </MemoryRouter>,
  );
}

describe("GlobalAudioPlayerPopover", () => {
  beforeEach(() => {
    useAudioPlayer.setState({
      isPlaying: false,
      currentDate: null,
      chunks: [],
      currentChunk: null,
      seekTarget: null,
      isCreatingSource: false,
    });
    useSettingsStore.setState({ volume: 1, playbackRate: 1 });
  });

  it("remains available before playback has been selected", () => {
    renderPlayer();

    fireEvent.click(screen.getByTestId("global-player-trigger"));

    expect(screen.getByText("Now playing")).not.toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Resume audio",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Ready")).not.toBeNull();
  });

  it("pauses and remains available for resume inside the popover", () => {
    act(() => {
      useAudioPlayer.setState({
        isPlaying: true,
        currentDate: new Date("2026-07-28T03:15:12.500Z"),
      });
    });
    renderPlayer();

    fireEvent.click(screen.getByTestId("global-player-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Pause audio" }));

    expect(useAudioPlayer.getState().isPlaying).toBe(false);
    expect(
      (screen.getByRole("button", {
        name: "Resume audio",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.getByText("Paused")).not.toBeNull();
  });
});
