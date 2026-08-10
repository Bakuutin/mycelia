import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import VoiceIdentityReviewPage from "./VoiceIdentityReviewPage";

vi.mock("@/lib/api", () => ({
  callResource: vi.fn(),
}));

vi.mock("./VoiceIdentityReviewPlayer", () => ({
  VoiceIdentityReviewPlayer: (props: any) => (
    <div data-testid="review-player">
      <span>active:{String(props.segment._id)}</span>
      <span data-testid="play-on-mount">{String(props.playOnMount)}</span>
      <span>session:{props.sessionAnswered}/{props.sessionTotal}</span>
      <button onClick={() => props.onDecision("me")}>This is me</button>
      <button onClick={() => props.onDecision("not-me")}>Not me</button>
      <button onClick={props.onUndo} disabled={!props.canUndo}>Undo</button>
    </div>
  ),
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

    await screen.findByText(/No reviewable segments/);
    await waitFor(() => expect(reviewCalls).toBe(1));
    expect(screen.getByText(/active diarization run/i)).toBeInTheDocument();
    now.mockRestore();
  });

  it("saves a manual annotation, advances with autoplay, and undoes it", async () => {
    const first = {
      _id: "66b000000000000000000001",
      original_id: "66b000000000000000000011",
      start: "2026-08-10T10:00:00.000Z",
      end: "2026-08-10T10:00:05.000Z",
    };
    const second = {
      _id: "66b000000000000000000002",
      original_id: "66b000000000000000000012",
      start: "2026-08-10T10:01:00.000Z",
      end: "2026-08-10T10:01:04.000Z",
    };
    const annotationId = "66b000000000000000000099";

    mockCallResource.mockImplementation((resource, input: any) => {
      if (resource === "mongo") {
        return Promise.resolve([{
          _id: "66b000000000000000000010",
          name: "Sky",
          is_primary: true,
          revision: 3,
          embeddingSpaceId: "space-v1",
        }]);
      }
      if (resource === "jobs") {
        return Promise.resolve({
          services: [{ id: "diarizator", status: "healthy" }],
        });
      }
      if (resource === "speaker-segments") {
        if (input.action === "identity-status") {
          return Promise.resolve({
            labels: { sky: 39, notSky: 40, total: 99, recordings: 4 },
            calibrations: [],
            classification: {
              identified: 0,
              unknown: 0,
              uncertain: 0,
              unclassified: 2,
            },
          });
        }
        if (input.action === "review-queue") {
          return Promise.resolve([first, second]);
        }
        if (input.action === "annotate") {
          return Promise.resolve({ _id: annotationId, ...input });
        }
        if (input.action === "delete-annotation") {
          return Promise.resolve({ deletedCount: 1 });
        }
      }
      return Promise.resolve({});
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <VoiceIdentityReviewPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText(`active:${first._id}`);
    expect(screen.getByText("session:0/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "This is me" }));

    await screen.findByText(`active:${second._id}`);
    expect(screen.getByText("session:1/2")).toBeInTheDocument();
    expect(screen.getByTestId("play-on-mount")).toHaveTextContent("true");
    expect(mockCallResource).toHaveBeenCalledWith(
      "speaker-segments",
      expect.objectContaining({
        action: "annotate",
        segmentId: first._id,
        profileId: "66b000000000000000000010",
        excludedProfileIds: [],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText(`active:${first._id}`);
    expect(screen.getByText("session:0/2")).toBeInTheDocument();
    expect(mockCallResource).toHaveBeenCalledWith("speaker-segments", {
      action: "delete-annotation",
      id: annotationId,
    });
  });
});
