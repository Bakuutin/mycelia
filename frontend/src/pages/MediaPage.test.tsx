import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as userEventLib from "@testing-library/user-event";
import * as api from "@/lib/api";
import MediaPage from "./MediaPage";

const userEvent = (userEventLib as any).default || userEventLib;

vi.mock("@/lib/api", () => ({ callResource: vi.fn() }));
vi.mock("@/components/media/AuthenticatedMediaImage", () => ({
  AuthenticatedMediaImage: (props: any) => <img {...props} />,
}));

const mockCallResource = vi.mocked(api.callResource);

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

  it("imports and renders a staged card without queueing recognition", async () => {
    const user = userEvent.setup();
    render(<MediaPage />);

    await user.click(
      await screen.findByRole("button", { name: "Analyze locally" }),
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
      await screen.findByRole("switch", {
        name: "Visual understanding (primary)",
      }),
    ).toHaveAttribute("data-state", "checked");
    expect(
      screen.getByRole("switch", { name: "Extract text (OCR)" }),
    ).toHaveAttribute("data-state", "unchecked");
  });
});
