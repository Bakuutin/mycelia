import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import * as userEventLib from "@testing-library/user-event";
import * as api from "@/lib/api";
import MediaPage from "./MediaPage";

const userEvent = (userEventLib as any).default || userEventLib;

vi.mock("@/lib/api", () => ({
  callResource: vi.fn(),
  apiClient: { postForm: vi.fn() },
}));
vi.mock("@/components/media/AuthenticatedMediaImage", () => ({
  AuthenticatedMediaImage: (props: any) => <img {...props} />,
}));
vi.mock("@/components/media/LazyAuthenticatedMediaImage", () => ({
  LazyAuthenticatedMediaImage: ({
    containerClassName: _containerClassName,
    path,
    ...props
  }: any) => <img src={path} {...props} />,
}));
vi.mock("@/components/media/MediaEventsPanel", () => ({
  MediaEventsPanel: ({ candidateAssetIds }: any) => (
    <div data-testid="event-candidates">{candidateAssetIds.join(",")}</div>
  ),
}));

const mockCallResource = vi.mocked(api.callResource);
const mockPostForm = vi.mocked(api.apiClient.postForm);

const baseAsset = {
  _id: "asset-1",
  fileName: "photo.jpg",
  kind: "image",
  status: "staged",
  storageMode: "managed_original",
  managedOriginal: { bucket: "media_originals", fileId: "file-1" },
  source: { relativePath: "photo.jpg" },
  thumbnailUrl: "/api/files/thumb",
  previewUrl: "/api/files/preview",
  byteLength: 2_000_000,
  metadata: {},
};

function defaultResourceResponse(input: any) {
  if (input.action === "status") {
    return Promise.resolve({
      enabled: true,
      sourceConfigured: true,
      activeProfileId: undefined,
      profiles: [],
    });
  }
  if (input.action === "listAssets") {
    return Promise.resolve({ assets: [], total: 0 });
  }
  if (input.action === "listMountedFolders") {
    return Promise.resolve({
      listing: { currentPath: ".", folders: [] },
    });
  }
  if (input.action === "getActiveFolderCampaign") {
    return Promise.resolve({ campaign: null });
  }
  return Promise.resolve({});
}

function renderMediaPage(initialEntry = "/media") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MediaPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="media-location">
      {location.pathname + location.search}
    </output>
  );
}

