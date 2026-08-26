import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

function renderMediaPage() {
  return render(
    <MemoryRouter>
      <MediaPage />
    </MemoryRouter>,
  );
}

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
          storageMode: "external_reference",
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

  it("keeps metadata-only uploads available when recognition is disabled", async () => {
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "status") {
        return Promise.resolve({
          enabled: false,
          sourceConfigured: false,
          activeProfileId: undefined,
          profiles: [],
        });
      }
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [] });
      }
      return Promise.resolve({});
    });

    renderMediaPage();

    const input = await screen.findByLabelText("Choose files");
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(
      screen.getByText(/Local managed uploads, previews, EXIF\/GPS/),
    ).toBeTruthy();
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
    renderMediaPage();

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

  it("imports and renders a staged inventory row without queueing recognition", async () => {
    const user = userEvent.setup();
    renderMediaPage();

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

  it("explains mounted paths and does not submit an absolute host path", async () => {
    const user = userEvent.setup();
    renderMediaPage();

    const input = await screen.findByLabelText(
      "Relative folder or file path",
    );
    await user.clear(input);
    await user.type(input, "/Users/example/Pictures");
    await user.click(
      screen.getByRole("button", { name: "Analyze mounted path" }),
    );

    expect(screen.getByText(/MEDIA_SOURCE_HOST_PATH/)).toBeTruthy();
    expect(mockCallResource).not.toHaveBeenCalledWith(
      "media",
      expect.objectContaining({ action: "analyzeSource" }),
    );
  });

  it("trims a mounted relative path before analysis", async () => {
    const user = userEvent.setup();
    renderMediaPage();

    const input = await screen.findByLabelText(
      "Relative folder or file path",
    );
    await user.clear(input);
    await user.type(input, " 2026/photos ");
    await user.click(
      screen.getByRole("button", { name: "Analyze mounted path" }),
    );

    expect(mockCallResource).toHaveBeenCalledWith("media", {
      action: "analyzeSource",
      relativePath: "2026/photos",
    });
    expect(await screen.findByText("External reference")).toBeTruthy();
  });

  it("does not auto-select a disabled active provider", async () => {
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "status") {
        return Promise.resolve({
          enabled: true,
          sourceConfigured: true,
          activeProfileId: "google-cloud-media",
          profiles: [{
            id: "google-cloud-media",
            name: "Google Cloud EU Photo Knowledge",
            providerType: "google-cloud",
            enabled: false,
            allowGlobalPhotoAnalysis: false,
          }],
        });
      }
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [] });
      }
      if (input.action === "analyzeSource") {
        return Promise.resolve({
          importId: "import-disabled-profile",
          storageMode: "external_reference",
          grossEstimateUsd: 0,
          provider: { id: null, name: "Metadata only", providerType: "none" },
          requestedTasks: [],
          items: [],
        });
      }
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    renderMediaPage();

    const provider = await screen.findByLabelText("Recognition provider");
    expect((provider as HTMLSelectElement).value).toBe("");
    await user.click(
      screen.getByRole("button", { name: "Analyze mounted path" }),
    );
    expect(mockCallResource).toHaveBeenCalledWith("media", {
      action: "analyzeSource",
      relativePath: ".",
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

    renderMediaPage();

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

  it("discloses the active search provider independently of the import selector", async () => {
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "status") {
        return Promise.resolve({
          enabled: true,
          sourceConfigured: true,
          activeProfileId: "google-cloud-media",
          profiles: [{
            id: "google-cloud-media",
            name: "Google Cloud EU Photo Knowledge",
            providerType: "google-cloud",
            enabled: true,
            allowGlobalPhotoAnalysis: false,
          }],
        });
      }
      if (input.action === "listAssets") {
        return Promise.resolve({ assets: [] });
      }
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <MediaPage />
      </MemoryRouter>,
    );

    await user.selectOptions(
      await screen.findByLabelText("Recognition provider"),
      "",
    );
    expect(
      screen.getByText(/active provider Google Cloud EU Photo Knowledge/),
    ).toBeTruthy();
    expect(screen.getByText(/at most \$0\.0004/)).toBeTruthy();
    expect(
      (screen.getByLabelText("Semantic photo search") as HTMLInputElement)
        .maxLength,
    ).toBe(512);
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
    renderMediaPage();

    await user.click(
      await screen.findByRole("button", { name: "Details" }),
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

  it("filters unprocessed assets and queues an explicitly selected batch", async () => {
    const confirm = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    mockCallResource.mockImplementation((_resource, input) => {
      if (input.action === "status") {
        return Promise.resolve({
          enabled: true,
          activeProfileId: "google-media",
          profiles: [{
            id: "google-media",
            name: "Google media",
            providerType: "google-cloud",
            enabled: true,
            allowGlobalPhotoAnalysis: false,
          }],
        });
      }
      if (input.action === "listAssets") {
        const allAssets = [{
          _id: "asset-staged",
          fileName: "unprocessed.jpg",
          kind: "image",
          status: "staged",
          source: { relativePath: "unprocessed.jpg" },
          thumbnailUrl: "/api/files/unprocessed",
          metadata: { exif: { Make: "Apple", Model: "iPhone" } },
        }, {
          _id: "asset-ready",
          fileName: "ready.jpg",
          kind: "image",
          status: "ready",
          currentRunId: "run-ready",
          source: { relativePath: "ready.jpg" },
          thumbnailUrl: "/api/files/ready",
          inventory: { processed: true, shortCaption: "Ready photo" },
        }];
        const selectedAssets = input.inventoryFilter === "unprocessed"
          ? allAssets.filter((asset) => asset.status === "staged")
          : allAssets;
        return Promise.resolve({
          total: selectedAssets.length,
          assets: selectedAssets,
        });
      }
      if (input.action === "retry") {
        return Promise.resolve({ queued: true, jobId: "job-1" });
      }
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <MediaPage />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Unprocessed" }),
    );
    expect(screen.getByText("unprocessed.jpg")).toBeTruthy();
    expect(screen.queryByText("ready.jpg")).toBeNull();
    await user.click(screen.getByLabelText("Select unprocessed.jpg"));
    await user.click(
      screen.getByRole("button", { name: "Process selected (1)" }),
    );

    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith("media", {
        action: "retry",
        assetId: "asset-staged",
        profileId: "google-media",
        requestedTasks: ["visual-understanding"],
      });
    });
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });
});
