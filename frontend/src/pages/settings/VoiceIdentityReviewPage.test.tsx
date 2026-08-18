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
      <span>editing:{props.editingLabel ?? "no"}</span>
      <button type="button" onClick={() => props.onDecision("me")}>Sky</button>
      <button type="button" onClick={() => props.onDecision("not-me")}>
        Not Sky
      </button>
      <button type="button" onClick={() => props.onDecision("skip")}>
        Skip
      </button>
      <button
        type="button"
        onClick={() => props.onAssignProfile?.("66b000000000000000000020")}
      >
        Assign Belka
      </button>
      <button type="button" onClick={props.onEdit} disabled={!props.canEdit}>
        Edit active
      </button>
      <button type="button" onClick={props.onCancelEdit}>Cancel edit</button>
      <button type="button" onClick={props.onUndo} disabled={!props.canUndo}>
        Undo
      </button>
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
};
const emptyPreview = {
  profile: {
    id: profile._id,
    name: "Sky",
    revision: 3,
    embeddingSpaceId: "space-v1",
  },
  counts: {
    positive: 0,
    negative: 0,
    total: 0,
    recordings: 0,
    incompatible: 0,
  },
  recordings: [],
  calibrationRecordingIds: [],
  validationRecordingIds: [],
  automaticSplit: true,
  thresholds: null,
  calibrationMetrics: null,
  validationMetrics: null,
  blockers: ["100 more compatible labels needed in total"],
  canValidate: false,
};
const readyPreview = {
  ...emptyPreview,
  counts: {
    positive: 55,
    negative: 53,
    total: 108,
    recordings: 3,
    incompatible: 0,
  },
  recordings: [
    {
      id: "66b000000000000000000011",
      positive: 30,
      negative: 25,
      total: 55,
      start: "2026-08-09T10:00:00.000Z",
      end: "2026-08-09T10:30:00.000Z",
    },
  ],
  calibrationRecordingIds: ["66b000000000000000000011"],
  validationRecordingIds: ["66b000000000000000000012"],
  thresholds: { positiveThreshold: 0.72, negativeThreshold: 0.41 },
  calibrationMetrics: {
    total: 60,
    positives: 30,
    negatives: 30,
    identified: 25,
    rejected: 20,
    uncertain: 15,
    positivePrecision: 1,
    positiveRecall: 0.83,
    negativePrecision: 1,
    negativeRecall: 0.67,
  },
  validationMetrics: {
    total: 48,
    positives: 25,
    negatives: 23,
    identified: 20,
    rejected: 15,
    uncertain: 13,
    positivePrecision: 0.985,
    positiveRecall: 0.8,
    negativePrecision: 1,
    negativeRecall: 0.65,
  },
  blockers: [],
  canValidate: true,
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
      if (input.action === "calibration-preview") {
        return Promise.resolve(emptyPreview);
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

  it("runs the global identity classification only from the manual button", async () => {
    mockCallResource.mockImplementation((resource, input: any) => {
      if (resource === "mongo") return Promise.resolve([profile]);
      if (resource === "jobs") return Promise.resolve({ services: [] });
      if (input.action === "identity-status") {
        return Promise.resolve(emptyStatus);
      }
      if (input.action === "identity-classification") {
        return Promise.resolve({
          asOf: "2026-08-18T08:00:00.000Z",
          classification: {
            identified: 10,
            unknown: 2,
            uncertain: 3,
            unclassified: 4,
          },
        });
      }
      if (input.action === "calibration-preview") {
        return Promise.resolve(emptyPreview);
      }
      if (input.action === "list-review-sessions") return Promise.resolve([]);
      return Promise.resolve({});
    });

    renderPage();

    const calculate = await screen.findByRole("button", {
      name: "Calculate exact",
    });
    expect(mockCallResource).not.toHaveBeenCalledWith(
      "speaker-segments",
      expect.objectContaining({ action: "identity-classification" }),
    );

    fireEvent.click(calculate);

    await screen.findByRole("button", { name: "Recalculate exact" });
    expect(mockCallResource).toHaveBeenCalledWith("speaker-segments", {
      action: "identity-classification",
    });
    expect(screen.getByText("10")).toBeInTheDocument();
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
      if (input.action === "calibration-preview") {
        return Promise.resolve(emptyPreview);
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
    fireEvent.click(screen.getByRole("button", { name: "Sky" }));

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
      sessionId,
      revision: 2,
    });
  });

  it("shows manual profile labels and revises one reviewed segment without changing counts", async () => {
    const belka = {
      _id: "66b000000000000000000020",
      name: "Belka",
      is_primary: false,
      revision: 1,
      embeddingSpaceId: "legacy-unknown",
    };
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
    const oldDecisionId = "66b000000000000000000099";
    const newDecisionId = "66b000000000000000000100";
    const session = {
      _id: sessionId,
      name: "Review 2026-08-10",
      status: "active",
      revision: 3,
      targetProfileIds: [profile._id],
      window: [
        {
          segmentId: first._id,
          groupId: "g1",
          status: "reviewed",
          decisionId: oldDecisionId,
          decisionSummary: {
            decisionId: oldDecisionId,
            profileId: belka._id,
            profileName: "Belka",
            excludedProfileIds: [profile._id],
            excludedProfileNames: ["Sky"],
            source: "manual",
            updatedAt: "2026-08-12T08:00:00.000Z",
          },
        },
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
      activeSegmentId: second._id,
      loadedCount: 2,
      reviewedCount: 1,
      skippedCount: 0,
      backlogEstimate: 2,
      preferences: { autoPlay: true, groupMode: true, compactMode: true },
      querySnapshot: {
        rangeMode: "fixed",
        start: first.start,
        end: second.end,
      },
    };
    const revised = {
      ...session,
      revision: 4,
      window: [
        {
          ...session.window[0],
          decisionId: newDecisionId,
          decisionSummary: {
            decisionId: newDecisionId,
            profileId: null,
            profileName: null,
            excludedProfileIds: [profile._id],
            excludedProfileNames: ["Sky"],
            source: "manual",
            updatedAt: "2026-08-12T08:05:00.000Z",
          },
        },
        session.window[1],
      ],
    };

    mockCallResource.mockImplementation((resource, input: any) => {
      if (resource === "mongo") return Promise.resolve([profile, belka]);
      if (resource === "jobs") {
        return Promise.resolve({
          services: [{ id: "diarizator", status: "healthy" }],
        });
      }
      if (input.action === "identity-status") {
        return Promise.resolve(emptyStatus);
      }
      if (input.action === "calibration-preview") {
        return Promise.resolve(emptyPreview);
      }
      if (input.action === "list-review-sessions") {
        return Promise.resolve([session]);
      }
      if (input.action === "get-review-session") {
        return Promise.resolve(session);
      }
      if (input.action === "revise-review-decision") {
        return Promise.resolve({
          decision: { _id: newDecisionId },
          session: revised,
        });
      }
      return Promise.resolve({});
    });

    renderPage();

    await screen.findByText("Belka · Manual");
    fireEvent.click(screen.getByRole("button", { name: "Edit segment 1" }));
    await screen.findByText(`active:${first._id}`);
    expect(screen.getByText("editing:Belka")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not Sky" }));

    await waitFor(() =>
      expect(mockCallResource).toHaveBeenCalledWith(
        "speaker-segments",
        expect.objectContaining({
          action: "revise-review-decision",
          sessionId,
          revision: 3,
          segmentIds: [first._id],
          replacesDecisionId: oldDecisionId,
          excludedProfileIds: [profile._id],
        }),
      )
    );
    expect(await screen.findByText("Not Sky · Manual")).toBeInTheDocument();
    expect(screen.getByText("session:1/2")).toBeInTheDocument();
  });

  it("shows server-computed calibration metrics instead of editable confidence fields", async () => {
    mockCallResource.mockImplementation((resource, input: any) => {
      if (resource === "mongo") return Promise.resolve([profile]);
      if (resource === "jobs") return Promise.resolve({ services: [] });
      if (input.action === "identity-status") {
        return Promise.resolve(emptyStatus);
      }
      if (input.action === "calibration-preview") {
        return Promise.resolve(readyPreview);
      }
      if (input.action === "list-review-sessions") return Promise.resolve([]);
      return Promise.resolve({});
    });

    renderPage();

    await screen.findByText("Minimum reached");
    await screen.findByText("98.5%");
    expect(screen.getByText("0.720")).toBeInTheDocument();
    expect(screen.queryByLabelText(/positive threshold/i)).not
      .toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: /save validated calibration/i,
    })).toBeEnabled();
  });

  it("shows split blockers and warns when the minimum spans only three recordings", async () => {
    const blockedPreview = {
      ...readyPreview,
      blockers: [
        "Validation set needs both target and not-target examples",
        "No threshold pair reaches the target precision on calibration audio",
        "Validation auto-match precision is below 98%",
      ],
      canValidate: false,
    };
    mockCallResource.mockImplementation((resource, input: any) => {
      if (resource === "mongo") return Promise.resolve([profile]);
      if (resource === "jobs") return Promise.resolve({ services: [] });
      if (input.action === "identity-status") {
        return Promise.resolve(emptyStatus);
      }
      if (input.action === "calibration-preview") {
        return Promise.resolve(blockedPreview);
      }
      if (input.action === "list-review-sessions") return Promise.resolve([]);
      return Promise.resolve({});
    });

    renderPage();

    await screen.findByText("Split blocked");
    for (const blocker of blockedPreview.blockers) {
      expect(screen.getAllByText(blocker).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Only 3 source recordings/i)).toBeInTheDocument();
  });

  it("marks a validated calibration as ready for the 24-hour pilot", async () => {
    const calibratedStatus = {
      ...emptyStatus,
      calibrations: [{ calibrationId: "sky-r3", status: "validated" }],
    };
    mockCallResource.mockImplementation((resource, input: any) => {
      if (resource === "mongo") return Promise.resolve([profile]);
      if (resource === "jobs") return Promise.resolve({ services: [] });
      if (input.action === "identity-status") {
        return Promise.resolve(calibratedStatus);
      }
      if (input.action === "calibration-preview") {
        return Promise.resolve(readyPreview);
      }
      if (input.action === "list-review-sessions") return Promise.resolve([]);
      return Promise.resolve({});
    });

    renderPage();

    await screen.findByText("Validated");
    expect(screen.getByText(/Pilot ready/i)).toBeInTheDocument();
  });
});
