import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import VoiceIdentityReviewPage from "./VoiceIdentityReviewPage";

vi.mock("@/lib/api", () => ({ callResource: vi.fn() }));
vi.mock("./VoiceIdentityReviewPlayer", () => ({
  VoiceIdentityReviewPlayer: (props: any) => (
    <div data-testid="review-player">
      <span>active:{String(props.segment._id)}</span>
      <span data-testid="play-on-mount">{String(props.playOnMount)}</span>
      <span>session:{props.sessionAnswered}/{props.sessionTotal}</span>
      <button onClick={() => props.onDecision("me")}>This is me</button>
      <button onClick={() => props.onDecision("not-me")}>Not me</button>
      <button onClick={() => props.onDecision("skip")}>Skip</button>
      <button onClick={props.onUndo} disabled={!props.canUndo}>Undo</button>
    </div>
  ),
}));

const mockCallResource = vi.mocked(api.callResource);
const profile = {
  _id: "66b000000000000000000010",
  name: "Sky",
  is_primary: true,
  revision: 3,
  embeddingSpaceId: "space-v1",
};
const emptyStatus = {
  labels: { sky: 39, notSky: 40, total: 79, recordings: 4 },
  calibrations: [],
  classification: { identified: 0, unknown: 0, uncertain: 0, unclassified: 2 },
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <VoiceIdentityReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("VoiceIdentityReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps session discovery stable and offers an explicit first session", async () => {
    let sessionListCalls = 0;
    mockCallResource.mockImplementation((resource, input: any) => {
      if (resource === "mongo") return Promise.resolve([profile]);
      if (resource === "jobs") {
        return Promise.resolve({
          services: [{ id: "diarizator", status: "healthy" }],
        });
      }
      if (input.action === "identity-status") {
        return Promise.resolve(emptyStatus);
      }
      if (input.action === "list-review-sessions") {
        sessionListCalls += 1;
        return Promise.resolve([]);
      }
      return Promise.resolve({});
    });

    renderPage();

    await screen.findByRole("button", { name: "Start review" });
    await waitFor(() => expect(sessionListCalls).toBe(1));
    expect(screen.getByText(/Saved sessions resume on any device/i))
      .toBeInTheDocument();
    expect(screen.getByRole("option", { name: "No saved sessions" }))
      .toBeInTheDocument();
  });

  it("resumes a server session, commits a decision, advances, and undoes it", async () => {
    const first = {
      _id: "66b000000000000000000001",
      original_id: "66b000000000000000000011",
      start: "2026-08-10T10:00:00.000Z",
      end: "2026-08-10T10:00:05.000Z",
      speaker: "SPEAKER_00",
    };
    const second = {
      _id: "66b000000000000000000002",
      original_id: "66b000000000000000000012",
      start: "2026-08-10T10:01:00.000Z",
      end: "2026-08-10T10:01:04.000Z",
      speaker: "SPEAKER_01",
    };
    const sessionId = "66b000000000000000000050";
    const decisionId = "66b000000000000000000099";
    const session = {
      _id: sessionId,
      name: "Review 2026-08-10",
      status: "active",
      revision: 1,
      targetProfileIds: [profile._id],
      window: [
        { segmentId: first._id, groupId: "g1", status: "pending" },
        { segmentId: second._id, groupId: "g2", status: "pending" },
      ],
      groups: [
        {
          groupId: "g1",
          segmentIds: [first._id],
          start: first.start,
          end: first.end,
          durationSeconds: 5,
        },
        {
          groupId: "g2",
          segmentIds: [second._id],
          start: second.start,
          end: second.end,
          durationSeconds: 4,
        },
      ],
      segments: [first, second],
      activeSegmentId: first._id,
      loadedCount: 2,
      reviewedCount: 0,
      skippedCount: 0,
      backlogEstimate: 2,
      preferences: { autoPlay: true, groupMode: true, compactMode: true },
      querySnapshot: {
        rangeMode: "fixed",
        start: first.start,
        end: second.end,
      },
    };
    const advanced = {
      ...session,
      revision: 2,
      activeSegmentId: second._id,
      reviewedCount: 1,
      window: [
        { segmentId: first._id, groupId: "g1", status: "reviewed", decisionId },
        { segmentId: second._id, groupId: "g2", status: "pending" },
      ],
    };

    mockCallResource.mockImplementation((resource, input: any) => {
      if (resource === "mongo") return Promise.resolve([profile]);
      if (resource === "jobs") {
        return Promise.resolve({
          services: [{ id: "diarizator", status: "healthy" }],
        });
      }
      if (input.action === "identity-status") {
        return Promise.resolve(emptyStatus);
      }
      if (input.action === "list-review-sessions") {
        return Promise.resolve([session]);
      }
      if (input.action === "get-review-session") {
        return Promise.resolve(session);
      }
      if (input.action === "commit-review-decision") {
        return Promise.resolve({
          decision: { _id: decisionId },
          session: advanced,
        });
      }
      if (input.action === "undo-review-decision") {
        return Promise.resolve(session);
      }
      return Promise.resolve({});
    });

    renderPage();

    await screen.findByText(`active:${first._id}`);
    expect(screen.getByText("session:0/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "This is me" }));

    await screen.findByText(`active:${second._id}`);
    expect(screen.getByText("session:1/2")).toBeInTheDocument();
    expect(screen.getByTestId("play-on-mount")).toHaveTextContent("true");
    expect(mockCallResource).toHaveBeenCalledWith(
      "speaker-segments",
      expect.objectContaining({
        action: "commit-review-decision",
        sessionId,
        revision: 1,
        segmentIds: [first._id],
        profileId: profile._id,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText(`active:${first._id}`);
    expect(mockCallResource).toHaveBeenCalledWith("speaker-segments", {
      action: "undo-review-decision",
      decisionId,
    });
  });
});
