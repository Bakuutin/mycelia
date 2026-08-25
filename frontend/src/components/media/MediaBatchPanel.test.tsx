import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as userEventLib from "@testing-library/user-event";
import * as api from "@/lib/api";
import { MediaBatchPanel } from "./MediaBatchPanel";

const userEvent = (userEventLib as any).default || userEventLib;

vi.mock("@/lib/api", () => ({ callResource: vi.fn() }));
const mockCallResource = vi.mocked(api.callResource);

const status = {
  enabled: true,
  activeProfileId: "google-cloud-media",
  profiles: [{
    id: "google-cloud-media",
    name: "Google Cloud EU Photo Knowledge",
    enabled: true,
    providerType: "google-cloud",
  }],
};

describe("MediaBatchPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
  });

  it("builds one exact visual plus OCR batch before confirmation", async () => {
    const user = userEvent.setup();
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "previewRecognitionBatch") {
        return Promise.resolve({
          previewId: "68a000000000000000000001",
          eligibleCount: 928,
          missingOriginalCount: 1,
          authorizedGrossUsd: 6.96,
          perAssetGrossUsd: 0.0075,
        });
      }
      if (input.action === "confirmRecognitionBatch") {
        return Promise.resolve({
          batch: {
            _id: "68a000000000000000000002",
            status: "queued",
            authorizedGrossUsd: 6.96,
            counts: { total: 928, pending: 928 },
          },
        });
      }
      return Promise.resolve({});
    });

    render(
      <MemoryRouter>
        <MediaBatchPanel status={status} onInventoryChanged={vi.fn()} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", {
      name: "Process all with Google Cloud EU Photo Knowledge",
    }));

    expect(mockCallResource).toHaveBeenCalledWith("media-library", {
      action: "previewRecognitionBatch",
      profileId: "google-cloud-media",
      requestedTasks: ["visual-understanding", "ocr"],
    });
    expect(await screen.findByText(/Exact selection:/)).toBeTruthy();
    expect(screen.getByText(/\$6\.96/)).toBeTruthy();

    await user.click(screen.getByRole("button", {
      name: "Confirm this exact batch",
    }));
    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith("media-library", {
        action: "confirmRecognitionBatch",
        previewId: "68a000000000000000000001",
        consent: true,
      });
    });
    expect(await screen.findByText(/pending 928/)).toBeTruthy();
  });

  it("starts the mounted folder campaign with the relative 900-photo path", async () => {
    const user = userEvent.setup();
    mockCallResource.mockResolvedValue({
      campaign: {
        _id: "68a000000000000000000003",
        relativePath: "900-photos",
        status: "scanning",
        counts: { total: 900, pending: 900 },
      },
    });
    render(
      <MemoryRouter>
        <MediaBatchPanel status={status} onInventoryChanged={vi.fn()} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Scan" }));
    expect(mockCallResource).toHaveBeenCalledWith("media-library", {
      action: "startFolderScan",
      relativePath: "900-photos",
    });
    expect(await screen.findByText(/total 900/)).toBeTruthy();
  });
});
