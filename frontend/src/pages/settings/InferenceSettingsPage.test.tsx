import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as userEventLib from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import * as api from "@/lib/api";
import InferenceSettingsPage from "./InferenceSettingsPage";

const userEvent = (userEventLib as any).default || userEventLib;

vi.mock("@/lib/api", () => ({
  callResource: vi.fn(),
}));

const mockCallResource = vi.mocked(api.callResource);

let serverProbeResponse: Record<string, unknown>;

const config = {
  llmProfiles: {
    includeEnvironment: false,
    profiles: [{
      id: "selfhost",
      name: "Self-hosted",
      baseUrl: "http://selfhost.example:8080/v1",
      apiKey: "local-key",
      aliases: { medium: "old-model" },
      defaultAlias: "medium",
      modelSelectionMode: "automatic",
      enabled: true,
      priority: 10,
      concurrency: 1,
    }],
  },
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <InferenceSettingsPage />
    </MemoryRouter>,
  );

describe("InferenceSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverProbeResponse = {
      success: true,
      available: true,
      status: 200,
      latencyMs: 12,
      message: "Server is available (HTTP 200)",
    };
    mockCallResource.mockImplementation((resource, input) => {
      if (resource === "config" && input.action === "get") {
        return Promise.resolve(config);
      }
      if (resource === "llm" && input.action === "environment_status") {
        return Promise.resolve({
          configured: false,
          enabled: false,
          priority: 50,
          concurrency: 4,
          message: "Environment route is not configured",
        });
      }
      if (resource === "jobs" && input.action === "get_worker_defaults") {
        return Promise.resolve({ defaults: {} });
      }
      if (resource === "jobs" && input.action === "services_health") {
        return Promise.reject(new Error("self-host is offline"));
      }
      if (resource === "llm" && input.action === "probe") {
        return Promise.resolve(serverProbeResponse);
      }
      if (resource === "llm" && input.action === "models") {
        return Promise.resolve({
          success: true,
          serverAvailable: true,
          modelsLoaded: true,
          status: 200,
          latencyMs: 25,
          message: "Loaded 1 model from the provider catalogue",
          models: ["new-model"],
        });
      }
      return Promise.resolve({ success: true });
    });
  });

  it("shows separate server and model status with automatic substitution", async () => {
    renderPage();
    expect(await screen.findByText("Self-hosted")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Check server" }));
    expect(await screen.findByText("Online")).toHaveClass("text-green-700");
    expect(screen.getByText(/Server is available \(HTTP 200\)/))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load models" }));
    expect(await screen.findByText("1 loaded")).toHaveClass("text-green-700");
    expect(screen.getAllByText("new-model")).toHaveLength(2);
    expect(screen.getByText(/Preferred medium model/)).toHaveTextContent(
      "old-model",
    );
    expect(screen.getByText(/Automatic mode will use/)).toBeInTheDocument();
  });

  it("shows an offline server as a red status", async () => {
    serverProbeResponse = {
      success: false,
      available: false,
      status: null,
      latencyMs: 5,
      message: "Could not reach the provider server",
    };
    renderPage();
    expect(await screen.findByText("Self-hosted")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Check server" }));

    expect(await screen.findByText("Offline")).toHaveClass("text-red-700");
    expect(screen.getByText(/Could not reach the provider server/))
      .toBeInTheDocument();
  });

  it("saves a new offline provider without requiring a loaded model", async () => {
    renderPage();
    expect(await screen.findByText("Self-hosted")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add provider" }));
    const name = screen.getByLabelText("Provider name");
    await user.clear(name);
    await user.type(name, "Offline lab");
    await user.type(
      screen.getByLabelText("OpenAI-compatible base URL"),
      "http://offline.example:8080/v1",
    );
    await user.click(
      screen.getByRole("button", { name: "Save all providers" }),
    );

    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith(
        "config",
        expect.objectContaining({
          action: "patch",
          updates: expect.objectContaining({
            llmProfiles: expect.objectContaining({
              profiles: expect.arrayContaining([
                expect.objectContaining({
                  name: "Offline lab",
                  baseUrl: "http://offline.example:8080/v1",
                  aliases: {},
                }),
              ]),
            }),
          }),
        }),
      );
    });
    expect(screen.getByText(/Saved 2 provider\(s\)/)).toBeInTheDocument();
  });
});
