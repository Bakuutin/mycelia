import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStableChatSessionId } from "./useStableChatSessionId";

describe("useStableChatSessionId", () => {
  it("keeps one draft id across rerenders and the draft route transition", () => {
    const { result, rerender } = renderHook(
      ({ routeId }: { routeId?: string }) => useStableChatSessionId(routeId),
      { initialProps: { routeId: undefined as string | undefined } },
    );
    const draftId = result.current.chatSessionId;
    expect(draftId).toMatch(/^[a-f0-9]{24}$/);

    rerender({ routeId: undefined });
    expect(result.current.chatSessionId).toBe(draftId);

    rerender({ routeId: draftId });
    expect(result.current.chatSessionId).toBe(draftId);
  });
});
