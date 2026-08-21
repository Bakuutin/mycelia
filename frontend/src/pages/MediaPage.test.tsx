import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const mockCallResource = vi.mocked(api.callResource);
const mockPostForm = vi.mocked(api.apiClient.postForm);

describe("MediaPage local-only import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let confirmed = false;
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "status") {
        return Promise.resolve({
          enabled: true,
          sourceConfigured: true,
          activeProfileId: undefined,
          profiles: [],
        });
      }
      if (input.action === "listAssets") {
        return Promise.resolve({
          assets: confirmed
            ? [{
              _id: "asset-1",
              fileName: "photo.jpg",
              kind: "image",
              status: "staged",
              thumbnailUrl: "/api/files/thumb",
              source: { relativePath: "photo.jpg" },
            }]
            : [],
        });
      }
      if (input.action === "analyzeSource") {
        return Promise.resolve({
          importId: "import-1",
          grossEstimateUsd: 0,
          provider: { name: "Metadata only", providerType: "none" },
          includeGlobalPhotoAnalysis: false,
          items: [{
            relativePath: "photo.jpg",
            fileName: "photo.jpg",
            kind: "image",
            byteLength: 44_894,
            pageCount: 1,
            estimatedGrossUsd: 0,
            thumbnailUrl: "/api/files/thumb",
          }],
        });
      }
      if (input.action === "confirmImport") {
        confirmed = true;
        return Promise.resolve({
          created: [{ assetId: "asset-1", jobId: null }],
        });
      }
      return Promise.resolve({});
    });
  });

  it("uploads files as managed originals before confirmation", async () => {
    const user = userEvent.setup();
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
    render(<MediaPage />);

    const input = await screen.findByLabelText("Choose files");
    await user.upload(
      input,
      new File([new Uint8Array([1, 2, 3])], "garden.jpg", {
        type: "image/jpeg",
      }),
    );

    await waitFor(() => expect(mockPostForm).toHaveBeenCalledTimes(1));
    const [path, form] = mockPostForm.mock.calls[0];
    expect(path).toBe("/api/media/imports/analyze");
    expect((form as FormData).get("files")).toBeInstanceOf(File);
    expect(await screen.findByText("Managed original")).toBeTruthy();
    expect(screen.getByText("garden.jpg")).toBeTruthy();
  });

  it("imports and renders a staged card without queueing recognition", async () => {
    const user = userEvent.setup();
    render(<MediaPage />);

    await user.click(
      await screen.findByRole("button", { name: "Analyze mounted path" }),
    );
    expect(mockCallResource).toHaveBeenCalledWith("media", {
      action: "analyzeSource",
      relativePath: ".",
    });
    expect(await screen.findByText("photo.jpg")).toBeTruthy();
    expect(screen.getByText("Metadata only")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm local import" }))
      .toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Confirm local import" }),
    );

    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith("media", {
        action: "confirmImport",
        importId: "import-1",
        consent: true,
        queueRecognition: false,
      });
      expect(screen.getByText("staged")).toBeTruthy();
      expect(screen.getAllByText("photo.jpg").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("defaults a selected provider to visual understanding, not OCR", async () => {
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "status") {
        return Promise.resolve({
          enabled: true,
          sourceConfigured: true,
          activeProfileId: "self-hosted-media",
          profiles: [{
            id: "self-hosted-media",
            name: "Self-hosted visual model",
            providerType: "self-hosted",
            enabled: true,
            baseUrl: "http://media-provider:8090",
          }],
        });
      }
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [] });
      }
      return Promise.resolve({});
    });

    render(<MediaPage />);

    expect(
      (await screen.findByRole("switch", {
        name: "Visual understanding (primary)",
      })).getAttribute("data-state"),
    ).toBe("checked");
    expect(
      screen.getByRole("switch", { name: "Extract text (OCR)" }).getAttribute(
        "data-state",
      ),
    ).toBe("unchecked");
  });

  it("requires a deletion preview before deleting a managed original", async () => {
    let deleted = false;
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "status") {
        return Promise.resolve({
          enabled: true,
          sourceConfigured: false,
          profiles: [],
        });
      }
      if (input.action === "listAssets") {
        return Promise.resolve({
          assets: [{
            _id: "asset-managed",
            fileName: "managed.jpg",
            kind: "image",
            status: "ready",
            storageMode: deleted ? "preview_only" : "managed_original",
            managedOriginal: deleted
              ? undefined
              : { bucket: "media_originals", fileId: "file-1" },
            thumbnailUrl: "/api/files/thumb",
          }],
        });
      }
      if (input.action === "getAsset") {
        return Promise.resolve({
          asset: {
            _id: "asset-managed",
            fileName: "managed.jpg",
            kind: "image",
            status: "ready",
            storageMode: deleted ? "preview_only" : "managed_original",
            managedOriginal: deleted
              ? undefined
              : { bucket: "media_originals", fileId: "file-1" },
            previewUrl: "/api/files/preview",
            byteLength: 2_000_000,
            metadata: {},
          },
          runs: [{ _id: "run-1", state: "ready" }],
        });
      }
      if (input.action === "previewOriginalDeletion") {
        return Promise.resolve({
          canDelete: true,
          deletionPreviewId: "deletion-preview-1",
          byteLength: 2_000_000,
          previewReady: true,
          analysisReady: true,
        });
      }
      if (input.action === "confirmOriginalDeletion") {
        deleted = true;
        return Promise.resolve({ success: true, storageMode: "preview_only" });
      }
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    render(<MediaPage />);

    await user.click(
      await screen.findByRole("button", { name: "Open details" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Review original deletion" }),
    );
    expect(mockCallResource).toHaveBeenCalledWith("media", {
      action: "previewOriginalDeletion",
      assetId: "asset-managed",
    });
    await user.click(
      await screen.findByRole("button", {
        name: "Permanently delete managed original",
      }),
    );
    expect(mockCallResource).toHaveBeenCalledWith("media", {
      action: "confirmOriginalDeletion",
      deletionPreviewId: "deletion-preview-1",
      confirm: true,
    });
    expect(await screen.findByText(/managed original was deleted/i))
      .toBeTruthy();
  });
});
