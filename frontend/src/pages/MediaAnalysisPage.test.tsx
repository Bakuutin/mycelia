import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import * as userEventLib from "@testing-library/user-event";
import * as api from "@/lib/api";
import MediaAnalysisPage from "./MediaAnalysisPage";

const userEvent = (userEventLib as any).default || userEventLib;

vi.mock("@/lib/api", () => ({
  callResource: vi.fn(),
}));
vi.mock("@/components/media/AuthenticatedMediaImage", () => ({
  AuthenticatedMediaImage: (props: any) => <img {...props} />,
}));

const mockCallResource = vi.mocked(api.callResource);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const status = {
  enabled: true,
  activeProfileId: "google-media",
  profiles: [{
    id: "google-media",
    name: "Google EU Photo Knowledge",
    providerType: "google-cloud",
    enabled: true,
  }],
};

const stagedAssets = [{
  _id: "111111111111111111111111",
  fileName: "first.jpg",
  status: "staged",
  thumbnailUrl: "/thumb/first",
  storageMode: "external_reference",
  source: { relativePath: "900-photos/first.jpg" },
  inventory: {},
}, {
  _id: "222222222222222222222222",
  fileName: "second.jpg",
  status: "staged",
  thumbnailUrl: "/thumb/second",
  storageMode: "external_reference",
  source: { relativePath: "900-photos/second.jpg" },
  inventory: {},
}];

function renderPage(initialEntry = "/media/analysis") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MediaAnalysisPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="analysis-location">{location.search}</div>;
}

function baseResponse(resource: string, input: any) {
  if (resource === "media" && input.action === "status") {
    return Promise.resolve(status);
  }
  if (resource === "media-library" && input.action === "summary") {
    return Promise.resolve({
      all: 801,
      ready: 12,
      needsAttention: 2,
      missingTime: 4,
      missingLocation: 5,
    });
  }
  if (
    resource === "media-library" &&
    input.action === "listRecognitionBatches"
  ) {
    return Promise.resolve({ batches: [] });
  }
  return undefined;
}

