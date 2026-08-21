import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as userEventLib from "@testing-library/user-event";
import * as api from "@/lib/api";
import GoogleCloudSettingsPage from "./GoogleCloudSettingsPage";

const userEvent = (userEventLib as any).default || userEventLib;

vi.mock("@/lib/api", () => ({ callResource: vi.fn() }));

const mockCallResource = vi.mocked(api.callResource);

const emptyConfig = {
  enabled: false,
  profiles: [],
  promoGuard: {
    mode: "promo_guarded",
    promotionExpiresAt: "2026-09-24T00:00:00.000Z",
    stopBeforeHours: 72,
    monthlyGrossLimitUsd: 1,
    dailyGrossLimitUsd: 0.1,
    perImportGrossLimitUsd: 0.01,
  },
  limits: {
    maxFilesPerImport: 200,
    maxImageBytes: 20_000_000,
    maxPdfBytes: 32_000_000,
    maxPdfPages: 15,
  },
};

const status = {
  enabled: false,
  sourceConfigured: true,
  adc: { configured: true, credentialPathConfigured: true },
  promoGuard: { ...emptyConfig.promoGuard, creditVerificationFresh: false },
  usage: {
    month: "2026-08",
    day: "2026-08-21",
    grossCommittedUsd: 0.006,
    grossReservedUsd: 0.0015,
    grossMonthUsd: 0.0075,
    grossTodayUsd: 0.0075,
    monthlyLimitUsd: 1,
    dailyLimitUsd: 0.1,
    monthlyRemainingUsd: 0.9925,
    dailyRemainingUsd: 0.0925,
  },
};

describe("GoogleCloudSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallResource.mockImplementation((resource, input) => {
      if (resource === "config" && input.action === "get") {
        return Promise.resolve(emptyConfig);
      }
      if (resource === "media" && input.action === "status") {
        return Promise.resolve(status);
      }
      return Promise.resolve({});
    });
  });

  it("creates an EU ADC preset without exposing an API-key field", async () => {
    const user = userEvent.setup();
    render(<GoogleCloudSettingsPage />);

    await user.click(
      await screen.findByRole("button", { name: "Add Google Cloud preset" }),
    );

    expect(screen.getAllByText("Google Cloud EU Photo Knowledge").length)
      .toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Vertex endpoint:/).textContent).toContain("eu");
    expect(screen.getByText(/visual model:/).textContent).toContain(
      "gemini-3.5-flash-lite",
    );
    expect(screen.queryByLabelText(/API key/i)).toBeNull();

    await user.type(
      screen.getByLabelText("Google project ID"),
      "mycelia-media-260821",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith("config", {
        action: "patch",
        path: "mediaKnowledge",
        updates: expect.objectContaining({
          activeProfileId: "google-cloud-media",
          profiles: [expect.objectContaining({
            providerType: "google-cloud",
            projectId: "mycelia-media-260821",
            location: "eu",
            enabled: false,
          })],
        }),
      });
    });
  });

  it("shows the conservative committed and reserved usage ledger", async () => {
    render(<GoogleCloudSettingsPage />);

    expect(await screen.findByText("$0.0075 / $1.00")).toBeTruthy();
    expect(screen.getByText("Committed")).toBeTruthy();
    expect(screen.getByText("$0.0060")).toBeTruthy();
    expect(screen.getByText("Reserved")).toBeTruthy();
    expect(screen.getByText("$0.0015")).toBeTruthy();
  });
});