describe("MediaPage consolidated library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallResource.mockImplementation((_resource, input) =>
      defaultResourceResponse(input)
    );
  });

  it("shows one mounted-folder picker and routes recognition to analysis", async () => {
    renderMediaPage();

    expect(await screen.findByText("Mounted folder browser")).toBeTruthy();
    expect(screen.getAllByText("Mounted folder browser")).toHaveLength(1);
    expect(screen.queryByLabelText("Relative folder or file path")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Analyze mounted path" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Process all with Google Cloud/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Process selected/i }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Photo analysis" }).getAttribute(
        "href",
      ),
    ).toBe("/media/analysis");
    expect(
      (screen.getByLabelText("Choose files") as HTMLInputElement).disabled,
    ).toBe(false);
  });

  it("uploads locally and refreshes the gallery after confirmation", async () => {
    let confirmed = false;
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listAssets") {
        return Promise.resolve({
          assets: confirmed ? [{ ...baseAsset, fileName: "garden.jpg" }] : [],
          total: confirmed ? 1 : 0,
        });
      }
      if (input.action === "confirmImport") {
        confirmed = true;
        return Promise.resolve({
          created: [{ assetId: "asset-1", jobId: null }],
        });
      }
      return defaultResourceResponse(input);
    });
    mockPostForm.mockResolvedValue({
      importId: "upload-import-1",
      storageMode: "managed_original",
      grossEstimateUsd: 0,
      provider: { name: "Metadata only", providerType: "none" },
      requestedTasks: [],
      items: [{
        fileName: "garden.jpg",
        kind: "image",
        byteLength: 1024,
        pageCount: 1,
        estimatedGrossUsd: 0,
        sha256: "a".repeat(64),
        thumbnailUrl: "/api/files/upload-thumb",
      }],
    });
    const user = userEvent.setup();
    renderMediaPage();

    await user.upload(
      await screen.findByLabelText("Choose files"),
      new File([new Uint8Array([1, 2, 3])], "garden.jpg", {
        type: "image/jpeg",
      }),
    );

    expect(await screen.findByText("Review local import")).toBeTruthy();
    expect(screen.getByText("Managed original")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Confirm local import" }),
    );

    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith("media", {
        action: "confirmImport",
        importId: "upload-import-1",
        consent: true,
        queueRecognition: false,
      });
    });
    expect(
      await screen.findByRole("button", { name: "Open garden.jpg" }),
    ).toBeTruthy();
  });

  it("does not let an older filter response replace the current results", async () => {
    let resolveReady: ((value: any) => void) | undefined;
    let resolveUnprocessed: ((value: any) => void) | undefined;
    const readyRequest = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const unprocessedRequest = new Promise((resolve) => {
      resolveUnprocessed = resolve;
    });

    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listAssets") {
        if (input.inventoryFilter === "ready") return readyRequest;
        if (input.inventoryFilter === "unprocessed") {
          return unprocessedRequest;
        }
        return Promise.resolve({ assets: [], total: 0 });
      }
      return defaultResourceResponse(input);
    });
    const user = userEvent.setup();
    renderMediaPage();

    await screen.findByText("No media matches these filters.");
    await user.click(screen.getByRole("button", { name: "Ready" }));
    await waitFor(() => expect(resolveReady).toBeTypeOf("function"));
    await user.click(screen.getByRole("button", { name: "Unprocessed" }));
    await waitFor(() => expect(resolveUnprocessed).toBeTypeOf("function"));

    await act(async () => {
      resolveUnprocessed?.({
        assets: [{ ...baseAsset, fileName: "unprocessed.jpg" }],
        total: 1,
      });
    });
    expect(
      await screen.findByRole("button", { name: "Open unprocessed.jpg" }),
    ).toBeTruthy();

    await act(async () => {
      resolveReady?.({
        assets: [{
          ...baseAsset,
          fileName: "ready.jpg",
          status: "ready",
        }],
        total: 1,
      });
    });
    expect(
      screen.getByRole("button", { name: "Open unprocessed.jpg" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open ready.jpg" }),
    ).toBeNull();
  });

  it("keeps loaded pages and their tail cursor during a background refresh", async () => {
    const secondAsset = {
      ...baseAsset,
      _id: "asset-2",
      fileName: "second.jpg",
    };
    const thirdAsset = {
      ...baseAsset,
      _id: "asset-3",
      fileName: "third.jpg",
    };
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listAssets") {
        if (input.cursor === "cursor-1") {
          return Promise.resolve({
            assets: [secondAsset],
            total: 3,
            nextCursor: "cursor-2",
          });
        }
        if (input.cursor === "cursor-2") {
          return Promise.resolve({ assets: [thirdAsset], total: 3 });
        }
        return Promise.resolve({
          assets: [{ ...baseAsset, status: "ready" }],
          total: 3,
          nextCursor: "cursor-1",
        });
      }
      return defaultResourceResponse(input);
    });
    const user = userEvent.setup();
    renderMediaPage();

    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(
      await screen.findByRole("button", { name: "Open second.jpg" }),
    ).toBeTruthy();

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open second.jpg" }))
        .toBeTruthy()
    );

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(
      await screen.findByRole("button", { name: "Open third.jpg" }),
    ).toBeTruthy();
    expect(mockCallResource).toHaveBeenCalledWith("media", {
      action: "listAssets",
      limit: 100,
      inventoryFilter: "all",
      placement: "all",
      cursor: "cursor-2",
    });
  });

  it("opens gallery details in a dialog and keeps selection for photo events", async () => {
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [baseAsset], total: 1 });
      }
      if (input.action === "getAsset") {
        return Promise.resolve({
          asset: {
            ...baseAsset,
            capturedAt: "2024-04-05T12:00:00.000Z",
            location: { latitude: 41.7, longitude: -8.1 },
          },
          pages: [],
          annotations: [],
          runs: [],
        });
      }
      return defaultResourceResponse(input);
    });
    const user = userEvent.setup();
    renderMediaPage();

    await user.click(
      await screen.findByLabelText("Select photo.jpg for photo event"),
    );
    expect(screen.getByTestId("event-candidates").textContent).toContain(
      "asset-1",
    );
    await user.click(screen.getByRole("button", { name: "Open photo.jpg" }));

    const dialog = await screen.findByRole("dialog", { name: "photo.jpg" });
    expect(dialog).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Get description" }).getAttribute(
        "href",
      ),
    ).toBe("/media/analysis?assetId=asset-1&select=1");
    expect(
      screen.getByRole("link", { name: "Show on Map" }).getAttribute("href"),
    ).toBe("/map?photoAssetId=asset-1");
    expect(
      screen.getByRole("link", { name: "Show on Timeline" }).getAttribute(
        "href",
      ),
    ).toBe("/timeline?photoAssetId=asset-1");
    expect(
      (screen.getByRole("button", {
        name: "Review original deletion",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.getByText("Manual Timeline / Map placement")).toBeTruthy();
  });

  it("keeps general analysis but hides photo-only actions for a PDF", async () => {
    const pdfAsset = {
      ...baseAsset,
      fileName: "document.pdf",
      kind: "pdf",
    };
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [pdfAsset], total: 1 });
      }
      if (input.action === "getAsset") {
        return Promise.resolve({
          asset: pdfAsset,
          pages: [],
          annotations: [],
          runs: [],
        });
      }
      return defaultResourceResponse(input);
    });

    renderMediaPage("/media?assetId=asset-1");

    expect(
      await screen.findByRole("dialog", { name: "document.pdf" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Get description" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Open in Photo analysis" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open in Analysis" }).getAttribute(
        "href",
      ),
    ).toBe("/media/analysis?assetId=asset-1");
    expect(screen.queryByRole("link", { name: "Show on Map" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Show on Timeline" })).toBeNull();
  });

  it("preserves assetId deep links in the same dialog viewer", async () => {
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [baseAsset], total: 1 });
      }
      if (input.action === "getAsset") {
        return Promise.resolve({
          asset: baseAsset,
          pages: [],
          annotations: [],
          runs: [],
        });
      }
      return defaultResourceResponse(input);
    });

    const user = userEvent.setup();
    renderMediaPage("/media?assetId=asset-1");

    expect(
      await screen.findByRole("dialog", { name: "photo.jpg" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Provider analysis status").textContent)
      .toContain("Not processed");
    expect(
      screen.getByText(
        /No stored Google Cloud or self-hosted analysis run or result/i,
      ),
    ).toBeTruthy();
    expect(mockCallResource).toHaveBeenCalledWith("media", {
      action: "getAsset",
      assetId: "asset-1",
    });
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "photo.jpg" })).toBeNull()
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(screen.getByTestId("media-location").textContent).toBe("/media");
    expect(
      mockCallResource.mock.calls.filter(([, input]) =>
        input.action === "getAsset"
      ),
    ).toHaveLength(1);
  });

  it("identifies the active Google result and its stored projections", async () => {
    const readyAsset = {
      ...baseAsset,
      status: "ready",
      currentRunId: "run-google",
    };
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [readyAsset], total: 1 });
      }
      if (input.action === "getAsset") {
        return Promise.resolve({
          asset: readyAsset,
          visual: {
            visualUnderstanding: {
              shortCaption: "A coastal landscape",
              description: "A view of the coast.",
              scene: {
                summary: "Coast",
                environment: "outdoor",
                placeType: "coast",
                timeOfDay: "day",
              },
              peopleCount: 0,
              possibleEvent: null,
              confidence: 0.9,
              objects: [],
              activities: [],
              keywords: ["coast"],
              warnings: [],
            },
          },
          pages: [{ _id: "page-1", pageNumber: 1, text: "Sign" }],
          annotations: [{ _id: "annotation-1", type: "label", label: "sea" }],
          runs: [{
            _id: "run-google",
            state: "ready",
            providerSnapshot: {
              providerType: "google-cloud",
              name: "Google Cloud EU Photo Knowledge",
            },
            provenance: {
              providerType: "google-cloud",
              service: "Vertex AI + Cloud Vision",
              location: "europe-west4 / eu",
              modelVersion: "visual-model",
            },
          }],
        });
      }
      return defaultResourceResponse(input);
    });

    renderMediaPage("/media?assetId=asset-1");

    const providerStatus = await screen.findByLabelText(
      "Provider analysis status",
    );
    expect(providerStatus.textContent).toContain("Google Cloud result");
    expect(providerStatus.textContent).toContain(
      "Google Cloud EU Photo Knowledge",
    );
    expect(providerStatus.textContent).toContain(
      "Visual description: available",
    );
    expect(providerStatus.textContent).toContain("OCR pages: 1");
    expect(
      screen.getByRole("link", {
        name: "Open in Photo analysis",
      }).getAttribute("href"),
    ).toBe("/media/analysis?assetId=asset-1");
    expect(screen.queryByRole("link", { name: "Get description" })).toBeNull();
  });

  it("opens ready OCR-only photos as analysis history instead of promising a description", async () => {
    const readyOcrAsset = {
      ...baseAsset,
      status: "ready",
      currentRunId: "run-ocr",
    };
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [readyOcrAsset], total: 1 });
      }
      if (input.action === "getAsset") {
        return Promise.resolve({
          asset: readyOcrAsset,
          pages: [{ _id: "page-1", pageNumber: 1, text: "Receipt" }],
          annotations: [],
          runs: [{ _id: "run-ocr", state: "ready" }],
        });
      }
      return defaultResourceResponse(input);
    });

    renderMediaPage("/media?assetId=asset-1");

    expect(
      (await screen.findByRole("link", {
        name: "Open in Photo analysis",
      })).getAttribute("href"),
    ).toBe("/media/analysis?assetId=asset-1");
    expect(screen.queryByRole("link", { name: "Get description" })).toBeNull();
  });

  it("does not promise a description when a staged photo has no retained original", async () => {
    const previewOnlyAsset = {
      ...baseAsset,
      storageMode: "preview_only",
      managedOriginal: undefined,
    };
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [previewOnlyAsset], total: 1 });
      }
      if (input.action === "getAsset") {
        return Promise.resolve({
          asset: previewOnlyAsset,
          pages: [],
          annotations: [],
          runs: [],
        });
      }
      return defaultResourceResponse(input);
    });

    renderMediaPage("/media?assetId=asset-1");

    expect(
      (await screen.findByRole("link", {
        name: "Open in Photo analysis",
      })).getAttribute("href"),
    ).toBe("/media/analysis?assetId=asset-1");
    expect(screen.queryByRole("link", { name: "Get description" })).toBeNull();
  });

  it("keeps the preview-and-confirm guard for managed-original deletion", async () => {
    let deleted = false;
    mockCallResource.mockImplementation((_resource, input) => {
      const currentAsset = {
        ...baseAsset,
        storageMode: deleted ? "preview_only" : "managed_original",
        managedOriginal: deleted ? undefined : baseAsset.managedOriginal,
      };
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [currentAsset], total: 1 });
      }
      if (input.action === "getAsset") {
        return Promise.resolve({
          asset: currentAsset,
          pages: [],
          annotations: [],
          runs: [{ _id: "run-1", state: "ready" }],
        });
      }
      if (input.action === "previewOriginalDeletion") {
        return Promise.resolve({
          canDelete: true,
          deletionPreviewId: "deletion-preview-1",
          byteLength: baseAsset.byteLength,
          previewReady: true,
          analysisReady: true,
        });
      }
      if (input.action === "confirmOriginalDeletion") {
        deleted = true;
        return Promise.resolve({ success: true, storageMode: "preview_only" });
      }
      return defaultResourceResponse(input);
    });
    const user = userEvent.setup();
    renderMediaPage();

    await user.click(
      await screen.findByRole("button", { name: "Open photo.jpg" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Review original deletion" }),
    );
    expect(mockCallResource).toHaveBeenCalledWith("media", {
      action: "previewOriginalDeletion",
      assetId: "asset-1",
    });
    await user.click(
      await screen.findByRole("button", {
        name: "Permanently delete managed original",
      }),
    );

    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith("media", {
        action: "confirmOriginalDeletion",
        deletionPreviewId: "deletion-preview-1",
        confirm: true,
      });
    });
    expect(await screen.findByText(/managed original was deleted/i))
      .toBeTruthy();
  });
});
