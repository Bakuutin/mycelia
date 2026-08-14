import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as userEventLib from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import * as api from "@/lib/api";
import TranscriptionSettingsPage from "./TranscriptionSettingsPage";

const userEvent = (userEventLib as any).default || userEventLib;

vi.mock("@/lib/api", () => ({
  callResource: vi.fn(),
}));

const mockCallResource = vi.mocked(api.callResource);

const config = {
  transcription: {
    baseUrl: "http://host.docker.internal:10301",
    apiKey: "local-no-auth",
    model: "large-v3",
    batchSize: 8,
    batchTimeoutBaseSeconds: 120,
    batchTimeoutPerSequenceSeconds: 60,
  },
  transcriptionProfiles: {
    includeEnvironment: true,
    environmentPriority: 30,
    profiles: [
      {
        id: "local",
        name: "Local Argmax",
        baseUrl: "http://host.docker.internal:10301",
        apiKey: "local-no-auth",
        model: "large-v3",
        enabled: true,
        priority: 10,
        concurrency: 1,
      },
      {
        id: "remote",
        name: "Remote Whisper",
        baseUrl: "https://stt.example.com",
        apiKey: "remote-key",
        model: "whisper",
        enabled: true,
        priority: 20,
        concurrency: 2,
      },
    ],
  },
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <TranscriptionSettingsPage />
    </MemoryRouter>,
  );

describe("TranscriptionSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallResource.mockImplementation((resource, input) => {
      if (resource === "config" && input.action === "get") {
        return Promise.resolve(config);
      }
      if (
        resource === "transcription" && input.action === "environment_status"
      ) {
        return Promise.resolve({
          configured: true,
          enabled: true,
          baseUrl: "http://environment-stt:8001",
          model: "large-v3-turbo",
          priority: 30,
          concurrency: 1,
          message: "Deployment-managed route",
        });
      }
      if (resource === "jobs" && input.action === "pipeline_health") {
        return Promise.resolve({
          services: [{
            id: "stt",
            routes: [
              {
                providerProfileId: "local",
                status: "healthy",
                message: "ok",
              },
              {
                providerProfileId: "remote",
                status: "unavailable",
                message: "offline",
                model: "large-v3-turbo",
              },
            ],
          }],
        });
      }
      if (resource === "transcription" && input.action === "models") {
        return Promise.resolve({
          success: true,
          message: "Provider reports loaded model large-v3-turbo",
          reportedModel: "large-v3-turbo",
          models: ["large-v3-turbo"],
        });
      }
      return Promise.resolve({ success: true, message: "ok" });
    });
  });

  it("shows every STT server and switches the selected editor", async () => {
    renderPage();

    expect(await screen.findByText("Local Argmax")).toBeInTheDocument();
    expect(screen.getByText("Remote Whisper")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Local Argmax")).toBeInTheDocument();

    await userEvent.setup().click(
      screen.getByRole("button", { name: /Remote Whisper/ }),
    );

    expect(screen.getByDisplayValue("Remote Whisper")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://stt.example.com"))
      .toBeInTheDocument();
  });

  it("saves priority and total enabled slots", async () => {
    renderPage();
    await screen.findByText("Local Argmax");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Remote Whisper/ }));
    const priority = screen.getByLabelText("Priority");
    await user.clear(priority);
    await user.type(priority, "5");
    await user.click(
      screen.getByRole("button", { name: "Save all STT servers" }),
    );

    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith(
        "config",
        expect.objectContaining({
          action: "patch",
          updates: expect.objectContaining({
            transcriptionProfiles: expect.objectContaining({
              profiles: expect.arrayContaining([
                expect.objectContaining({ id: "remote", priority: 5 }),
              ]),
            }),
          }),
        }),
      );
      expect(mockCallResource).toHaveBeenCalledWith("jobs", {
        action: "set_worker_concurrency",
        workerType: "transcription",
        concurrency: 4,
      });
    });
  });

  it("shows the environment route as a read-only deployment-managed server", async () => {
    renderPage();

    expect(await screen.findByText(/environment-stt:8001/)).toBeInTheDocument();
    expect(screen.getByText(/default model can only be changed in \.env/))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Use environment STT route")).toBeEnabled();
  });

  it("selects the provider-reported model when loading models", async () => {
    renderPage();
    await screen.findByText("Local Argmax");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Remote Whisper/ }));
    await user.click(screen.getByRole("button", { name: "Load models" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox"))
        .toHaveTextContent("large-v3-turbo");
    });
  });

  it("saves an intentional all-routes-disabled state", async () => {
    renderPage();
    await screen.findByText("Local Argmax");
    const user = userEvent.setup();

    await user.click(screen.getByLabelText("Use environment STT route"));
    await user.click(screen.getByLabelText("Enable Local Argmax"));
    await user.click(screen.getByRole("button", { name: /Remote Whisper/ }));
    await user.click(screen.getByLabelText("Enable Remote Whisper"));
    await user.click(
      screen.getByRole("button", { name: "Save all STT servers" }),
    );

    await waitFor(() => {
      expect(mockCallResource).toHaveBeenCalledWith(
        "config",
        expect.objectContaining({
          action: "patch",
          updates: expect.objectContaining({
            transcriptionProfiles: expect.objectContaining({
              includeEnvironment: false,
              profiles: expect.arrayContaining([
                expect.objectContaining({ id: "local", enabled: false }),
                expect.objectContaining({ id: "remote", enabled: false }),
              ]),
            }),
          }),
        }),
      );
    });
    expect(mockCallResource).not.toHaveBeenCalledWith("jobs", {
      action: "set_worker_concurrency",
      workerType: "transcription",
      concurrency: 0,
    });
    expect(screen.getByText(/all STT routes are disabled/i))
      .toBeInTheDocument();
  });
});
