import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAudioPlayer } from "@/modules/audio/player";
import { useSettingsStore } from "@/stores/settingsStore";
import { TimelinePlayerControls } from "./TimelinePlayerControls";

function renderControls(onGoToAudio = vi.fn()) {
  render(
    <TooltipProvider>
      <TimelinePlayerControls onGoToAudio={onGoToAudio} />
    </TooltipProvider>,
  );
  return onGoToAudio;
}

describe("TimelinePlayerControls", () => {
  beforeEach(() => {
    useAudioPlayer.setState({
      currentDate: null,
      isPlaying: false,
    });
    useSettingsStore.setState({ volume: 1, playbackRate: 1 });
  });

  it("disables Go to audio until a playback position exists", () => {
    renderControls();

    expect(
      (screen.getByRole("button", {
        name: "Go to current audio position",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("focuses the timeline on the current playback position", () => {
    const currentDate = new Date("2026-07-28T03:15:12.500Z");
    useAudioPlayer.setState({ currentDate });
    const onGoToAudio = renderControls();

    fireEvent.click(
      screen.getByRole("button", { name: "Go to current audio position" }),
    );

    expect(onGoToAudio).toHaveBeenCalledWith(currentDate);
  });
});
