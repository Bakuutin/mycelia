import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as userEventLib from "@testing-library/user-event";
import * as api from "@/lib/api";
import { MediaEventsPanel } from "./MediaEventsPanel";

const userEvent = (userEventLib as any).default || userEventLib;

vi.mock("@/lib/api", () => ({ callResource: vi.fn() }));
vi.mock("./AuthenticatedMediaImage", () => ({
  AuthenticatedMediaImage: (props: any) => <img {...props} />,
}));

const mockCallResource = vi.mocked(api.callResource);

const status = {
  enabled: true,
  activeProfileId: "google-media",
  profiles: [{
    id: "google-media",
    name: "Google Cloud EU Photo Knowledge",
    enabled: true,
    providerType: "google-cloud" as const,
  }],
  eventAggregation: {
    maxGapMinutes: 240,
    maxDistanceKm: 25,
    perEventGrossLimitUsd: 0.02,
  },
};

describe("MediaEventsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallResource.mockImplementation((resource, input) => {
      if (resource === "media-events" && input.action === "list") {
        return Promise.resolve({ events: [] });
      }
      if (
        resource === "media-events" &&
        input.action === "previewAggregation"
      ) {
        return Promise.resolve({
          previewId: "66c7cc330000000000000001",
          skippedWithoutTime: 1,
          eligibleAssetCount: 4,
          groupedAssetCount: 3,
          groups: [{
            index: 0,
            stableKey: "event-one",
            startAt: "2026-08-21T10:00:00.000Z",
            endAt: "2026-08-21T11:00:00.000Z",
            assetCount: 3,
            estimatedGrossUsd: 0.02,
            centroid: { latitude: 40.18, longitude: 44.51 },
            assets: [
              {
                assetId: "asset-1",
                fileName: "one.jpg",
                thumbnailUrl: "/api/files/thumb-1",
              },
              {
                assetId: "asset-2",
                fileName: "two.jpg",
                thumbnailUrl: "/api/files/thumb-2",
              },
              {
                assetId: "asset-3",
                fileName: "three.jpg",
                thumbnailUrl: "/api/files/thumb-3",
              },
            ],
            providerAssets: [
              {
                assetId: "asset-1",
                fileName: "one.jpg",
                thumbnailUrl: "/api/files/thumb-1",
              },
              {
                assetId: "asset-3",
                fileName: "three.jpg",
                thumbnailUrl: "/api/files/thumb-3",
              },
            ],
          }],
          singletons: [{
            assetId: "asset-4",
            fileName: "single.jpg",
            capturedAt: "2026-08-22T12:00:00.000Z",
            thumbnailUrl: "/api/files/thumb-4",
          }],
        });
      }
      if (
        resource === "media-events" &&
        input.action === "confirmAggregation"
      ) {
        return Promise.resolve({
          events: [{
            eventId: "66c7cc330000000000000010",
            jobId: "66c7cc330000000000000011",
          }],
        });
      }
      return Promise.resolve({});
    });
  });

  it("previews locally before explicitly queueing group understanding", async () => {
    const user = userEvent.setup();
    const onOpenAsset = vi.fn();
    render(
      <MemoryRouter>
        <MediaEventsPanel status={status} onOpenAsset={onOpenAsset} />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Build local event proposals",
      }),
    );

    expect(
      await screen.findByText(/No Google or self-hosted call has happened yet/),
    ).toBeTruthy();
    expect(screen.getByText("3 photos")).toBeTruthy();
    expect(screen.getByAltText("one.jpg")).toBeTruthy();
    expect(screen.getByAltText("three.jpg")).toBeTruthy();
    expect(screen.queryByAltText("two.jpg")).toBeNull();
    expect(screen.getByText("Single photos")).toBeTruthy();
    expect(screen.getByText("single.jpg")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenAsset).toHaveBeenCalledWith("asset-4");
    expect(screen.getByText("Maximum selected cost $0.0200")).toBeTruthy();
    expect(mockCallResource).toHaveBeenCalledWith("media-events", {
      action: "previewAggregation",
      maxGapMinutes: 240,
      maxDistanceKm: 25,
      limit: 500,
      profileId: "google-media",
    });

    await user.click(screen.getByLabelText("Queue event understanding"));
    await user.click(
      screen.getByRole("button", { name: "Confirm 1 event group(s)" }),
    );

    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith("media-events", {
        action: "confirmAggregation",
        previewId: "66c7cc330000000000000001",
        selectedGroupIndexes: [0],
        consent: true,
        queueAnalysis: true,
      });
    });
  });

  it("renders participants, highlights, and local memory links", async () => {
    mockCallResource.mockImplementation((resource, input) => {
      if (resource === "media-events" && input.action === "list") {
        return Promise.resolve({
          events: [{
            event: {
              _id: "66c7cc330000000000000010",
              status: "ready",
              currentRunId: "event-run-1",
              objectId: "66c7cc330000000000000020",
              startAt: "2026-08-21T10:00:00.000Z",
              endAt: "2026-08-21T11:00:00.000Z",
            },
            analysis: {
              title: "Прогулка",
              eventType: "walk",
              description: "Прогулка в парке",
              confidence: 0.9,
              keywords: ["парк"],
              participants: {
                visiblePeopleRange: { min: 1, max: 3 },
                groups: [{ role: "participants" }],
              },
              keyActions: [{ text: "Прогулка" }],
              highlights: [{
                ref: "asset-1",
                rank: 1,
                reason: "Лучший общий план",
              }],
              warnings: [],
            },
            assets: [{
              assetId: "asset-1",
              fileName: "one.jpg",
              thumbnailUrl: "/api/files/thumb-1",
            }],
            links: {
              audioSources: [{
                id: "audio-link",
                targetId: "66c7cc330000000000000030",
              }],
              transcriptions: [{
                id: "transcript-link",
                targetId: "66c7cc330000000000000040",
                overlap: {
                  startAt: "2026-08-21T10:10:00.000Z",
                  endAt: "2026-08-21T10:20:00.000Z",
                },
              }],
              objects: [{
                id: "object-link",
                targetId: "66c7cc330000000000000050",
              }],
            },
          }],
        });
      }
      if (resource === "media-events" && input.action === "previewAnalysis") {
        return Promise.resolve({
          previewId: "66c7cc330000000000000060",
          provider: { name: "Google Cloud EU Photo Knowledge" },
          estimatedGrossUsd: 0.02,
          providerAssets: [{
            assetId: "asset-1",
            fileName: "one.jpg",
            thumbnailUrl: "/api/files/thumb-1",
          }],
        });
      }
      if (resource === "media-events" && input.action === "retry") {
        return Promise.resolve({ queued: true, jobId: "job-1" });
      }
      return Promise.resolve({});
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <MediaEventsPanel status={status} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "Visible people per frame: 1–3; roles: participants",
      ),
    )
      .toBeTruthy();
    expect(screen.getByText("Best frames")).toBeTruthy();
    expect(screen.getByText("Лучший общий план")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Audio 1" }).getAttribute("href"),
    ).toBe("/audio/source_files/66c7cc330000000000000030");
    expect(
      screen.getByRole("link", { name: "Object 1" }).getAttribute("href"),
    ).toBe("/objects/66c7cc330000000000000050");
    expect(screen.getByRole("button", { name: "Reanalyze" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sync Event Object" }))
      .toBeTruthy();
    expect(screen.getByText(/Publishing confirms that you reviewed/))
      .toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Sync Event Object" }));
    expect(mockCallResource).toHaveBeenCalledWith("media-events", {
      action: "publishEvent",
      eventId: "66c7cc330000000000000010",
      analysisRunId: "event-run-1",
      confirm: true,
      reviewedSensitiveText: true,
    });

    await user.click(screen.getByRole("button", { name: "Reanalyze" }));
    expect(await screen.findByText("Review exactly what will be sent"))
      .toBeTruthy();
    expect(mockCallResource).toHaveBeenCalledWith("media-events", {
      action: "previewAnalysis",
      eventId: "66c7cc330000000000000010",
      profileId: "google-media",
    });

    await user.click(
      screen.getByRole("button", { name: "Confirm and queue analysis" }),
    );
    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith("media-events", {
        action: "retry",
        eventId: "66c7cc330000000000000010",
        previewId: "66c7cc330000000000000060",
        consent: true,
        idempotencyKey: expect.any(String),
      });
    });
  });
});
