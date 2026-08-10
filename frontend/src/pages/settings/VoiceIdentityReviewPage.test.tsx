import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import VoiceIdentityReviewPage from "./VoiceIdentityReviewPage";

vi.mock("@/lib/api", () => ({
  callResource: vi.fn(),
}));

const mockCallResource = vi.mocked(api.callResource);

describe("VoiceIdentityReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps one stable review request across query-driven rerenders", async () => {
    let reviewCalls = 0;
    mockCallResource.mockImplementation((resource) => {
      if (resource === "mongo") return Promise.resolve([]);
      if (resource === "speaker-segments") {
        reviewCalls += 1;
        return reviewCalls === 1 ? Promise.resolve([]) : new Promise(() => {});
      }
      return Promise.resolve({});
    });
    const now = vi.spyOn(Date, "now");
    let timestamp = 1_700_000_000_000;
    now.mockImplementation(() => timestamp += 1_000);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <VoiceIdentityReviewPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText(/No uncertain segments/);
    await waitFor(() => expect(reviewCalls).toBe(1));
    expect(screen.getByText(/active diarization run/i)).toBeInTheDocument();
    now.mockRestore();
  });
});
