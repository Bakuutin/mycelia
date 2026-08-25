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

  it("scans the mounted root by default and shows durable progress", async () => {
    const user = userEvent.setup();
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listMountedFolders") {
        return Promise.resolve({
          listing: {
            currentPath: ".",
            folders: [{ name: "900-photos", relativePath: "900-photos" }],
          },
        });
      }
      if (input.action === "getActiveFolderCampaign") {
        return Promise.resolve({ campaign: null });
      }
      return Promise.resolve({
        campaign: {
          _id: "68a000000000000000000003",
          relativePath: ".",
          status: "scanning",
          counts: {
            total: 904,
            pending: 775,
            processing: 1,
            ready: 24,
            unsupported: 103,
          },
          progress: {
            stage: "metadata_scan",
            processed: 25,
            total: 801,
            remaining: 776,
            percent: 3.1,
            filesPerSecond: 1.6,
            etaSeconds: 485,
            chunkSize: 25,
            message: "Reading metadata and hashes locally; Google is not used",
            nextStep: "Review the report and confirm the local import",
            lastProgressAt: new Date().toISOString(),
          },
        },
      });
    });
    render(
      <MemoryRouter>
        <MediaBatchPanel status={status} onInventoryChanged={vi.fn()} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", {
      name: "Scan selected folder recursively",
    }));
    expect(mockCallResource).toHaveBeenCalledWith("media-library", {
      action: "startFolderScan",
      relativePath: ".",
    });
    expect(await screen.findByText(/25 of 801 supported files checked/))
      .toBeTruthy();
    expect(screen.getByText(/about 9 min remaining/)).toBeTruthy();
    expect(screen.getByText(/pending 775/)).toBeTruthy();
    expect(screen.getByText(/ready 24/)).toBeTruthy();
  });

  it("chooses a visible mounted subfolder without typing a path", async () => {
    const user = userEvent.setup();
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listMountedFolders") {
        return Promise.resolve({
          listing: input.relativePath === "."
            ? {
              currentPath: ".",
              folders: [{ name: "Trips", relativePath: "Trips" }],
            }
            : { currentPath: "Trips", parentPath: ".", folders: [] },
        });
      }
      if (input.action === "getActiveFolderCampaign") {
        return Promise.resolve({ campaign: null });
      }
      return Promise.resolve({
        campaign: {
          _id: "68a000000000000000000004",
          relativePath: "Trips",
          status: "queued",
          counts: {},
        },
      });
    });
    render(
      <MemoryRouter>
        <MediaBatchPanel status={status} onInventoryChanged={vi.fn()} />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "Trips" }));
    expect((await screen.findByText(/Selected:/)).textContent).toContain(
      "Trips",
    );
    await user.click(screen.getByRole("button", {
      name: "Scan selected folder recursively",
    }));
    expect(mockCallResource).toHaveBeenCalledWith("media-library", {
      action: "startFolderScan",
      relativePath: "Trips",
    });
  });
});
