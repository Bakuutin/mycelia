import { forwardRef, useImperativeHandle } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  getReviewShortcut,
  getSwipeDecision,
  VoiceIdentityReviewPlayer,
} from "./VoiceIdentityReviewPlayer";
import { useAudioPlaybackStore } from "@/stores/audioPlaybackStore";

const playerControls = vi.hoisted(() => ({
  togglePlayback: vi.fn(),
}));

vi.mock("@/components/audio/WaveformPlayer", () => ({
  WaveformPlayer: forwardRef((props: any, ref) => {
    useImperativeHandle(ref, () => ({
      play: vi.fn(),
      pause: vi.fn(),
      togglePlayback: playerControls.togglePlayback,
    }));
    return (
      <div
        data-testid="waveform-player"
        data-autoplay={String(props.autoPlay)}
        data-audio-url={props.audioUrl}
      />
    );
  }),
}));

const segment = {
  _id: "66b000000000000000000001",
  original_id: "66b000000000000000000002",
  start: "2026-08-10T10:00:00.000Z",
  end: "2026-08-10T10:00:05.000Z",
};

function renderPlayer(overrides: Record<string, unknown> = {}) {
  const props = {
    segment,
    profileName: "Sky",
    profileOptions: [
      { id: "66b000000000000000000010", name: "Sky" },
      { id: "66b000000000000000000020", name: "Belka" },
      { id: "66b000000000000000000030", name: "david bowie" },
      { id: "66b000000000000000000040", name: "Andrew" },
    ],
    position: 1,
    remaining: 12,
    sessionAnswered: 0,
    sessionTotal: 12,
    pending: false,
    autoPlayNext: true,
    playOnMount: false,
    canPrevious: false,
    canNext: true,
    canUndo: true,
    canEdit: false,
    creatingProfile: false,
    alternateProfiles: [
      { id: "66b000000000000000000020", name: "Belka" },
      { id: "66b000000000000000000030", name: "david bowie" },
      { id: "66b000000000000000000040", name: "Andrew" },
    ],
    onDecision: vi.fn(),
    onAssignProfile: vi.fn(),
    onCreateProfile: vi.fn().mockResolvedValue(undefined),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onUndo: vi.fn(),
    onEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onAutoPlayChange: vi.fn(),
    ...overrides,
  };
  const view = render(
    <MemoryRouter>
      <VoiceIdentityReviewPlayer {...props} />
    </MemoryRouter>,
  );
  return { ...view, props };
}

describe("VoiceIdentityReviewPlayer", () => {
  it("shows honest score semantics and exact duration", () => {
    renderPlayer();

    expect(screen.getByText("Not classified")).toBeInTheDocument();
    expect(screen.getByText("5.0 sec")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getByTestId("waveform-player")).toHaveAttribute(
      "data-audio-url",
      expect.stringContaining("original_id=66b000000000000000000002"),
    );
  });

  it("shows matcher candidates as similarities, not probabilities", () => {
    renderPlayer({
      segment: {
        ...segment,
        speakerIdentity: {
          primaryScore: 0.73,
          state: "matched",
          candidates: [
            {
              profileId: "66b000000000000000000020",
              score: 0.73,
            },
          ],
        },
      },
    });

    expect(screen.getByText("Similarity to Sky: 73%")).toBeInTheDocument();
    expect(screen.getByText("Model candidates: Belka 73%"))
      .toBeInTheDocument();
    expect(screen.getByText(/not a calibrated probability/i))
      .toBeInTheDocument();
  });

  it("maps review shortcuts while protecting interactive focus and pending state", () => {
    const { props, rerender } = renderPlayer();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "s" });
    fireEvent.keyDown(window, { key: " " });
    expect(props.onDecision).toHaveBeenNthCalledWith(1, "me");
    expect(props.onDecision).toHaveBeenNthCalledWith(2, "not-me");
    expect(props.onDecision).toHaveBeenNthCalledWith(3, "skip");
    expect(playerControls.togglePlayback).toHaveBeenCalledOnce();

    screen.getByRole("switch", { name: /automatically play next/i }).focus();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(props.onDecision).toHaveBeenCalledTimes(3);

    rerender(
      <MemoryRouter>
        <VoiceIdentityReviewPlayer {...props} pending />
      </MemoryRouter>,
    );
    document.body.focus();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(props.onDecision).toHaveBeenCalledTimes(3);
  });

  it("allows edit while reviewed actions are pending-disabled", () => {
    const { props } = renderPlayer({ pending: true, canEdit: true });

    document.body.focus();
    fireEvent.keyDown(window, { key: "e" });
    expect(props.onEdit).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(props.onDecision).not.toHaveBeenCalled();
  });

  it("does not capture shortcuts behind another open review editor", () => {
    const { props } = renderPlayer({ shortcutsEnabled: false });

    document.body.focus();
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(props.onAssignProfile).not.toHaveBeenCalled();
    expect(props.onDecision).not.toHaveBeenCalled();
  });

  it("keeps Skip available while editing and exposes a separate cancel action", () => {
    const { props } = renderPlayer({ editingLabel: "Andrew Kislov" });

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(props.onDecision).toHaveBeenCalledWith("skip");
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(props.onCancelEdit).toHaveBeenCalledOnce();
  });

  it("assigns visible alternate profiles by button or numbered shortcut", () => {
    const { props } = renderPlayer({ canEdit: true });

    expect(screen.getByRole("button", { name: /Belka/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /david bowie/ }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Andrew/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Assign another profile"), {
      target: { value: "66b000000000000000000030" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Assign profile" }));
    expect(props.onAssignProfile).toHaveBeenNthCalledWith(
      1,
      "66b000000000000000000030",
    );

    document.body.focus();
    fireEvent.keyDown(window, { key: "1" });
    expect(props.onAssignProfile).toHaveBeenNthCalledWith(
      2,
      "66b000000000000000000020",
    );
    fireEvent.keyDown(window, { key: "e" });
    expect(props.onEdit).toHaveBeenCalledOnce();
    expect(getReviewShortcut("2")).toEqual({ type: "profile", index: 1 });
    expect(getReviewShortcut("4")).toBeNull();
  });

  it("creates and assigns a new speaker without requiring an existing profile", async () => {
    const { props } = renderPlayer({ alternateProfiles: [] });

    fireEvent.click(screen.getByRole("button", { name: "New speaker" }));
    fireEvent.change(screen.getByLabelText("Speaker name"), {
      target: { value: "Andrew Kislov" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create and assign" }),
    );

    await waitFor(() =>
      expect(props.onCreateProfile).toHaveBeenCalledWith("Andrew Kislov")
    );
  });

  it("maps horizontal swipes and ignores vertical movement", () => {
    expect(getSwipeDecision({ x: 100, y: 20 }, { x: 180, y: 30 })).toBe("me");
    expect(getSwipeDecision({ x: 180, y: 20 }, { x: 100, y: 30 })).toBe(
      "not-me",
    );
    expect(getSwipeDecision({ x: 100, y: 20 }, { x: 180, y: 90 })).toBeNull();
    expect(getReviewShortcut("u")).toBe("undo");
    expect(getReviewShortcut("s")).toBe("skip");
    expect(getReviewShortcut("ArrowDown")).toBe("next");
  });

  it("stops the active clip before moving to another review segment", () => {
    const stopActiveClip = vi.fn();
    useAudioPlaybackStore.getState().acquire("active-review", stopActiveClip);
    const { props } = renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "Next segment" }));

    expect(stopActiveClip).toHaveBeenCalledOnce();
    expect(props.onNext).toHaveBeenCalledOnce();
  });
});