describe("MediaAnalysisPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not let a stale filter response replace the newest result", async () => {
    const allResponse = deferred<any>();
    const readyResponse = deferred<any>();
    mockCallResource.mockImplementation((resource, input) => {
      const base = baseResponse(resource, input);
      if (base) return base;
      if (resource === "media" && input.action === "listAssets") {
        return input.inventoryFilter === "ready"
          ? readyResponse.promise
          : allResponse.promise;
      }
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(mockCallResource).toHaveBeenCalledWith(
        "media",
        expect.objectContaining({
          action: "listAssets",
          inventoryFilter: "all",
        }),
        expect.any(Object),
      )
    );
    await user.selectOptions(screen.getByLabelText("Status"), "ready");
    await waitFor(() =>
      expect(mockCallResource).toHaveBeenCalledWith(
        "media",
        expect.objectContaining({
          action: "listAssets",
          inventoryFilter: "ready",
        }),
        expect.any(Object),
      )
    );

    readyResponse.resolve({
      total: 1,
      assets: [{
        _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        fileName: "ready-new.jpg",
        status: "ready",
        inventory: { shortCaption: "Newest response" },
      }],
    });
    expect(await screen.findByText("ready-new.jpg")).toBeTruthy();

    allResponse.resolve({
      total: 1,
      assets: [{
        _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
        fileName: "stale-old.jpg",
        status: "staged",
      }],
    });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    expect(screen.queryByText("stale-old.jpg")).toBeNull();
    expect(screen.getByText("ready-new.jpg")).toBeTruthy();
  });

  it("turns all matching photos into one durable preview and confirmation", async () => {
    mockCallResource.mockImplementation((resource, input) => {
      const base = baseResponse(resource, input);
      if (base) return base;
      if (resource === "media" && input.action === "listAssets") {
        return Promise.resolve({ total: 801, assets: stagedAssets });
      }
      if (
        resource === "media-library" &&
        input.action === "previewRecognitionBatch"
      ) {
        return Promise.resolve({
          previewId: "333333333333333333333333",
          eligibleCount: 799,
          missingOriginalCount: 2,
          authorizedGrossUsd: 6.25,
        });
      }
      if (
        resource === "media-library" &&
        input.action === "confirmRecognitionBatch"
      ) {
        return Promise.resolve({
          batch: {
            _id: "444444444444444444444444",
            status: "queued",
            profileName: "Google EU Photo Knowledge",
            requestedTasks: ["visual-understanding", "ocr"],
            counts: { total: 799, pending: 799 },
          },
        });
      }
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    renderPage(
      "/media/analysis?status=unprocessed&placement=missing_location",
    );

    await screen.findByText("first.jpg");
    await user.click(
      screen.getByRole("button", { name: "Select loaded (2)" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Select all 801 matching" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Review analysis batch (801)" }),
    );

    await waitFor(() => {
      const previewCalls = mockCallResource.mock.calls.filter(([, input]) =>
        input.action === "previewRecognitionBatch"
      );
      expect(previewCalls).toHaveLength(1);
      expect(previewCalls[0]).toEqual([
        "media-library",
        {
          action: "previewRecognitionBatch",
          profileId: "google-media",
          requestedTasks: ["visual-understanding", "ocr"],
          selection: {
            mode: "all_matching",
            inventoryFilter: "unprocessed",
            placement: "missing_location",
          },
        },
      ]);
    });

    await user.click(
      await screen.findByRole("button", { name: "Confirm exact batch" }),
    );
    await waitFor(() => {
      const confirmCalls = mockCallResource.mock.calls.filter(([, input]) =>
        input.action === "confirmRecognitionBatch"
      );
      expect(confirmCalls).toEqual([[
        "media-library",
        {
          action: "confirmRecognitionBatch",
          previewId: "333333333333333333333333",
          consent: true,
        },
      ]]);
    });
    expect(
      mockCallResource.mock.calls.some(([, input]) => input.action === "retry"),
    ).toBe(false);
  });

  it("keeps filters and a new selection available while another batch runs", async () => {
    mockCallResource.mockImplementation((resource, input) => {
      if (
        resource === "media-library" &&
        input.action === "listRecognitionBatches"
      ) {
        return Promise.resolve({
          batches: [{
            _id: "555555555555555555555555",
            status: "running",
            profileName: "Google EU Photo Knowledge",
            requestedTasks: ["visual-understanding", "ocr"],
            counts: { total: 300, ready: 120, processing: 8, pending: 172 },
          }],
        });
      }
      const base = baseResponse(resource, input);
      if (base) return base;
      if (resource === "media" && input.action === "listAssets") {
        return Promise.resolve({ total: 2, assets: stagedAssets });
      }
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/Existing batches continue/)).toBeTruthy();
    expect((screen.getByLabelText("Status") as HTMLSelectElement).disabled)
      .toBe(
        false,
      );
    expect(
      (screen.getByLabelText("Search imported photos") as HTMLInputElement)
        .disabled,
    ).toBe(false);
    await user.click(
      screen.getByRole("button", { name: "Select loaded (2)" }),
    );
    expect(
      (screen.getByRole("button", {
        name: "Review analysis batch (2)",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", {
        name: "Open first.jpg",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("can select one processable photo from a deep-linked detail sheet", async () => {
    mockCallResource.mockImplementation((resource, input) => {
      const base = baseResponse(resource, input);
      if (base) return base;
      if (resource === "media" && input.action === "listAssets") {
        return Promise.resolve({ total: 0, assets: [] });
      }
      if (resource === "media" && input.action === "getAsset") {
        return Promise.resolve({
          asset: stagedAssets[0],
          pages: [],
          runs: [],
        });
      }
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    renderPage("/media/analysis?assetId=111111111111111111111111");

    await user.click(
      await screen.findByRole("button", { name: "Select this photo" }),
    );

    expect(
      screen.getByRole("button", { name: "Review analysis batch (1)" }),
    ).toBeTruthy();
  });

  it("preselects exactly one eligible deep-linked photo without preparing a preview", async () => {
    mockCallResource.mockImplementation((resource, input) => {
      const base = baseResponse(resource, input);
      if (base) return base;
      if (resource === "media" && input.action === "listAssets") {
        return Promise.resolve({ total: 2, assets: stagedAssets });
      }
      if (resource === "media" && input.action === "getAsset") {
        return Promise.resolve({
          asset: stagedAssets[0],
          pages: [],
          runs: [],
        });
      }
      if (
        resource === "media-library" &&
        input.action === "previewRecognitionBatch"
      ) {
        return Promise.resolve({
          previewId: "333333333333333333333333",
          eligibleCount: 1,
          authorizedGrossUsd: 0.01,
        });
      }
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    renderPage(
      "/media/analysis?assetId=111111111111111111111111&select=1",
    );

    expect(
      await screen.findByText("Ready to review one photo"),
    ).toBeTruthy();
    expect(screen.getByText("1 explicit photo(s) selected")).toBeTruthy();
    expect(
      mockCallResource.mock.calls.filter(([, input]) =>
        input.action === "previewRecognitionBatch"
      ),
    ).toHaveLength(0);

    await user.click(
      screen.getByRole("button", {
        name: "Continue to Review analysis batch (1)",
      }),
    );
    const reviewButton = await screen.findByRole("button", {
      name: "Review analysis batch (1)",
    });
    await waitFor(() => expect(document.activeElement).toBe(reviewButton));
    expect(screen.getByTestId("analysis-location").textContent).toBe("");
    await user.click(reviewButton);

    await waitFor(() => {
      const previewCalls = mockCallResource.mock.calls.filter(([, input]) =>
        input.action === "previewRecognitionBatch"
      );
      expect(previewCalls).toEqual([[
        "media-library",
        expect.objectContaining({
          action: "previewRecognitionBatch",
          selection: expect.objectContaining({
            mode: "explicit",
            assetIds: ["111111111111111111111111"],
          }),
        }),
      ]]);
    });
    expect(
      mockCallResource.mock.calls.some(([, input]) =>
        input.action === "confirmRecognitionBatch"
      ),
    ).toBe(false);
  });

  it.each([
    {
      status: "ready",
      title: "Description already processed",
    },
    {
      status: "source_missing",
      title: "Original photo is unavailable",
    },
  ])(
    "does not preselect a $status deep-linked photo",
    async ({ status: assetStatus, title }) => {
      const asset = {
        ...stagedAssets[0],
        status: assetStatus,
        safeError: assetStatus === "source_missing"
          ? "The original photo is not available at its mounted reference"
          : undefined,
      };
      mockCallResource.mockImplementation((resource, input) => {
        const base = baseResponse(resource, input);
        if (base) return base;
        if (resource === "media" && input.action === "listAssets") {
          return Promise.resolve({ total: 1, assets: [asset] });
        }
        if (resource === "media" && input.action === "getAsset") {
          return Promise.resolve({ asset, pages: [], runs: [] });
        }
        return Promise.resolve({});
      });
      renderPage(
        "/media/analysis?assetId=111111111111111111111111&select=1",
      );

      expect(await screen.findByText(title)).toBeTruthy();
      expect(screen.getByText("0 explicit photo(s) selected")).toBeTruthy();
      expect(
        screen.queryByRole("button", {
          name: "Continue to Review analysis batch (1)",
        }),
      ).toBeNull();
      expect(
        mockCallResource.mock.calls.some(([, input]) =>
          input.action === "previewRecognitionBatch" ||
          input.action === "confirmRecognitionBatch"
        ),
      ).toBe(false);
    },
  );
});
