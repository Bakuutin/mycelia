import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupPage from "./SetupPage";

const tokenCommand =
  "docker exec -it -w /app mycelia-media-89da-backend-1 deno run -A server.ts token-create --name Browser-2026-08-21";

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({
    apiEndpoint: "http://127.0.0.1:3211",
    clientId: "",
    clientSecret: "",
    setApiEndpoint: vi.fn(),
    setClientId: vi.fn(),
    setClientSecret: vi.fn(),
  }),
}));

vi.mock("@/lib/setupCommands", () => ({
  getDockerSetupEndpoint: () => "http://127.0.0.1:3211",
  getDockerTokenCommand: () => tokenCommand,
  isMediaDevSetupLocation: () => true,
}));

vi.mock("@/lib/auth", () => ({
  exchangeApiKeyForJWT: vi.fn(),
}));

describe("SetupPage isolated media stack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
  });

  it("shows the working token command for port 3211", () => {
    render(
      <MemoryRouter initialEntries={["/setup"]}>
        <SetupPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("See how to generate them"));

    expect(screen.getByText(tokenCommand)).toBeTruthy();
    expect(screen.getByText("http://127.0.0.1:3211")).toBeTruthy();
    expect(screen.queryByText("Local development (deno task dev)")).toBeNull();
  });
});
