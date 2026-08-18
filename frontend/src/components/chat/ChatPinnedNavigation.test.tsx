import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPinnedNavigation } from "./ChatPinnedNavigation.tsx";
import type { MemoryChatMessage } from "@/lib/chat";

const messages: MemoryChatMessage[] = [
  {
    id: "message-1",
    role: "user",
    parts: [{ type: "text", text: "First pinned message" }],
    metadata: { pinnedAt: "2026-08-18T10:00:00Z" },
  },
  {
    id: "message-2",
    role: "assistant",
    parts: [{ type: "text", text: "Second pinned message" }],
    metadata: { pinnedAt: "2026-08-18T11:00:00Z" },
  },
];

describe("ChatPinnedNavigation", () => {
  it("cycles through pinned messages and jumps to the selected message", () => {
    const onJump = vi.fn();
    render(
      <ChatPinnedNavigation
        messages={messages}
        onJumpToMessage={onJump}
      />,
    );

    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByText("First pinned message")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", {
      name: "Next pinned message",
    }));

    expect(screen.getByText("2/2")).toBeTruthy();
    expect(screen.getByText("Second pinned message")).toBeTruthy();
    expect(onJump).toHaveBeenLastCalledWith("message-2");
  });
});
